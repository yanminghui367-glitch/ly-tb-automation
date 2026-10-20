import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {SourceStore,digest} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
async function fixture(t,owner){
 const parent=await realpath(tmpdir()),dir=await mkdtemp(join(parent,'travel-timing-flow-')),store=new SourceStore(join(dir,'state.sqlite'));
 t.after(async()=>{store.close();assert.equal(dirname(dir),parent);await rm(dir,{recursive:true,force:true});});
 const task={shopId:'fixture',listing:{type:'country',country:'合成国',title:'合成任务'},business:{listing_time:'立刻上架'},adapterIssues:[]};
 const run=store.create('synthetic',task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(task)}),flow=new SourceWorkflow(owner,{runtime:dir,artifacts:join(dir,'artifacts'),store});
 return {dir,store,run,flow,shop:{id:'fixture'}};
}
test('real workflow preserves CAPTCHA blocker and a separate timing artifact for every resume',async t=>{
 let checks=0;const f=await fixture(t,{status:async()=>{checks++;return {running:true,loggedIn:false,loginState:'PAUSED_CAPTCHA'};},sessions:new Map()});
 f.flow.launch(f.run.id,f.shop);await f.flow.pending;await f.flow.resume({id:f.run.id},f.shop);await f.flow.pending;
 const saved=f.store.run(f.run.id),dir=join(f.dir,'artifacts',f.run.id),names=(await readdir(dir)).filter(n=>n.startsWith('execution-timing-'));
 assert.equal(checks,2);assert.equal(saved.state,'PAUSED_CAPTCHA');assert.equal(names.length,2);
 for(const name of names){const timing=JSON.parse(await readFile(join(dir,name),'utf8'));assert.equal(timing.evidenceMode,'full');assert.equal(timing.categories.guard.errors,1);assert.equal(timing.categories['browser-status'].calls,1);assert(timing.elapsedMs>=0);}
 const disk=JSON.parse(await readFile(join(dir,'checkpoint.json'),'utf8'));assert.equal(disk.state,'PAUSED_CAPTCHA');assert(disk.executionTiming.attemptId);
 assert(f.store.events(f.run.id).every(e=>!['SUBMITTING','SUBMIT_CLICKED','VERIFIED'].includes(e.kind)));
});
test('result-unknown execution remains verification-only with the original run and no new form',async t=>{
 let pages=0;const f=await fixture(t,{status:async()=>({running:true,loggedIn:true}),sessions:new Map([['fixture',{context:{pages:()=>{pages++;return [];}}}]])});
 f.store.move(f.run.id,'RUNNING');f.store.move(f.run.id,'SUBMITTING');f.store.move(f.run.id,'RESULT_UNKNOWN');
 f.flow.launch(f.run.id,f.shop);await f.flow.pending;
 assert.equal(f.store.run(f.run.id).state,'RESULT_UNKNOWN');assert.match(f.store.run(f.run.id).reason,/不会重新提交/);assert(pages>0);
 assert(!f.store.events(f.run.id).some(e=>['STEP_INTENT','SUBMIT_CLICKED'].includes(e.kind)));
 const disk=JSON.parse(await readFile(join(f.dir,'artifacts',f.run.id,'checkpoint.json'),'utf8'));assert.equal(disk.executionTiming.evidenceMode,'full');
});
test('unrecognized evidence mode fails safe to full diagnostics',()=>{
 const store={recover(){}};assert.equal(new SourceWorkflow({}, {store,evidenceMode:'off'}).evidenceMode,'full');assert.equal(new SourceWorkflow({}, {store,evidenceMode:'full'}).evidenceMode,'full');
});
