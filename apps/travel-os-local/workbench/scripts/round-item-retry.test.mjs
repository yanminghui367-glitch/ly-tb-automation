import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,shop} from './skip-independent-fixture.mjs';
import {RoundItemRetry} from '../round-item-retry.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
async function fixture(t,options){
 const f=await setup(t,options);let resets=0;
 const product={round:f.round,source:f.flow,batch:f.batch,shop,capturing:false,reconciling:false,integrity:async()=>({ok:true}),roundVerifier:{reset(){resets++;}}};
 const host=new RoundItemHostGuard(product,{isShopRemoved:()=>false}),retry=new RoundItemRetry(host);
 f.round.update(f.r.id,f.scope().key,{reason:'上次后台读取失败，尚未提交'});
 const request=(n=1,id='retry-1')=>({...f.scope(n),expectedRevision:retry.reader.read(f.scope(n)).revision,requestId:id});
 return {...f,product,host,retry,request,resets:()=>resets};
}
test('manual retry reuses the owner and creates only the selected queue; other items never start',async t=>{
 const f=await fixture(t),before=f.round.items(f.r.id).slice(1),req=f.request();
 const result=await f.retry.retry(req);
 assert.equal(result.finished,true);assert.equal(result.outcome.state,'NEW_SUCCESS');assert.equal(f.flow.submits,1);assert.equal(f.resets(),1);
 assert.equal(f.round.round(f.r.id).state,'PAUSED');assert.equal(f.round.active,null);
 assert.deepEqual(f.round.items(f.r.id).slice(1),before);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM batch_items').get().n,1);
 const a=f.retry.lookup(req);assert.equal(a.kind,'MANUAL_RETRY');assert.equal(a.before.historyCoverage,'PRIOR_HISTORY_NOT_SEGMENTED');
 assert.equal((await f.retry.retry(req)).replayed,true);assert.equal(f.flow.submits,1);
});
test('paused original run and queue are reused, old events remain and retry links to the previous attempt',async t=>{
 const f=await fixture(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),events=f.store.events(x.run_id),prior=f.retry.attempts.list(f.r.id,x.key).at(-1);
 const req=f.request(),result=await f.retry.retry(req),a=f.retry.lookup(req);
 assert.equal(result.outcome.state,'NEW_SUCCESS');assert.equal(a.parent_attempt_id,prior.id);assert.equal(a.run_id,x.run_id);
 assert.equal(f.round.item(f.r.id,x.key).queue_id,x.queue_id);assert.deepEqual(f.store.events(x.run_id).slice(0,events.length),events);assert.equal(f.flow.submits,1);
});
test('sealed original window stays byte-identical; retry gets one bounded follow-up window',async t=>{
 const f=await fixture(t);f.round.update(f.r.id,f.scope().key,{state:'FAILED',reason:'商品问题已修复待重查'});f.round.stop();
 const old=f.round.windows.get(f.w.id),entries=f.round.windows.entries(f.w.id),req=f.request();
 const result=await f.retry.retry(req);
 assert.notEqual(result.executionWindowId,f.w.id);assert.deepEqual(f.round.windows.get(f.w.id),old);assert.deepEqual(f.round.windows.entries(f.w.id),entries);
 const next=f.round.windows.get(result.executionWindowId);assert.equal(next.limit_count,1);assert.equal(next.auto_continue,0);assert.equal(f.flow.submits,1);
 assert.equal((await f.retry.retry(req)).executionWindowId,next.id);assert.equal(f.round.windows.history(f.r.id).length,2);
});
test('stale revision, successful task and submission evidence block before launch',async t=>{
 const f=await fixture(t),req=f.request();f.round.update(f.r.id,req.key,{reason:'状态变化'});
 await assert.rejects(f.retry.retry(req),/ITEM_RETRY_STALE_REVISION/);
 f.round.update(f.r.id,req.key,{submitted:1});await assert.rejects(f.retry.retry(f.request()),/SUBMISSION_PROTECTED/);
 f.round.update(f.r.id,req.key,{submitted:0,state:'NEW_SUCCESS'});await assert.rejects(f.retry.retry(f.request()),/STATE_PROTECTED/);assert.equal(f.flow.submits,0);
});
test('verification error records actual query phase and neither submits nor consumes automatic retries',async t=>{
 const f=await fixture(t);f.round.verifyExisting=async()=>{throw Object.assign(Error('后台查询失败'),{code:'SAFE_RETRY_TEST'});};
 const req=f.request(),result=await f.retry.retry(req);
 assert.equal(result.outcome.state,'PENDING');assert.equal(f.round.item(f.r.id,req.key).failure_stage,'existing-listing-query');assert.deepEqual(f.round.item(f.r.id,req.key).retry_counts,{});
 assert.equal(f.round.round(f.r.id).state,'SYSTEM_BLOCKED');assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);
});
test('changed frozen data during async precheck rejects before recording or execution',async t=>{
 const f=await fixture(t);f.round.checkFiles=async()=>{f.round.update(f.r.id,f.scope().key,{reason:'并发变化'});};
 await assert.rejects(f.retry.retry(f.request()),/STALE_REVISION/);assert.equal(f.retry.attempts.list(f.r.id,f.scope().key).length,0);assert.equal(f.flow.submits,0);
});
test('lost response cannot begin another attempt or overwrite a sealed receipt',async t=>{
 const f=await fixture(t),req=f.request(),receipt=await f.retry.retry(req),snapshot=JSON.stringify(f.retry.lookup(req));
 for(let i=0;i<2;i++)assert.equal((await f.retry.retry(req)).attemptId,receipt.attemptId);
 await assert.rejects(f.retry.retry({...req,key:f.scope(2).key}),/REQUEST_CONFLICT/);
 assert.equal(JSON.stringify(f.retry.lookup(req)),snapshot);assert.equal(f.flow.submits,1);
});

