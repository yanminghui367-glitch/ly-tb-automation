import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,shop} from './skip-independent-fixture.mjs';
import {RoundItemApi} from '../round-item-api.mjs';

function candidateHistory(f,{event=true,notSubmitted=true,change=()=>{}}={}){
 const scope=f.scope(),s=f.action.read(scope),snapshot=structuredClone(s.snapshot);
 Object.assign(snapshot.item,{state:'RESULT_UNKNOWN',stage:'existing-listing-check',enteredPublish:false,submitted:false,submissionUncertain:false,runId:null,result:null});
 if(event)f.round.event(f.r.id,scope.key,'EXISTENCE_CHECK_ISOLATED',{notSubmitted,candidateIds:['fixture-existing-id']});
 snapshot.roundEventThrough=f.store.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM round_events WHERE round_id=?').get(f.r.id).n;
 const outcome={state:'RESULT_UNKNOWN',disposition:'FINISHED',submittedByThisAttempt:false,submissionEvidenceObserved:false,submissionIntentByThisAttempt:false,snapshot};change(outcome);
 return f.store.transaction(()=>{
  const a=f.action.attempts.begin({scope:{...scope,shopId:shop.id,taskHash:s.x.task_hash,repairVersion:f.r.repairVersion},kind:'INITIAL',requestId:'historical-pre-submit-candidate',before:{snapshot:s.snapshot}});
  return f.action.attempts.seal(a.id,outcome);
 });
}
test('explicit pre-submit candidate history does not mark a later image timeout as submitted',async t=>{
 const f=await setup(t),old=candidateHistory(f);await f.pause();
 const x=f.round.item(f.r.id,f.scope().key);f.store.checkpoint(x.run_id,{step:'main-image-5'});
 f.round.update(f.r.id,x.key,{failure_stage:'main-image-5',reason:'image selection timed out'});
 const d=await new RoundItemApi(f.action).detail(f.scope());
 assert.equal(d.submissionEvidence,false);assert.equal(d.capabilities.skip.allowed,true);
 const original=f.store.run(x.run_id),receipt=f.action.skip(f.request());assert.equal(receipt.outcome.state,'MANUAL_SKIPPED');
 assert.deepEqual(f.action.attempts.get(old.id),old);assert.deepEqual(f.store.run(x.run_id),original);assert.equal(f.flow.submits,0);
});
test('candidate history never removes a genuine later submit or source-result protection',async t=>{
 for(const kind of ['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']){
  const f=await setup(t);candidateHistory(f);await f.pause();f.store.event(f.round.item(f.r.id,f.scope().key).run_id,kind,{});
  assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/SUBMISSION_PROTECTED/);
 }
});
test('an unknown result requires the exact original unsubmitted isolation event and scope',async t=>{
 for(const options of [
  {event:false},{notSubmitted:false},{notSubmitted:'true'},
  {change:o=>{o.snapshot.item.stage='verify-platform-result';}},
  {change:o=>{o.snapshot.parent.manifestHash='another-manifest';}},
  {change:o=>{o.snapshot.window.id='another-window';}},
  {change:o=>{delete o.submissionIntentByThisAttempt;}},
  {change:o=>{o.snapshot.item.runId='prior-real-run';}}
 ]){
  const f=await setup(t);candidateHistory(f,options);assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/SUBMISSION_PROTECTED/);
 }
});
test('contradictory submission flags, IDs, queue results and nested evidence keep the old history protected',async t=>{
 for(const change of [
  o=>{o.submittedByThisAttempt=true;},o=>{o.submissionEvidenceObserved=true;},o=>{o.submissionIntentByThisAttempt=true;},
  o=>{o.snapshot.item.submitted=true;},o=>{o.snapshot.item.submissionUncertain=true;},
  o=>{o.snapshot.item.result={itemId:'prior-real-id'};},
  o=>{o.snapshot.run={state:'RESULT_UNKNOWN',checkpoint:{step:'submit-once'}};},
  o=>{o.snapshot.queue={runId:null,attempts:0,state:'PENDING',result:{itemId:'prior-real-id'}};},
  o=>{o.snapshot.history={itemId:'prior-real-id'};}
 ]){
  const f=await setup(t);candidateHistory(f,{change});assert.equal(f.action.inspect(f.scope()).allowed,false);assert.throws(()=>f.action.skip(f.request()),/SUBMISSION_PROTECTED/);
 }
});
