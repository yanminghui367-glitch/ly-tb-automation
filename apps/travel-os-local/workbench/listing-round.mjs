import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,destinationKey} from './source-store.mjs';
import {RoundWindows} from './round-windows.mjs';
import {RoundSuccessGoal} from './round-success-goal.mjs';
import {RoundExecutionAttempts} from './round-execution-attempts.mjs';
import {RoundSelection} from './round-selection.mjs';
import {RoundItemPark} from './round-item-park.mjs';
import {assertUnclaimedSubmissionId} from './result-reconciliation.mjs';

export const ROUND_ITEM_STATES=['EXISTING_VERIFIED','NEW_SUCCESS','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED','RESULT_UNKNOWN','WAITING_HUMAN','PENDING'];
const done=new Set(['EXISTING_VERIFIED','NEW_SUCCESS','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED']);
const contentHeld=x=>x.state==='RESULT_UNKNOWN'&&x.failure_stage==='content-review';
const contentPending=x=>x.state==='WAITING_HUMAN'&&x.failure_stage==='content-preflight';
const isolated=x=>contentPending(x)||x.state==='RESULT_UNKNOWN'&&['existing-listing-check','content-review'].includes(x.failure_stage);
const now=()=>new Date().toISOString();
const parse=v=>v?JSON.parse(v):null;
const fail=message=>{throw Error(message);};
const reasonOf=error=>String(error?.message||error||'未知执行错误').slice(0,1600);
const isEvidence=r=>!!(/^\d{6,30}$/.test(String(r?.itemId||''))&&r.status&&r.rowText&&r.screenshot&&Number.isFinite(Date.parse(r.verifiedAt)));
const csvCell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
const detailRetryCode=code=>/^SAFE_RETRY_DETAIL_(?:PANEL|FRAME_ORIGIN|UPLOAD_ENTRY|UPLOAD_PANEL|UPLOAD_RECEIPT|MATERIAL)$/.test(code||'');
const detailRetryStep=(code,step)=>['SAFE_RETRY_DETAIL_PANEL','SAFE_RETRY_DETAIL_FRAME_ORIGIN'].includes(code)?['open-new-form','open-details'].includes(step)||/^select-detail-\d+$/.test(step||''):/^select-detail-\d+$/.test(step||'');
const mainRetryCode=code=>['SAFE_RETRY_MAIN_IMAGE_STATE','SAFE_RETRY_MAIN_FRAME_ORIGIN','SAFE_RETRY_MAIN_PANEL'].includes(code);
const readinessRetryCode=code=>detailRetryCode(code)||mainRetryCode(code);
const submissionInRun=run=>!!(run&&(['SUBMITTING','RESULT_UNKNOWN','VERIFIED'].includes(run.state)||run.result||run.checkpoint?.itemId||run.checkpoint?.reconciliation));
const protectedPageReason=reason=>/PAGE_LEDGER_|PAGE_PROTECTION_|PINNED_PAGE|PAGE_BUDGET|RESIDUAL_REFILL_|保留页面.*(?:保护|失败)/i.test(reason||'');

