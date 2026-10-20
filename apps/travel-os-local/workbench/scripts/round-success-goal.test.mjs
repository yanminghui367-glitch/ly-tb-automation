import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './success-goal-fixture.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';

async function prepare(x,config={}){
 const input={id:x.r.id,manifestHash:x.r.manifestHash,requestId:randomUUID(),targetSuccess:3,windowLimit:2,retryFailedOnce:true,confirmedBy:'隔离测试',...config};
 const p=await x.round.successGoals.preview(x.r.id,input);
 return {...input,goalHash:p.goalHash,confirmed:true};
}
async function create(x,config={}){const input=await prepare(x,config);return x.round.successGoals.create(x.r.id,input);}
async function run(x,g){x.round.start(x.r.id,{windowId:g.window.id});await x.round.pending;return x.round.successGoals.summary(x.r.id);}

test('success target fills failures from remaining range and stops before extra submission',async t=>{
 const x=await fixture(t,7);x.fail(1);const g=await create(x),v=await run(x,g);
 assert.equal(v.state,'TARGET_REACHED');assert.equal(v.newSuccess,3);assert.equal(v.failed,1);assert.equal(x.flow.submits,3);
 assert.deepEqual(x.round.items(x.r.id).filter(i=>i.run_id).map(i=>i.position),[1,2,3,4]);
 assert.equal(x.round.view(x.r.id).total,7);assert.equal(x.round.summary(x.r.id).successGoal.id,g.goal.id);
});
test('crosses 100-item windows and halts exactly at 103, not end of second window',async t=>{
 const x=await fixture(t,106),g=await create(x,{targetSuccess:103,windowLimit:100}),v=await run(x,g);
 assert.equal(v.newSuccess,103);assert.equal(x.flow.submits,103);assert.deepEqual(x.round.windows.history(x.r.id).map(w=>w.total),[6,100]);
 assert(x.round.items(x.r.id).slice(103).every(x=>!x.run_id));
});
test('history is excluded; scope denominator stays fixed; other window cannot steal live goal',async t=>{
 const x=await fixture(t,6),old=await x.create({limit:1});await x.run(old);
 const g=await create(x,{targetSuccess:2}),v=await run(x,g);
 assert.equal(x.flow.submits,3);assert.equal(v.newSuccess,2);assert.equal(v.historyExcludedCount,1);assert.equal(v.scopeTotal,6);
 assert.equal(x.round.item(x.r.id,x.round.items(x.r.id)[0].key).run_id,x.flow.launches[0]);
});
test('safe failed item retries once at end with same queue/run and untouched max attempts',async t=>{
 const x=await fixture(t,3);let fails=0;x.setBehavior(task=>task.priority===1&&fails++===0?{code:'TASK_DATA',reason:'TASK_DATA: 单商品资料错误'}:null);
 const g=await create(x),v=await run(x,g),first=x.round.items(x.r.id)[0],q=x.batch.store.item(first.queue_id);
 assert.equal(v.state,'TARGET_REACHED');assert.equal(v.phase,'RETRY');assert.equal(v.newSuccess,3);assert.equal(q.attempts,2);assert.equal(q.max_attempts,3);
 assert.equal(x.flow.launches.filter(id=>id===first.run_id).length,2);assert.equal(x.flow.submits,3);
});
test('persistent product failure gets one final pass then exhausts with explicit shortfall',async t=>{
 const x=await fixture(t,3);x.fail(1);const g=await create(x,{targetSuccess:4}),v=await run(x,g);
 assert.equal(v.state,'EXHAUSTED');assert.equal(v.newSuccess,2);assert.equal(v.remaining,2);assert.equal(v.scopeTotal,3);
 const first=x.round.items(x.r.id)[0];assert.equal(x.flow.launches.filter(id=>id===first.run_id).length,2);assert.equal(x.batch.store.item(first.queue_id).attempts,2);
});
test('retry-disabled goal does not reopen failed item',async t=>{
 const x=await fixture(t,2);x.fail(1);const g=await create(x,{retryFailedOnce:false}),v=await run(x,g);
 assert.equal(v.state,'EXHAUSTED');assert.equal(x.flow.launches.length,2);assert.equal(v.phase,'FIRST');
});
test('captcha gate pauses all work without selecting replacement or auto-parking',async t=>{
 const x=await fixture(t,4);x.setBehavior(()=>({state:'PAUSED_CAPTCHA',reason:'CAPTCHA'}));const g=await create(x),v=await run(x,g);
 assert.equal(v.state,'WAITING_HUMAN');assert.equal(x.flow.launches.length,1);assert.equal(x.flow.submits,0);assert.equal(v.parked,0);
});
test('submitted unknown stays protected and does not count as success',async t=>{
 const x=await fixture(t,4);x.setBehavior(()=>({state:'RESULT_UNKNOWN',reason:'提交结果不明'}));const g=await create(x),v=await run(x,g);
 assert.equal(v.state,'RESULT_UNKNOWN');assert.equal(v.newSuccess,0);assert.equal(v.resultUnknown,1);assert.equal(v.parked,0);assert.equal(x.flow.launches.length,1);
});
test('pause/restart retains target and original identity; only explicit resume progresses',async t=>{
 const x=await fixture(t,5),g=await create(x);x.hold();x.round.start(x.r.id,{windowId:g.window.id});while(!x.flow.active)await new Promise(r=>setTimeout(r,1));
 x.round.pause();x.release();await x.round.pending;const first=x.round.items(x.r.id)[0].run_id,recovered=x.make();
 assert.equal(recovered.successGoals.summary(x.r.id).id,g.goal.id);assert.equal(x.flow.submits,0);assert.equal(recovered.active,null);
 recovered.resume(x.r.id,{windowId:g.window.id});await recovered.pending;
 assert.equal(recovered.successGoals.summary(x.r.id).newSuccess,3);assert.equal(recovered.items(x.r.id)[0].run_id,first);
});
test('manual stop seals goal; restart and old resume cannot auto-continue it',async t=>{
 const x=await fixture(t,5),g=await create(x);x.hold();x.round.start(x.r.id,{windowId:g.window.id});while(!x.flow.active)await new Promise(r=>setTimeout(r,1));
 x.round.stop();x.release();await x.round.pending;const recovered=x.make();assert.equal(recovered.successGoals.summary(x.r.id).state,'STOPPED');
 assert.throws(()=>recovered.resume(x.r.id,{windowId:g.window.id}),/已结束/);assert.equal(x.flow.submits,0);
});
test('creation is idempotent; changed goal with same request rejected',async t=>{
 const x=await fixture(t),input=await prepare(x),g=await x.round.successGoals.create(x.r.id,input),again=await x.round.successGoals.create(x.r.id,input);
 assert.equal(again.goal.id,g.goal.id);assert.equal(again.replayed,true);assert.equal(x.round.windows.history(x.r.id).length,1);
 await assert.rejects(x.round.successGoals.create(x.r.id,{...input,targetSuccess:4}),{code:'SUCCESS_GOAL_REQUEST_CONFLICT'});
});
test('existing open window cannot be converted to a target; autoPark is explicitly rejected',async t=>{
 const x=await fixture(t);await x.create({limit:2});await assert.rejects(prepare(x),{code:'SUCCESS_GOAL_WINDOW_OPEN'});
 x.round.stop();await assert.rejects(prepare(x,{autoParkEligible:true}),{code:'SUCCESS_GOAL_AUTO_PARK_UNAVAILABLE'});
});
test('stale preview cannot create a target',async t=>{
 const x=await fixture(t),input=await prepare(x);x.round.update(x.r.id,x.round.items(x.r.id)[3].key,{state:'MANUAL_SKIPPED'});
 await assert.rejects(x.round.successGoals.create(x.r.id,input),{code:'SUCCESS_GOAL_STALE'});
});
test('concurrent identical creates have one durable goal and window',async t=>{
 const x=await fixture(t),input=await prepare(x),results=await Promise.all([x.round.successGoals.create(x.r.id,input),x.round.successGoals.create(x.r.id,input)]);
 assert.equal(results.filter(x=>x.replayed).length,1);assert.equal(x.round.windows.history(x.r.id).length,1);
});
test('another normal window cannot bypass an active paused goal',async t=>{
 const x=await fixture(t,5),g=await create(x);x.round.windows.close(g.window.id,'COMPLETED','隔离：模拟已封存窗口衔接前暂停');
 const p=await x.round.windows.preview(x.r.id,{limit:1});assert.throws(()=>x.round.windows.create(p),/未结束的持续目标/);
 assert.equal(x.round.windows.history(x.r.id).length,1);assert.equal(x.flow.submits,0);
});
test('exhausted original claim budget excludes final retry without granting extra attempts',async t=>{
 const x=await fixture(t,2);x.fail(1);const g=await create(x,{windowLimit:1});
 const next=x.round.successGoals.next.bind(x.round.successGoals);let injected=false;
 x.round.successGoals.next=previous=>{if(!injected){const first=x.round.items(x.r.id)[0];if(first.queue_id){x.store.db.prepare('UPDATE batch_items SET attempts=max_attempts WHERE id=?').run(first.queue_id);injected=true;}}return next(previous);};
 const v=await run(x,g),first=x.round.items(x.r.id)[0],q=x.batch.store.item(first.queue_id);
 assert.equal(v.state,'EXHAUSTED');assert.equal(q.attempts,3);assert.equal(q.max_attempts,3);assert.equal(first.extra_attempts,0);assert.equal(x.flow.launches.filter(id=>id===first.run_id).length,1);
});
test('three identical unclassified pre-submit failures still trip original circuit',async t=>{
 const x=await fixture(t,6);x.setBehavior(()=>({state:'PAUSED',step:'open-new-form',reason:'page.goto: Timeout 30000ms exceeded'}));
 const g=await create(x,{windowLimit:6}),v=await run(x,g);
 assert.equal(v.state,'SYSTEM_BLOCKED');assert.equal(x.flow.launches.length,3);assert.equal(x.flow.submits,0);
});
test('scope limit never expands to other original products when target cannot be met',async t=>{
 const x=await fixture(t,8),g=await create(x,{startPosition:3,endPosition:5,targetSuccess:7}),v=await run(x,g);
 assert.equal(v.state,'EXHAUSTED');assert.equal(v.newSuccess,3);assert.equal(v.remaining,4);assert.equal(v.scopeTotal,3);
 assert.deepEqual(x.round.items(x.r.id).filter(i=>i.run_id).map(i=>i.position),[3,4,5]);
});
test('goal policy tampering is rejected before original item is claimed',async t=>{
 const x=await fixture(t),g=await create(x),row=x.round.successGoals.row(g.goal.id);
 x.store.db.prepare('UPDATE round_success_goals SET config=? WHERE id=?').run(JSON.stringify({...row.config,targetSuccess:99}),row.id);
 assert.throws(()=>x.round.start(x.r.id,{windowId:g.window.id}),{code:'SUCCESS_GOAL_POLICY_CHANGED'});assert.equal(x.flow.submits,0);
});
test('manual eligible parking preserves unknown and denominator, while target fills from others',async t=>{
 const x=await fixture(t,5);x.setBehavior(task=>task.priority===1?{state:'RESULT_UNKNOWN',reason:'提交回执未读到'}:null);
 const g=await create(x,{targetSuccess:3,windowLimit:2});await run(x,g);const item=x.round.items(x.r.id)[0];
 const p={round:x.round,source:x.flow,batch:x.batch,shop:x.round.shop,owner:{sessions:new Map([[x.round.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 const host=new RoundItemHostGuard(p,{isShopRemoved:()=>false}),verifier=new RoundItemVerify(host),scope={roundId:x.r.id,windowId:g.window.id,key:item.key};
 x.round.verifyExisting=async()=>{throw Object.assign(Error('已点击提交、回执未读到；后台创建时间与本次提交时间不匹配，保持待核验，保持 RESULT_UNKNOWN，禁止再次提交'),{code:'RESULT_UNKNOWN'});};
 await assert.rejects(verifier.verify({...scope,expectedRevision:verifier.reader.read(scope).revision,requestId:'test-verification'}));
 const before=x.round.item(x.r.id,item.key),receipt=x.round.parking.park({...scope,expectedRevision:x.round.parking.reader.read(scope).revision,requestId:'test-park',confirmedBy:'隔离测试操作者',reason:'核验时间不匹配，确认挂起继续'});
 x.round.verifyExisting=async()=>null;x.setBehavior(()=>null);x.round.resume(x.r.id,receipt.continueRequest);await x.round.pending;
 const goal=x.round.successGoals.summary(x.r.id);assert.equal(goal.state,'TARGET_REACHED');assert.equal(goal.newSuccess,3);assert.equal(goal.parked,1);assert.equal(goal.scopeTotal,5);
 assert.deepEqual(x.round.item(x.r.id,item.key),before);assert.equal(x.flow.submits,4);assert.equal(x.flow.launches.filter(id=>id===item.run_id).length,1);
});
