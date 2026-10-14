import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './skip-independent-fixture.mjs';
async function captcha(t){
 const f=await setup(t,{limit:1}),journal=f.round.executionAttempts.attempts,seal=journal.seal.bind(journal);
 f.round.verifyExisting=async()=>{throw Error('PAUSED_CAPTCHA');};journal.seal=()=>{throw Error('QA_INITIAL_SEAL_FAILURE');};
 f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;journal.seal=seal;
 const recovery=f.round.executionAttempts.recoveryView(f.r.id);assert(recovery);assert.equal(f.round.item(f.r.id,recovery.key).run_id,null);
 f.round.executionAttempts.recover({id:f.r.id,windowId:f.w.id,attemptId:recovery.attemptId});
 assert.equal(f.round.round(f.r.id).state,'WAITING_HUMAN');const original=journal.get(recovery.attemptId);assert(original.finished_at);
 f.round.verifyExisting=async({history})=>history||null;
 // Bound a broken coordinator without touching the production implementation.
 const begin=f.round.executionAttempts.begin.bind(f.round.executionAttempts);let iterations=0;
 f.round.executionAttempts.begin=(...args)=>{if(++iterations>3)throw Error('QA_EMPTY_ITERATION_LOOP_BOUND');return begin(...args);};
 return {...f,journal,original,iterations:()=>iterations};
}
test('EA10 no-run CAPTCHA explicit human confirmation queues and executes only the original selected task',async t=>{
 const f=await captcha(t),old=f.round.item(f.r.id,f.scope().key),others=f.round.items(f.r.id).filter(x=>x.key!==old.key);
 f.round.start(f.r.id,{windowId:f.w.id,humanVerified:true});await f.round.pending;
 const item=f.round.item(f.r.id,old.key);assert.equal(f.flow.launches.length,1,'one original task must launch; no silent empty iterations');assert.equal(f.flow.submits,1);assert.equal(item.state,'NEW_SUCCESS');assert(item.queue_id&&item.run_id);assert.equal(item.key,old.key);assert.equal(item.task_hash,old.task_hash);assert.equal(f.store.run(item.run_id).key,old.key);
 assert.equal(f.iterations(),1);assert.deepEqual(f.round.items(f.r.id).filter(x=>x.key!==old.key),others);assert.equal(f.journal.get(f.original.id).outcome_snapshot,f.original.outcome_snapshot);
 const attempts=f.journal.list(f.r.id,old.key);assert.equal(attempts.length,2);assert.equal(attempts[1].kind,'RESUME');assert.equal(attempts[1].parent_attempt_id,f.original.id);
});
test('EA10 explicit human confirmation never clears content-preflight isolation',async t=>{
 const f=await captcha(t),key=f.scope().key;f.round.update(f.r.id,key,{failure_stage:'content-preflight',reason:'QA source content needs human evidence'});
 const before=f.round.item(f.r.id,key);f.round.start(f.r.id,{windowId:f.w.id,humanVerified:true});await f.round.pending;
 const after=f.round.item(f.r.id,key);assert.equal(after.state,'WAITING_HUMAN');assert.equal(after.failure_stage,'content-preflight');assert.equal(after.task_hash,before.task_hash);assert.equal(after.run_id,null);assert.equal(after.queue_id,null);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);assert.equal(f.iterations(),0);assert.equal(f.journal.get(f.original.id).outcome_snapshot,f.original.outcome_snapshot);
});
test('EA10 hidden returned item evidence prevents no-run human confirmation from publishing',async t=>{
 const f=await captcha(t),key=f.scope().key,proof={itemId:'1234567890123',status:'unreconciled'};f.round.update(f.r.id,key,{result:proof});
 f.round.start(f.r.id,{windowId:f.w.id,humanVerified:true});await f.round.pending;
 const item=f.round.item(f.r.id,key);assert.equal(f.flow.submits,0);assert.equal(f.flow.launches.length,0);assert.equal(item.run_id,null);assert.equal(item.queue_id,null);assert(['WAITING_HUMAN','RESULT_UNKNOWN'].includes(item.state));assert.deepEqual(item.result,proof);assert(f.iterations()<=1);assert.equal(f.journal.get(f.original.id).outcome_snapshot,f.original.outcome_snapshot);
});
test('EA10 no explicit human confirmation cannot create a queue or another attempt',async t=>{
 const f=await captcha(t),before=f.journal.list(f.r.id,f.scope().key);assert.throws(()=>f.round.start(f.r.id,{windowId:f.w.id}),/人工处理/);assert.equal(f.flow.launches.length,0);assert.deepEqual(f.journal.list(f.r.id,f.scope().key),before);assert.equal(f.round.item(f.r.id,f.scope().key).queue_id,null);
});
test('EA10 evidence added during asynchronous human recovery validation stays protected',async t=>{
 const f=await captcha(t),key=f.scope().key,proof={itemId:'1234567890124',status:'unreconciled'};let checks=0;
 f.round.checkFiles=async()=>{checks++;f.round.update(f.r.id,key,{result:proof});};
 f.round.start(f.r.id,{windowId:f.w.id,humanVerified:true});await f.round.pending;
 const item=f.round.item(f.r.id,key);assert.equal(checks,1);assert.equal(f.flow.launches.length,0);assert.equal(item.queue_id,null);assert.equal(item.run_id,null);assert.deepEqual(item.result,proof);assert.equal(item.state,'WAITING_HUMAN');assert.equal(f.journal.get(f.original.id).outcome_snapshot,f.original.outcome_snapshot);
});
test('EA10 missing queue for a nonterminal task stops after one iteration instead of silently looping',async t=>{
 const f=await setup(t,{limit:1});f.round.ensureQueue=async()=>null;const begin=f.round.executionAttempts.begin.bind(f.round.executionAttempts);let iterations=0;f.round.executionAttempts.begin=(...args)=>{if(++iterations>3)throw Error('QA_EMPTY_ITERATION_LOOP_BOUND');return begin(...args);};
 f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;assert.equal(iterations,1);assert.equal(f.flow.launches.length,0);assert.equal(f.round.round(f.r.id).state,'SYSTEM_BLOCKED');assert.equal(f.round.item(f.r.id,f.scope().key).queue_id,null);
});