// Classification is separate from continuation: only proven pre-submit item
// failures may be finalized by the bounded, distinct-item circuit below.
export function classifyRoundFailure(error,{run,preflight=false}={}){
 const reason=reasonOf(error),code=error?.code||'';
 if(['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state))return {kind:'UNKNOWN',reason};
 if(run?.state==='PAUSED_CAPTCHA'||/CAPTCHA|验证码|滑块|风险验证|请人工登录|店铺身份|专用浏览器未运行|登录失效/i.test(reason))return {kind:'HUMAN',reason};
 if(preflight&&/ENOENT|素材.*(?:缺失|变化|改变)|文件.*不存在|图片.*缺失|TASK_DATA|ADAPTER_ISSUE|价格.*缺失|库存.*缺失/i.test(reason))return {kind:'PREFLIGHT',reason};
 if(/^PRODUCT_|^TASK_DATA|^ATTRIBUTE_VALUE_INVALID/.test(code)||/^(?:PRODUCT_DATA|TASK_DATA|ATTRIBUTE_VALUE_INVALID):/.test(reason))return {kind:'PRODUCT',reason};
 if(/^SAFE_RETRY_DETAIL_/.test(code)){
  if(!preflight&&detailRetryCode(code)&&run?.state==='PAUSED'&&detailRetryStep(code,run.checkpoint?.step)&&!submissionInRun(run)&&!protectedPageReason(reason))return {kind:'TRANSIENT',reason,fingerprint:code,safe:true};
  return {kind:'SYSTEM',reason,fingerprint:code};
 }
 if(mainRetryCode(code)){
  if(!preflight&&run?.state==='PAUSED'&&/^main-image-[1-5]$/.test(run.checkpoint?.step||'')&&!submissionInRun(run)&&!protectedPageReason(reason))return {kind:'TRANSIENT',reason,fingerprint:code,safe:true};
  return {kind:'SYSTEM',reason,fingerprint:code};
 }
 if(/^SAFE_RETRY_/.test(code))return {kind:'TRANSIENT',reason,fingerprint:code,safe:true};
 return {kind:'SYSTEM',reason,fingerprint:code||reason.replace(/\d+/g,'#')};
}

// A persistent coordinator of the existing BatchWorkflow/SourceWorkflow owner.
// It owns no browser, worker process, alternative submitter, or separate DB.
export class ListingRound {
 constructor({batch,source=batch?.flow,shop,rules,assertExecution,verifyExisting,checkFiles,contentReviews,artifacts,classifyFailure=classifyRoundFailure,onGate,getListingDefaults=async()=>null}={}){
  if(!batch||!source||!shop||typeof assertExecution!=='function'||typeof verifyExisting!=='function')fail('轮次缺少现有执行器、店铺或检查依赖');
  Object.assign(this,{batch,source,shop,rules,assertExecution,verifyExisting,classifyFailure,onGate,contentReviews,getListingDefaults});
  this.db=source.store.db;this.artifacts=artifacts||join(source.artifacts,'rounds');this.reporting=new Map();
  this.checkFiles=checkFiles||((task)=>source.preflight([task]));this.active=null;this.creating=false;this.pauseRequested=false;this.stopRequested=false;
  this.db.exec(`CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY,shop TEXT NOT NULL,import_id TEXT NOT NULL,manifest_hash TEXT NOT NULL,authorization_hash TEXT NOT NULL,authorization TEXT NOT NULL,repair_version TEXT NOT NULL,state TEXT NOT NULL,gate INTEGER NOT NULL DEFAULT 0,current_item TEXT,reason TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,updated TEXT NOT NULL,stopped INTEGER NOT NULL DEFAULT 0,system_fingerprint TEXT NOT NULL DEFAULT '',system_count INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS round_policy_overrides(round_id TEXT NOT NULL,policy TEXT NOT NULL,payload TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(round_id,policy));
   CREATE TABLE IF NOT EXISTS round_items(round_id TEXT NOT NULL,key TEXT NOT NULL,position INTEGER NOT NULL,task TEXT NOT NULL,task_hash TEXT NOT NULL,queue_id TEXT,batch_id TEXT,run_id TEXT,state TEXT NOT NULL DEFAULT 'PENDING',entered_publish INTEGER NOT NULL DEFAULT 0,submitted INTEGER NOT NULL DEFAULT 0,submission_uncertain INTEGER NOT NULL DEFAULT 0,baseline_attempts INTEGER NOT NULL DEFAULT 0,extra_attempts INTEGER NOT NULL DEFAULT 0,retry_counts TEXT NOT NULL DEFAULT '{}',reason TEXT NOT NULL DEFAULT '',failure_stage TEXT NOT NULL DEFAULT '',result TEXT,started TEXT,finished TEXT,updated TEXT NOT NULL,PRIMARY KEY(round_id,key),UNIQUE(round_id,position));
   CREATE TABLE IF NOT EXISTS round_events(seq INTEGER PRIMARY KEY,round_id TEXT NOT NULL,key TEXT,at TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL);`);
  this.windows=new RoundWindows(this);
  this.executionAttempts=new RoundExecutionAttempts(this);
  this.selections=new RoundSelection(this);
  this.parking=new RoundItemPark(this);
  this.successGoals=new RoundSuccessGoal(this);
  this.recover();
 }
 event(id,key,kind,payload={}){this.db.prepare('INSERT INTO round_events(round_id,key,at,kind,payload) VALUES(?,?,?,?,?)').run(id,key,now(),kind,JSON.stringify(payload));}
 events(id){return this.db.prepare('SELECT * FROM round_events WHERE round_id=? ORDER BY seq').all(id).map(r=>({...r,payload:parse(r.payload)}));}
 round(id){const r=id?this.db.prepare('SELECT * FROM rounds WHERE id=?').get(id):this.db.prepare('SELECT * FROM rounds ORDER BY rowid DESC LIMIT 1').get();if(!r)return null;const policies=Object.fromEntries(this.db.prepare('SELECT policy,payload FROM round_policy_overrides WHERE round_id=?').all(r.id).map(x=>[x.policy,parse(x.payload)]));return {...r,authorization:parse(r.authorization),policies};}
 applyUserRules(id,{manifestHash,ignoreDestinationDuplicates=false,acceptDedhamTransliteration=false,confirmedBy='用户'}={}){
  this.assertIdle();if(this.creating||this.hasUnsettledExecution())fail('仍有执行动作未结束，不能修改本轮规则');
  const r=this.assertManifest(id);if(manifestHash!==r.manifest_hash)fail('固定轮次范围已变化');
  if(!['WAITING_HUMAN','PAUSED','SYSTEM_BLOCKED','RESULT_UNKNOWN','NEEDS_REVIEW'].includes(r.state))fail('仅能对已暂停轮次追加规则');
  if(typeof confirmedBy!=='string'||!confirmedBy.trim()||confirmedBy.length>80)fail('规则确认人无效');
  const at=now(),applied=[];
  return this.source.store.transaction(()=>{
   if(ignoreDestinationDuplicates){
    const payload={enabled:true,scope:'THIS_ROUND_ONLY',manifestHash:r.manifest_hash,shop:r.shop,confirmedBy:confirmedBy.trim(),at,meaning:'跳过店内目的地候选检索；已知原商品ID核验、提交结果核对和商品资料/平台验证闸门保持有效'};
    this.db.prepare('INSERT INTO round_policy_overrides(round_id,policy,payload,at) VALUES(?,?,?,?) ON CONFLICT(round_id,policy) DO UPDATE SET payload=excluded.payload,at=excluded.at').run(id,'ignore-destination-duplicates',JSON.stringify(payload),at);
    let released=0;
    for(const x of this.items(id)){
     if(x.state!=='RESULT_UNKNOWN'||x.failure_stage!=='existing-listing-check'||x.entered_publish||x.submitted||x.submission_uncertain||x.result)continue;
     const run=x.run_id?this.source.store.run(x.run_id):null;if(run&&(this.wasSubmitted(run)||run.result?.itemId||run.checkpoint?.itemId||!['QUEUED','PAUSED','WAITING_HUMAN'].includes(run.state)))continue;
     if(x.queue_id){const q=this.batch.store.item(x.queue_id);if(!['WAITING_HUMAN','PENDING','RETRY'].includes(q.state))continue;}
     this.update(id,x.key,{state:'PENDING',failure_stage:'',reason:'已按用户确认忽略店内同目的地候选；未提交，沿用原任务快照'});
     this.event(id,x.key,'DESTINATION_DUPLICATE_HOLD_RELEASED',{policy:'ignore-destination-duplicates',taskHash:x.task_hash,submitted:false,submissionUncertain:false});released++;
    }
    this.event(id,null,'DESTINATION_DUPLICATE_POLICY_ENABLED',{...payload,releasedCount:released});applied.push({policy:'ignore-destination-duplicates',releasedCount:released});
   }
   if(acceptDedhamTransliteration){
    const x=this.items(id).find(v=>v.task.listing.country==='美国'&&v.task.listing.city==='戴德姆'&&v.state==='WAITING_HUMAN'&&v.failure_stage==='content-preflight'&&!v.entered_publish&&!v.submitted&&!v.submission_uncertain);
    if(!x)fail('未找到未提交的“美国·戴德姆”译名待人工项；未应用译名规则');
    const payload={enabled:true,scope:'EXACT_ITEM_ONLY',key:x.key,taskHash:x.task_hash,country:'美国',canonicalCity:'戴德姆',observedAlias:'德德姆',confirmedBy:confirmedBy.trim(),at,meaning:'视为同一地点的译名差异，冻结任务名称仍为戴德姆'};
    this.db.prepare('INSERT INTO round_policy_overrides(round_id,policy,payload,at) VALUES(?,?,?,?) ON CONFLICT(round_id,policy) DO UPDATE SET payload=excluded.payload,at=excluded.at').run(id,'dedham-transliteration',JSON.stringify(payload),at);
    const review={shop:r.shop,roundId:id,manifestHash:r.manifest_hash,key:x.key,taskHash:x.task_hash,decision:'PASS',observedText:'德德姆',reviewer:confirmedBy.trim(),method:'user-confirmed-transliteration',evidence:[],reviewedAt:at,mainHashes:x.task.assets.main.map(a=>a.sha256)};
    this.contentReviews.save([review]);
    this.update(id,x.key,{state:'PENDING',failure_stage:'',reason:'用户确认“德德姆”为“戴德姆”的译名差异；保留冻结任务名称，未提交'});
    this.event(id,x.key,'USER_CONFIRMED_TRANSLITERATION_ACCEPTED',{policy:'dedham-transliteration',canonicalCity:'戴德姆',observedAlias:'德德姆',taskHash:x.task_hash,submitted:false,reviewer:confirmedBy.trim()});
    this.event(id,null,'TRANSLITERATION_POLICY_ENABLED',{...payload});applied.push({policy:'dedham-transliteration',key:x.key});
   }
   if(!applied.length)fail('没有选择要应用的规则');
   return {id,manifestHash:r.manifest_hash,applied};
  });
 }
 item(id,key){const r=this.db.prepare('SELECT * FROM round_items WHERE round_id=? AND key=?').get(id,key);if(!r)fail('商品不属于固定轮次');return {...r,task:parse(r.task),result:parse(r.result),retry_counts:parse(r.retry_counts)};}
 items(id){return this.db.prepare('SELECT * FROM round_items WHERE round_id=? ORDER BY position').all(id).map(r=>({...r,task:parse(r.task),result:parse(r.result),retry_counts:parse(r.retry_counts)}));}
 state(id,state,reason=''){
  const unresolved=state==='STOPPED'&&this.windows?.resolutionRequired(this.windows.open(id)?.id);
  if(unresolved){state=unresolved;reason+='；原商品仍需'+(unresolved==='RESULT_UNKNOWN'?'核验结果':'人工验证')+'，处理完成后停止，禁止重发';}
  if(state==='STOPPED'){const latest=this.windows?.latest(id);if(latest?.continuation_pending)this.windows.finishContinuation(latest.id,'操作者停止自动衔接');}
  this.db.prepare('UPDATE rounds SET state=?,reason=?,updated=? WHERE id=?').run(state,reason,now(),id);this.event(id,null,state,{reason});
  this.successGoals?.state(id,state,reason);
  const window=this.windows?.open(id);
  if(window){if(['STOPPED','COMPLETED'].includes(state))this.windows.close(window.id,state,reason);else this.windows.state(window.id,state,reason);}
 }
 update(id,key,patch){
  const allowed=new Set(['queue_id','batch_id','run_id','state','entered_publish','submitted','submission_uncertain','reason','failure_stage','result','started','finished','retry_counts']);
  for(const k of Object.keys(patch))if(!allowed.has(k))fail('禁止修改清单身份：'+k);
  const data={...patch,updated:now()};for(const k of ['result','retry_counts'])if(k in data)data[k]=data[k]===null?null:JSON.stringify(data[k]);
  this.db.prepare('UPDATE round_items SET '+Object.keys(data).map(k=>k+'=?').join(',')+' WHERE round_id=? AND key=?').run(...Object.values(data),id,key);
  if(patch.state)this.event(id,key,patch.state,{reason:patch.reason||'',stage:patch.failure_stage||'',itemId:patch.result?.itemId});
 }
 assertIdle(){if(this.active||this.batch.active||this.source.active||this.source.queueLease)fail('已有执行任务或轮次，禁止第二发布者');}
 assertManifest(id){const r=this.round(id);if(!r||r.shop!==this.shop.id)fail('轮次店铺不匹配');const rows=this.items(id);if(rows.some(x=>x.key!==destinationKey(x.task)||digest(x.task)!==x.task_hash||x.task.shopId!==r.shop))fail('轮次冻结资料已变化');const hash=digest({shop:r.shop,importId:r.import_id,entries:rows.map(x=>({key:x.key,position:x.position,taskHash:x.task_hash}))});if(hash!==r.manifest_hash||digest(r.authorization)!==r.authorization_hash)fail('轮次清单或授权校验失败');return r;}
 assertContentForTask(task,id){
  const r=this.round(id),x=this.item(id,destinationKey(task));
  if(contentHeld(x))throw Object.assign(Error('CONTENT_REVIEW_HELD: 原商品内容待核验，仅凭本地新审核不能解除隔离'),{code:'CONTENT_REVIEW_HELD'});
  if(!r||task.shopId!==r.shop||digest(task)!==x.task_hash)throw Object.assign(Error('CONTENT_REVIEW_INVALID: 原任务身份或资料版本不匹配'),{code:'CONTENT_REVIEW_INVALID'});
  if(!this.contentReviews)throw Object.assign(Error('CONTENT_REVIEW_REQUIRED: 缺少主图内容审核'),{code:'CONTENT_REVIEW_REQUIRED'});
  return this.contentReviews.assertApproved(task,r);
 }
 holdContent(id,x,reason){
  const run=x.run_id?this.source.store.run(x.run_id):null;
  this.update(id,x.key,{state:'RESULT_UNKNOWN',failure_stage:'content-review',reason,result:x.result||run?.result||this.source.store.completed(x.task)||null});
  this.event(id,x.key,'CONTENT_REVIEW_ISOLATED',{reason,itemId:this.item(id,x.key).result?.itemId||null,sourceState:run?.state||null,notRepublished:true});
 }
 applyContentReviews(id,reviews){
  this.assertIdle();this.assertManifest(id);
  let contentUnblocked=false;
  for(const review of reviews){
   const x=this.item(id,review.key);this.event(id,x.key,'CONTENT_REVIEW_RECORDED',review);
   const run=x.run_id?this.source.store.run(x.run_id):null;
   if(contentHeld(x))continue;
   if(run?.state==='PAUSED_CAPTCHA')continue;
   const neverSubmitted=!x.submitted&&!x.submission_uncertain&&!this.wasSubmitted(run)&&run?.state!=='VERIFIED'&&!this.source.store.completed(x.task);
   if(review.decision==='PASS'){
    if(contentPending(x)&&neverSubmitted){this.update(id,x.key,{state:'PENDING',failure_stage:'',reason:'主图目的地已核对；保留原任务与次数，等待明确继续'});contentUnblocked=true;}
    continue;
   }
   if(review.decision==='UNREVIEWED'){
    if(neverSubmitted&&!done.has(x.state)&&!isolated(x))this.update(id,x.key,{state:'WAITING_HUMAN',failure_stage:'content-preflight',reason:'主图地名待人工确认：'+review.observedText+'；未提交，其他已审核商品可继续'});
    continue;
   }
   // A content rejection cannot downgrade an unresolved submission into an
   // isolated item that the coordinator would skip. Resolve its original ID first.
   if(['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state)||x.submission_uncertain){
    this.update(id,x.key,{state:'RESULT_UNKNOWN',reason:'提交结果仍未知，且主图审核不通过；须先核验原商品ID，禁止再次提交',failure_stage:x.failure_stage==='content-review'?'submit-once':x.failure_stage||run?.checkpoint?.step||'submit-once'});continue;
   }
   if(run?.state==='VERIFIED'||x.state==='EXISTING_VERIFIED'||x.state==='NEW_SUCCESS'){
    this.holdContent(id,x,'主图内容待核验：'+review.observedText+'；保留原商品ID，禁止重发；本地审核不能代替平台内容修正');
   }else if(neverSubmitted&&!done.has(x.state)&&(!isolated(x)||contentPending(x))){
    this.update(id,x.key,{state:'PREFLIGHT_SKIPPED',failure_stage:'content-preflight',reason:'主图目的地错配：'+review.observedText+'；本商品未提交',finished:now()});
    this.syncQueue(x,'SKIPPED',null,'主图内容预检不通过，未提交');
   }
  }
  const rows=this.items(id);
  if(rows.some(x=>x.state==='RESULT_UNKNOWN'&&!isolated(x)))this.state(id,'RESULT_UNKNOWN','仍有真实提交结果未知，必须先核验原商品，不能用内容隔离跳过');
  else if(rows.some(contentHeld))this.state(id,'PAUSED','存在已发布商品的主图内容待核验，已隔离且禁止重发；其余商品通过逐图审核后才能继续');
  else if(contentUnblocked&&this.round(id).state==='NEEDS_REVIEW')this.state(id,'PAUSED','待核对主图已确认；保留原断点，检查并继续原轮次后才执行');
 }
 applyDefaultImageApproval(id=this.round()?.id,{transaction=true}={}){
  if(!id||typeof this.contentReviews?.prepareUserBatch!=='function')return 0;
  this.assertIdle();const r=this.assertManifest(id),prepared=this.contentReviews.prepareUserBatch(r,this.items(id));
  if(!prepared.length)return 0;
  const commit=()=>{
   this.contentReviews.save(prepared);this.applyContentReviews(id,prepared);
   this.event(id,null,'USER_BATCH_IMAGES_CONFIRMED',{method:'user-batch-confirmation',reviewer:'用户',count:prepared.length,manifestHash:r.manifest_hash,policyVersion:prepared[0].policyVersion,source:prepared[0].authorizationSource,notVisuallyReviewed:true,executionStarted:false});
  };
  if(transaction)this.source.store.transaction(commit);else commit();return prepared.length;
 }
 async create({importId,heatImportId,authorization,repairVersion,expectedCount=700}={}){
  this.assertIdle();if(this.creating)fail('轮次清单正在生成');
  if(authorization?.allowLive!==true||authorization?.maxSafeRecoveries!==2||authorization?.confirmedShop!==this.shop.name||authorization?.expectedCount!==expectedCount||!repairVersion)fail('缺少固定范围授权、目标店铺或修复版本');
  const unfinished=this.db.prepare("SELECT id FROM rounds WHERE state!='COMPLETED' ORDER BY rowid DESC LIMIT 1").get();if(unfinished)fail('已有未结束轮次，请从原轮次恢复：'+unfinished.id);
  const base=this.source.store.batch(importId),heat=heatImportId?this.source.store.batch(heatImportId):null;
  if(!base||base.tasks?.length!==expectedCount||!Number.isInteger(expectedCount)||expectedCount<1)fail('完整商品清单数量与授权范围不一致');
  if(heatImportId&&(!heat||heat.poolHash!==base.sourceHash))fail('热度表与完整商品池版本不一致');
  const keys=base.tasks.map(destinationKey);if(new Set(keys).size!==keys.length||base.tasks.some(t=>t.shopId!==this.shop.id))fail('清单含重复商品或其他店铺');
  const heatMap=new Map();for(const t of heat?.tasks||[])if(!heatMap.has(destinationKey(t)))heatMap.set(destinationKey(t),t);
  const entries=base.tasks.map((original,i)=>{
   const key=keys[i],oldRun=this.db.prepare('SELECT id FROM runs WHERE key=?').get(key),oldQueue=this.db.prepare('SELECT id FROM batch_items WHERE key=?').get(key);
   const run=oldRun?this.source.store.run(oldRun.id):null,queue=oldQueue?this.batch.store.item(oldQueue.id):null;
   if(run&&queue&&digest(run.task)!==digest(queue.task))fail('原任务与队列快照冲突：'+key);
   const task=structuredClone(run?.task||queue?.task||((original.listing.type==='city'||original.listing.city)&&heatMap.get(key))||original);
   if(destinationKey(task)!==key||task.shopId!==this.shop.id||task.business?.shop_name!==this.shop.name)fail('来源映射改变了商品或店铺身份');
   return {key,position:i+1,task,queue,run};
  });
  this.creating=true;
  try{
   const defaults=await this.getListingDefaults();
   if(defaults?.ignoreExternalDestinationProducts===true&&(defaults.shopId!==this.shop.id||defaults.scope!==undefined&&!['SHOP_DEFAULT','WEBSITE_DEFAULT'].includes(defaults.scope)||!Number.isInteger(defaults.revision)||defaults.revision<1||typeof defaults.confirmedAt!=='string'||!Number.isFinite(Date.parse(defaults.confirmedAt))))fail('默认发布规则归属或版本无效');
   const newEntries=entries.filter(x=>!x.run&&!x.queue&&!this.source.store.completed(x.task)&&!x.task.adapterIssues?.length);
   if(newEntries.length&&this.rules){const prepared=await this.rules.prepare({importId,tasks:newEntries.map(x=>x.task),selectionHash:digest(newEntries.map(x=>x.task)),limit:newEntries.length},this.shop.id,'round');if(prepared.tasks.length!==newEntries.length)fail('发布规则改变了商品范围');prepared.tasks.forEach((t,i)=>{if(destinationKey(t)!==newEntries[i].key)fail('发布规则改变了商品身份');newEntries[i].task=t;});}
   this.assertIdle();
   // All checks after awaited preparation, before the manifest transaction.
   for(const x of entries){const run=this.db.prepare('SELECT id FROM runs WHERE key=?').get(x.key),q=this.db.prepare('SELECT id FROM batch_items WHERE key=?').get(x.key);if((run?.id||null)!==(x.run?.id||null)||(q?.id||null)!==(x.queue?.id||null))fail('清单生成期间原任务改变，请重新检查');}
   const id=randomUUID(),at=now(),manifestHash=digest({shop:this.shop.id,importId,entries:entries.map(x=>({key:x.key,position:x.position,taskHash:digest(x.task)}))});
   this.source.store.transaction(()=>{
    this.db.prepare('INSERT INTO rounds(id,shop,import_id,manifest_hash,authorization_hash,authorization,repair_version,state,at,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,this.shop.id,importId,manifestHash,digest(authorization),JSON.stringify(authorization),repairVersion,'READY',at,at);
    const insert=this.db.prepare('INSERT INTO round_items(round_id,key,position,task,task_hash,queue_id,batch_id,run_id,baseline_attempts,updated) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(const x of entries)insert.run(id,x.key,x.position,JSON.stringify(x.task),digest(x.task),x.queue?.id||null,x.queue?.batch||null,x.run?.id||x.queue?.run_id||null,x.queue?.attempts||0,at);
    this.event(id,null,'MANIFEST_FROZEN',{count:entries.length,importId,heatImportId:heatImportId||null,sourceHash:base.sourceHash,manifestHash,authorizationHash:digest(authorization),repairVersion});
    this.applyDefaultImageApproval(id,{transaction:false});
    if(defaults?.ignoreExternalDestinationProducts===true){
     const website=defaults.scope==='WEBSITE_DEFAULT';
     const payload={enabled:true,scope:'THIS_ROUND_ONLY',manifestHash,shop:this.shop.id,confirmedBy:website?'用户确认的网站默认规则':'用户确认的店铺默认规则',at,inheritedFrom:{scope:website?'WEBSITE_DEFAULT':'SHOP_DEFAULT',revision:defaults.revision,confirmedAt:defaults.confirmedAt},meaning:'按导入清单发布；店内其他同目的地商品不阻止；本系统原商品ID、提交结果、资料与平台验证保护保持'};
     this.db.prepare('INSERT INTO round_policy_overrides(round_id,policy,payload,at) VALUES(?,?,?,?)').run(id,'ignore-destination-duplicates',JSON.stringify(payload),at);
     this.event(id,null,website?'WEBSITE_DEFAULT_POLICY_INHERITED':'SHOP_DEFAULT_POLICY_INHERITED',{policy:'ignore-destination-duplicates',...payload});
    }
   });
   await this.report(id);return this.view(id);
  }finally{this.creating=false;}
 }
 recover(){
  // Construction never launches a browser or a task. Existing server ownership
  // must be established by the caller before constructing this coordinator.
  if(this.batch.active||this.source.active)return;
  for(const row of this.db.prepare("SELECT id FROM rounds WHERE state IN ('RUNNING','PAUSING')").all())this.state(row.id,'PAUSED','程序中断；先对账，再从原轮次明确恢复');
  const trustedRounds=new Set();
  for(const row of this.db.prepare("SELECT id FROM rounds WHERE state!='COMPLETED'").all()){
   try{this.assertManifest(row.id);this.reconcileMappings(row.id);trustedRounds.add(row.id);}catch(e){this.state(row.id,'SYSTEM_BLOCKED','原轮次身份映射待核对：'+reasonOf(e));}
  }
  for(const row of this.db.prepare("SELECT round_id,key FROM round_items WHERE state NOT IN ('EXISTING_VERIFIED','NEW_SUCCESS','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED')").all()){
   if(!trustedRounds.has(row.round_id))continue;
   this.reconcileResult(row.round_id,row.key);
  }
 }
 reconcileResult(id,key){
   const x=this.item(id,key),run=x.run_id?this.source.store.run(x.run_id):null;if(!run||contentHeld(x)||this.parking.has(id,x))return;
   if(run.state==='VERIFIED'&&x.entered_publish){try{this.assertContentForTask(x.task,x.round_id);}catch(e){this.update(x.round_id,x.key,{state:'RESULT_UNKNOWN',failure_stage:'content-review',result:x.result||run.result,...this.submissionFlags(run,x.round_id),reason:'原商品已发布，主图内容仍需核验：'+reasonOf(e)});return;}}
   if(run.state==='VERIFIED'&&x.entered_publish&&isEvidence(run.result)){try{this.assertResultIdentity(x.round_id,x.key,run.result);}catch(e){this.update(x.round_id,x.key,{state:'RESULT_UNKNOWN',reason:reasonOf(e)});this.state(x.round_id,'RESULT_UNKNOWN',reasonOf(e));return;}this.update(x.round_id,x.key,{state:'NEW_SUCCESS',result:run.result,...this.submissionFlags(run,x.round_id),finished:now(),reason:'从本轮原执行记录恢复核验结果；未再次提交'});this.syncQueue(x,'SUCCEEDED',run.result,'从本轮已核验执行对账，未再次提交');}
   else if(['SUBMITTING','RESULT_UNKNOWN'].includes(run.state))this.update(x.round_id,x.key,{state:'RESULT_UNKNOWN',...this.submissionFlags(run,x.round_id),reason:'提交结果待核验，禁止再次提交',failure_stage:run.checkpoint?.step||''});
 }
 reconcileMappings(id){
  const r=this.round(id);
  for(const original of this.items(id)){
   const found=this.db.prepare('SELECT id FROM batch_items WHERE key=?').get(original.key);
   if(!found){if(original.queue_id)fail('原队列映射指向不存在的商品');continue;}
   const q=this.batch.store.item(found.id),b=this.batch.store.batch(q.batch);
   if(q.key!==original.key||digest(q.task)!==original.task_hash||q.task.shopId!==r.shop||b?.shop!==r.shop)fail('原队列身份或快照与固定清单不一致');
   if(original.queue_id&&original.queue_id!==q.id||original.batch_id&&original.batch_id!==q.batch)fail('禁止替换原队列或内部批次身份');
   if(!original.queue_id&&(b.review?.roundId!==id||b.review?.manifestHash!==r.manifest_hash||b.mode!=='LIVE'))fail('未映射队列并非本轮已提交的内部批次');
   let runId=original.run_id||q.run_id;
   if(original.run_id&&q.run_id&&original.run_id!==q.run_id)fail('原执行任务与队列关联冲突');
   if(!runId){const existing=this.db.prepare('SELECT id FROM runs WHERE key=?').get(original.key);if(existing){const created=this.source.store.events(existing.id).find(e=>e.kind==='CREATED');if(created?.payload?.review?.roundId!==id)fail('新出现的执行任务不属于本轮授权');runId=existing.id;}}
   if(runId){const run=this.source.store.run(runId);if(run.key!==original.key||digest(run.task)!==original.task_hash||run.task.shopId!==r.shop)fail('原执行任务身份或快照不一致');}
   // BatchStore.create and SourceStore.create each commit their own existing
   // transactions. Recover their committed identities rather than creating a
   // second task when the coordinator's following linkage write was lost.
   if(!original.queue_id||!original.batch_id||runId&&!original.run_id||runId&&!q.run_id){
    this.source.store.transaction(()=>{if(runId&&!q.run_id)this.batch.store.attach(q.id,runId);this.update(id,original.key,{queue_id:q.id,batch_id:q.batch,...(runId?{run_id:runId}:{})});this.event(id,original.key,'COMMITTED_MAPPING_RECOVERED',{queueId:q.id,batchId:q.batch,runId:runId||null,manifestHash:r.manifest_hash});});
   }
  }
 }
 humanHolds(id){
  return this.db.prepare(`SELECT i.key,i.reason,i.failure_stage,i.submitted,i.submission_uncertain,i.result,i.run_id FROM round_items i LEFT JOIN runs r ON r.id=i.run_id
   WHERE i.round_id=? AND i.state NOT IN ('EXISTING_VERIFIED','NEW_SUCCESS','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED')
   AND ((i.state='WAITING_HUMAN' AND i.failure_stage!='content-preflight') OR r.state='PAUSED_CAPTCHA') ORDER BY i.position`).all(id);
 }
 captchaRecheck(id){
  const holds=this.humanHolds(id);
  const eligible=holds.length>0&&holds.every(x=>{
   const run=x.run_id?this.source.store.run(x.run_id):null,reason=[x.reason,run?.reason].filter(Boolean).join('；');
   if(!/CAPTCHA|验证码|滑块|风险验证/i.test(reason)||/登录|店铺身份|WRONG_SHOP|IDENTITY|HUMAN_MODE/i.test(reason)||/identity|content|submit|verify-platform|login/i.test(x.failure_stage))return false;
   if(x.submitted||x.submission_uncertain||x.result||run&&(!['PAUSED','PAUSED_CAPTCHA'].includes(run.state)||run.mode!=='LIVE'||run.result||run.checkpoint?.itemId||run.checkpoint?.reconciliation?.itemId))return false;
   return !run||!this.source.store.events(run.id).some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind));
  });
  return {eligible,count:holds.length,keys:holds.map(x=>x.key)};
 }
 verifyClearedCaptcha(id,browser){
  const age=Date.now()-Date.parse(browser?.checkedAt),check=this.captchaRecheck(id);
  if(!check.eligible||browser?.running!==true||browser.loggedIn!==true||browser.loginState!=='LOGGED_IN'||browser.stale===true||!Number.isFinite(age)||age<0||age>15000)return null;
  return {source:'fresh-browser-check',checkedAt:browser.checkedAt,keys:check.keys};
 }
 start(id,options={}){
  this.assertIdle();const r=this.assertManifest(id);if(r.state==='COMPLETED')fail('本轮已结束，不重复处理终态商品');this.reconcileMappings(id);
  const window=this.windows.open(id),latest=this.windows.latest(id);
  if(latest&&!window){
   if(latest.state!=='COMPLETED'||!latest.auto_continue||!latest.continuation_pending||options.windowId!==latest.id)fail('上一执行轮次已结束，请先检查并创建下一轮范围');
   this.windows.assert(latest.id,id);options={...options,handoffWindow:latest.id};
  }
  if(window){this.windows.assert(window.id,id);if(options.windowId!==window.id)fail('请核对当前执行轮次后继续，不能恢复其他轮次');}
  if(window&&r.stopped)options={...options,...(this.windows.resolutionRequired(window.id)?{finishCurrentOnly:true}:{finalizeStopOnly:true})};
  // Historical publication gates remain, but their content cannot be assumed.
  // Every surviving new success must have a review before any more LIVE work.
  for(const x of this.items(id))if(x.state==='NEW_SUCCESS')this.assertContentForTask(x.task,id);
  const human=this.humanHolds(id),proof=options.captchaVerification;
  const checked=proof?.source==='fresh-browser-check'&&this.verifyClearedCaptcha(id,{running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:proof.checkedAt});
  const captchaCleared=!!checked&&JSON.stringify(checked.keys)===JSON.stringify(proof.keys);
  if(human.length&&options.humanVerified!==true&&!captchaCleared)fail('请先人工处理登录或验证码，并确认后恢复');
  if(options.repairVersion&&options.repairVersion!==r.repair_version){
   // An idle manifest can predate a deployment before its first start or after
   // an explicit stop. Neither state needs an artificial pause to adopt it.
   if(!['READY','STOPPED','SYSTEM_BLOCKED','PAUSED','WAITING_HUMAN','RESULT_UNKNOWN'].includes(r.state))fail('只能在任务未运行时核验新修复版本');
   this.db.prepare('UPDATE rounds SET repair_version=? WHERE id=?').run(options.repairVersion,id);
   this.event(id,null,'REPAIR_VERSION_UPDATED',{from:r.repair_version,to:options.repairVersion,authorizationHash:r.authorization_hash,attemptsPreserved:true});
   r.repair_version=options.repairVersion;
  }
  this.active=id;this.batch.active='round:'+id;this.source.queueLease='round:'+id;this.pauseRequested=false;this.stopRequested=false;
  this.executionAttempts.coordinatorSettled=false;this.executionAttempts.automaticParent=null;
  this.source.store.transaction(()=>{this.db.prepare('UPDATE rounds SET stopped=? WHERE id=?').run(options.finishCurrentOnly||options.finalizeStopOnly?1:0,id);this.state(id,'RUNNING',options.finishCurrentOnly?'仅核验原商品，完成后停止':'从固定清单继续，终态商品不重复');this.event(id,null,'START_ACCEPTED',{humanVerified:options.humanVerified===true,captchaVerification:captchaCleared?checked:null,repairVersion:r.repair_version,previousState:r.state,finishCurrentOnly:options.finishCurrentOnly===true});});
  this.pending=this.pump(id,options).catch(e=>{if(this.pauseRequested||e.code==='ROUND_PAUSE'){this.state(id,this.stopRequested?'STOPPED':'PAUSED',this.stopRequested?'本轮已停止；剩余商品仍未处理':'已安全暂停，恢复将沿用原任务和记录');this.event(id,null,'PAUSE_FINALIZED',{stopRequested:this.stopRequested,phase:'initial-check-or-boundary'});}else{this.state(id,'SYSTEM_BLOCKED',reasonOf(e));this.event(id,null,'COORDINATOR_ERROR',{reason:reasonOf(e)});}}).finally(()=>this.finishExecution(id));
  return this.view(id);
 }
 resume(id,options={}){return this.start(id,options);}
 pause(){if(!this.active)return {pauseRequested:false};this.pauseRequested=true;this.source.pause();this.state(this.active,'PAUSING','正在安全暂停；当前动作检查后停止');return {pauseRequested:true,id:this.active};}
 stop(){
  const goalRound=this.round();if(goalRound)this.successGoals.stopRequested(goalRound.id);
  if(!this.active){
   this.assertIdle();const r=this.round(),latest=r&&this.windows.latest(r.id),w=r&&(this.windows.open(r.id)||(latest?.continuation_pending?latest:null));
   if(!r||r.state==='COMPLETED'||!w)return {stopped:false};
   if(w.continuation_pending)this.windows.finishContinuation(w.id,'操作者停止，未创建下一轮');
   this.assertManifest(r.id);this.state(r.id,'STOPPED','本轮已停止；未执行任务与待核验现场保留');this.db.prepare('UPDATE rounds SET stopped=1 WHERE id=?').run(r.id);
   return {stopped:true,id:r.id,windowId:w.id};
  }
  this.stopRequested=true;const r=this.pause();this.db.prepare('UPDATE rounds SET stopped=1 WHERE id=?').run(this.active);return {...r,stopRequested:true};
 }
 async shutdown(){if(this.active){this.pause();await this.pending;}}
 wasSubmitted(run){return !!run&&(run.state==='SUBMITTING'||run.state==='RESULT_UNKNOWN'||this.source.store.events(run.id).some(e=>['SUBMITTING','SUBMIT_EVIDENCE'].includes(e.kind)));}
 submissionFlags(run,id){
  const r=this.round(id),entry=run&&this.db.prepare('SELECT entered_publish FROM round_items WHERE round_id=? AND key=?').get(id,run.key);
  if(!run||!r||!entry?.entered_publish)return {submitted:0,submission_uncertain:0};
  const events=this.source.store.events(run.id).filter(e=>Date.parse(e.at)>=Date.parse(r.at));
  const clicked=events.some(e=>e.kind==='SUBMIT_CLICKED'||e.kind==='SUBMIT_EVIDENCE'),intent=events.some(e=>e.kind==='SUBMITTING');
  return {submitted:clicked?1:0,submission_uncertain:!clicked&&intent?1:0};
 }
 assertResultIdentity(id,key,result){
  const itemId=String(result?.itemId||''),r=this.round(id),entry=this.item(id,key),conflict=reason=>{throw Object.assign(Error('商品 ID 已关联其他目的地，禁止写入成功或重新发布：'+itemId+'；'+reason),{code:'RESULT_UNKNOWN'});};
  if(entry.task.shopId!==r.shop||entry.task_hash!==digest(entry.task))conflict('目标商品快照不一致');
  if(!/^\d{6,30}$/.test(itemId))conflict('商品ID无效');
  const another=this.db.prepare("SELECT key FROM round_items WHERE round_id=? AND key!=? AND CAST(json_extract(result,'$.itemId') AS TEXT)=? LIMIT 1").get(id,key,itemId);if(another)conflict('本轮不同商品');
  for(const run of this.source.store.list())if(run.key!==key&&run.task.shopId===r.shop&&[run.result?.itemId,run.checkpoint?.itemId,run.checkpoint?.reconciliation?.itemId].some(value=>String(value||'')===itemId))conflict('本店原执行任务 '+run.id);
  const histories=this.db.prepare("SELECT key FROM history WHERE key!=? AND CAST(json_extract(payload,'$.itemId') AS TEXT)=?").all(key,itemId);
  if(histories.length){
   const owners=new Map();for(const row of this.db.prepare('SELECT payload FROM imports').all())for(const task of parse(row.payload)?.tasks||[])owners.set(destinationKey(task),task.shopId);
   for(const row of histories)if(!owners.has(row.key)||owners.get(row.key)===r.shop)conflict(owners.has(row.key)?'本店历史记录':'历史记录归属不明');
  }
 }
 assertLease(id){if(this.active!==id||this.batch.active!=='round:'+id||this.source.queueLease!=='round:'+id)fail('轮次失去唯一执行租约');if(this.pauseRequested)throw Object.assign(Error('操作者暂停'),{code:'ROUND_PAUSE'});}
 // Ephemeral display phase only. Original checkpoints and execution decisions
 // remain authoritative and are never changed to improve the presentation.
 displayPhase(id,key,stage){if(this.active===id&&this.round(id)?.current_item===key)this.currentOperation={roundId:id,key,stage};}
 failureStage(id,x,run){
  const op=this.currentOperation;
  // Query failure is not a candidate hold. Keep these distinct from the
  // existing-listing-check isolation token and preserve the source checkpoint.
  if(this.active===id&&this.round(id)?.current_item===x.key&&op?.roundId===id&&op.key===x.key){
   if(op.stage==='existing-listing-check')return 'existing-listing-query';
   if(op.stage==='known-listing-check')return 'known-listing-query';
  }
  return run?.checkpoint?.step||'preflight';
 }
 currentStage(r,x,run){
  const active=this.active===r.id&&r.current_item===x.key,operation=active&&this.currentOperation?.roundId===r.id&&this.currentOperation.key===x.key?this.currentOperation.stage:null;
  if(operation&&operation!=='source-execution')return operation;
  if(x.state==='RESULT_UNKNOWN')return x.failure_stage||'verify-platform-result';
  if(done.has(x.state))return x.state==='EXISTING_VERIFIED'?'existing-verified':x.state==='NEW_SUCCESS'?'platform-verified':x.failure_stage||'';
  if(active){
   if(x.entered_publish&&run?.id===this.source.active)return run.checkpoint?.step||'open-new-form';
   return run?.state==='VERIFIED'||run?.result?.itemId||run?.checkpoint?.itemId?'known-listing-check':'existing-listing-check';
  }
  return x.failure_stage||'';
 }
 async verify(id,x){
  if(contentHeld(this.item(id,x.key)))throw Object.assign(Error('CONTENT_REVIEW_HELD: 已发布商品内容待核验，后台存在不能解除隔离'),{code:'CONTENT_REVIEW_HELD'});
  this.assertContentForTask(x.task,id);
  const run=x.run_id?this.source.store.run(x.run_id):null,history=this.source.store.completed(x.task),itemId=history?.itemId||run?.result?.itemId||run?.checkpoint?.itemId||null;
  this.displayPhase(id,x.key,itemId?'known-listing-check':'existing-listing-check');
  const single=this.singleItemExecution?.roundId===id&&this.singleItemExecution.key===x.key?this.singleItemExecution:null;
  const missingSubmittedId=!itemId&&['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state);
  const result=await this.verifyExisting({task:x.task,itemId,history,run,roundId:id,key:x.key,
   ...(missingSubmittedId?{submissionEvents:this.source.store.events(run.id),assertUnusedItemId:value=>assertUnclaimedSubmissionId(this.source.store,run,value)}:{}),
   ...(single?{executionWindowId:single.windowId,executionAttemptId:single.attemptId}:{})});this.assertLease(id);
  if(!result){if(itemId||run?.state==='VERIFIED'||['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state))throw Object.assign(Error('已有商品记录未能在原店铺核实，禁止重新发布'),{code:'RESULT_UNKNOWN'});return false;}
  if(!isEvidence(result)||itemId&&String(result.itemId)!==String(itemId))throw Object.assign(Error('已有商品核验缺少完整或一致证据，禁止发布'),{code:'RESULT_UNKNOWN'});
  this.assertResultIdentity(id,x.key,result);
  if(['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state))this.source.store.move(run.id,'VERIFIED','本轮后台核验原商品；未重新提交',result);
  else this.source.store.history(x.task,result);
  const isNew=!!(x.entered_publish&&run&&this.wasSubmitted(run));
  this.update(id,x.key,{state:isNew?'NEW_SUCCESS':'EXISTING_VERIFIED',result,...this.submissionFlags(run,id),finished:now(),reason:'目标店铺后台核验通过'});
  this.syncQueue(this.item(id,x.key),'SUCCEEDED',result,'后台核验已存在，不重复发布');return true;
 }
 syncQueue(x,state,result,reason=''){
  if(!x.queue_id)return;let q=this.batch.store.item(x.queue_id);if(q.state===state||q.state==='SKIPPED'||q.state==='SUCCEEDED')return;
  if(state==='SUCCEEDED'){
   // This path is read-only platform reconciliation; no publish attempt is consumed.
   if(q.state==='FAILED'){this.batch.store.move(q.id,'RETRY','已核验存在，衔接原队列结果');q=this.batch.store.item(q.id);}
   if(['PENDING','RETRY','WAITING_HUMAN'].includes(q.state))this.batch.store.move(q.id,'RUNNING','仅同步后台核验结果；未发起发布');
   this.batch.store.move(q.id,'SUCCEEDED',reason,result);
  }else if(state==='SKIPPED'){if(['PENDING','RETRY','WAITING_HUMAN','FAILED','RUNNING'].includes(q.state))this.batch.store.move(q.id,'SKIPPED',reason);}
  else if(q.state==='RUNNING')this.batch.store.move(q.id,state,reason,result);
  this.finishInternal(x.batch_id);
 }
 finishInternal(batchId){
  if(!batchId)return;const items=this.batch.store.items(batchId);
  if(!items.length||!items.every(x=>['SUCCEEDED','FAILED','SKIPPED'].includes(x.state)))return;
  // A historical platform success stays SUCCEEDED even when its content is held.
  // Only genuinely terminal round items can complete this internal aggregate.
  const mapped=this.db.prepare('SELECT queue_id,state FROM round_items WHERE batch_id=?').all(batchId);
  if(mapped.length!==items.length||new Set(mapped.map(x=>x.queue_id)).size!==items.length||!items.every(q=>mapped.some(x=>x.queue_id===q.id&&done.has(x.state))))return;
  this.batch.store.setBatch(batchId,'COMPLETED','本内部批次已处理；轮次将自动衔接后续清单');
 }
 hasUnsettledExecution(){return !!(this.source.active||this.db.prepare("SELECT id FROM runs WHERE state IN ('RUNNING','SUBMITTING') LIMIT 1").get()||this.db.prepare("SELECT id FROM batch_items WHERE state='RUNNING' LIMIT 1").get());}
 settleInternalBatches(id,{keepBatchId=null,phase='exit'}={}){
  const candidates=this.db.prepare(`SELECT b.id FROM batches b WHERE b.state='RUNNING' AND (? IS NULL OR b.id!=?)
   AND (json_extract(b.review,'$.roundId')=? OR EXISTS(SELECT 1 FROM round_items i WHERE i.round_id=? AND i.batch_id=b.id))`).all(keepBatchId,keepBatchId,id,id);
  if(!candidates.length)return [];
  if(this.hasUnsettledExecution())fail('真实执行尚未结束，不能收口内部批次或释放执行租约');
  const r=this.assertManifest(id),entries=this.items(id),byQueue=new Map(entries.filter(x=>x.queue_id).map(x=>[x.queue_id,x]));
  return this.source.store.transaction(()=>{
   // Validate every candidate before writing any aggregate. An invalid mapping
   // must not silently repair identity or partly settle another batch.
   const plans=candidates.map(({id:batchId})=>{
    const b=this.batch.store.batch(batchId),items=this.batch.store.items(batchId);
    if(b.shop!==r.shop||b.review?.roundId&&(b.review.roundId!==id||b.review.manifestHash!==r.manifest_hash))fail('内部批次归属或轮次清单哈希不一致');
    if(!items.length||entries.filter(x=>x.batch_id===batchId).length!==items.length)fail('内部批次并非完整映射到本轮清单');
    const mapped=items.map(q=>{
     const x=byQueue.get(q.id);
     if(!x||x.batch_id!==batchId||x.key!==q.key||destinationKey(q.task)!==x.key||digest(q.task)!==x.task_hash||q.task.shopId!==r.shop||(q.run_id||null)!==(x.run_id||null))fail('内部批次队列身份或冻结快照不一致');
     if(q.run_id){const run=this.source.store.run(q.run_id);if(run.key!==x.key||run.task.shopId!==r.shop||digest(run.task)!==x.task_hash)fail('内部批次原执行任务身份不一致');}
     return x;
    });
    const isolatedCount=mapped.filter(isolated).length,complete=items.every(x=>['SUCCEEDED','FAILED','SKIPPED'].includes(x.state))&&mapped.every(x=>done.has(x.state));
    const state=complete?'COMPLETED':'PAUSED',reason=complete?'本内部批次全部真实终态；执行与计时已结束':
     isolatedCount&&mapped.every(x=>done.has(x.state)||isolated(x))?'安全项已处理；候选或内容隔离待核验，原队列状态保留':
     phase==='handoff'?'已交接后续条目；本批原队列与核验状态保留':`轮次 ${r.state}；${r.reason||'执行已停止，原任务状态保留'}`;
    return {batchId,state,reason,isolatedCount};
   });
   for(const p of plans){this.batch.store.setBatch(p.batchId,p.state,p.reason);this.event(id,null,'INTERNAL_BATCH_SETTLED',{...p,phase,from:'RUNNING'});}
   return plans;
  });
 }
 async finishExecution(id){
  let sourceSettled=false;
  try{
   const pending=this.source.pending;if(pending&&pending===this.pending)fail('执行器 pending 指向轮次自身；禁止自等待或释放租约');
   try{await pending;}finally{sourceSettled=true;}
   if(this.hasUnsettledExecution())fail('源执行器尚未完全结束；保留执行租约，禁止第二发布者');
   this.settleInternalBatches(id,{phase:'exit'});
  }catch(e){this.state(id,'SYSTEM_BLOCKED','内部批次收口失败；保留原任务与核验状态：'+reasonOf(e));this.event(id,null,'INTERNAL_BATCH_SETTLE_ERROR',{reason:reasonOf(e),sourceSettled});}
  // Failed aggregation does not strand an idle owner, but an unfinished source
  // retains the lease even when the coordinator's promise has already stopped.
  if(sourceSettled&&!this.hasUnsettledExecution()&&!this.executionAttempts.blocked){if(this.batch.active==='round:'+id)this.batch.active=null;if(this.source.queueLease==='round:'+id)this.source.queueLease=null;if(this.active===id)this.active=null;}
  await this.report(id).catch(e=>this.event(id,null,'REPORT_WRITE_ERROR',{reason:reasonOf(e)}));
  this.executionAttempts.coordinatorSettled=sourceSettled&&!this.hasUnsettledExecution();
 }
 async preflight(id,x){
  this.displayPhase(id,x.key,'preflight');
  try{this.assertContentForTask(x.task,id);if(x.task.adapterIssues?.length)throw Object.assign(Error('ADAPTER_ISSUE: '+x.task.adapterIssues.join('；')),{code:'TASK_DATA'});await this.checkFiles(x.task);this.assertLease(id);return true;}
  catch(e){
   if(e.code==='ROUND_PAUSE')throw e;
   if(e.code==='CONTENT_MISMATCH'){this.update(id,x.key,{state:'PREFLIGHT_SKIPPED',reason:reasonOf(e),failure_stage:'content-preflight',finished:now()});this.syncQueue(x,'SKIPPED',null,'主图内容错配，未提交：'+reasonOf(e));return false;}
   if(e.path){const normalize=v=>String(v||'').replaceAll('\\','/').toLowerCase(),missing=normalize(e.path),users=this.items(id).filter(v=>[v.task.source?.workbook,...(v.task.sourceReferences||[]).map(s=>s.workbook),...Object.values(v.task.assets||{}).flat().map(a=>a.path)].some(p=>normalize(p)===missing));if(users.length>1)throw Object.assign(Error('共享资料不可用，暂停整轮，不批量跳过：'+e.path),{code:'SHARED_SOURCE_UNAVAILABLE'});}
   const c=this.classifyFailure(e,{preflight:true});if(['PREFLIGHT','PRODUCT'].includes(c.kind)){this.update(id,x.key,{state:'PREFLIGHT_SKIPPED',reason:reasonOf(e),failure_stage:'preflight',finished:now()});this.syncQueue(x,'SKIPPED',null,'本轮预检跳过；未提交：'+reasonOf(e));return false;}throw e;
  }
 }
 async resumeUnstartedHumanItem(id,x,options){
  if((options.humanVerified!==true&&!options.captchaVerification?.keys.includes(x.key))||x.state!=='WAITING_HUMAN'||contentPending(x)||x.run_id||x.queue_id)return x;
  this.assertLease(id);
  const window=this.windows.open(id);
  if(!window)throw Object.assign(Error('原人工处理任务缺少执行轮次，保留原记录'),{code:'HUMAN_RESUME_WINDOW_REQUIRED'});
  const scope={roundId:id,windowId:window.id,key:x.key},reader=this.executionAttempts.reader;
  const before=reader.read(scope);
  if(before.hasSubmit||before.x.entered_publish)throw Object.assign(Error('原任务已有发布或提交证据，须先核验，不能重新进入队列'),{code:'HUMAN_RESUME_SUBMISSION_PROTECTED'});
  this.assertContentForTask(x.task,id);await this.checkFiles(x.task);this.assertLease(id);
  return this.source.store.transaction(()=>{
   const current=reader.read(scope);
   if(current.revision!==before.revision||current.hasSubmit||current.run||current.q)throw Object.assign(Error('人工处理检查期间原任务记录已变化，请重新核对'),{code:'HUMAN_RESUME_SCOPE_CHANGED'});
   this.assertContentForTask(current.x.task,id);
   this.update(id,x.key,{state:'PENDING',reason:'人工确认及原资料复核通过，继续原未启动任务'});
   this.event(id,x.key,'UNSTARTED_HUMAN_RESUME_CONFIRMED',{windowId:window.id,taskHash:x.task_hash,submitted:false});
   return this.item(id,x.key);
  });
 }
 async ensureQueue(id,x){
  if(x.queue_id)return this.batch.store.item(x.queue_id);
  const r=this.round(id),accepted=this.items(id).filter(x=>x.state==='NEW_SUCCESS').length,size=r.gate===0||accepted===0?1:r.gate<5||accepted<5?Math.max(1,5-accepted):100,ready=[];
  const window=this.windows.open(id),allowed=window?new Set(this.windows.entries(window.id).map(e=>e.key)):null;
  for(const candidate of this.items(id)){
   if(this.singleItemExecution?.roundId===id&&candidate.key!==this.singleItemExecution.key)continue;
   if(allowed&&!allowed.has(candidate.key))continue;
   if(candidate.position<x.position||candidate.state!=='PENDING'||candidate.queue_id||candidate.run_id||this.source.store.completed(candidate.task))continue;
   if(await this.preflight(id,candidate))ready.push(candidate);if(ready.length>=size)break;
  }
  if(!ready.some(v=>v.key===x.key))return null;
  const tasks=ready.map(v=>v.task),review={reviewed:true,selectionHash:digest(tasks),authorization:r.authorization,roundId:id,manifestHash:r.manifest_hash};
  this.assertLease(id);const b=this.batch.store.create(r.import_id,tasks,r.shop,'LIVE',review,{roundId:id});
  for(const q of this.batch.store.items(b.id))this.update(id,q.key,{queue_id:q.id,batch_id:b.id});
  this.event(id,null,'INTERNAL_BATCH_CREATED',{batchId:b.id,count:tasks.length,gate:r.gate});return this.batch.store.item(this.item(id,x.key).queue_id);
 }
 async executeItem(id,x){
  if(this.parking.has(id,x))throw Object.assign(Error('挂起商品仅可核验，禁止重新执行或提交'),{code:'ITEM_PARK_EXECUTION_PROTECTED'});
  this.assertLease(id);let run=x.run_id?this.source.store.run(x.run_id):null;
  this.displayPhase(id,x.key,'content-preflight');
  if(contentHeld(this.item(id,x.key)))throw Object.assign(Error('CONTENT_REVIEW_HELD: 已发布错图保持隔离，禁止重投'),{code:'CONTENT_REVIEW_HELD'});
  try{this.assertContentForTask(x.task,id);}catch(e){if(e.code==='CONTENT_MISMATCH'&&!['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state)&&!x.submission_uncertain){if(run?.state==='VERIFIED')this.holdContent(id,x,'本地主图错配，原商品内容待核验：'+reasonOf(e));else if(!this.wasSubmitted(run))await this.preflight(id,x);else throw e;return;}throw e;}
  if(run&&['SUBMITTING','RESULT_UNKNOWN'].includes(run.state)){this.update(id,x.key,{state:'RESULT_UNKNOWN',...this.submissionFlags(run,id),reason:'只允许核验原商品'});if(await this.verify(id,this.item(id,x.key)))return;fail('原商品提交结果仍未知');}
  if(await this.verify(id,x))return;
  if(!await this.preflight(id,x))return;
  if(run?.state==='DRY_RUN_COMPLETE'||run&&run.mode!=='LIVE')throw Object.assign(Error('原任务为仅填写模式，保留原快照；需核对正式授权转换'),{code:'HUMAN_MODE'});
  let q=await this.ensureQueue(id,x);x=this.item(id,x.key);this.assertLease(id);
  // A pre-existing single run may have no batch item. Reuse it without creating
  // another run; queue creation is permitted only if its exact snapshot is used.
  if(!q&&x.run_id){const r=this.round(id),tasks=[x.task],b=this.batch.store.create(r.import_id,tasks,r.shop,'LIVE',{reviewed:true,selectionHash:digest(tasks),authorization:r.authorization,roundId:id,manifestHash:r.manifest_hash},{roundId:id});q=this.batch.store.items(b.id)[0];this.update(id,x.key,{queue_id:q.id,batch_id:b.id});}
  if(!q){
   if(done.has(this.item(id,x.key).state))return;
   throw Object.assign(Error('原商品未能进入执行队列；已暂停，未启动发布'),{code:'QUEUE_PREPARATION_INCOMPLETE'});
  }
  if(q.state==='SUCCEEDED'){if(!await this.verify(id,x))fail('队列成功缺少可核验商品ID');return;}
  if(q.state==='SKIPPED'){this.update(id,x.key,{state:'PREFLIGHT_SKIPPED',reason:'沿用原队列明确跳过：'+q.reason,failure_stage:'previous-decision',finished:now()});return;}
  this.selections.assertExecutionItem(id,x);
  this.successGoals.assertClaim(id,x);
  if(q.state==='FAILED')this.batch.store.move(q.id,'RETRY','本轮授权从原任务恢复，保留原次数');
  this.batch.store.claim(q.id,{roundId:id});this.batch.store.setBatch(q.batch,'RUNNING','本轮唯一发布执行器');
  x=this.item(id,x.key);run=x.run_id?this.source.store.run(x.run_id):null;
  if(!run){const old=this.db.prepare('SELECT id FROM runs WHERE key=?').get(x.key);if(old){run=this.source.store.run(old.id);if(digest(run.task)!==x.task_hash)fail('旧执行快照与轮次不符');}else run=this.source.store.create(this.round(id).import_id,x.task,'LIVE','SOURCE',{reviewed:true,taskHash:x.task_hash,roundId:id,authorizationHash:this.round(id).authorization_hash});this.batch.store.attach(q.id,run.id);this.update(id,x.key,{run_id:run.id});}
  else this.batch.store.attach(q.id,run.id);
  this.update(id,x.key,{entered_publish:1,started:x.started||now(),reason:'',state:'PENDING'});
  this.windows.bindExecution(id,x.key,run.id);
  try{this.executionAttempts.bind(id,x.key,run.id);}catch(error){
   this.syncQueue(x,'WAITING_HUMAN',null,'处理记录尚未绑定，未启动发布；保留原任务');throw error;
  }
  this.displayPhase(id,x.key,'source-execution');
  if(run.state==='QUEUED')this.source.launch(run.id,this.shop);
  else if(['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(run.state))await this.source.resume({id:run.id},this.shop);
  else fail('原执行任务状态不支持发布恢复：'+run.state);
  await this.source.pending;run=this.source.store.run(run.id);x=this.item(id,x.key);
  this.update(id,x.key,{...this.submissionFlags(run,id),failure_stage:run.checkpoint?.step||''});
  if(run.state==='VERIFIED'){
   if(!isEvidence(run.result))fail('发布引擎核验结果证据不完整');this.assertResultIdentity(id,x.key,run.result);
   this.syncQueue(x,'SUCCEEDED',run.result);this.update(id,x.key,{state:'NEW_SUCCESS',result:run.result,reason:'发布并在目标店铺后台核验',finished:now()});return;
  }
  throw Object.assign(Error(run.reason||'执行未完成'),{run,code:run.checkpoint?.errorCode});
 }
 canIsolateFailure(x,run,error,events){
  // Do not reinterpret infrastructure, identity or preserved-page faults as
  // product failures, even when they surface through an item callback.
  if(!x.entered_publish||run?.state!=='PAUSED'||run.mode!=='LIVE'||!run.checkpoint?.step||/^(?:submit|verify-platform)/.test(run.checkpoint.step))return false;
  if(this.failureStage(x.round_id,x,run)!==run.checkpoint.step)return false;
  if(x.submitted||x.submission_uncertain||x.result||submissionInRun(run)||events.some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED','PAGE_LEDGER_PERSISTENCE_FAILED'].includes(e.kind)))return false;
  if(run.key!==x.key||digest(run.task)!==x.task_hash)return false;
  const code=String(error.code||''),reason=reasonOf(error);
  const fault=code+' '+reason;
  if(/\b(?:SQLITE|ERR_SQLITE|ITEM_RETRY_|SELECTION_|ROUND_|QUEUE_|EXECUTION_|ATTEMPT_|CONTENT_|SOURCE_|KERNEL_|IDENTITY_|SHARED_)/i.test(fault))return false;
  if(protectedPageReason(fault)||/(?:FRAME_(?:ORIGIN|CHANGED|AMBIGUOUS)|MAIN_IMAGE_(?:FORM_CHANGED|ORIGIN_CHANGED)|FORM_.*(?:IDENTITY|ORIGIN|PAGE_CHANGED)|ANOTHER_TASK_FORM|NEW_ITEMS_ONLY|原任务|快照|清单|归属|身份|额度|哈希|数据库|授权|冻结|事务|台账|记录.*(?:丢失|缺失|冲突))/i.test(fault))return false;
  if(/(?:UserArea_shopName__|只允许新增商品页|禁止编辑旧链接|辅助页面已关闭或地址改变|执行浏览器没有可用页面|后台页面创建失败)/i.test(fault))return false;
  if(/(?:Target (?:page|context|browser).*closed|browser.*(?:closed|disconnected)|connectOverCDP|WebSocket|socket hang up|ECONN(?:RESET|REFUSED)|EPIPE|浏览器.*(?:关闭|断开|断连)|连接.*(?:断开|中断))/i.test(fault))return false;
  return true;
 }
 finalizeFailedItem(id,x,patch,{fingerprint,cause='UNCLASSIFIED',code=null}={}){
  // FAILED and its audit outcome commit together before pump can select again.
  // Attempts, limits and recovery credits are deliberately not written here.
  return this.source.store.transaction(()=>{
   this.syncQueue(x,'FAILED',null,patch.reason);this.update(id,x.key,{...patch,state:'FAILED',finished:now()});this.finishInternal(x.batch_id);
   const seen=new Set([x.key]);let consecutiveFailures=1,sameFingerprint=1,same=true;
   const rows=this.db.prepare("SELECT key,kind,payload FROM round_events WHERE round_id=? AND kind IN ('ITEM_FAILURE_FINALIZED','NEW_SUCCESS','EXISTING_VERIFIED','MANUAL_SKIPPED','PREFLIGHT_SKIPPED') ORDER BY seq DESC").iterate(id);
   for(const e of rows){
    if(e.kind!=='ITEM_FAILURE_FINALIZED')break;
    if(seen.has(e.key))continue;seen.add(e.key);consecutiveFailures++;
    if(same&&parse(e.payload).fingerprint===fingerprint)sameFingerprint++;else same=false;
    if(consecutiveFailures>=5)break;
   }
   this.db.prepare('UPDATE rounds SET system_fingerprint=?,system_count=? WHERE id=?').run(fingerprint||'',sameFingerprint,id);
   const tripped=sameFingerprint>=3||consecutiveFailures>=5;
   this.event(id,x.key,'ITEM_FAILURE_FINALIZED',{policy:'distinct-item-circuit-v1',cause,code,fingerprint,sameFingerprint,consecutiveFailures,continued:!tripped,preSubmitConfirmed:true});
   if(tripped){
    this.event(id,x.key,'FAILURE_CIRCUIT_OPENED',{sameFingerprint,consecutiveFailures,fingerprint,limits:{sameFingerprint:3,consecutiveFailures:5}});
    this.state(id,'SYSTEM_BLOCKED',`连续失败已暂停：同类错误 ${sameFingerprint} 条，连续失败 ${consecutiveFailures} 条；已失败商品不自动重投`);
   }
   return !tripped;
  });
 }
 async failure(id,x,error,{allowRecovery=true}={}){
  x=this.item(id,x.key);const run=x.run_id?this.source.store.run(x.run_id):null;
  if(this.pauseRequested||error.code==='ROUND_PAUSE'){
   this.syncQueue(x,'WAITING_HUMAN',null,'操作者暂停；保留原任务断点');this.update(id,x.key,{state:run&&['SUBMITTING','RESULT_UNKNOWN'].includes(run.state)?'RESULT_UNKNOWN':'PENDING',...this.submissionFlags(run,id),reason:'操作者暂停',failure_stage:run?.checkpoint?.step||''});return false;
  }
  let c=/^(RESULT_UNKNOWN|DUPLICATE_AMBIGUOUS)$/.test(error.code||'')?{kind:'UNKNOWN',reason:reasonOf(error)}:error.code==='HUMAN_MODE'?{kind:'HUMAN',reason:reasonOf(error)}:this.classifyFailure(error,{run});
  const detailCode=readinessRetryCode(error.code),events=run?this.source.store.events(run.id):[];
  if(detailCode&&c.kind==='TRANSIENT'){
   const protectedEvidence=x.submitted||x.submission_uncertain||x.result||submissionInRun(run)||events.some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind)||e.kind==='PAGE_LEDGER_PERSISTENCE_FAILED');
   if(protectedEvidence||!x.entered_publish||this.failureStage(id,x,run)!==run?.checkpoint?.step)c={kind:'SYSTEM',reason:reasonOf(error),fingerprint:error.code};
  }
  const patch={reason:c.reason||reasonOf(error),failure_stage:this.failureStage(id,x,run),...this.submissionFlags(run,id)};
  if(detailCode){patch.submitted=x.submitted||patch.submitted;patch.submission_uncertain=x.submission_uncertain||patch.submission_uncertain;}
  if(error.code==='EXISTENCE_AMBIGUOUS'&&error.isolated===true&&!x.entered_publish&&!this.wasSubmitted(run)){
   this.update(id,x.key,{...patch,state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check'});this.event(id,x.key,'EXISTENCE_CHECK_ISOLATED',{reason:patch.reason,candidateIds:error.candidateIds||[],notSubmitted:true});return true;
  }
  if(c.kind==='PRODUCT'&&(x.submitted||x.submission_uncertain||this.wasSubmitted(run)||run?.result||run?.checkpoint?.itemId||x.result)){
   this.syncQueue(x,'WAITING_HUMAN',null,patch.reason);this.update(id,x.key,{...patch,submitted:x.submitted||patch.submitted,submission_uncertain:x.submission_uncertain||patch.submission_uncertain,state:'RESULT_UNKNOWN'});this.state(id,'RESULT_UNKNOWN','资料错误伴有原提交证据，须先核验原商品');return false;
  }
  if(c.kind==='PRODUCT'){
   if(x.entered_publish&&this.canIsolateFailure(x,run,{message:patch.reason},events))return this.finalizeFailedItem(id,x,patch,{fingerprint:error.code||c.fingerprint||patch.reason,cause:'PRODUCT',code:error.code});
   this.syncQueue(x,'FAILED',null,patch.reason);this.update(id,x.key,{...patch,state:x.entered_publish?'FAILED':'PREFLIGHT_SKIPPED',finished:now()});return true;
  }
  if(c.kind==='UNKNOWN'||c.kind==='HUMAN'){
   this.syncQueue(x,'WAITING_HUMAN',null,patch.reason);this.update(id,x.key,{...patch,state:c.kind==='UNKNOWN'?'RESULT_UNKNOWN':'WAITING_HUMAN'});this.state(id,c.kind==='UNKNOWN'?'RESULT_UNKNOWN':'WAITING_HUMAN',patch.reason);return false;
  }
  // Explicit detail/main readiness failures keep their two original bounded
  // recoveries; only their final outcome contributes one item to the circuit.
  if(allowRecovery&&detailCode&&c.kind==='TRANSIENT'&&c.safe===true){
   const stage=run.checkpoint.step,tries=x.retry_counts[stage]||0;
   this.syncQueue(x,'FAILED',null,patch.reason);
   this.event(id,x.key,'TRANSIENT_FAILURE',{code:error.code,step:stage,retry:tries,reason:patch.reason});
   let budgetDenied=null;
   if(tries<2){
    // Read the existing claim rule; do not grant, reset or reinterpret credit.
    try{
     if(x.queue_id)this.batch.store.assertClaimBudget(this.batch.store.item(x.queue_id),{round:this.round(id),entry:x});
    }catch(error){
     // Historical claim usage can exceed safe-step retries. End only this
     // pre-submit detail failure; unknown/store faults still block the round.
     if(!['ITEM_RETRY_BUDGET_EXHAUSTED','ITEM_RETRY_BUDGET_EXTRA_UNSAFE','ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED'].includes(error.code))throw error;
     budgetDenied={budgetCode:error.code,budgetReason:reasonOf(error)};
    }
    if(!budgetDenied){
     this.update(id,x.key,{...patch,state:'PENDING',retry_counts:{...x.retry_counts,[stage]:tries+1}});
     this.event(id,x.key,'SAFE_STEP_RECOVERY',{step:stage,retry:tries+1,max:2,repairVersion:this.round(id).repair_version});return true;
    }
   }
   const continued=this.finalizeFailedItem(id,x,patch,{fingerprint:error.code,cause:'SAFE_RECOVERY_EXHAUSTED',code:error.code});
   this.event(id,x.key,'SAFE_STEP_RECOVERY_EXHAUSTED',{code:error.code,step:stage,retries:tries,max:2,cause:budgetDenied?'CLAIM_BUDGET':'STEP_RECOVERIES',...budgetDenied,continued});return continued;
  }
  if(c.kind==='SYSTEM'&&!detailCode&&!/^SAFE_RETRY_/.test(error.code||'')&&this.canIsolateFailure(x,run,error,events))return this.finalizeFailedItem(id,x,patch,{fingerprint:c.fingerprint||patch.reason,code:error.code});
  this.syncQueue(x,'FAILED',null,patch.reason);this.update(id,x.key,{...patch,state:'PENDING'});
  const r=this.round(id),fingerprint=c.fingerprint||patch.reason,count=r.system_fingerprint===fingerprint?r.system_count+1:1;
  this.db.prepare('UPDATE rounds SET system_fingerprint=?,system_count=? WHERE id=?').run(fingerprint,count,id);
  this.event(id,x.key,'SYSTEM_FAILURE',{fingerprint,count,reason:patch.reason});
  if(allowRecovery&&c.kind==='TRANSIENT'&&c.safe===true&&!this.wasSubmitted(run)&&run?.state!=='PAUSED_CAPTCHA'){
   const stage=run?.checkpoint?.step||'preflight',tries=x.retry_counts[stage]||0;
   if(tries<2&&count<3){this.update(id,x.key,{retry_counts:{...x.retry_counts,[stage]:tries+1}});this.event(id,x.key,'SAFE_STEP_RECOVERY',{step:stage,retry:tries+1,max:2,repairVersion:r.repair_version});return true;}
  }
  this.state(id,'SYSTEM_BLOCKED','系统问题已暂停；其余商品仍待处理：'+patch.reason);return false;
 }
 async gate(id){
  const count=this.db.prepare("SELECT COUNT(*) n FROM round_items WHERE round_id=? AND state='NEW_SUCCESS'").get(id).n,r=this.round(id);
  if(count>=1&&r.gate===0){
   this.db.prepare('UPDATE rounds SET gate=1 WHERE id=?').run(id);this.state(id,'PAUSED','首条真实发布核验通过；持久暂停后检查恢复');this.event(id,null,'GATE_ONE_VERIFIED',{count});
   if(this.onGate){await this.onGate({roundId:id,gate:1,view:this.view(id)});}return false;
  }
  if(count>=5&&r.gate<5){this.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(id);this.event(id,null,'GATE_FIVE_VERIFIED',{count,phase:'BATCH'});if(this.onGate)await this.onGate({roundId:id,gate:5,view:this.view(id)});}
  return true;
 }
 async pump(id,options){
  await this.assertExecution({round:this.round(id),shop:this.shop,options});this.assertLease(id);this.assertManifest(id);
  this.executionAttempts.reconcile(id);
  if(options.finalizeStopOnly){this.state(id,'STOPPED','恢复原停止请求；保留全部未执行任务');return;}
  if(options.handoffWindow){
   const previous=this.windows.assert(options.handoffWindow,id),next=await this.nextWindow(previous);
   if(!next){this.windows.finishContinuation(previous.id,'已选范围没有可执行项');this.state(id,'PAUSED','已选范围没有可执行项；未扩大范围');return;}
   this.windows.state(next.id,'RUNNING','恢复原已授权范围的下一轮');
  }
  const initial=this.round(id);if(initial.gate===1&&this.events(id).some(e=>e.kind==='GATE_ONE_VERIFIED')&&!this.events(id).some(e=>e.kind==='GATE_ONE_RESUMED'))this.event(id,null,'GATE_ONE_RESUMED',{manifestHash:initial.manifest_hash,source:'explicit-resume-after-persisted-pause'});
  if(!await this.gate(id))return;
  while(!this.pauseRequested){
   if(this.successGoals.boundary(id))break;
   const all=this.items(id),window=this.windows.open(id);
   const allowed=window?new Set(this.windows.entries(this.windows.assert(window.id,id).id).map(e=>e.key)):null;
   let x=all.find(v=>(!allowed||allowed.has(v.key))&&!done.has(v.state)&&!isolated(v)&&!this.parking.has(id,v));
   if(!x){
    if(window){
     this.windows.close(window.id,'COMPLETED','本轮分配范围已处理；成功、跳过与待核验分别记录');
     if(this.successGoals.forWindow(window.id)){
      const next=await this.nextWindow(window);
      if(next){this.windows.state(next.id,'RUNNING','按持续成功目标自动衔接');continue;}
      break;
     }
     if(all.some(v=>!done.has(v.state)&&!isolated(v)&&!this.parking.has(id,v))){
      if(window.auto_continue){
       const next=await this.nextWindow(window);
       if(next){this.windows.state(next.id,'RUNNING','按已选范围自动衔接');continue;}
       this.windows.finishContinuation(window.id,'已选范围没有可执行项');
      }
      this.state(id,'PAUSED',window.auto_continue?'已选范围内没有可执行项；其他未执行任务保留':'本轮已结束；自动衔接未开启，其他任务仍待处理');break;
     }
    }
    if(window)this.windows.finishContinuation(window.id,'总清单无剩余可执行项');
    if(this.parking.list(id).length)this.state(id,'NEEDS_REVIEW','可执行商品已处理；挂起商品提交结果未定，需人工后台确认');else if(all.some(isolated))this.state(id,'NEEDS_REVIEW','可安全执行项已处理；商品候选或内容问题保持隔离，需核验，不能称为全部完成');else this.state(id,'COMPLETED','固定清单已完成一轮处理；失败项不会重新投递');break;
   }
   this.settleInternalBatches(id,{keepBatchId:x.batch_id,phase:'handoff'});
   this.db.prepare('UPDATE rounds SET current_item=?,updated=? WHERE id=?').run(x.key,now(),id);
   x=await this.resumeUnstartedHumanItem(id,x,options);
   const attempt=this.executionAttempts.begin(id,x.key);let continueLoop=false,disposition='FINISHED';
   try{
    try{await this.executeItem(id,x);continueLoop=true;}catch(error){
     if(/^(?:EXECUTION_ATTEMPT_|ATTEMPT_)/.test(error.code||error.message||'')){disposition='JOURNAL_BLOCKED';throw error;}
     continueLoop=await this.failure(id,x,error);
    }
   }finally{this.executionAttempts.finish(attempt,{continueLoop,disposition});this.currentOperation=null;}
   if(!continueLoop)break;
   if(options.finishCurrentOnly){this.state(id,'STOPPED','原商品核验或人工处理已结束；保留其他未执行任务');break;}
   if(!await this.gate(id))break;
   this.assertLease(id);
   // Every transition is already synchronous FULL SQLite. Large export files
   // are checkpoints, not the queue authority, and are refreshed on demand.
   const processed=this.db.prepare("SELECT COUNT(*) n FROM round_items WHERE round_id=? AND state IN ('EXISTING_VERIFIED','NEW_SUCCESS','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED')").get(id).n;
   if(processed&&processed%50===0)await this.report(id);
  }
  if(this.pauseRequested)this.state(id,this.stopRequested?'STOPPED':'PAUSED',this.stopRequested?'本轮已停止；剩余商品仍未处理':'已安全暂停，恢复将沿用原任务和记录');
 }
 async nextWindow(previous){
  const goalNext=this.successGoals.next(previous);if(goalNext!==undefined)return goalNext;
  const selected=await this.selections.continueWindow(previous);if(selected!==undefined)return selected;
  const preview=await this.windows.preview(previous.round_id,{startPosition:previous.scope_start,endPosition:previous.scope_end,limit:previous.limit_count,autoContinue:true},{internal:true});
  return preview.count?this.windows.create(preview):null;
 }
 summary(id){
  const r=this.round(id);if(!r)return null;
  const counts=Object.fromEntries(ROUND_ITEM_STATES.map(s=>[s,0]));let total=0,processed=0;
  for(const row of this.db.prepare('SELECT state,COUNT(*) n FROM round_items WHERE round_id=? GROUP BY state').all(r.id)){counts[row.state]=row.n;total+=row.n;if(done.has(row.state))processed+=row.n;}
  const row=r.current_item?this.db.prepare(`SELECT i.key,i.run_id,i.reason,i.state,i.submitted,i.submission_uncertain,i.extra_attempts,i.entered_publish,i.failure_stage,
   COALESCE(NULLIF(json_extract(i.task,'$.listing.city'),''),json_extract(i.task,'$.listing.country')) destination,
   json_extract(i.task,'$.listing.title') title,s.state run_state,s.checkpoint run_checkpoint,s.result run_result,
   COALESCE(q.attempts,0) attempts FROM round_items i LEFT JOIN runs s ON s.id=i.run_id LEFT JOIN batch_items q ON q.id=i.queue_id WHERE i.round_id=? AND i.key=?`).get(r.id,r.current_item):null;
  const run=row?.run_id?{id:row.run_id,state:row.run_state,checkpoint:parse(row.run_checkpoint),result:parse(row.run_result)}:null;
  const current=row?{key:row.key,destination:row.destination,title:row.title,state:row.state,stage:this.currentStage(r,row,run),runId:row.run_id,reason:row.reason,submitted:!!row.submitted,submissionUncertain:!!row.submission_uncertain,enteredPublish:!!row.entered_publish,attempts:row.attempts,extraAttempts:row.extra_attempts}:null;
  return {id:r.id,shop:r.shop,importId:r.import_id,manifestHash:r.manifest_hash,authorizationHash:r.authorization_hash,repairVersion:r.repair_version,state:r.state,gate:r.gate,currentItem:r.current_item,reason:r.reason,at:r.at,updated:r.updated,total,counts,processed,active:this.active===r.id,successGoal:this.successGoals.summary(r.id),verificationControl:this.verificationControl?.(r.id)||null,executionRecovery:this.executionAttempts.recoveryView(r.id),captchaRecheck:(({eligible,count})=>({eligible,count}))(this.captchaRecheck(r.id)),current,parkedCount:this.parking.list(r.id).length,parkedItems:this.parking.list(r.id),window:this.windows.view(this.windows.latest(r.id)?.id),windowHistory:this.windows.history(r.id)};
 }
 view(id){const r=this.round(id);if(!r)return null;const rows=this.items(r.id),counts=Object.fromEntries(ROUND_ITEM_STATES.map(s=>[s,rows.filter(x=>x.state===s).length]));return {id:r.id,shop:r.shop,importId:r.import_id,manifestHash:r.manifest_hash,authorizationHash:r.authorization_hash,repairVersion:r.repair_version,state:r.state,gate:r.gate,currentItem:r.current_item,reason:r.reason,at:r.at,updated:r.updated,total:rows.length,counts,processed:rows.filter(x=>done.has(x.state)).length,active:this.active===r.id,successGoal:this.successGoals.summary(r.id),verificationControl:this.verificationControl?.(r.id)||null,executionRecovery:this.executionAttempts.recoveryView(r.id),window:this.windows.view(this.windows.latest(r.id)?.id),windowHistory:this.windows.history(r.id),parkedCount:this.parking.list(r.id).length,parkedItems:this.parking.list(r.id),items:rows.map(x=>({parking:this.parking.record(r.id,x),key:x.key,id:x.queue_id||x.key,queueId:x.queue_id,runId:x.run_id,batchId:x.batch_id,position:x.position,taskHash:x.task_hash,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,state:x.state,attempts:x.queue_id?this.batch.store.item(x.queue_id).attempts:0,extraAttempts:x.extra_attempts,enteredPublish:!!x.entered_publish,submitted:!!x.submitted,submissionUncertain:!!x.submission_uncertain,reason:x.reason,stage:this.currentStage(r,x,r.current_item===x.key&&x.run_id?this.source.store.run(x.run_id):null),started:x.started,finished:x.finished,result:x.result?{itemId:x.result.itemId,url:x.result.url,status:x.result.status,verifiedAt:x.result.verifiedAt,screenshot:x.result.screenshot}:null}))};}
 csv(id){const r=this.round(id);if(!r)fail('轮次不存在');const rows=[['轮次ID','批次ID','任务ID','商品唯一键','店铺','目的地','状态','本轮进入发布','本轮点击提交','失败阶段','原因','开始时间','结束时间','商品ID','链接','平台状态','截图','日志']];for(const x of this.items(id))rows.push([id,x.batch_id,x.run_id||x.queue_id,x.key,r.shop,x.task.listing.city||x.task.listing.country,x.state,x.entered_publish?'是':'否',x.submitted?'是':x.submission_uncertain?'可能已提交（仅有本轮提交意图记录）':'否',x.failure_stage,x.reason,x.started,x.finished,x.result?.itemId,x.result?.url,x.result?.status,x.result?.screenshot,x.run_id?join(this.source.artifacts,x.run_id):'']);return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
 parkedCsv(id){const rows=[['轮次ID','窗口ID','序号','商品唯一键','目的地','原状态','提示','确认人','挂起时间','挂起原因','核验记录','核验证据','审计事件']];for(const x of this.parking.list(id))rows.push([id,x.windowId,x.position,x.key,x.destination,x.state,x.notice,x.actor.name,x.at,x.reason,x.evidence.attemptId,x.evidence.reason,x.eventSeq]);return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
 async report(id){
  const previous=this.reporting.get(id)||Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{const dir=join(this.artifacts,id);await mkdir(dir,{recursive:true});const view=this.view(id),files={'report.json':JSON.stringify({generatedAt:now(),...view,events:this.events(id)},null,2),'results.csv':this.csv(id),'parked-items.csv':this.parkedCsv(id)};for(const [name,bytes] of Object.entries(files)){const file=join(dir,name);await writeFile(file+'.tmp',bytes);await rename(file+'.tmp',file);}return {directory:dir,...view};});
  this.reporting.set(id,operation);try{return await operation;}finally{if(this.reporting.get(id)===operation)this.reporting.delete(id);}
 }
}

