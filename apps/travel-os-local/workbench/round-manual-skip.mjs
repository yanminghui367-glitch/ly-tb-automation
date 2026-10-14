// Candidate only. Synchronous, same-owner transaction; no browser or publishing.
import {createHash} from 'node:crypto';
import {RoundItemAttempts} from './round-item-attempts.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const valid=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const outcomeHasSubmission=(value,unsubmittedCandidates=new Set())=>{
 const pending=[value];
 while(pending.length){
  const v=pending.pop();if(!v||typeof v!=='object')continue;
  if(['SUBMITTING','VERIFIED','NEW_SUCCESS','EXISTING_VERIFIED'].includes(v.state)||v.state==='RESULT_UNKNOWN'&&!unsubmittedCandidates.has(v)
   ||v.submitted||v.submissionUncertain||v.submission_uncertain||v.submittedByThisAttempt||v.submissionEvidenceObserved||v.submissionIntentByThisAttempt||v.itemId||v.successUrl||v.result||v.history
   ||[v.step,v.name].some(s=>['submit-once','verify-platform-result'].includes(s)))return true;
  for(const key of ['item','run','queue','snapshot','checkpoint','reconciliation'])if(v[key])pending.push(v[key]);
 }
 return false;
};
export class RoundManualSkip {
 constructor(owner){this.owner=owner;this.db=owner.db;this.attempts=new RoundItemAttempts(this.db);}
 unsubmittedCandidate(a,outcome,{roundId,windowId,key,taskHash,manifestHash}){
  const s=outcome?.snapshot,x=s?.item,q=s?.queue;
  // RESULT_UNKNOWN is also used for pre-publish destination candidates. Exempt
  // only the immutable, same-scope attempt with its original isolation event.
  // Absence of a current submit click, or a human-readable reason, is not proof.
  if(a.round_id!==roundId||a.window_id!==windowId||a.task_hash!==taskHash||a.run_id!==null||!a.finished_at
   ||a.source_event_after!==a.source_event_through||outcome?.state!=='RESULT_UNKNOWN'||outcome.disposition!=='FINISHED'
   ||outcome.submittedByThisAttempt!==false||outcome.submissionEvidenceObserved!==false||outcome.submissionIntentByThisAttempt!==false
   ||s?.parent?.id!==roundId||s.parent.manifestHash!==manifestHash||s?.window?.id!==windowId
   ||x?.key!==key||x.state!=='RESULT_UNKNOWN'||x.stage!=='existing-listing-check'
   ||x.enteredPublish!==false||x.submitted!==false||x.submissionUncertain!==false||x.runId!==null||x.result!==null
   ||s.run!==null||s.history!==null||s.sourceEventThrough!==0
   ||q&&(q.runId!==null||q.result!==null||q.attempts!==0||q.state!=='PENDING'))return false;
  const e=this.db.prepare('SELECT key,kind,payload FROM round_events WHERE seq=? AND round_id=?').get(s.roundEventThrough,roundId);
  return e?.key===key&&e.kind==='EXISTENCE_CHECK_ISOLATED'&&JSON.parse(e.payload)?.notSubmitted===true;
 }
 request(input){
  const {roundId,windowId,key,expectedRevision,requestId}=input;
  const reason=typeof input.reason==='string'?input.reason.trim():'';
  if(![roundId,windowId,key,expectedRevision,requestId].every(valid)||requestId.length>96||!reason||reason.length>1000)fail('ITEM_SKIP_REQUEST_INVALID');
  return {roundId,windowId,key,expectedRevision,requestId,reason};
 }
 read({roundId,windowId,key}){
  const o=this.owner,r=o.assertManifest(roundId),w=o.windows.assert(windowId,roundId),x=o.item(roundId,key);
  const assignment=o.windows.entries(windowId).find(e=>e.key===key);
  if(!assignment||assignment.task_hash!==x.task_hash)fail('ITEM_SKIP_SCOPE_MISMATCH');
  const sourceRun=this.db.prepare('SELECT id FROM runs WHERE key=?').get(key),sourceQueue=this.db.prepare('SELECT id FROM batch_items WHERE key=?').get(key);
  if((sourceRun?.id||null)!==(x.run_id||null))fail('ITEM_SKIP_RUN_MISMATCH');
  if((sourceQueue?.id||null)!==(x.queue_id||null))fail('ITEM_SKIP_QUEUE_MISMATCH');
  const run=x.run_id?o.source.store.run(x.run_id):null,q=x.queue_id?o.batch.store.item(x.queue_id):null;
  if(q&&(q.key!==key||digest(q.task)!==x.task_hash||q.task.shopId!==r.shop||q.batch!==x.batch_id||(q.run_id||null)!==(x.run_id||null)))fail('ITEM_SKIP_QUEUE_MISMATCH');
  if(run&&(run.key!==key||digest(run.task)!==x.task_hash||run.task.shopId!==r.shop))fail('ITEM_SKIP_RUN_MISMATCH');
  if(q&&o.batch.store.batch(q.batch)?.shop!==r.shop)fail('ITEM_SKIP_QUEUE_MISMATCH');
  const events=run?o.source.store.events(run.id):[];
  const cp=run?.checkpoint||{};
  // Persisted return evidence survives stale state or incomplete event history.
  // This action does not decide whether an ID/URL is valid; its presence means
  // the original result must be reconciled rather than hidden by skipping.
  const returnedEvidence=!!(cp.itemId||cp.successUrl||cp.reconciliation?.itemId||run?.result||x.result||q?.result)
   ||[cp.step,cp.name].some(step=>['submit-once','verify-platform-result'].includes(step));
  const ledgerHistory=this.db.prepare('SELECT id,round_id,window_id,task_hash,run_id,source_event_after,source_event_through,intent_hash,finished_at,before_snapshot,outcome_snapshot FROM round_item_attempts WHERE key=? ORDER BY rowid').all(key);
  const ledgerEvidence=ledgerHistory.some(a=>{
   const outcome=a.outcome_snapshot?JSON.parse(a.outcome_snapshot):null;
   const candidate=this.unsubmittedCandidate(a,outcome,{roundId,windowId,key,taskHash:x.task_hash,manifestHash:r.manifest_hash});
   return outcomeHasSubmission(outcome,candidate?new Set([outcome,outcome.snapshot.item]):undefined)||outcomeHasSubmission(JSON.parse(a.before_snapshot)?.snapshot);
  });
  const hasSubmit=returnedEvidence||ledgerEvidence||!!x.submitted||!!x.submission_uncertain||events.some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind))||['SUBMITTING','RESULT_UNKNOWN','VERIFIED'].includes(run?.state)||!!o.source.store.completed(x.task);
  const snapshot={parent:{id:r.id,state:r.state,updated:r.updated,manifestHash:r.manifest_hash},
   window:{id:w.id,state:w.state,updated:w.updated,selectionHash:w.selection_hash},item:{...o.windows.observation(x),updated:x.updated,retryCounts:x.retry_counts,baselineAttempts:x.baseline_attempts,extraAttempts:x.extra_attempts},
   queue:q?{id:q.id,batch:q.batch,state:q.state,attempts:q.attempts,maxAttempts:q.max_attempts,runId:q.run_id,reason:q.reason,result:q.result,started:q.started,finished:q.finished}:null,
   run:run?{id:run.id,state:run.state,mode:run.mode,checkpoint:run.checkpoint,reason:run.reason,result:run.result}:null,
   sourceEventThrough:events.at(-1)?.seq||0,
   roundEventThrough:this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM round_events WHERE round_id=?').get(roundId).n,
   batchEventThrough:q?this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM batch_events WHERE batch=?').get(q.batch).n:0,
   history:o.source.store.completed(x.task)||null,
   attemptVersion:ledgerHistory.map(a=>({id:a.id,intentHash:a.intent_hash,finished:a.finished_at,outcomeHash:digest(a.outcome_snapshot)}))};
  return {r,w,x,q,run,assignment,hasSubmit,snapshot,revision:digest(snapshot)};
 }
 assertAllowed(s){
  const o=this.owner;o.assertIdle();
  if(o.creating||o.hasUnsettledExecution())fail('ITEM_SKIP_EXECUTION_NOT_SETTLED');
  // An operator may abandon a CAPTCHA-paused, unsubmitted current item.
  // This records a decision only; continuing still uses the original browser,
  // login, identity and challenge guards. Other human decisions stay protected.
  const captcha=/CAPTCHA|验证码|滑块|风险验证/.test([s.run?.reason,s.x.reason].filter(Boolean).join(' '))||s.run?.state==='PAUSED_CAPTCHA';
  const currentCaptcha=captcha&&s.r.current_item===s.x.key;
  const idleStates=['READY','PAUSED','SYSTEM_BLOCKED',...(currentCaptcha?['WAITING_HUMAN']:[])];
  if(o.windows.open(s.r.id)?.id!==s.w.id||s.assignment.outcome||s.w.finished||!idleStates.includes(s.w.state)||!idleStates.includes(s.r.state))fail('ITEM_SKIP_WINDOW_NOT_IDLE');
  if(s.hasSubmit)fail('ITEM_SKIP_SUBMISSION_PROTECTED');
  if(!['PENDING','FAILED',...(currentCaptcha?['WAITING_HUMAN']:[])].includes(s.x.state)||['existing-listing-check','content-review','content-preflight'].includes(s.x.failure_stage))fail('ITEM_SKIP_STATE_PROTECTED');
  if(s.run&&!['QUEUED','PAUSED',...(currentCaptcha?['PAUSED_CAPTCHA']:[])].includes(s.run.state)||s.run?.state==='PAUSED'&&/请人工登录|登录失效|店铺身份/.test(s.run.reason||'')||captcha&&!currentCaptcha)fail('ITEM_SKIP_HUMAN_OR_RUN_STATE');
  if(s.q&&!['PENDING','RETRY','FAILED','WAITING_HUMAN'].includes(s.q.state))fail('ITEM_SKIP_QUEUE_STATE');
  if(s.q?.state==='WAITING_HUMAN'&&s.run?.state!=='PAUSED'&&!currentCaptcha)fail('ITEM_SKIP_HUMAN_OR_RUN_STATE');
  // Keep GET capabilities and the transactional mutation on the same rule.
  // An open attempt from another window must be reconciled, not advertised
  // as a usable skip action that the POST will subsequently reject.
  const open=this.attempts.openFor(s.x.key);
  if(open&&(open.round_id!==s.r.id||open.window_id!==s.w.id||open.task_hash!==s.x.task_hash))fail('ITEM_SKIP_ATTEMPT_SCOPE');
 }
 inspect(scope){const s=this.read(scope);try{this.assertAllowed(s);return {allowed:true,revision:s.revision,reason:''};}catch(e){return {allowed:false,revision:s.revision,reason:e.code||e.message};}}
 replay(input){
  const req=this.request(input),requestKey='manual-skip:'+req.requestId,intent=digest(req);
  // Replay is a read of an already sealed receipt, even after its window closes.
  this.read(req);
  const prior=this.db.prepare('SELECT id FROM round_item_attempts WHERE request_id=?').get(requestKey);
  if(prior){const a=this.attempts.get(prior.id);if(a.kind!=='MANUAL_SKIP'||a.before?.requestIntent!==intent||!a.finished_at)fail('ITEM_SKIP_REQUEST_CONFLICT');return {replayed:true,attemptId:a.id,outcome:a.outcome};}
  return null;
 }
 skip(input){
  const replay=this.replay(input);if(replay)return replay;
  const req=this.request(input),requestKey='manual-skip:'+req.requestId,intent=digest(req);
  return this.owner.source.store.transaction(()=>{
   const s=this.read(req);this.assertAllowed(s);if(s.revision!==req.expectedRevision)fail('ITEM_SKIP_STALE_REVISION');
   const open=this.attempts.openFor(req.key);
   if(open){
    if(open.round_id!==req.roundId||open.window_id!==req.windowId||open.task_hash!==s.x.task_hash)fail('ITEM_SKIP_ATTEMPT_SCOPE');
    if(s.run)this.attempts.bindRun(open.id,s.run.id);
    this.attempts.seal(open.id,{state:s.x.state,disposition:'ENDED_BY_MANUAL_SKIP',snapshot:s.snapshot});
   }
   const parent=this.attempts.list(req.roundId,req.key).at(-1);
   const before={requestIntent:intent,request:req,historyCoverage:parent?'LINKED_ATTEMPT':'PRIOR_HISTORY_NOT_SEGMENTED',snapshot:s.snapshot};
   const a=this.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},
    kind:'MANUAL_SKIP',requestId:requestKey,parentAttemptId:parent?.id||null,before});
   if(s.run)this.attempts.bindRun(a.id,s.run.id);
   if(s.q)this.owner.batch.store.move(s.q.id,'SKIPPED',req.reason);
   this.owner.update(req.roundId,req.key,{state:'MANUAL_SKIPPED',reason:req.reason,failure_stage:'manual-skip',finished:new Date().toISOString()});
   this.owner.event(req.roundId,req.key,'MANUAL_SKIP_RECORDED',{windowId:req.windowId,attemptId:a.id,requestId:req.requestId,reason:req.reason,submitted:false});
   const outcome={state:'MANUAL_SKIPPED',submitted:false,reason:req.reason,item:this.owner.windows.observation(this.owner.item(req.roundId,req.key))};
   this.attempts.seal(a.id,outcome);
   return {replayed:false,attemptId:a.id,outcome};
  });
 }
}
