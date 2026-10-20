import {createHash,randomUUID} from 'node:crypto';
import {RoundManualSkip} from './round-manual-skip.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const notice='提交结果未定，需人工后台确认';
const prefix='已点击提交、回执未读到；',suffix='，保持 RESULT_UNKNOWN，禁止再次提交';
const reasons=new Map([
 ['后台创建时间与本次提交时间不匹配，保持待核验','TIME_MISMATCH'],
 ['后台三次只读查询仍未找到唯一匹配商品','NO_UNIQUE_MATCH'],
 ['后台同标题商品不唯一，不能自动认领','NO_UNIQUE_MATCH']
]);
export function parkFailureEvidence(error){
 if(error?.code!=='RESULT_UNKNOWN')return null;
 const reason=String(error.message||'');
 if(!reason.startsWith(prefix)||!reason.endsWith(suffix))return null;
 const category=reasons.get(reason.slice(prefix.length,-suffix.length));
 return category?{category,reason}:null;
}
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
export class RoundItemPark {
 constructor(owner){this.owner=owner;this.db=owner.db;this.reader=new RoundManualSkip(owner);this.attempts=this.reader.attempts;}
 events(roundId,key){return this.db.prepare("SELECT seq,at,payload FROM round_events WHERE round_id=? AND key=? AND kind='ITEM_PARKED' ORDER BY seq").all(roundId,key).map(e=>({...e,...JSON.parse(e.payload)}));}
 record(roundId,x){
  if(x.state!=='RESULT_UNKNOWN'||!x.submitted||!x.run_id)return null;
  const event=this.events(roundId,x.key).at(-1);if(!event)return null;
  const r=this.owner.round(roundId),run=this.owner.source.store.run(x.run_id);
  if(event.shopId!==r.shop||event.manifestHash!==r.manifest_hash||event.taskHash!==x.task_hash||event.runId!==x.run_id||run.state!=='RESULT_UNKNOWN')return null;
  const w=this.owner.windows.get(event.windowId),entry=w&&this.owner.windows.entries(w.id).find(e=>e.key===x.key);
  if(w?.round_id!==roundId||entry?.task_hash!==x.task_hash)return null;
  const a=this.attempts.get(event.evidence?.attemptId);
  if(!a||digest({before:a.before,outcome:a.outcome})!==event.evidence.attemptHash)return null;
  return {...event,eventSeq:event.seq,notice};
 }
 has(roundId,x){return !!this.record(roundId,typeof x==='string'?this.owner.item(roundId,x):x);}
 list(roundId){return this.db.prepare("SELECT DISTINCT e.key FROM round_events e JOIN round_items i ON i.round_id=e.round_id AND i.key=e.key WHERE e.round_id=? AND e.kind='ITEM_PARKED' AND i.state='RESULT_UNKNOWN' AND i.submitted=1 ORDER BY i.position").all(roundId).map(({key})=>{const x=this.owner.item(roundId,key),p=this.record(roundId,x);return p?{key:x.key,position:x.position,destination:x.task.listing.city||x.task.listing.country,state:x.state,submitted:!!x.submitted,retryBlocked:true,...p}:null;}).filter(Boolean);}
 proof(s){
  for(const a of this.attempts.list(s.r.id,s.x.key).slice(-1)){
   if(!a.finished_at||a.window_id!==s.w.id||a.task_hash!==s.x.task_hash||a.run_id!==s.run.id||a.shop_id!==s.r.shop||a.outcome?.state!=='RESULT_UNKNOWN')continue;
   const before=a.before?.snapshot;
   if(before?.item?.state!=='RESULT_UNKNOWN'||before.item.submitted!==true||before.run?.id!==s.run.id||before.run.state!=='RESULT_UNKNOWN')continue;
   let e=null; // Only the latest attempt may authorize a new park; older proof cannot hide a later failure.
   if(a.kind==='VERIFY_ONLY'&&a.outcome.disposition==='UNRESOLVED'&&a.outcome.code==='RESULT_UNKNOWN')e=parkFailureEvidence({code:a.outcome.code,message:a.outcome.parkEvidence?.reason});
   // Legacy read-only coordinator resumes have a sealed, exact original reason.
   if(a.kind==='RESUME'&&a.outcome.disposition==='FINISHED'&&a.outcome.submittedByThisAttempt===false&&a.outcome.submissionIntentByThisAttempt===false)
    e=parkFailureEvidence({code:'RESULT_UNKNOWN',message:a.outcome.reason});
   if(e&&!(this.owner.source.store.events(s.run.id).some(v=>v.seq>a.source_event_after&&v.seq<=a.source_event_through&&['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE'].includes(v.kind))))
    return {attemptId:a.id,kind:a.kind,started:a.started_at,finished:a.finished_at,sourceEventAfter:a.source_event_after,sourceEventThrough:a.source_event_through,attemptHash:digest({before:a.before,outcome:a.outcome}),...e};
  }
  fail('ITEM_PARK_VERIFICATION_REQUIRED');
 }
 allowed(s){
  const o=this.owner;o.assertIdle();if(o.creating||o.hasUnsettledExecution()||this.attempts.openFor(s.x.key))fail('ITEM_PARK_BUSY');
  if(o.windows.open(s.r.id)?.id!==s.w.id||s.w.finished||s.assignment.outcome||!['RESULT_UNKNOWN','PAUSED','SYSTEM_BLOCKED'].includes(s.r.state))fail('ITEM_PARK_WINDOW_PROTECTED');
  // retryBlocked is derived on the server, never accepted from the request.
  if(s.x.state!=='RESULT_UNKNOWN'||!s.x.submitted||s.run?.state!=='RESULT_UNKNOWN'||s.run.mode!=='LIVE'||!s.hasSubmit||['content-review','content-preflight','existing-listing-check'].includes(s.x.failure_stage)&&!s.x.entered_publish)
    fail('ITEM_PARK_SUBMISSION_REQUIRED');
  if(s.q&&['RUNNING','SUCCEEDED','SKIPPED'].includes(s.q.state)||s.snapshot.history?.itemId||s.run.result?.itemId||s.run.checkpoint?.itemId)fail('ITEM_PARK_RESULT_PROTECTED');
  if(this.has(s.r.id,s.x))fail('ITEM_ALREADY_PARKED');
  return this.proof(s);
 }
 capability(s,hostIssue){try{if(hostIssue)fail(hostIssue.code);this.allowed(s);return {allowed:true,code:null,reason:'保留提交结果待核验和禁止重发，仅让本轮继续处理其他商品。'};}catch(e){return {allowed:false,code:e.code||'ITEM_PARK_PROTECTED',reason:'暂不满足挂起条件，请核对原任务及核验记录。'};}}
 request(v){
  const fields=['roundId','windowId','key','expectedRevision','requestId','confirmedBy','reason'];
  if(!v||Array.isArray(v)||Object.keys(v).length!==fields.length||fields.some(k=>!text(v[k],k==='reason'?1000:k==='confirmedBy'?80:k==='requestId'?96:200)))fail('ITEM_PARK_REQUEST_INVALID');
  return Object.fromEntries(fields.map(k=>[k,v[k]]));
 }
 replay(v){const req=this.request(v),events=this.db.prepare("SELECT seq,at,key,payload FROM round_events WHERE round_id=? AND kind='ITEM_PARKED' ORDER BY seq").all(req.roundId).map(e=>({...e,...JSON.parse(e.payload)}));
  const e=events.find(e=>e.requestId===req.requestId);if(!e)return null;if(e.requestHash!==digest(req))fail('ITEM_PARK_REQUEST_CONFLICT');return this.receipt(e,true);
 }
 receipt(e,replayed){return {replayed,eventSeq:e.seq,roundId:e.roundId,windowId:e.windowId,key:e.key,requestId:e.requestId,state:'RESULT_UNKNOWN',submitted:true,retryBlocked:true,
  parking:{eventSeq:e.seq,actor:e.actor,at:e.at,reason:e.reason,evidence:e.evidence,notice},continueRequest:e.continueRequest};}
 park(value){
  const req=this.request(value),old=this.replay(req);if(old)return old;
  return this.owner.source.store.transaction(()=>{
   const s=this.reader.read(req),evidence=this.allowed(s);if(s.revision!==req.expectedRevision)fail('ITEM_PARK_STALE_REVISION');
   const at=new Date().toISOString(),payload={...req,requestHash:digest(req),shopId:s.r.shop,manifestHash:s.r.manifest_hash,taskHash:s.x.task_hash,runId:s.run.id,
    actor:{name:req.confirmedBy.trim(),identitySource:'LOCAL_OPERATOR_DECLARATION'},at,evidence,notice,previousStopRequested:!!s.r.stopped,
    continueRequest:{id:s.r.id,shopId:s.r.shop,windowId:s.w.id,manifestHash:s.r.manifest_hash,requestId:randomUUID(),humanVerified:false}};
   this.owner.event(s.r.id,s.x.key,'ITEM_PARKED',payload);
   const row=this.db.prepare("SELECT seq,at FROM round_events WHERE round_id=? AND key=? AND kind='ITEM_PARKED' ORDER BY seq DESC LIMIT 1").get(s.r.id,s.x.key);
   // This new, explicit continue decision replaces only the parent's stop intent.
   // It never updates round_items, runs, batch_items, source events or attempts.
   this.db.prepare('UPDATE rounds SET stopped=0 WHERE id=?').run(s.r.id);
   this.owner.event(s.r.id,s.x.key,'PARK_CONTINUE_REQUESTED',{parkEventSeq:row.seq,windowId:s.w.id,actor:payload.actor,previousStopRequested:!!s.r.stopped});
   this.owner.state(s.r.id,'PAUSED','已挂起待核验商品；其他商品等待原恢复检查');
   return this.receipt({...payload,...row},false);
  });
 }
}
