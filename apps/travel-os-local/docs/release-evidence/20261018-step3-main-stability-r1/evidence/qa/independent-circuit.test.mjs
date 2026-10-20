import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,shop} from './independent-fixture.mjs';
import {digest} from '../dev/workbench/source-store.mjs';

const bad=(reason='selector absent',code)=>({state:'PAUSED',step:'main-image-3',reason,code});
async function windowScenario(t,n,behavior){
 const f=await fixture(t,n);f.setBehavior(behavior);const r=await f.create();
 f.store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const w=f.round.windows.create(await f.round.windows.preview(r.id,{limit:n,autoContinue:false}));
 f.round.start(r.id,{windowId:w.id});await f.round.pending;
 return {f,r,w,v:f.round.view(r.id)};
}
async function seeded(t,n=6){
 const f=await fixture(t,n),r=await f.create();f.round.state(r.id,'RUNNING');
 const b=f.batch.store.create(f.importId,f.tasks,shop.id,'LIVE',{reviewed:true,selectionHash:digest(f.tasks),authorization:f.authorization},{roundId:r.id});
 for(const q of f.batch.store.items(b.id)){
  f.round.update(r.id,q.key,{queue_id:q.id,batch_id:b.id,entered_publish:1});
  f.batch.store.claim(q.id,{roundId:r.id});
  const run=f.store.create(f.importId,q.task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(q.task)});
  f.batch.store.attach(q.id,run.id);f.round.update(r.id,q.key,{run_id:run.id});
  f.store.move(run.id,'RUNNING');f.store.checkpoint(run.id,{step:'main-image-3'});f.store.move(run.id,'PAUSED','selector absent');
 }
 return {f,r,rows:f.round.items(r.id)};
}
const failItem=(f,r,x,reason='selector absent',code)=>f.round.failure(r.id,x,Object.assign(Error(reason),code?{code}:{}));

