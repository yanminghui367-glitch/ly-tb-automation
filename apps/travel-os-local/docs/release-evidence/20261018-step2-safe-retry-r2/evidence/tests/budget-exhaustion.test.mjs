import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fixture} from './round-fixture.mjs';

const code='SAFE_RETRY_DETAIL_MATERIAL',step='select-detail-1',outcomes=[];
test.after(async()=>writeFile(new URL('./budget-outcomes.json',import.meta.url),JSON.stringify(outcomes,null,2)));

for(const scenario of [
 {name:'historical attempts 3/3 with zero safe recoveries',max:3,past:2,tries:0},
 {name:'historical attempts 3/3 with one safe recovery',max:3,past:2,tries:1},
 {name:'previously granted one allowance consumed: attempts 4/4 and zero safe recoveries',max:4,past:3,tries:0},
])test(scenario.name+' finishes only failed item and continues the website window',async t=>{
 const f=await fixture(t,5);let detail=false;
 f.setBehavior(run=>run.task.priority===2?{state:'PAUSED',step,code:detail?code:undefined,reason:'详情缩略图页面等待超时'}:{state:'VERIFIED'});
 const r=await f.create(),window=f.round.windows.create(await f.round.windows.preview(r.id,{limit:5}));
 const execute=async()=>{f.round.start(r.id,{windowId:window.id});await f.round.pending;if(f.round.view(r.id).state==='PAUSED'&&f.round.view(r.id).gate===1){f.round.resume(r.id,{windowId:window.id});await f.round.pending;}return f.round.view(r.id);};
 assert.equal((await execute()).state,'SYSTEM_BLOCKED');
 const bad=f.round.items(r.id)[1];
 // Seed only the isolated historical fixture. The next original claim consumes
 // its last permitted attempt; failure() must not change any budget counters.
 f.store.db.prepare('UPDATE batch_items SET attempts=?,max_attempts=? WHERE id=?').run(scenario.past,scenario.max,bad.queue_id);
 f.round.update(r.id,bad.key,{retry_counts:scenario.tries?{[step]:scenario.tries}:{}});
 const beforeFailure=[],afterFailure=[],base=f.round.failure.bind(f.round);
 f.round.failure=async(id,x,error,options)=>{
  if(error.code===code)beforeFailure.push(f.batch.store.item(x.queue_id));
  const continued=await base(id,x,error,options);
  if(error.code===code)afterFailure.push({queue:f.batch.store.item(x.queue_id),continued});
  return continued;
 };
 detail=true;const v=await execute(),item=f.round.item(r.id,bad.key),q=f.batch.store.item(bad.queue_id);
 assert.equal(v.state,'COMPLETED');assert.equal(v.counts.NEW_SUCCESS,4);assert.equal(v.counts.FAILED,1);assert.equal(f.flow.submits,4);
 assert.equal(beforeFailure.length,1);assert.equal(afterFailure.length,1);assert.equal(afterFailure[0].continued,true);
 assert.equal(beforeFailure[0].attempts,scenario.max);assert.equal(beforeFailure[0].max_attempts,scenario.max);
 assert.equal(q.attempts,beforeFailure[0].attempts);assert.equal(q.max_attempts,beforeFailure[0].max_attempts);
 assert.equal(item.state,'FAILED');assert.equal(q.state,'FAILED');assert(item.finished);assert.equal(item.extra_attempts,0);
 assert.deepEqual(item.retry_counts,scenario.tries?{[step]:scenario.tries}:{});
 const exhausted=f.round.events(r.id).find(e=>e.kind==='SAFE_STEP_RECOVERY_EXHAUSTED'&&e.key===bad.key);
 assert.equal(exhausted.payload.cause,'CLAIM_BUDGET');assert.equal(exhausted.payload.budgetCode,'ITEM_RETRY_BUDGET_EXTRA_UNSAFE');assert.equal(exhausted.payload.continued,true);
 assert(!f.round.events(r.id).some(e=>e.kind==='COORDINATOR_ERROR'));
 const ledger=f.round.executionAttempts.attempts.list(r.id,bad.key),last=ledger.at(-1);
 assert.equal(last.outcome.state,'FAILED');assert.equal(last.outcome.autoRetryScheduled,false);assert.equal(last.outcome.submittedByThisAttempt,false);assert(last.finished_at);
 assert.equal(last.outcome.disposition,'FINISHED');
 assert.equal(f.round.windows.latest(r.id).state,'COMPLETED');assert.equal(f.round.active,null);
 outcomes.push({scenario:scenario.name,round:v.state,window:f.round.windows.latest(r.id).state,counts:v.counts,attemptsBeforeFailure:beforeFailure[0].attempts,attemptsAfterFailure:q.attempts,maxAttempts:q.max_attempts,safeRecoveries:item.retry_counts,extraAttempts:item.extra_attempts,event:exhausted.payload,ledgerOutcome:last.outcome.state,autoRetryScheduled:last.outcome.autoRetryScheduled,synthetic:true});
});
