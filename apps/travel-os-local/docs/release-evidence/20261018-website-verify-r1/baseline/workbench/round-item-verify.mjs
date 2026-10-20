// Isolated candidate. Uses the existing round owner and verifier; never pumps or publishes.
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {relative,isAbsolute} from 'node:path';
import {RoundManualSkip} from './round-manual-skip.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const text=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const id=x=>typeof x==='string'&&/^\d{6,30}$/.test(x);
// Fixed protocol categories only: an uppercase-shaped exception can still be a secret.
const safeFailureCodes=new Set(['PAUSED_CAPTCHA','ROUND_PAUSE','RESULT_UNKNOWN','EXISTENCE_AMBIGUOUS','INVENTORY_IDENTITY_UNRESOLVED','CONTENT_REVIEW_HELD','SQLITE_FULL','SQLITE_BUSY','SQLITE_IOERR','ITEM_VERIFY_FAILED','ITEM_VERIFY_PERSISTENCE_RECOVERED','ITEM_VERIFY_HOST_CHANGED','ITEM_VERIFY_HOST_UNAVAILABLE','ITEM_VERIFY_LEASE_LOST','ITEM_VERIFY_EXECUTION_NOT_SETTLED','ITEM_VERIFY_EVIDENCE_INCOMPLETE','ITEM_VERIFY_SCREENSHOT_SCOPE','ITEM_VERIFY_SCREENSHOT_INVALID','ITEM_VERIFY_BUSINESS_MISMATCH','ITEM_VERIFY_BROWSER_REQUIRED','ITEM_VERIFY_INTEGRITY_CHANGED','ITEM_VERIFY_BROWSER_CHANGED','ITEM_VERIFY_STALE_REVISION','ITEM_VERIFY_RUN_CHANGED']);
export function verifyFailureCode(error){return safeFailureCodes.has(error?.code)?error.code:error?.message==='PAUSED_CAPTCHA'?'PAUSED_CAPTCHA':'ITEM_VERIFY_FAILED';}

