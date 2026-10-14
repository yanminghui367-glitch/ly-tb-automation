import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './skip-independent-fixture.mjs';
const journal=f=>f.round.executionAttempts.attempts;
const run=async f=>{f.round.start(f.r.id,{windowId:f.w.id});await f.round.pending;};
test('no pending record recovery returns null with or without an optional round ID',async t=>{
 const f=await setup(t),recovery=f.round.executionAttempts;
 assert.equal(recovery.recoveryView(),null);assert.equal(recovery.recoveryView(f.r.id),null);
 recovery.blocked={roundId:f.r.id,windowId:f.w.id,key:f.scope().key,attemptId:'fixture-only'};
 assert.equal(recovery.recoveryView(),null);assert.equal(recovery.recoveryView('other-round'),null);
 assert.deepEqual(recovery.recoveryView(f.r.id),recovery.blocked);
});
test('website window records each actual iteration, binding original run before launch and sealing truth',async t=>{
 const f=await setup(t),base=f.flow.launch.bind(f.flow);
 f.flow.launch=id=>{const r=f.store.run(id),a=journal(f).openFor(r.key);assert.equal(a.run_id,id);assert.equal(a.kind,'INITIAL');base(id);};
 await run(f);assert.equal(f.flow.submits,3);
 for(let n=1;n<=3;n++){const list=journal(f).list(f.r.id,f.scope(n).key);assert.equal(list.length,1);assert.equal(list[0].outcome.state,'NEW_SUCCESS');assert.equal(list[0].outcome.submittedByThisAttempt,true);assert(list[0].finished_at);}
 assert.equal(f.round.active,null);
});
test('safe automatic recovery links a second attempt without replacing the first failure',async t=>{
 const f=await setup(t),base=f.flow.launch.bind(f.flow);let once=true;
 f.flow.launch=id=>{if(!once)return base(id);once=false;f.flow.active=id;f.flow.launches.push(id);f.flow.pending=(async()=>{f.store.move(id,'RUNNING');f.store.checkpoint(id,{step:'main-image-1',errorCode:'SAFE_RETRY_UPLOAD'});f.store.move(id,'PAUSED','temporary upload failure');})().finally(()=>f.flow.active=null);};
 await run(f);const list=journal(f).list(f.r.id,f.scope().key);
 assert.deepEqual(list.map(x=>x.kind),['INITIAL','AUTO_RETRY']);assert.equal(list[0].outcome.submittedByThisAttempt,false);assert.equal(list[0].outcome.autoRetryScheduled,true);
 assert.equal(list[1].parent_attempt_id,list[0].id);assert.equal(list[1].run_id,list[0].run_id);assert.equal(list[1].outcome.state,'NEW_SUCCESS');assert.equal(f.flow.submits,3);
});
test('operator resume records RESUME, preserving first paused attempt and original run',async t=>{
 const f=await setup(t);await f.pause();const before=journal(f).list(f.r.id,f.scope().key)[0];assert.equal(before.outcome.submittedByThisAttempt,false);
 await run(f);const list=journal(f).list(f.r.id,f.scope().key);assert.deepEqual(list.map(x=>x.kind),['INITIAL','RESUME']);assert.equal(list[1].run_id,before.run_id);assert.equal(list[0].outcome_snapshot,before.outcome_snapshot);assert.equal(f.flow.submits,3);
});
test('candidate isolation records no submit and does not prevent later tasks',async t=>{
 const f=await setup(t);f.round.verifyExisting=async({task})=>{if(task.priority===1)throw Object.assign(Error('saved geographic candidate'),{code:'EXISTENCE_AMBIGUOUS',isolated:true});return null;};
 await run(f);const a=journal(f).list(f.r.id,f.scope().key)[0];assert.equal(a.outcome.state,'RESULT_UNKNOWN');assert.equal(a.run_id,null);assert.equal(a.outcome.submittedByThisAttempt,false);assert.equal(f.flow.submits,2);
});
test('seal persistence failure holds lease and cannot dispatch next item or replay a submitted item',async t=>{
 const f=await setup(t),ledger=journal(f),seal=ledger.seal.bind(ledger);let fail=true;
 ledger.seal=(...args)=>{if(fail)throw Error('synthetic journal write failure');return seal(...args);};
 await run(f);assert.equal(f.flow.submits,1);assert.equal(f.flow.launches.length,1);assert.equal(f.round.active,f.r.id);assert.equal(f.flow.queueLease,'round:'+f.r.id);assert.equal(f.round.round(f.r.id).state,'SYSTEM_BLOCKED');
 assert.throws(()=>f.round.start(f.r.id,{windowId:f.w.id}));const recovery=f.round.summary().executionRecovery;assert(recovery.attemptId);
 assert.throws(()=>f.round.executionAttempts.recover({id:f.r.id,windowId:f.w.id,attemptId:'wrong'}),/RECOVERY_SCOPE/);assert.equal(f.flow.submits,1);
 fail=false;const receipt=f.round.executionAttempts.recover({id:f.r.id,windowId:f.w.id,attemptId:recovery.attemptId});assert(receipt.recovered);assert.equal(f.round.active,null);assert.equal(journal(f).list(f.r.id,f.scope().key)[0].outcome.state,'NEW_SUCCESS');
 await run(f);assert.equal(f.flow.submits,3);assert.equal(f.flow.launches.length,3);
});
test('restart reconciliation seals unfinished observation of a recovered success before selecting next item',async t=>{
 const f=await setup(t),ledger=journal(f),seal=ledger.seal.bind(ledger);ledger.seal=()=>{throw Error('synthetic crash boundary');};await run(f);const a=ledger.openFor(f.scope().key);assert(a);
 // Model process loss without creating another engine or changing historical records.
 f.round.active=null;f.batch.active=null;f.flow.queueLease=null;f.round.executionAttempts.blocked=null;ledger.seal=seal;
 await run(f);const old=ledger.get(a.id);assert.equal(old.outcome.disposition,'INTERRUPTED');assert.equal(old.outcome.state,'NEW_SUCCESS');assert.equal(f.flow.submits,3);assert.equal(f.flow.launches.length,3);
});
