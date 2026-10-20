import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from './round-fixture.mjs';
import {classifyRoundFailure} from './dev/workbench/listing-round.mjs';
import {waitMaterialReadiness,DETAIL_MATERIAL_BUDGETS} from './dev/workbench/publishing-materials.mjs';
import {waitDetailMaterialFrame} from './dev/workbench/taobao-publisher.mjs';

const code='SAFE_RETRY_DETAIL_MATERIAL',step='select-detail-1';
const paused={state:'PAUSED',checkpoint:{step}};
const outcomes=[];
test.after(async()=>writeFile(new URL('./mock-outcomes.json',import.meta.url),JSON.stringify(outcomes,null,2)));

test('five-item mock: second item exhausts two safe recoveries, four complete; original attempts stay 3/3',async t=>{
 const f=await fixture(t,5);f.setBehavior(run=>run.task.priority===2?{state:'PAUSED',code,step,reason:'详情缩略图超时'}:{state:'VERIFIED'});
 const r=await f.create(),v=await f.finish(r.id),bad=f.round.items(r.id)[1],q=f.batch.store.item(bad.queue_id);
 assert.equal(v.state,'COMPLETED');assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(v.counts.FAILED,1);assert.equal(f.flow.submits,4);
 assert.equal(f.flow.launches.filter(id=>id===bad.run_id).length,3);assert.equal(bad.retry_counts[step],2);assert.equal(q.attempts,3);assert.equal(q.max_attempts,3);
 assert.equal(f.round.round(r.id).system_count,0);assert(!f.round.events(r.id).some(e=>e.kind==='SYSTEM_FAILURE'));
 outcomes.push({scenario:'five items with second detail timeout',roundState:v.state,counts:v.counts,submits:f.flow.submits,badItemAttempts:q.attempts,maxAttempts:q.max_attempts,safeRecoveries:bad.retry_counts[step]});
});

test('untyped second-item failure still blocks and leaves the other three pending',async t=>{
 const f=await fixture(t,5);f.setBehavior(run=>run.task.priority===2?{state:'PAUSED',step,reason:'untyped selector failure'}:{state:'VERIFIED'});
 const r=await f.create(),v=await f.finish(r.id);assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.NEW_SUCCESS,1);assert.equal(v.counts.PENDING,4);assert.equal(f.flow.launches.length,2);assert.equal(f.flow.submits,1);
 outcomes.push({scenario:'untyped fault',roundState:v.state,counts:v.counts,submits:f.flow.submits});
});

test('five material stages have explicit codes; guard and inspection faults keep their original identity',async()=>{
 for(const [stage,expected] of [['upload-entry','SAFE_RETRY_DETAIL_UPLOAD_ENTRY'],['upload-panel','SAFE_RETRY_DETAIL_UPLOAD_PANEL'],['upload-receipt','SAFE_RETRY_DETAIL_UPLOAD_RECEIPT'],['thumbnail',code]]){
  await assert.rejects(waitMaterialReadiness(stage,async()=>({ready:false,actual:{pending:true}}),async()=>{},{timeout:5,selector:'mock',expected:'ready'}),e=>e.code===expected&&e.materialReadiness.stage===stage&&classifyRoundFailure(e,{run:paused}).kind==='TRANSIENT');
 }
 for(const message of ['PAUSED_CAPTCHA','请人工登录目标店铺','PAGE_LEDGER_PERSISTENCE_FAILED','untyped browser transport failure']){
  const failure=Error(message);
  await assert.rejects(waitMaterialReadiness('thumbnail',async()=>({ready:true}),async()=>{throw failure;},{timeout:20,selector:'mock',expected:'ready'}),e=>e===failure&&!e.code);
 }
 const inspectFailure=Error('locator threw');await assert.rejects(waitMaterialReadiness('thumbnail',async()=>{throw inspectFailure;},async()=>{},{timeout:20,selector:'mock',expected:'ready'}),e=>e===inspectFailure&&!e.code);
 await assert.rejects(waitMaterialReadiness('unrecognized-stage',async()=>({ready:false}),async()=>{},{timeout:5,selector:'mock',expected:'ready'}),e=>!e.code&&classifyRoundFailure(e,{run:paused}).kind==='SYSTEM');
});

