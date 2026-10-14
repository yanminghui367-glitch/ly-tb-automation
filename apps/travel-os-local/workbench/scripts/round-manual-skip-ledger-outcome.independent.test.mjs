import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,shop} from './skip-independent-fixture.mjs';

for(const [label,outcome] of [
 ['known success',{state:'NEW_SUCCESS',submitted:false}],
 ['unknown result',{state:'RESULT_UNKNOWN',submitted:false}],
 ['returned item ID',{state:'FAILED',itemId:'1234567890123',submitted:false}]
])test('sealed attempt '+label+' blocks skip despite stale source and parent',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key),parent=history.at(-1);
 assert.equal(parent.kind,'INITIAL');assert(parent.finished_at);
 const original=f.store.transaction(()=>{
  const a=f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:'RESUME',parentAttemptId:parent.id,requestId:'prior-ledger-evidence',before:{state:'PENDING'}});
  f.action.attempts.bindRun(a.id,x.run_id);return f.action.attempts.seal(a.id,outcome);
 });
 const req=f.request(),priorItem=f.round.item(f.r.id,x.key),priorRun=f.store.run(x.run_id),priorQueue=f.batch.store.item(x.queue_id);
 assert.equal(priorRun.state,'PAUSED');assert.equal(priorItem.state,'PENDING');assert.equal(f.store.completed(priorRun.task),null);assert(!f.store.events(x.run_id).some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind)));
 assert.throws(()=>f.action.skip(req),/SUBMISSION_PROTECTED|ATTEMPT.*PROTECTED|EVIDENCE/);
 assert.deepEqual(f.action.attempts.get(original.id),original);assert.deepEqual(f.round.item(f.r.id,x.key),priorItem);assert.deepEqual(f.store.run(x.run_id),priorRun);assert.deepEqual(f.batch.store.item(x.queue_id),priorQueue);assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,original]);
});

const rows=f=>Object.fromEntries(['runs','batch_items','round_items','round_item_attempts','events','batch_events','round_events','round_windows','round_window_items','history'].map(table=>[table,f.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
function seed(f,{outcome,before={state:'PENDING'},requestId='ledger-evidence',parent=null,bind=true}={}){
 const x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key),previous=parent||history.at(-1);
 const seeded=f.store.transaction(()=>{
  const a=f.action.attempts.begin({scope:{...f.scope(),shopId:shop.id,taskHash:x.task_hash,repairVersion:f.r.repairVersion},kind:parent?'VERIFY_ONLY':previous?'RESUME':'INITIAL',requestId,parentAttemptId:previous?.id||null,before});
  if(bind)f.action.attempts.bindRun(a.id,x.run_id);
  return outcome?f.action.attempts.seal(a.id,outcome):f.action.attempts.get(a.id);
 });
 assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,seeded]);
 return seeded;
}
function protectedWithoutMutation(f){
 const baseline=rows(f),inspection=f.action.inspect(f.scope());
 assert.equal(inspection.allowed,false);assert.equal(inspection.reason,'ITEM_SKIP_SUBMISSION_PROTECTED');
 assert.throws(()=>f.action.skip({...f.scope(),expectedRevision:inspection.revision,requestId:'blocked-skip',reason:'isolated protection probe'}),/ITEM_SKIP_SUBMISSION_PROTECTED/);
 assert.deepEqual(rows(f),baseline);assert.equal(f.flow.submits,0);
}

test('an older successful attempt remains protected behind a newer FAILED attempt',async t=>{
 const f=await setup(t);await f.pause();
 const original=seed(f,{outcome:{state:'NEW_SUCCESS',submitted:false}});
 const latest=seed(f,{outcome:{state:'FAILED',submitted:false},parent:original,requestId:'newer-failure'});
 assert.equal(f.action.attempts.list(f.r.id,f.scope().key).at(-1).id,latest.id);
 protectedWithoutMutation(f);
});

for(const [label,fixture] of [
 ['outcome snapshot run checkpoint reconciliation ID',{outcome:{state:'FAILED',snapshot:{run:{checkpoint:{reconciliation:{itemId:'1234567890123'}}}}}}],
 ['outcome snapshot queue result',{outcome:{state:'FAILED',snapshot:{queue:{result:{status:'unreconciled'}}}}}],
 ['outcome nested item uncertainty',{outcome:{state:'FAILED',snapshot:{item:{submission_uncertain:1}}}}],
 ['outcome snapshot run verified state',{outcome:{state:'FAILED',snapshot:{run:{state:'VERIFIED'}}}}],
 ['before snapshot checkpoint submit step',{before:{snapshot:{run:{checkpoint:{name:'submit-once'}}}},outcome:{state:'FAILED'}}],
 ['before snapshot success history',{before:{snapshot:{history:{itemId:'1234567890123'}}},outcome:{state:'FAILED'}}],
 ['before snapshot item unknown result',{before:{snapshot:{item:{state:'RESULT_UNKNOWN'}}},outcome:{state:'FAILED'}}]
])test(label+' blocks skip while current projections lack submission evidence',async t=>{
 const f=await setup(t);await f.pause();seed(f,fixture);protectedWithoutMutation(f);
});

test('closing the original open attempt binds the validated original run without a new run',async t=>{
 const f=await setup(t);await f.pause();const x=f.round.item(f.r.id,f.scope().key),history=f.action.attempts.list(f.r.id,x.key);
 const original=seed(f,{bind:false});assert.equal(original.run_id,null);
 const run=f.store.run(x.run_id),beforeRunCount=f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n;
 const result=f.action.skip(f.request());
 const ended=f.action.attempts.get(original.id),decision=f.action.attempts.get(result.attemptId);
 assert.equal(ended.run_id,x.run_id);assert.equal(ended.outcome.disposition,'ENDED_BY_MANUAL_SKIP');
 assert.equal(decision.run_id,x.run_id);assert.equal(decision.parent_attempt_id,original.id);
 assert.deepEqual(f.action.attempts.list(f.r.id,x.key),[...history,ended,decision]);
 assert.deepEqual(f.store.run(x.run_id),run);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,beforeRunCount);assert.equal(f.flow.submits,0);
});