test('website window isolates one failure, seals FAILED once, then succeeds four without auto-retry',async t=>{
 const {f,r,w,v}=await windowScenario(t,5,x=>x.task.priority===1?bad():{state:'VERIFIED'});
 assert.equal(v.state,'COMPLETED');assert.equal(v.counts.FAILED,1);assert.equal(v.counts.NEW_SUCCESS,4);
 const x=f.round.items(r.id)[0],q=f.batch.store.item(x.queue_id),a=f.round.executionAttempts.attempts.list(r.id,x.key);
 assert.equal(a.length,1);assert.equal(a[0].outcome.state,'FAILED');assert.equal(a[0].outcome.autoRetryScheduled,false);
 assert.equal(a[0].outcome.submittedByThisAttempt,false);assert.equal(q.attempts,1);assert.equal(q.max_attempts,3);
 assert.equal(f.round.windows.get(w.id).state,'COMPLETED');assert.equal(f.flow.launches.length,5);
});
test('three distinct identical failures stop website window; no fourth launch or auto-retry',async t=>{
 const {f,r,w,v}=await windowScenario(t,5,()=>bad());assert.equal(v.state,'SYSTEM_BLOCKED');
 assert.equal(v.counts.FAILED,3);assert.equal(v.counts.PENDING,2);assert.equal(f.flow.launches.length,3);
 assert.equal(f.round.windows.get(w.id).state,'SYSTEM_BLOCKED');
 for(const x of f.round.items(r.id).slice(0,3))assert.equal(f.round.executionAttempts.attempts.list(r.id,x.key).at(-1).outcome.autoRetryScheduled,false);
});
test('five distinct heterogeneous failures stop at five',async t=>{
 const words=['alpha','bravo','charlie','delta','echo','foxtrot'];
 const {f,r,v}=await windowScenario(t,6,x=>bad(words[x.task.priority-1]));
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,5);assert.equal(f.flow.launches.length,5);
 const e=f.round.events(r.id).find(e=>e.kind==='FAILURE_CIRCUIT_OPENED');assert.equal(e.payload.sameFingerprint,1);assert.equal(e.payload.consecutiveFailures,5);
});
test('persisted audit survives coordinator reconstruction without counting same item twice',async t=>{
 const {f,r,rows}=await seeded(t);await failItem(f,r,rows[0]);
 f.round=f.make();await failItem(f,r,rows[0]);await failItem(f,r,rows[1]);
 let last=f.round.events(r.id).filter(e=>e.kind==='ITEM_FAILURE_FINALIZED').at(-1);
 assert.equal(last.payload.sameFingerprint,2);assert.equal(last.payload.consecutiveFailures,2);
 assert.equal(await failItem(f,r,rows[2]),false);assert.equal(f.round.round(r.id).state,'SYSTEM_BLOCKED');
});
for(const reset of ['NEW_SUCCESS','EXISTING_VERIFIED','MANUAL_SKIPPED','PREFLIGHT_SKIPPED'])test(reset+' breaks the audit streak',async t=>{
 const {f,r,rows}=await seeded(t);await failItem(f,r,rows[0]);await failItem(f,r,rows[1]);
 f.round.event(r.id,rows[2].key,reset,{});await failItem(f,r,rows[3]);
 const last=f.round.events(r.id).filter(e=>e.kind==='ITEM_FAILURE_FINALIZED').at(-1);
 assert.equal(last.payload.sameFingerprint,1);assert.equal(last.payload.consecutiveFailures,1);
});
test('audit write failure rolls back terminal item, queue, circuit and budgets together',async t=>{
 const {f,r,rows}=await seeded(t),x=rows[0];
 const snapshot=()=>JSON.stringify({x:f.round.item(r.id,x.key),q:f.batch.store.item(x.queue_id),r:f.round.round(r.id),events:f.round.events(r.id)});
 const before=snapshot(),event=f.round.event.bind(f.round);
 f.round.event=(id,key,kind,payload)=>{if(kind==='ITEM_FAILURE_FINALIZED')throw Error('injected audit persistence failure');return event(id,key,kind,payload);};
 await assert.rejects(failItem(f,r,x),/injected audit persistence failure/);assert.equal(snapshot(),before);
});
for(const [name,reason,code] of [
 ['browser closed','Target page, context or browser has been closed',undefined],
 ['transport disconnected','browserType.connectOverCDP: WebSocket error: socket hang up',undefined],
 ['source asset identity','SOURCE_OR_ASSET_CHANGED','ERR_ASSERTION'],
 ['another task form','ANOTHER_TASK_FORM','ERR_ASSERTION'],
 ['not a new form','NEW_ITEMS_ONLY','ERR_ASSERTION'],
 ['retained page code only','write failed','PAGE_LEDGER_PERSISTENCE_FAILED'],
 ['unclassified database failure','SQLITE_BUSY: database is locked',undefined],
 ['actual source form guard','只允许新增商品页，禁止编辑旧链接',undefined],
 ['actual auxiliary page guard','辅助页面已关闭或地址改变，请保留原素材库/商品核验页后重试','ERR_ASSERTION'],
 ['actual shop identity locator','expect(locator).toHaveText(expected) failed\nLocator: locator(\'div.UserArea_shopName__3xGhm\')\nExpected: 环球领航\nReceived: other-shop',undefined],
])test('hard gate must not isolate as product FAILED: '+name,async t=>{
 const {f,v}=await windowScenario(t,5,()=>bad(reason,code));
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,0);assert.equal(f.flow.launches.length,1);
});
test('backend query failure with old publishing checkpoint is not a new per-item failure',async t=>{
 const {f,r,rows}=await seeded(t),x=rows[0];
 f.round.active=r.id;f.store.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(x.key,r.id);
 f.round.currentOperation={roundId:r.id,key:x.key,stage:'existing-listing-check'};
 assert.equal(await failItem(f,r,x,'backend list response failed'),false);
 assert.equal(f.round.item(r.id,x.key).state,'PENDING');assert.equal(f.round.round(r.id).state,'SYSTEM_BLOCKED');
});
for(const [name,mutate] of [
 ['submitted item',({f,r,x})=>f.round.update(r.id,x.key,{submitted:1})],
 ['unknown result',({f,r,x})=>f.round.update(r.id,x.key,{submission_uncertain:1})],
 ['original submit event',({f,x})=>f.store.event(x.run_id,'SUBMIT_CLICKED',{})],
 ['page journal failure',({f,x})=>f.store.event(x.run_id,'PAGE_LEDGER_PERSISTENCE_FAILED',{})],
])test('original evidence gate preserved: '+name,async t=>{
 const {f,r,rows}=await seeded(t),x=rows[0];mutate({f,r,x});
 assert.equal(await failItem(f,r,x),false);assert.notEqual(f.round.item(r.id,x.key).state,'FAILED');
});