async function exhausted(t){
 const f=await fixture(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key);
 f.store.db.prepare("UPDATE batch_items SET attempts=3,max_attempts=3,state='RETRY' WHERE id=?").run(x.queue_id);
 f.store.db.prepare('UPDATE runs SET reason=? WHERE id=?').run('FORM_DETAIL_IMAGE: synthetic pre-submit failure',x.run_id);
 f.flow.launch=function(id){this.active=id;this.launches.push(id);this.pending=Promise.resolve().then(()=>{f.store.move(id,'RUNNING');f.store.checkpoint(id,{step:'select-detail-1'});f.store.move(id,'PAUSED','FORM_DETAIL_IMAGE: synthetic pre-submit failure');}).finally(()=>this.active=null);};
 return {...f,x};
}
test('one click adds one original-task allowance; three additions are durable and a fourth is rejected',async t=>{
 const f=await exhausted(t),others=f.round.items(f.r.id).slice(1),run=f.store.run(f.x.run_id),manifest=f.round.round(f.r.id).manifest_hash;
 for(let i=1;i<=3;i++){
  const scope=f.retry.reader.read(f.scope()),budget=f.retry.allowed(scope);assert.equal(budget.willAdd,true);assert.equal(budget.used,i-1);assert.equal(budget.remaining,4-i);
  const req=f.request(1,'addition-'+i),receipt=await f.retry.retry(req);
  assert.equal(receipt.finished,true);const q=f.batch.store.item(f.x.queue_id);assert.equal(q.attempts,3+i);assert.equal(q.max_attempts,3+i);assert.equal(q.run_id,f.x.run_id);
  assert.equal(f.round.selections.manualBudgetUsed(q.id),i);assert.equal((await f.retry.retry(req)).replayed,true);assert.equal(f.batch.store.item(q.id).max_attempts,3+i);
 }
 await assert.rejects(f.retry.retry(f.request(1,'addition-4')),/ITEM_RETRY_BUDGET_MANUAL_CAP/);
 assert.equal(f.store.run(f.x.run_id).taskHash,run.taskHash);assert.equal(f.round.round(f.r.id).manifest_hash,manifest);assert.deepEqual(f.round.items(f.r.id).slice(1),others);assert.equal(f.flow.submits,0);
});
test('preflight rejection and transaction failure grant no allowance; old manual grants count toward the cap',async t=>{
 const f=await exhausted(t),q=()=>f.batch.store.item(f.x.queue_id);
 f.round.checkFiles=async()=>{throw Error('SOURCE_OR_ASSET_CHANGED');};await assert.rejects(f.retry.retry(f.request()),/SOURCE_OR_ASSET_CHANGED/);assert.equal(q().max_attempts,3);assert.equal(f.round.selections.manualBudgetUsed(q().id),0);
 f.round.checkFiles=async()=>{};const begin=f.retry.attempts.begin;f.retry.attempts.begin=()=>{throw Error('SYNTHETIC_WRITE_FAILURE');};await assert.rejects(f.retry.retry(f.request()),/SYNTHETIC_WRITE_FAILURE/);assert.equal(q().max_attempts,3);assert.equal(f.round.selections.manualBudgetUsed(q().id),0);f.retry.attempts.begin=begin;
 for(let i=0;i<3;i++)f.batch.store.event(q().batch,q().id,'MANUAL_RETRY_BUDGET_GRANTED',{addAttempts:1,source:'old-bulk-grant'});
 await assert.rejects(f.retry.retry(f.request()),/ITEM_RETRY_BUDGET_MANUAL_CAP/);assert.equal(q().attempts,3);assert.equal(q().max_attempts,3);
});

test('previously consumed automatic extras stay counted; one manual addition creates exactly one usable attempt',async t=>{
 const f=await exhausted(t);f.store.db.prepare('UPDATE batch_items SET attempts=5,max_attempts=3 WHERE id=?').run(f.x.queue_id);f.store.db.prepare('UPDATE round_items SET baseline_attempts=3,extra_attempts=2 WHERE round_id=? AND key=?').run(f.r.id,f.x.key);
 const receipt=await f.retry.retry(f.request(1,'after-legacy-extras'));assert.equal(receipt.finished,true);const q=f.batch.store.item(f.x.queue_id);assert.equal(q.attempts,6);assert.equal(q.max_attempts,6);assert.equal(f.round.item(f.r.id,f.x.key).extra_attempts,2);assert.equal(f.round.selections.manualBudgetUsed(q.id),1);
 const grant=f.batch.store.events(q.batch).findLast(e=>e.kind==='MANUAL_RETRY_BUDGET_GRANTED');assert.equal(grant.payload.addAttempts,1);assert.equal(grant.payload.historicalAlreadyConsumed,2);assert.equal(grant.payload.oldLimit,3);assert.equal(grant.payload.newLimit,6);assert.equal(f.flow.submits,0);
});