export class RoundItemVerify {
 constructor(host){
  this.host=host;this.owner=host.round;this.product=host.product;
  this.reader=new RoundManualSkip(this.owner);this.attempts=this.reader.attempts;this.db=this.owner.db;
 }
 request(input){
  const {roundId,windowId,key,expectedRevision,requestId}=input;
  if(![roundId,windowId,key,expectedRevision,requestId].every(text)||requestId.length>96)fail('ITEM_VERIFY_REQUEST_INVALID');
  // Manual association requires the existing reconciliation checks; no arbitrary ID override here.
  if(input.itemId!==undefined)fail('ITEM_VERIFY_ID_OVERRIDE_NOT_SUPPORTED');
  return {roundId,windowId,key,expectedRevision,requestId};
 }
 allowed(s){
  const o=this.owner;o.assertIdle();
  if(o.creating||o.hasUnsettledExecution())fail('ITEM_VERIFY_EXECUTION_NOT_SETTLED');
  if(!['PAUSED','SYSTEM_BLOCKED','RESULT_UNKNOWN','WAITING_HUMAN','NEEDS_REVIEW','STOPPED','READY'].includes(s.r.state))fail('ITEM_VERIFY_PARENT_NOT_IDLE');
  if(s.x.state!=='RESULT_UNKNOWN'||['content-review','content-preflight'].includes(s.x.failure_stage))fail('ITEM_VERIFY_STATE_PROTECTED');
  if(s.run&&s.run.state!=='RESULT_UNKNOWN')fail('ITEM_VERIFY_RUN_PROTECTED');
  if(s.q&&['SKIPPED','SUCCEEDED','RUNNING'].includes(s.q.state))fail('ITEM_VERIFY_QUEUE_PROTECTED');
  const open=this.attempts.openFor(s.x.key);
  if(open&&(open.kind!=='VERIFY_ONLY'||open.round_id!==s.r.id||open.window_id!==s.w.id||open.task_hash!==s.x.task_hash))fail('ITEM_VERIFY_OPEN_ATTEMPT_PROTECTED');
  // A sealed assignment remains immutable. Do not borrow another open window.
  const window=o.windows.open(s.r.id);
  if(window?.id!==s.w.id){
   if(window)fail('ITEM_VERIFY_OTHER_WINDOW_OPEN');
   if(!s.w.finished||!['COMPLETED','STOPPED'].includes(s.w.state)||s.assignment.outcome?.state!=='RESULT_UNKNOWN')fail('ITEM_VERIFY_WINDOW_ADAPTER_REQUIRED');
   const original=s.assignment.outcome;
   if(original.key!==s.x.key||original.position!==s.x.position||original.title!==s.x.task.listing.title||original.destination!==(s.x.task.listing.city||s.x.task.listing.country)||(original.runId??null)!==(s.x.run_id??null))fail('ITEM_VERIFY_WINDOW_SNAPSHOT_INVALID');
  }
  o.assertContentForTask(s.x.task,s.r.id);
 }
 owned(req,{allowPause=false}={}){
  const h=this.host,p=this.product,o=this.owner;
  if(p.round!==o||p.source!==h.source||p.batch!==h.batch||o.source!==h.source||o.batch!==h.batch||p.source.store!==h.store||p.batch.store!==h.batchStore||h.store.db!==this.db||o.db!==this.db||h.batch.flow!==h.source||h.batchStore.source!==h.store||h.batchStore.db!==this.db||p.shop.id!==h.shopId||o.shop.id!==h.shopId)fail('ITEM_VERIFY_HOST_CHANGED');
  if(h.isShopRemoved(p.shop.id)!==false||p.capturing||p.reconciling)fail('ITEM_VERIFY_HOST_UNAVAILABLE');
  if(allowPause){if(o.active!==req.roundId||o.batch.active!=='round:'+req.roundId||o.source.queueLease!=='round:'+req.roundId)fail('ITEM_VERIFY_LEASE_LOST');}
  else o.assertLease(req.roundId);
  if(o.source.active||o.creating||o.hasUnsettledExecution())fail('ITEM_VERIFY_EXECUTION_NOT_SETTLED');
 }
 sealed(req){
  const row=this.db.prepare('SELECT id FROM round_item_attempts WHERE request_id=?').get('verify-only:'+req.requestId);
  if(!row)return null;
  const a=this.attempts.get(row.id);
  if(a.kind!=='VERIFY_ONLY'||a.before?.requestIntent!==hash(req))fail('ITEM_VERIFY_REQUEST_CONFLICT');
  return a.finished_at?{replayed:true,attemptId:a.id,outcome:a.outcome}:null;
 }
 controlScope(input){
  const req=this.activeRequest;
  if(!req||input?.id!==req.roundId||input.windowId!==req.windowId||input.key!==req.key||input.verificationRequestId!==req.requestId)return false;
  try{
   this.owned(req,{allowPause:true});
   const w=this.owner.windows.assert(req.windowId,req.roundId),a=this.attempts.openFor(req.key);
   return !!((this.owner.windows.open(req.roundId)?.id===w.id||w.finished&&!this.owner.windows.open(req.roundId))&&a&&a.kind==='VERIFY_ONLY'&&a.round_id===req.roundId&&a.window_id===req.windowId&&a.request_id==='verify-only:'+req.requestId&&a.before?.requestIntent===hash(req));
  }catch{return false;}
 }
 controlView(roundId){
  const req=this.activeRequest;
  if(!req||req.roundId!==roundId)return null;
  const scope={id:req.roundId,windowId:req.windowId,key:req.key,verificationRequestId:req.requestId};
  return this.controlScope(scope)?scope:null;
 }
 needsStop(req){
  const r=this.owner.assertManifest(req.roundId),w=this.owner.windows.assert(req.windowId,req.roundId);
  if(w.finished)return !!(r.stopped&&r.state!=='STOPPED'&&!this.owner.windows.open(req.roundId));
  return !!(r.stopped&&!this.owner.windows.resolutionRequired(w.id));
 }
 finalizeStop(req){
  try{
   const window=this.owner.windows.open(req.roundId),target=this.owner.windows.assert(req.windowId,req.roundId);
   if(window?.id!==req.windowId&&!(target.finished&&!window))fail('ITEM_VERIFY_STOP_SCOPE_CHANGED');
   this.owner.state(req.roundId,'STOPPED','原停止请求已完成；仅核验原商品，其他任务保留');
   this.stopFinalizationBlocked=null;
  }catch(error){this.stopFinalizationBlocked=req;throw error;}
 }
 async finishSealed(req,receipt){
  if(!this.needsStop(req))return receipt;
  await this.host.assert();
  if(!this.needsStop(req))return this.sealed(req);
  const o=this.owner,lease='round:'+req.roundId;
  o.active=req.roundId;o.batch.active=lease;o.source.queueLease=lease;o.pauseRequested=false;o.stopRequested=false;
  try{this.owned(req);this.finalizeStop(req);return this.sealed(req);}
  finally{if(!this.stopFinalizationBlocked)this.release(req);}
 }
 recoverStop(req){
  if(hash(req)!==hash(this.stopFinalizationBlocked))fail('ITEM_VERIFY_STOP_FINALIZATION_BLOCKED');
  this.owned(req,{allowPause:true});this.finalizeStop(req);this.release(req);return this.sealed(req);
 }
 release(req){
  const o=this.owner,lease='round:'+req.roundId;
  if(o.active===req.roundId&&o.batch.active===lease&&o.source.queueLease===lease&&!o.source.active){o.active=null;o.batch.active=null;o.source.queueLease=null;o.currentOperation=null;this.activeRequest=null;}
 }
 recoverPersistence(req){
  if(hash(req)!==hash(this.persistenceBlocked))fail('ITEM_VERIFY_PERSISTENCE_BLOCKED');
  this.owned(req,{allowPause:true});const s=this.reader.read(req);
  const open=this.attempts.openFor(req.key);
  if(!open||open.request_id!=='verify-only:'+req.requestId)fail('ITEM_VERIFY_PERSISTENCE_RECOVERY_REQUIRED');
  const receipt=this.owner.source.store.transaction(()=>{
   const outcome={state:s.x.state,disposition:'UNRESOLVED',code:'ITEM_VERIFY_PERSISTENCE_RECOVERED',submittedByThisAction:false,reason:'核验记录写入已恢复；原商品仍待核验，请重新核验'};
   this.owner.event(req.roundId,req.key,'ITEM_VERIFY_PERSISTENCE_RECOVERED',{attemptId:open.id,windowId:req.windowId});
   this.attempts.seal(open.id,outcome);
   this.owner.state(req.roundId,'PAUSED','核验记录已恢复保存，原商品仍受保护');
   return {replayed:true,attemptId:open.id,outcome};
  });
  this.persistenceBlocked=null;
  try{if(this.owner.round(req.roundId).stopped)this.finalizeStop(req);}
  finally{if(!this.stopFinalizationBlocked)this.release(req);}
  return receipt;
 }
 async evidence(result,s){
  const known=s.snapshot.history?.itemId||s.run?.result?.itemId||s.run?.checkpoint?.itemId;
  if(!result||!id(result.itemId)||known&&result.itemId!==String(known)||!['出售中','仓库中'].includes(result.status)||!result.rowText||!Number.isFinite(Date.parse(result.verifiedAt)))fail('ITEM_VERIFY_EVIDENCE_INCOMPLETE');
  const target=new URL(result.url);
  if(target.protocol!=='https:'||target.hostname!=='item.taobao.com'||target.searchParams.get('id')!==result.itemId)fail('ITEM_VERIFY_EVIDENCE_INCOMPLETE');
  const [root,file]=await Promise.all([realpath(this.owner.artifacts),realpath(result.screenshot)]);
  const rel=relative(root,file);if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))fail('ITEM_VERIFY_SCREENSHOT_SCOPE');
  const bytes=await readFile(file);
  if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('ITEM_VERIFY_SCREENSHOT_INVALID');
  // Original verifier enforces actual title, identity and status. Submitted results also require business checks.
  if(s.run&&(result.observed?.price!==Number(s.x.task.business.price_cny)||result.observed?.inventory!==Number(s.x.task.business.inventory)||!Array.isArray(result.differences)||result.differences.length))fail('ITEM_VERIFY_BUSINESS_MISMATCH');
  this.owner.assertResultIdentity(s.r.id,s.x.key,result);
 }
 async verify(input){
  const req=this.request(input),requestKey='verify-only:'+req.requestId,intent=hash(req);
  if(this.stopFinalizationBlocked)return this.recoverStop(req);
  if(this.persistenceBlocked)return this.recoverPersistence(req);
  let s=this.reader.read(req);
  const prior=this.db.prepare('SELECT id FROM round_item_attempts WHERE request_id=?').get(requestKey);
  if(prior){
   const a=this.attempts.get(prior.id);
   if(a.kind!=='VERIFY_ONLY'||a.before?.requestIntent!==intent)fail('ITEM_VERIFY_REQUEST_CONFLICT');
   if(a.finished_at)return this.finishSealed(req,{replayed:true,attemptId:a.id,outcome:a.outcome});
   try{await this.host.assert();}catch(error){const receipt=this.sealed(req);if(receipt)return this.finishSealed(req,receipt);throw error;}
   const receipt=this.sealed(req);if(receipt)return this.finishSealed(req,receipt);
   s=this.reader.read(req);this.allowed(s);
   return this.owner.source.store.transaction(()=>{
    this.attempts.seal(a.id,{state:s.x.state,disposition:'INTERRUPTED',reason:'核验请求中断，未确认新结果；刷新后可重新核验',snapshot:s.snapshot});
    return {replayed:true,attemptId:a.id,outcome:this.attempts.get(a.id).outcome};
   });
  }
  try{await this.host.assert();}catch(error){const receipt=this.sealed(req);if(receipt)return this.finishSealed(req,receipt);throw error;}
  const receipt=this.sealed(req);if(receipt)return this.finishSealed(req,receipt);
  s=this.reader.read(req);this.allowed(s);
  if(s.revision!==req.expectedRevision)fail('ITEM_VERIFY_STALE_REVISION');
  const o=this.owner,lease='round:'+req.roundId;
  o.active=req.roundId;o.batch.active=lease;o.source.queueLease=lease;o.pauseRequested=false;o.stopRequested=false;
  this.activeRequest=req;
  const operation=this.perform(req,s,intent,requestKey).finally(()=>{
   let open=true;try{open=!!this.attempts.openFor(req.key);}catch{}
   if(open){this.persistenceBlocked=req;o.currentOperation={roundId:req.roundId,key:req.key,stage:'verification-persistence-blocked'};}
   else if(this.stopFinalizationBlocked)o.currentOperation={roundId:req.roundId,key:req.key,stage:'verification-stop-finalization-blocked'};
   else this.release(req);
  });
  o.pending=operation;
  return operation;
 }
 async perform(req,s,intent,requestKey){
  const o=this.owner;let attempt,revision;
  try{
   o.source.store.transaction(()=>{
    this.owned(req);const current=this.reader.read(req);if(current.revision!==s.revision)fail('ITEM_VERIFY_STALE_REVISION');
    const open=this.attempts.openFor(req.key);
    if(open)this.attempts.seal(open.id,{state:s.x.state,disposition:'INTERRUPTED',snapshot:s.snapshot});
    const parent=this.attempts.list(req.roundId,req.key).at(-1);
    attempt=this.attempts.begin({scope:{roundId:req.roundId,windowId:req.windowId,key:req.key,shopId:s.r.shop,taskHash:s.x.task_hash,repairVersion:s.r.repair_version},kind:'VERIFY_ONLY',requestId:requestKey,parentAttemptId:parent?.id||null,before:{requestIntent:intent,request:req,historyCoverage:parent?'LINKED_ATTEMPT':'PRIOR_HISTORY_NOT_SEGMENTED',snapshot:s.snapshot}});
    if(s.run)this.attempts.bindRun(attempt.id,s.run.id);
    this.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(req.key,req.roundId);
    o.state(req.roundId,'RUNNING','仅核验指定商品，不发布、不启动下一条');
    o.event(req.roundId,req.key,'ITEM_VERIFY_STARTED',{windowId:req.windowId,attemptId:attempt.id,requestId:req.requestId});
    revision=this.reader.read(req).revision;
   });
   this.owned(req);await o.assertExecution();this.owned(req);
   o.assertContentForTask(s.x.task,req.roundId);
   o.displayPhase(req.roundId,req.key,'verify-platform-result');
   const known=s.snapshot.history?.itemId||s.run?.result?.itemId||s.run?.checkpoint?.itemId||null;
   const context=this.product.owner?.sessions?.get(s.r.shop)?.context;
   if(!context)fail('ITEM_VERIFY_BROWSER_REQUIRED');
   const result=await o.verifyExisting({task:s.x.task,itemId:known,history:s.snapshot.history,run:s.run,roundId:req.roundId,key:req.key,executionWindowId:req.windowId,verificationAttemptId:attempt.id});
   this.owned(req);await this.evidence(result,s);this.owned(req);
   if((await this.product.integrity())?.ok!==true)fail('ITEM_VERIFY_INTEGRITY_CHANGED');this.owned(req);
   await o.assertExecution();this.owned(req);
   if(this.product.owner?.sessions?.get(s.r.shop)?.context!==context)fail('ITEM_VERIFY_BROWSER_CHANGED');
   const receipt=o.source.store.transaction(()=>{
    this.owned(req);const current=this.reader.read(req);if(current.revision!==revision)fail('ITEM_VERIFY_STALE_REVISION');
    o.assertContentForTask(current.x.task,req.roundId);o.assertResultIdentity(req.roundId,req.key,result);
    const isNew=!!(s.x.entered_publish&&s.run&&o.wasSubmitted(s.run));
    if(s.run){
     // Same RESULT_UNKNOWN -> VERIFIED transition as SourceStore.move, inside this all-projection transaction.
     const changed=this.db.prepare("UPDATE runs SET state='VERIFIED',reason=?,result=? WHERE id=? AND state='RESULT_UNKNOWN'").run('单条核验原商品，未重新提交',JSON.stringify(result),s.run.id);
     if(changed.changes!==1)fail('ITEM_VERIFY_RUN_CHANGED');
     o.source.store.event(s.run.id,'VERIFIED',{reason:'单条核验原商品，未重新提交',result,attemptId:attempt.id});
    }
    o.source.store.history(s.x.task,result);
    o.update(req.roundId,req.key,{state:isNew?'NEW_SUCCESS':'EXISTING_VERIFIED',result,...o.submissionFlags(s.run,req.roundId),finished:new Date().toISOString(),reason:'单条后台核验通过，未再次提交'});
    o.syncQueue(o.item(req.roundId,req.key),'SUCCEEDED',result,'单条后台核验通过，未再次提交');
    o.state(req.roundId,'PAUSED','单条核验完成；其他任务保持原状态');
    const outcome={state:isNew?'NEW_SUCCESS':'EXISTING_VERIFIED',disposition:'VERIFIED',result,submittedByThisAction:false,item:o.windows.observation(o.item(req.roundId,req.key))};
    o.event(req.roundId,req.key,'ITEM_VERIFY_FINISHED',{windowId:req.windowId,attemptId:attempt.id,itemId:result.itemId,submittedByThisAction:false});
    this.attempts.seal(attempt.id,outcome);
    return {replayed:false,attemptId:attempt.id,outcome};
   });
   if(o.round(req.roundId).stopped)this.finalizeStop(req);
   return receipt;
  }catch(error){
   if(attempt){
    o.source.store.transaction(()=>{
     const a=this.attempts.get(attempt.id);
     if(a&&!a.finished_at){
      // Avoid copying arbitrary exception text/URLs into user-visible records.
      const code=verifyFailureCode(error);
      const human=code==='PAUSED_CAPTCHA';
      const outcome={state:this.owner.item(req.roundId,req.key).state,disposition:'UNRESOLVED',code,submittedByThisAction:false,reason:human?'请在执行Chrome完成人工验证；原商品未重新提交':'本次未取得完整核验结果；原商品保持保护，不重新提交'};
      o.event(req.roundId,req.key,'ITEM_VERIFY_UNRESOLVED',{windowId:req.windowId,attemptId:attempt.id,code});
      this.attempts.seal(attempt.id,outcome);
      if(o.active===req.roundId&&['RUNNING','PAUSING'].includes(o.round(req.roundId).state))o.state(req.roundId,human?'WAITING_HUMAN':'PAUSED',human?'请在执行Chrome完成人工验证；核验现场保留':'单条核验未完成；原商品与其他任务保留');
     }
    });
    // Window.close owns its transaction. Seal the attempt first; never nest its close transaction.
    if(o.active===req.roundId&&o.stopRequested&&['PAUSED','WAITING_HUMAN'].includes(o.round(req.roundId).state))this.finalizeStop(req);
   }
   throw error;
  }
 }
}
