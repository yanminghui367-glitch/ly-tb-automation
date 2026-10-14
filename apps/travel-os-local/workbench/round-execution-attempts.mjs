// Same-owner journal around one existing coordinator iteration. No new queue,
// browser, authorization, task snapshot or publishing implementation.
import {randomUUID} from 'node:crypto';
import {RoundManualSkip} from './round-manual-skip.mjs';
const kinds=new Set(['INITIAL','AUTO_RETRY','RESUME','MANUAL_RETRY']);
const fail=code=>{throw Object.assign(Error(code),{code});};
export class RoundExecutionAttempts {
 constructor(owner){this.owner=owner;this.reader=new RoundManualSkip(owner);this.attempts=this.reader.attempts;this.blocked=null;this.coordinatorSettled=false;this.automaticParent=null;}
 owned(id){const o=this.owner;if(o.active!==id||o.batch.active!=='round:'+id||o.source.queueLease!=='round:'+id)fail('EXECUTION_ATTEMPT_LEASE_LOST');}
 snapshot(scope){return this.reader.read(scope);}
 reconcile(id){
  this.owned(id);const o=this.owner;
  const rows=o.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL').all().map(x=>this.attempts.get(x.id));
  if(!rows.length)return;
  if(rows.some(a=>a.kind==='MANUAL_RETRY'))fail('EXECUTION_ATTEMPT_MANUAL_RETRY_RECOVERY_REQUIRED');
  if(o.hasUnsettledExecution())fail('EXECUTION_ATTEMPT_SOURCE_UNSETTLED');
  if(rows.some(a=>a.round_id!==id||!kinds.has(a.kind)))fail('EXECUTION_ATTEMPT_OTHER_ACTION_OPEN');
  for(const a of rows){
   const scope={roundId:a.round_id,windowId:a.window_id,key:a.key};
   this.finish({attemptId:a.id,...scope},{disposition:'INTERRUPTED',continueLoop:false});
  }
 }
 begin(id,key){
  this.owned(id);const o=this.owner,w=o.windows.open(id);
  // Preserve the legacy non-window coordinator. Website windows are journaled.
  if(!w)return null;
  if(this.blocked||o.hasUnsettledExecution())fail('EXECUTION_ATTEMPT_NOT_SETTLED');
  return o.source.store.transaction(()=>{
   const scope={roundId:id,windowId:w.id,key},s=this.snapshot(scope);
   if(s.assignment.outcome||w.finished)fail('EXECUTION_ATTEMPT_WINDOW_CLOSED');
   const open=this.attempts.openFor(key);if(open)fail('EXECUTION_ATTEMPT_ALREADY_OPEN');
   const previous=this.attempts.list(id,key).at(-1),legacy=!!(s.run||s.x.started||s.q?.attempts);
   const kind=previous?(this.automaticParent===previous.id?'AUTO_RETRY':'RESUME'):legacy?'RESUME':'INITIAL';
   this.automaticParent=null;
   const a=this.attempts.begin({scope:{...scope,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind,requestId:'execution:'+randomUUID(),parentAttemptId:previous?.id||null,before:{historyCoverage:previous?'LINKED_ATTEMPT':legacy?'PRIOR_HISTORY_NOT_SEGMENTED':'FROM_THIS_ATTEMPT',snapshot:s.snapshot}});
   if(s.run)this.attempts.bindRun(a.id,s.run.id);
   o.event(id,key,'EXECUTION_ATTEMPT_STARTED',{attemptId:a.id,windowId:w.id,kind});
   return {...scope,attemptId:a.id};
  });
 }
 finish(token,{continueLoop=false,disposition='FINISHED'}={}){
  if(!token)return;
  this.owned(token.roundId);const o=this.owner;
  this.blocked=Object.freeze({...token});
  if(o.hasUnsettledExecution())fail('EXECUTION_ATTEMPT_SOURCE_UNSETTLED');
  const result=o.source.store.transaction(()=>{
   const a=this.attempts.get(token.attemptId),s=this.snapshot(token);
   if(!a||a.round_id!==token.roundId||a.window_id!==token.windowId||a.key!==token.key||!kinds.has(a.kind))fail('EXECUTION_ATTEMPT_SCOPE_CHANGED');
   if(a.finished_at)return a;
   if(s.run?.state==='VERIFIED'&&s.x.entered_publish&&s.x.state!=='RESULT_UNKNOWN'&&(s.x.state!=='NEW_SUCCESS'||s.q&&s.q.state!=='SUCCEEDED'))fail('EXECUTION_ATTEMPT_RESULT_PROJECTION_UNSETTLED');
   if(s.run)this.attempts.bindRun(a.id,s.run.id);
   const events=s.run?o.source.store.events(s.run.id).filter(e=>e.seq>a.source_event_after):[];
   const autoRetryScheduled=continueLoop&&!o.pauseRequested&&!o.stopRequested&&s.x.state==='PENDING'&&Object.entries(s.x.retry_counts).some(([step,count])=>count>(a.before.snapshot.item.retryCounts?.[step]||0));
   const outcome={state:s.x.state,disposition,reason:s.x.reason||'',autoRetryScheduled,
    submittedByThisAttempt:events.some(e=>e.kind==='SUBMIT_CLICKED'),
    submissionEvidenceObserved:events.some(e=>e.kind==='SUBMIT_EVIDENCE'),
    submissionIntentByThisAttempt:events.some(e=>e.kind==='SUBMITTING'),snapshot:s.snapshot};
   o.event(token.roundId,token.key,'EXECUTION_ATTEMPT_FINISHED',{attemptId:a.id,windowId:token.windowId,state:s.x.state,disposition,autoRetryScheduled});
   return this.attempts.seal(a.id,outcome);
  });
  this.automaticParent=result.outcome?.autoRetryScheduled===true&&!o.pauseRequested&&!o.stopRequested?result.id:null;
  this.blocked=null;return result;
 }
 recoveryView(id){const b=this.blocked;return b&&b.roundId===id?{roundId:b.roundId,windowId:b.windowId,key:b.key,attemptId:b.attemptId}:null;}
 bind(id,key,runId){
  const a=this.attempts.openFor(key);if(!this.owner.windows.open(id)&&!a)return;
  if(!a||a.round_id!==id||!kinds.has(a.kind))fail('EXECUTION_ATTEMPT_BIND_SCOPE');
  this.owned(id);this.owner.source.store.transaction(()=>this.attempts.bindRun(a.id,runId));
 }
 recover(input,{commit}={}){
  const b=this.blocked;
  if(!b||input.id!==b.roundId||input.windowId!==b.windowId||input.attemptId!==b.attemptId)fail('EXECUTION_ATTEMPT_RECOVERY_SCOPE');
  if(!this.coordinatorSettled)fail('EXECUTION_ATTEMPT_COORDINATOR_UNSETTLED');
  const w=this.owner.windows.open(b.roundId);
  if(w&&w.id!==b.windowId)fail('EXECUTION_ATTEMPT_RECOVERY_SCOPE');
  this.owned(b.roundId);
  if(this.owner.hasUnsettledExecution())fail('EXECUTION_ATTEMPT_SOURCE_UNSETTLED');
  this.owner.assertManifest(b.roundId);this.owner.reconcileMappings(b.roundId);this.owner.reconcileResult(b.roundId,b.key);
  this.finish(b,{disposition:'INTERRUPTED',continueLoop:false});
  const o=this.owner,stopped=!!o.round(b.roundId).stopped;
  const current=o.item(b.roundId,b.key),run=current.run_id?o.source.store.run(current.run_id):null;
  const resumeState=run?.state==='PAUSED_CAPTCHA'||current.state==='WAITING_HUMAN'&&current.failure_stage!=='content-preflight'?'WAITING_HUMAN':current.state==='RESULT_UNKNOWN'?'RESULT_UNKNOWN':'PAUSED';
  try{o.source.store.transaction(()=>{o.state(b.roundId,stopped?'STOPPED':resumeState,'处理记录已恢复保存；原任务和商品结果保留');commit?.({recovered:true,stopped,attemptId:b.attemptId});});}catch(e){this.blocked=b;throw e;}
  o.active=null;o.batch.active=null;o.source.queueLease=null;o.currentOperation=null;o.singleItemExecution=null;
  return {recovered:true,stopped,attemptId:b.attemptId};
 }
}
