import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {ExecutionSteps} from '../execution-steps.mjs';
import {ExecutionTiming} from '../execution-timing.mjs';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
const stages=['open-new-form',...Array.from({length:5},(_,i)=>`main-image-${i+1}`),'close-main-image-menu','title','guide-title','price','inventory','brand','custom-service','listing-state','shipping-time','logistics','freight-template','shipping-region','single-origin','ship-from','procurement','region-restriction','attribute-pattern','attribute-subject','attribute-style','attribute-people','attribute-size','open-details',...Array.from({length:9},(_,i)=>`select-detail-${i+1}`),'insert-details','pre-submit-review','submit-once','verify-platform-result'];
async function fixture(t,{mode='key',recovery=false,screenshotError=false}={}){
 const parent=await realpath(tmpdir()),dir=await mkdtemp(join(parent,'travel-steps-')),store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{store.close();assert.equal(dirname(dir),parent);await rm(dir,{recursive:true,force:true});});
 const task={shopId:'fixture',listing:{type:'country',country:'合成国',title:'合成任务'},adapterIssues:[]};
 const run=store.create('synthetic',task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(task)});store.move(run.id,'RUNNING');
 let shots=0,guards=0,checkpoints=0;const timing=new ExecutionTiming();let steps;
 const page={screenshot:async({path})=>{shots++;if(screenshotError)throw Error('SYNTHETIC_CAPTURE_FAILURE');await writeFile(path,png);}};
 steps=new ExecutionSteps({store,id:run.id,dir,timing,mode,recovery,getPage:()=>page,checkpoint:patch=>{checkpoints++;store.checkpoint(run.id,patch);},errorText:e=>e.message,guard:()=>steps.measure('guard',async()=>{guards++;await steps.measure('identity-check',()=>Promise.resolve());})});
 return {store,run,dir,timing,steps,counts:()=>({shots,guards,checkpoints})};
}
for(const [mode,shots] of [['key',8],['full',41]])test(`${mode} mode preserves all 41 actions, 82 guards and synchronous checkpoints`,async t=>{
 const f=await fixture(t,{mode});let actions=0;
 for(const name of stages){await f.steps.run(name,async()=>{actions++;});const disk=JSON.parse(await readFile(join(f.dir,'checkpoint.json'),'utf8'));assert.equal(disk.step,name);}
 assert.equal(actions,41);assert.deepEqual(f.counts(),{shots,guards:82,checkpoints:41});
 const events=f.store.events(f.run.id),verified=events.filter(e=>e.kind==='STEP_VERIFIED');
 assert.equal(events.filter(e=>e.kind==='STEP_INTENT').length,41);assert.equal(verified.length,41);assert.equal(events.length,84);
 assert.equal(f.store.run(f.run.id).state,'RUNNING');assert.equal(verified.filter(e=>e.payload.screenshot).length,shots);
 for(const {payload:p} of verified){assert(p.durationMs>=0);assert.equal(p.timing.categories.guard.calls,2);assert.equal(p.timing.categories.action.calls,1);assert.equal(p.timing.categories.evidence.calls,1);if(!p.screenshotRequested){assert.equal(p.screenshot,null);assert.equal(p.screenshotAt,null);}}
 const total=f.timing.snapshot();assert.equal(total.categories.guard.calls,82);assert.equal(total.categories.persistence.calls,41);assert.equal(total.categories['identity-check'].calls,82);
});
test('action failure retains the original error and captures even a normally omitted stage',async t=>{
 const f=await fixture(t),failure=Object.assign(Error('bad material'),{code:'MATERIAL_CHANGED'});
 await assert.rejects(f.steps.run('title',async()=>{throw failure;}),e=>e===failure);
 const paused=f.store.events(f.run.id).filter(e=>e.kind==='STEP_PAUSED');assert.equal(paused.length,1);assert.equal(paused[0].payload.errorCode,failure.code);
 assert.equal(paused[0].payload.evidenceReason,'STEP_FAILED');assert.deepEqual(f.counts(),{shots:1,guards:1,checkpoints:1});
 assert.equal(paused[0].payload.timing.categories.action.errors,1);assert.deepEqual(await readFile(paused[0].payload.screenshot),png);
 await f.steps.run('price',async()=>{});assert.equal(f.store.run(f.run.id).checkpoint.step,'price');
});
test('failed capture does not replace the business error or reuse old screenshot',async t=>{
 const f=await fixture(t,{screenshotError:true}),failure=Error('business failure');f.store.checkpoint(f.run.id,{screenshot:'OLD.png'});
 await assert.rejects(f.steps.run('title',async()=>{throw failure;}),e=>e===failure);
 const saved=f.store.run(f.run.id).checkpoint;assert.equal(saved.screenshot,null);assert.match(saved.screenshotError,/SYNTHETIC_CAPTURE_FAILURE/);assert.equal(saved.error,'business failure');
});
test('recovery records its first boundary only, with ordinary following steps logged',async t=>{
 const f=await fixture(t,{recovery:true});await f.steps.run('title',async()=>{});await f.steps.run('price',async()=>{});
 const events=f.store.events(f.run.id).filter(e=>e.kind==='STEP_VERIFIED');assert.equal(events[0].payload.evidenceReason,'RECOVERY_BOUNDARY');assert.equal(events[1].payload.evidenceReason,'STRUCTURED_LOG');assert.equal(f.counts().shots,1);
});
test('empty error messages cannot be recorded as successful steps',async t=>{
 const f=await fixture(t);await assert.rejects(f.steps.run('title',async()=>{throw Error('');}));
 assert.equal(f.store.events(f.run.id).at(-1).kind,'STEP_PAUSED');assert.equal(f.counts().shots,1);
});
for(const guardNumber of [1,2])test(`guard ${guardNumber} failure retains typed error, capture and action count`,async t=>{
 const f=await fixture(t),failure=Object.assign(Error('guard failure'),{code:'SAFE_RETRY_PAGE_LOAD'});let guards=0,actions=0;
 f.steps.guard=()=>f.steps.measure('guard',async()=>{if(++guards===guardNumber)throw failure;});
 await assert.rejects(f.steps.run('title',async()=>{actions++;}),e=>e===failure);
 const last=f.store.events(f.run.id).at(-1);assert.equal(last.kind,'STEP_PAUSED');assert.equal(last.payload.errorCode,failure.code);assert.equal(last.payload.evidenceReason,'STEP_FAILED');assert.equal(actions,guardNumber===1?0:1);assert.equal(f.counts().shots,1);
});
test('successful action stays verified when its requested screenshot fails',async t=>{
 const f=await fixture(t,{screenshotError:true});await f.steps.run('insert-details',async()=>{});
 const last=f.store.events(f.run.id).at(-1);assert.equal(last.kind,'STEP_VERIFIED');assert.equal(last.payload.screenshot,null);assert.match(last.payload.screenshotError,/SYNTHETIC_CAPTURE_FAILURE/);
});
test('step completion awaits its screenshot before the next action can start',async t=>{
 const f=await fixture(t);let release,started;const startedPromise=new Promise(r=>started=r),shot=new Promise(r=>release=r),order=[];
 f.steps.getPage=()=>({screenshot:async({path})=>{order.push('capture-start');started();await shot;await writeFile(path,png);order.push('capture-complete');}});
 const first=f.steps.run('insert-details',async()=>order.push('action-one'));await startedPromise;
 assert.equal(f.store.events(f.run.id).filter(e=>e.kind==='STEP_VERIFIED').length,0);
 release();await first;await f.steps.run('title',async()=>order.push('action-two'));
 assert.deepEqual(order,['action-one','capture-start','capture-complete','action-two']);
});