for(const [reason,state,expected] of [['PAUSED_CAPTCHA','PAUSED_CAPTCHA','WAITING_HUMAN'],['请人工登录目标店铺','PAUSED','WAITING_HUMAN']])test('safe-main code does not override human gate: '+reason,async t=>{
 const {f,r,v}=await windowScenario(t,5,()=>({state,reason,step:'main-image-3',code:'SAFE_RETRY_MAIN_IMAGE_STATE'}));
 assert.equal(v.state,expected);assert.equal(v.counts.FAILED,0);assert.equal(f.flow.launches.length,1);
 assert(!f.round.events(r.id).some(e=>e.kind==='SAFE_STEP_RECOVERY'));
});
for(const scenario of [
 {name:'wrong step',step:'select-detail-1'},
 {name:'submitted marker',patch:{submitted:1}},
 {name:'unknown marker',patch:{submission_uncertain:1}},
 {name:'submit journal',event:'SUBMIT_CLICKED'},
 {name:'retained-page journal',event:'PAGE_LEDGER_PERSISTENCE_FAILED'},
])test('safe-main bounded branch cannot cross '+scenario.name,async t=>{
 const {f,r,rows}=await seeded(t),x=rows[0];
 if(scenario.step)f.store.checkpoint(x.run_id,{step:scenario.step});
 if(scenario.patch)f.round.update(r.id,x.key,scenario.patch);
 if(scenario.event)f.store.event(x.run_id,scenario.event,{});
 assert.equal(await failItem(f,r,x,'readiness expired','SAFE_RETRY_MAIN_IMAGE_STATE'),false);
 const after=f.round.item(r.id,x.key);assert.equal(after.state,'PENDING');
 for(const [k,v] of Object.entries(scenario.patch||{}))assert.equal(after[k],v);
 assert(!f.round.events(r.id).some(e=>e.kind==='SAFE_STEP_RECOVERY'));
});
for(const max of [3,4])test('safe-main original '+max+'/'+max+' exhausted quota becomes FAILED without adding or scheduling attempts',async t=>{
 const {f,r,rows}=await seeded(t),x=rows[0];
 f.store.db.prepare('UPDATE batch_items SET attempts=?,max_attempts=? WHERE id=?').run(max,max,x.queue_id);
 assert.equal(await failItem(f,r,x,'readiness expired','SAFE_RETRY_MAIN_IMAGE_STATE'),true);
 const q=f.batch.store.item(x.queue_id),after=f.round.item(r.id,x.key);
 assert.equal(after.state,'FAILED');assert.equal(q.state,'FAILED');assert.equal(q.attempts,max);assert.equal(q.max_attempts,max);assert.equal(after.extra_attempts,0);assert.deepEqual(after.retry_counts,{});
 assert(!f.round.events(r.id).some(e=>e.kind==='SAFE_STEP_RECOVERY'||e.kind==='MANUAL_RETRY_BUDGET_GRANTED'));
});
test('safe-main three items exhausted after two recoveries count as three failures, not nine',async t=>{
 const {f,r,v}=await windowScenario(t,5,()=>bad('readiness expired','SAFE_RETRY_MAIN_IMAGE_STATE'));
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(v.counts.FAILED,3);assert.equal(f.flow.launches.length,9);
 assert.equal(f.round.events(r.id).filter(e=>e.kind==='ITEM_FAILURE_FINALIZED').length,3);
 const e=f.round.events(r.id).find(e=>e.kind==='FAILURE_CIRCUIT_OPENED');assert.equal(e.payload.consecutiveFailures,3);assert.equal(e.payload.sameFingerprint,3);
 for(const x of f.round.items(r.id).slice(0,3)){assert.equal(f.batch.store.item(x.queue_id).attempts,3);assert.equal(x.retry_counts['main-image-3'],2);}
});