test('new code whitelist requires matching detail stage and pre-submit run; old code semantics retained',()=>{
 for(const [c,s] of [['SAFE_RETRY_DETAIL_PANEL','open-details'],['SAFE_RETRY_DETAIL_PANEL',step],[code,step],['SAFE_RETRY_DETAIL_UPLOAD_ENTRY',step],['SAFE_RETRY_DETAIL_UPLOAD_PANEL',step],['SAFE_RETRY_DETAIL_UPLOAD_RECEIPT',step]])assert.deepEqual(classifyRoundFailure(Object.assign(Error('wait timeout'),{code:c}),{run:{state:'PAUSED',checkpoint:{step:s}}}).kind,'TRANSIENT');
 for(const [c,run] of [['SAFE_RETRY_DETAIL_UNREVIEWED',paused],[code,{state:'PAUSED',checkpoint:{step:'submit-once'}}],[code,{state:'PAUSED',checkpoint:{step:'title'}}],[code,{state:'PAUSED',result:{itemId:'123456'},checkpoint:{step}}],[code,null]])assert.equal(classifyRoundFailure(Object.assign(Error('timeout'),{code:c}),{run}).kind,'SYSTEM');
 assert.equal(classifyRoundFailure(Object.assign(Error('network'),{code:'SAFE_RETRY_UPLOAD'}),{run:paused}).kind,'TRANSIENT');
 assert.equal(classifyRoundFailure(Object.assign(Error('timeout'),{code}),{run:{state:'RESULT_UNKNOWN',checkpoint:{step}}}).kind,'UNKNOWN');
});

test('actual iframe helper emits typed readiness failure but never types guard or origin failures',async()=>{
 const empty={count:async()=>0,evaluateAll:async()=>null};
 const page={frames:()=>[],locator:()=>empty};
 await assert.rejects(waitDetailMaterialFrame(page,async()=>{},{timeout:5}),e=>e.code==='SAFE_RETRY_DETAIL_PANEL'&&e.materialReadiness.stage==='detail-panel');
 for(const message of ['PAUSED_CAPTCHA','PAGE_LEDGER_PERSISTENCE_FAILED']){const failure=Error(message);await assert.rejects(waitDetailMaterialFrame(page,async()=>{throw failure;},{timeout:5}),e=>e===failure&&!e.code);}
 const host={evaluate:async()=>true,isVisible:async()=>true,getAttribute:async()=> 'https://foreign.invalid/',dispose:async()=>{}};
 const hosts={count:async()=>1,elementHandle:async()=>host,evaluate:async()=>true,evaluateAll:async()=>null};
 const foreign={frames:()=>[],locator:s=>s.includes('not(#mainImagesGroup)')?hosts:empty};
 await assert.rejects(waitDetailMaterialFrame(foreign,async()=>{},{timeout:20}),e=>!String(e.code||'').startsWith('SAFE_RETRY')&&/DETAIL_MATERIAL_FRAME_ORIGIN/.test(e.message));
});

test('Step 1 waiting budget bytes/values remain unchanged and Step 2 does not edit source workflow',async()=>{
 assert.deepEqual(DETAIL_MATERIAL_BUDGETS,{entry:20000,panel:8000,receipt:60000,thumbnail:30000,poll:150});
 const prior=new URL('../step1-detail-ready-20261018/dev/workbench/',import.meta.url),current=new URL('./dev/workbench/',import.meta.url);
 for(const name of ['source-workflow.mjs','execution-steps.mjs','batch-store.mjs','round-item-attempts.mjs','page-ownership.mjs','publishing-pages.mjs'])assert.deepEqual(await readFile(new URL(name,current)),await readFile(new URL(name,prior)));
});
