// One-item action on the existing round owner, source executor and queue.
// No browser ownership or alternative publishing implementation.
import {createHash} from 'node:crypto';
import {RoundManualSkip} from './round-manual-skip.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const fields=['roundId','windowId','key','expectedRevision','requestId'];
export class RoundItemRetry {
 constructor(host){this.host=host;this.product=host.product;this.owner=host.round;this.reader=new RoundManualSkip(this.owner);this.attempts=this.reader.attempts;this.db=this.owner.db;}
 request(value){
  if(!value||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(k=>typeof value[k]!=='string'||!value[k]||value[k].length>200)||value.requestId.length>96)fail('ITEM_RETRY_REQUEST_INVALID');
  return Object.fromEntries(fields.map(k=>[k,value[k]]));
 }
 lookup(req){
  const row=this.db.prepare('SELECT id FROM round_item_attempts WHERE request_id=?').get('manual-retry:'+req.requestId);
  if(!row)return null;
  const a=this.attempts.get(row.id);
  if(a.kind!=='MANUAL_RETRY'||a.before?.requestIntent!==hash(req)||a.before?.request?.windowId!==req.windowId||a.round_id!==req.roundId||a.key!==req.key)fail('ITEM_RETRY_REQUEST_CONFLICT');
  return a;
 }
 receipt(req,a){
  if(this.owner.executionAttempts.blocked?.attemptId===a.id)fail('ITEM_RETRY_RECORD_RECOVERY_REQUIRED');
  return {roundId:req.roundId,windowId:req.windowId,key:req.key,requestId:req.requestId,executionWindowId:a.window_id,attemptId:a.id,finished:!!a.finished_at,outcome:a.outcome};
 }
 needsStop(a){
  const o=this.owner,r=o.assertManifest(a.round_id),w=o.windows.assert(a.window_id,a.round_id);
  return !!(r.stopped&&(!w.finished||r.state!=='STOPPED'&&!o.windows.open(r.id)));
 }
 async finishSealed(req,a){
  this.receipt(req,a); // In-memory persistence failure requires its original recovery.
  if(this.needsStop(a)){
   await this.host.assert();this.host.assertCurrent();
   a=this.lookup(req);this.receipt(req,a);
   if(this.needsStop(a)){
    const o=this.owner,w=o.windows.assert(a.window_id,req.roundId),open=o.windows.open(req.roundId);
    if(open?.id!==w.id&&!(w.finished&&!open))fail('ITEM_RETRY_STOP_RECOVERY_REQUIRED');
    this.reader.read({roundId:req.roundId,windowId:a.window_id,key:req.key});
    // Only finish the durable stop. No new run, queue or publishing action.
    try{o.state(req.roundId,'STOPPED','原单条重试停止记录已保存；其他商品未启动');}
    catch{fail('ITEM_RETRY_STOP_RECOVERY_REQUIRED');}
   }
  }
  return {...this.receipt(req,a),replayed:true};
 }
 allowed(s){
  const o=this.owner;this.host.assertCurrent();
  if(!['READY','PAUSED','SYSTEM_BLOCKED','STOPPED','NEEDS_REVIEW','COMPLETED'].includes(s.r.state))fail('ITEM_RETRY_PARENT_NOT_IDLE');
  if(s.r.gate<5)fail('ITEM_RETRY_RELEASE_GATE_REQUIRED');
  if(s.hasSubmit)fail('ITEM_RETRY_SUBMISSION_PROTECTED');
  if(!['PENDING','FAILED'].includes(s.x.state)||['existing-listing-check','content-review','content-preflight'].includes(s.x.failure_stage))fail('ITEM_RETRY_STATE_PROTECTED');
  if(!s.x.reason&&!s.run&&!s.q?.attempts)fail('ITEM_RETRY_NOT_ATTEMPTED');
  if(s.run&&(!['QUEUED','PAUSED'].includes(s.run.state)||s.run.mode!=='LIVE'||/CAPTCHA|验证码|滑块|风险验证|请人工登录|登录失效|店铺身份/.test(s.run.reason||'')))fail('ITEM_RETRY_RUN_PROTECTED');
  if(s.q&&!['PENDING','RETRY','FAILED','WAITING_HUMAN'].includes(s.q.state))fail('ITEM_RETRY_QUEUE_PROTECTED');
  if(s.q?.state==='WAITING_HUMAN'&&s.run?.state!=='PAUSED')fail('ITEM_RETRY_RUN_PROTECTED');
  if(this.attempts.openFor(s.x.key))fail('ITEM_RETRY_OPEN_ATTEMPT');
  if(this.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL LIMIT 1').get())fail('ITEM_RETRY_OTHER_OPEN_ATTEMPT');
  const w=o.windows.open(s.r.id);
  if(w&&w.id!==s.w.id)fail('ITEM_RETRY_OTHER_WINDOW_OPEN');
  if(w&&(s.assignment.outcome||!['READY','PAUSED','SYSTEM_BLOCKED'].includes(w.state)))fail('ITEM_RETRY_WINDOW_PROTECTED');
  if(!w&&(!s.w.finished||!s.assignment.outcome||!['FAILED','PENDING'].includes(s.assignment.outcome.state)))fail('ITEM_RETRY_HISTORY_PROTECTED');
  for(const x of o.items(s.r.id)){
   const run=x.run_id?o.source.store.run(x.run_id):null;
   if(['SUBMITTING','RESULT_UNKNOWN','PAUSED_CAPTCHA'].includes(run?.state)&&x.failure_stage!=='content-review'||x.state==='RESULT_UNKNOWN'&&!['existing-listing-check','content-review'].includes(x.failure_stage)||x.state==='WAITING_HUMAN'&&x.failure_stage!=='content-preflight')fail('ITEM_RETRY_OTHER_RESOLUTION_REQUIRED');
   if(x.key!==s.x.key&&x.state==='PENDING'&&x.entered_publish)fail('ITEM_RETRY_OTHER_CHECKPOINT_OPEN');
   if(x.state==='NEW_SUCCESS')o.assertContentForTask(x.task,s.r.id);
  }
  o.assertContentForTask(s.x.task,s.r.id);
  if(s.x.task.adapterIssues?.length)fail('ITEM_RETRY_DATA_INVALID');
  // The button and the later transactional claim share the unchanged budget.
  // This read never reserves, increments, resets, or extends an attempt.
  if(s.q)o.batch.store.assertClaimBudget(s.q,{round:s.r,entry:s.x});
 }
 inspect(scope){const s=this.reader.read(scope);try{this.allowed(s);return {allowed:true,revision:s.revision};}catch(e){return {allowed:false,revision:s.revision,code:e.code||'ITEM_RETRY_STATE_CHECK_FAILED'};}}
 owned(req,{allowPause=false}={}){
  const h=this.host,p=this.product,o=this.owner;
  if(p.round!==o||p.source!==h.source||p.batch!==h.batch||o.source!==h.source||o.batch!==h.batch||p.source.store!==h.store||p.batch.store!==h.batchStore||h.store.db!==this.db||o.db!==this.db||h.batch.flow!==h.source||h.batchStore.source!==h.store||h.batchStore.db!==this.db||p.shop.id!==h.shopId||o.shop.id!==h.shopId)fail('ITEM_RETRY_HOST_CHANGED');
  if(h.isShopRemoved(p.shop.id)!==false||p.capturing||p.reconciling)fail('ITEM_RETRY_HOST_UNAVAILABLE');
  if(allowPause){if(o.active!==req.roundId||o.batch.active!=='round:'+req.roundId||o.source.queueLease!=='round:'+req.roundId)fail('ITEM_RETRY_LEASE_LOST');}
  else o.assertLease(req.roundId);
 }
 async recoverInterrupted(req,prior){
  const replay=await this.assertHostOrReplay(req);if(replay)return replay;
  const a=this.lookup(req);if(a.finished_at)return this.finishSealed(req,a);
  const scope={roundId:req.roundId,windowId:a.window_id,key:req.key};
  const s=this.reader.read(scope);
  if(a.id!==prior.id||a.run_id&&(a.run_id!==s.x.run_id)||a.task_hash!==s.x.task_hash)fail('ITEM_RETRY_RECOVERY_SCOPE');
  this.owner.source.store.transaction(()=>{
   this.host.assertCurrent();
   const current=this.reader.read(scope);
   if(current.revision!==s.revision)fail('ITEM_RETRY_RECOVERY_SCOPE');
   // A crash may happen after the original run was saved but before journaling
   // its ID. read() and bindRun() independently validate the existing mapping.
   if(!a.run_id&&current.run)this.attempts.bindRun(a.id,current.run.id);
   this.attempts.seal(a.id,{state:current.x.state,disposition:'INTERRUPTED',reason:'上次单条重试中断；本次仅保存原记录，未重新执行',snapshot:current.snapshot});
   this.owner.event(req.roundId,req.key,'MANUAL_RETRY_INTERRUPTED_RECORDED',{attemptId:a.id,executionWindowId:a.window_id,originWindowId:req.windowId});
  });
  return this.finishSealed(req,this.lookup(req));
 }
 async assertHostOrReplay(req){
  try{await this.host.assert();}catch(error){const a=this.lookup(req);if(a?.finished_at)return this.finishSealed(req,a);throw error;}
  const a=this.lookup(req);return a?.finished_at?this.finishSealed(req,a):null;
 }
 async retry(value){
  const req=this.request(value),prior=this.lookup(req);
  if(prior){
   if(this.owner.executionAttempts.blocked?.attemptId===prior.id)fail('ITEM_RETRY_RECORD_RECOVERY_REQUIRED');
   if(prior.finished_at)return this.finishSealed(req,prior);
   // Never restart an unsealed attempt from a repeated/lost HTTP request.
   if(this.activeRequest&&hash(this.activeRequest)===hash(req))fail('ITEM_RETRY_IN_PROGRESS');
   return this.recoverInterrupted(req,prior);
  }
  let replay=await this.assertHostOrReplay(req);if(replay)return replay;
  let s=this.reader.read(req);this.allowed(s);
  if(s.revision!==req.expectedRevision)fail('ITEM_RETRY_STALE_REVISION');
  await this.owner.assertExecution();await this.owner.checkFiles(s.x.task);
  replay=await this.assertHostOrReplay(req);if(replay)return replay;
  const stored=this.lookup(req);if(stored){if(stored.finished_at)return this.finishSealed(req,stored);fail('ITEM_RETRY_IN_PROGRESS');}
  s=this.reader.read(req);this.allowed(s);if(s.revision!==req.expectedRevision)fail('ITEM_RETRY_STALE_REVISION');
  const o=this.owner;let token;
  // All identity changes and the immutable intent commit before execution.
  o.source.store.transaction(()=>{
   const current=this.reader.read(req);this.allowed(current);if(current.revision!==req.expectedRevision)fail('ITEM_RETRY_STALE_REVISION');
   let w=o.windows.open(req.roundId);
   o.update(req.roundId,req.key,{state:'PENDING',reason:'操作者请求单条重试；原失败记录保留',finished:null});
   if(!w){
    const row=o.item(req.roundId,req.key),config={startPosition:row.position,endPosition:row.position,limit:1,autoContinue:false};
    const preview={roundId:req.roundId,manifestHash:current.r.manifest_hash,...config,selectionHash:o.windows.assignmentHash(current.r,config,[row]),items:[{key:row.key}]};
    const created=o.windows.create(preview);w=o.windows.get(created.id);
   }
   const parent=this.attempts.list(req.roundId,req.key).at(-1);
   const a=this.attempts.begin({scope:{roundId:req.roundId,windowId:w.id,key:req.key,shopId:current.r.shop,taskHash:current.x.task_hash,repairVersion:current.r.repair_version},kind:'MANUAL_RETRY',requestId:'manual-retry:'+req.requestId,parentAttemptId:parent?.id||null,
    before:{request:req,requestIntent:hash(req),originWindowId:req.windowId,historyCoverage:parent?'LINKED_ATTEMPT':'PRIOR_HISTORY_NOT_SEGMENTED',snapshot:current.snapshot}});
   if(current.run)this.attempts.bindRun(a.id,current.run.id);
   token={roundId:req.roundId,windowId:w.id,key:req.key,attemptId:a.id};
   this.db.prepare('UPDATE rounds SET current_item=?,stopped=0 WHERE id=?').run(req.key,req.roundId);
   o.state(req.roundId,'RUNNING','仅重试所选商品；完成后暂停，其余商品不启动');
   o.event(req.roundId,req.key,'MANUAL_RETRY_ACCEPTED',{originWindowId:req.windowId,executionWindowId:w.id,attemptId:a.id,requestId:req.requestId});
  });
  o.active=req.roundId;o.batch.active='round:'+req.roundId;o.source.queueLease='round:'+req.roundId;o.pauseRequested=false;o.stopRequested=false;
  o.executionAttempts.coordinatorSettled=false;o.executionAttempts.automaticParent=null;
  o.singleItemExecution={...token};this.activeRequest=req;
  const operation=this.perform(req,token).finally(async()=>{
   await o.finishExecution(req.roundId);
   if(!o.active){o.singleItemExecution=null;o.currentOperation=null;this.activeRequest=null;}
  });
  o.pending=operation;return operation;
 }
 async perform(req,token){
  const o=this.owner;
  try{
   // Pre-execution identity/evidence changes must retain the exact projection.
   // Generic execution failure handling can derive flags from an older run.
   this.owned(req);const before=this.reader.read(token);
   await o.assertExecution();this.owned(req);
   const after=this.reader.read(token);
   if(after.revision!==before.revision||after.hasSubmit)fail('ITEM_RETRY_EXECUTION_CHANGED');
   this.product.roundVerifier.reset();
   try{
    await o.executeItem(req.roundId,o.item(req.roundId,req.key));
   }catch(error){this.owned(req,{allowPause:true});await o.failure(req.roundId,o.item(req.roundId,req.key),error,{allowRecovery:false});}
   o.executionAttempts.finish(token,{continueLoop:false,disposition:'FINISHED'});
   if(o.stopRequested)o.state(req.roundId,'STOPPED','单条重试已安全停止；其余商品保留');
   else if(o.round(req.roundId).state==='RUNNING'||o.pauseRequested)o.state(req.roundId,'PAUSED','单条重试已结束；其余商品未启动');
   return {...this.receipt(req,this.lookup(req)),replayed:false};
  }catch(error){
   // Persistence failure keeps the original owner locked for record recovery.
   o.executionAttempts.blocked=token;
   throw error;
  }
 }
}
