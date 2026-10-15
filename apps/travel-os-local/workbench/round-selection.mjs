import {randomUUID} from 'node:crypto';
import {digest} from './source-store.mjs';

const fail=(code,message=code)=>{throw Object.assign(Error(message),{code});};
const text=x=>typeof x==='string'&&x.length>0&&x.length<=200;
const terminal=new Set(['NEW_SUCCESS','EXISTING_VERIFIED','MANUAL_SKIPPED','PREFLIGHT_SKIPPED']);
const isolated=x=>['existing-listing-check','content-review','content-preflight'].includes(x.failure_stage);
const human=/CAPTCHA|验证码|滑块|风险验证|请人工登录|登录失效|店铺身份/;
const evidence=value=>{
 const pending=[value];
 while(pending.length){const v=pending.pop();if(!v||typeof v!=='object')continue;
  if(['SUBMITTING','RESULT_UNKNOWN','VERIFIED','NEW_SUCCESS','EXISTING_VERIFIED'].includes(v.state)||v.submitted||v.submissionUncertain||v.submission_uncertain||v.itemId||v.successUrl||v.result||v.history||[v.step,v.name].some(x=>['submit-once','verify-platform-result'].includes(x)))return true;
  for(const key of ['item','run','queue','snapshot','checkpoint','reconciliation'])if(v[key])pending.push(v[key]);
 }return false;
};
const detail=(x,q=null)=>({key:x.key,position:x.position,taskHash:x.task_hash,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,state:x.state,resuming:!!x.run_id,...(q?{attempts:q.attempts,maxAttempts:q.max_attempts}: {})});

// An immutable selection attached to existing windows. This is neither a second
// executor nor an authorization grant. Creation never starts the coordinator.
export class RoundSelection {
 constructor(owner){
  this.owner=owner;this.db=owner.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS round_selections (
   id TEXT PRIMARY KEY,round_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,intent_hash TEXT NOT NULL,
   selection_hash TEXT NOT NULL,revision TEXT NOT NULL,manifest_hash TEXT NOT NULL,authorization_hash TEXT NOT NULL,
   keys_json TEXT NOT NULL,excluded_json TEXT NOT NULL,mode TEXT NOT NULL,limit_count INTEGER NOT NULL,auto_continue INTEGER NOT NULL,at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS round_selection_items (
   selection_id TEXT NOT NULL,key TEXT NOT NULL,ordinal INTEGER NOT NULL,task_hash TEXT NOT NULL,revision TEXT NOT NULL,baseline TEXT NOT NULL,
   window_id TEXT,PRIMARY KEY(selection_id,key),UNIQUE(selection_id,ordinal));
   CREATE TABLE IF NOT EXISTS round_window_selections(window_id TEXT PRIMARY KEY,selection_id TEXT NOT NULL);`);
  if(!this.db.prepare('PRAGMA table_info(round_selections)').all().some(c=>c.name==='origin_window_id'))this.db.exec('ALTER TABLE round_selections ADD COLUMN origin_window_id TEXT');
 }
 config(input={}){
  const {keys,mode='start',limit=100,autoContinue=false}=input;
  if(!Array.isArray(keys)||!keys.length||keys.length>10000||!keys.every(text)||new Set(keys).size!==keys.length)fail('SELECTION_KEYS_INVALID','请选择固定清单内互不重复的商品');
  if(!['start','retry','recheck'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>100||typeof autoContinue!=='boolean')fail('SELECTION_CONFIG_INVALID','模式或数量不正确，每轮数量须为 1—100');
  if(mode==='recheck'&&(!text(input.windowId)||keys.length>100||limit<keys.length||autoContinue))fail('SELECTION_RECHECK_SCOPE','重新检索须指定原批次，最多100条，不自动扩展范围');
  return {keys:[...keys].sort(),mode,limit,autoContinue,...(mode==='recheck'?{windowId:input.windowId}:{})};
 }
 recheckScope(roundId,config){
  if(config.mode!=='recheck')return;
  const o=this.owner,w=o.windows.assert(config.windowId,roundId),view=o.windows.view(w.id,{items:true});
  const candidates=new Set(view.items.filter(x=>['FAILED','MANUAL_SKIPPED','PREFLIGHT_SKIPPED','WAITING_HUMAN','RESULT_UNKNOWN','PAUSED'].includes(x.state)||x.state==='PENDING'&&x.reason&&(x.runId||x.stage)).map(x=>x.key));
  if(config.keys.some(key=>!candidates.has(key)))fail('SELECTION_RECHECK_SCOPE','仅可重新检索所选原批次的异常或跳过商品；范围已变化请刷新');
 }
 // A fresh, synchronous read pass only. Never retained on the owner or across
 // an await: each preflight revision and final transaction rereads the DB.
 readPass(roundId){
  const events=new Map();
  for(const row of this.db.prepare('SELECT * FROM events WHERE run IN (SELECT run_id FROM round_items WHERE round_id=? AND run_id IS NOT NULL) ORDER BY seq').all(roundId)){
   if(!events.has(row.run))events.set(row.run,[]);
   events.get(row.run).push({...row,payload:JSON.parse(row.payload)});
  }
  return {roundId,round:this.owner.round(roundId),events,batchShops:new Map(this.db.prepare('SELECT id,shop FROM batches').all().map(row=>[row.id,row.shop]))};
 }
 snapshot(roundId,x,pass=null){
  if(pass&&pass.roundId!==roundId)fail('SELECTION_MAPPING_CHANGED','原读取范围不一致');
  const o=this.owner,r=pass?pass.round:o.round(roundId),q=x.queue_id?o.batch.store.item(x.queue_id):null,run=x.run_id?o.source.store.run(x.run_id):null;
  const foundRun=this.db.prepare('SELECT id FROM runs WHERE key=?').get(x.key),foundQueue=this.db.prepare('SELECT id FROM batch_items WHERE key=?').get(x.key);
  if((foundRun?.id||null)!==(x.run_id||null)||(foundQueue?.id||null)!==(x.queue_id||null))fail('SELECTION_MAPPING_CHANGED','原任务关联待核对');
  const queueMismatch=q&&(q.key!==x.key||digest(q.task)!==x.task_hash||q.task.shopId!==r.shop||q.batch!==x.batch_id||(q.run_id||null)!==(x.run_id||null)||(pass?pass.batchShops.get(q.batch):o.batch.store.batch(q.batch)?.shop)!==r.shop);
  const runMismatch=run&&(run.key!==x.key||digest(run.task)!==x.task_hash||run.task.shopId!==r.shop);
  if(queueMismatch||runMismatch)fail('SELECTION_MAPPING_CHANGED','原任务、队列或资料版本不一致');
  const events=run?(pass?pass.events.get(run.id)||[]:o.source.store.events(run.id)):[],history=o.source.store.completed(x.task)||null;
  const attempts=this.db.prepare('SELECT id,intent_hash,finished_at,before_snapshot,outcome_snapshot FROM round_item_attempts WHERE key=? ORDER BY rowid').all(x.key);
  const hasSubmit=!!x.submitted||!!x.submission_uncertain||!!x.result||!!q?.result||!!history||['submit-once','verify-platform-result'].includes(x.failure_stage)||evidence(run)||events.some(e=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(e.kind))||attempts.some(a=>evidence(JSON.parse(a.before_snapshot)?.snapshot)||evidence(a.outcome_snapshot?JSON.parse(a.outcome_snapshot):null));
  return {x,q,run,hasSubmit,revision:digest({x,q,run,events,history,attempts})};
 }
 allowed(s,roundId,mode,{allowBudgetGrant=false}={}){
  const {x,q,run}=s,o=this.owner;
  if(s.hasSubmit)fail('SELECTION_SUBMISSION_PROTECTED','已有成功、提交或返回证据；须核验原商品，不能重发');
  const reopening=mode==='recheck'&&['MANUAL_SKIPPED','PREFLIGHT_SKIPPED'].includes(x.state);
  if((!reopening&&(terminal.has(x.state)||!['PENDING','FAILED'].includes(x.state)))||(isolated(x)&&!(reopening&&x.failure_stage==='content-preflight')))fail('SELECTION_STATE_PROTECTED','原状态受保护：'+x.state+'；请先处理原资料或核验记录');
  const attempted=!!(run||q?.attempts||x.reason||x.started||x.entered_publish||x.state==='FAILED');
  if(mode==='start'&&attempted)fail('SELECTION_RETRY_REQUIRED','已有原任务或异常，请使用重试所选异常');
  if(mode==='retry'&&!attempted)fail('SELECTION_NOT_ATTEMPTED','商品尚未执行，请使用开始所选商品');
  if(run&&(!['QUEUED','PAUSED'].includes(run.state)||run.mode!=='LIVE'||human.test(run.reason||'')))fail('SELECTION_RUN_PROTECTED','原任务需人工处理或不支持恢复');
  if(q&&!['PENDING','RETRY','FAILED','WAITING_HUMAN',...(reopening?['SKIPPED']:[])].includes(q.state)||q?.state==='WAITING_HUMAN'&&run?.state!=='PAUSED')fail('SELECTION_QUEUE_PROTECTED','原队列状态不支持恢复');
  // A new selection must never opt into historical extra-repair authorization,
  // including WAITING_HUMAN's normal resume exemption at the standard limit.
  if(q&&q.attempts>=q.max_attempts&&!allowBudgetGrant)fail('SELECTION_BUDGET_EXHAUSTED','已达原恢复次数上限；本批次不会增加额度');
  o.assertContentForTask(x.task,roundId);
  if(x.task.adapterIssues?.length)fail('SELECTION_DATA_INVALID','资料缺失：'+x.task.adapterIssues.join('；'));
 }
 blockers(roundId,eligible=[],config={}){
  const o=this.owner,r=o.assertManifest(roundId),out=[];
  const add=(code,reason)=>{if(!out.some(x=>x.code===code))out.push({code,reason});};
  if(o.active||o.batch.active||o.source.active||o.source.queueLease||o.creating||o.hasUnsettledExecution())add('SELECTION_EXECUTION_BUSY','现有执行任务尚未结束');
  const open=o.windows.open(roundId);
  if(open&&!(config.mode==='recheck'&&open.id===config.windowId&&['READY','PAUSED','SYSTEM_BLOCKED'].includes(open.state)))add('SELECTION_OLD_WINDOW_OPEN','请先结束或处理原执行窗口；不能从另一批次抢占执行范围');
  if(config.mode==='recheck'&&r.gate<5)add('SELECTION_RELEASE_GATE_REQUIRED','尚未通过原1条、5条发布验收，不能批量重新执行');
  if(!['READY','PAUSED','SYSTEM_BLOCKED','STOPPED','NEEDS_REVIEW','COMPLETED'].includes(r.state))add('SELECTION_PARENT_PROTECTED','请先处理原清单状态：'+r.state);
  if(this.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL LIMIT 1').get())add('SELECTION_ATTEMPT_OPEN','原处理记录尚未封存，请先恢复保存');
  const pass=this.readPass(roundId);
  for(const x of o.items(roundId)){
   const s=this.snapshot(roundId,x,pass);
   if(['SUBMITTING','RESULT_UNKNOWN'].includes(s.run?.state)||x.submission_uncertain||x.state==='RESULT_UNKNOWN'&&!isolated(x)||s.hasSubmit&&!terminal.has(x.state)&&!isolated(x))add('SELECTION_RESULT_UNRESOLVED','原商品提交结果待核验，禁止新建执行范围');
   if(s.run?.state==='PAUSED_CAPTCHA'||human.test(s.run?.reason||'')||x.state==='WAITING_HUMAN'&&x.failure_stage!=='content-preflight')add('SELECTION_HUMAN_REQUIRED','请先处理原登录、验证码或人工验证');
   if(x.state==='PENDING'&&x.entered_publish&&!eligible.some(v=>v.key===x.key))add('SELECTION_CHECKPOINT_REQUIRED','原商品仍有未结束断点，须纳入可执行选择或先处理原任务');
   if(x.state==='NEW_SUCCESS')try{o.assertContentForTask(x.task,roundId);}catch{add('SELECTION_SUCCESS_REVIEW_REQUIRED','历史成功商品仍需完成原内容审核');}
  }
  return out;
 }
 revision(roundId){const o=this.owner,pass=this.readPass(roundId);return digest({round:pass.round,windows:o.windows.history(roundId),rows:o.items(roundId).map(x=>this.snapshot(roundId,x,pass).revision),active:[o.active,o.batch.active,o.source.active,o.source.queueLease],attempts:this.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL ORDER BY rowid').all()});}
 async preview(roundId,input={}){
  const config=this.config(input),o=this.owner;
  if(!text(roundId)||!o.round(roundId))return {roundId:roundId||null,...config,eligible:[],items:[],excluded:[],blockers:[{code:'SELECTION_ROUND_REQUIRED',reason:'资料尚未进入固定清单；请先建立并审核固定清单及授权范围'}],count:0,windowCount:0,canCreate:false,expectedRevision:null,selectionHash:null};
  this.recheckScope(roundId,config);
  const r=o.assertManifest(roundId),before=this.revision(roundId),byKey=new Map(o.items(roundId).map(x=>[x.key,x])),eligible=[],excluded=[],versions={};
  for(const key of config.keys){
   const x=byKey.get(key);if(!x){excluded.push({key,code:'SELECTION_KEY_NOT_IN_ROUND',reason:'商品不属于当前固定清单，不能混用新资料包'});continue;}
   let s=null;try{s=this.snapshot(roundId,x);this.allowed(s,roundId,config.mode);await o.checkFiles(x.task);eligible.push(detail(x,s.q));versions[key]=s.revision;}
   catch(e){const kind=o.classifyFailure(e,{preflight:true}).kind;
    if(!/^SELECTION_/.test(e.code||'')&&!['CONTENT_MISMATCH','CONTENT_REVIEW_REQUIRED','CONTENT_REVIEW_HELD'].includes(e.code)&&!['PREFLIGHT','PRODUCT'].includes(kind))throw e;
    excluded.push({...detail(x,s?.q),...(e.code==='SELECTION_BUDGET_EXHAUSTED'&&s?.q?{manualBudgetGrantAvailable:!s.hasSubmit&&s.q.state==='FAILED'&&this.manualBudgetUsed(s.q.id)<1,manualBudgetRemaining:Math.max(0,1-this.manualBudgetUsed(s.q.id))}:{}),code:e.code||'SELECTION_DATA_INVALID',reason:String(e.message).slice(0,400)});
   }
  }
  eligible.sort((a,b)=>a.position-b.position);excluded.sort((a,b)=>(a.position||Infinity)-(b.position||Infinity));
  if(this.revision(roundId)!==before)fail('SELECTION_STALE_REVISION','预检期间原状态已变化，请重新预检');
  const blockers=this.blockers(roundId,eligible,config),selectionHash=digest({roundId,manifestHash:r.manifest_hash,authorizationHash:r.authorization_hash,...config,eligible:eligible.map(x=>({key:x.key,taskHash:x.taskHash,revision:versions[x.key]})),excluded});
  return {roundId,manifestHash:r.manifest_hash,shop:r.shop,...config,eligible,items:eligible,excluded,blockers,expectedRevision:before,selectionHash,count:eligible.length,windowCount:Math.min(config.limit,eligible.length),canCreate:eligible.length>0&&!blockers.length};
 }
 manualBudgetUsed(queueId){
  return this.db.prepare("SELECT payload FROM batch_events WHERE task=? AND kind='MANUAL_RETRY_BUDGET_GRANTED' ORDER BY seq").all(queueId).reduce((n,row)=>{try{return n+Number(JSON.parse(row.payload).addAttempts||0);}catch{return n;}},0);
 }
 async grantRetryBudget(input={}){
  const {roundId,windowId,keys,addAttempts,reason,requestId,expectedRevision}=input;
  if(!text(roundId)||!text(windowId)||!Array.isArray(keys)||!keys.length||keys.length>100||!keys.every(text)||new Set(keys).size!==keys.length||addAttempts!==1||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>400||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!/^([a-f0-9]{64})$/i.test(expectedRevision||''))fail('SELECTION_BUDGET_REQUEST_INVALID','请检查商品、增加次数和操作说明');
  const sorted=[...keys].sort(),requestHash=digest({roundId,windowId,keys:sorted,addAttempts,reason:reason.trim()});
  const prior=this.db.prepare("SELECT batch,task,payload FROM batch_events WHERE kind='MANUAL_RETRY_BUDGET_GRANTED' ORDER BY seq").all().map(x=>({...x,payload:JSON.parse(x.payload)})).filter(x=>x.payload.requestId===requestId);
  if(prior.length){if(prior.some(x=>x.payload.requestHash!==requestHash))fail('SELECTION_BUDGET_REQUEST_CONFLICT','操作编号已用于不同的额度调整');return {accepted:true,replayed:true,granted:prior.map(x=>({key:x.payload.key,attempts:x.payload.attempts,maxAttempts:x.payload.newLimit,addAttempts:x.payload.addAttempts}))};}
  const config=this.config({keys:sorted,mode:'recheck',windowId,limit:100,autoContinue:false}),o=this.owner,r=o.assertManifest(roundId);
  this.recheckScope(roundId,config);o.assertIdle();if(o.hasUnsettledExecution?.()||this.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL LIMIT 1').get())fail('SELECTION_BUDGET_BUSY','现有执行或处理记录尚未结束，不能调整额度');
  if(!['READY','PAUSED','SYSTEM_BLOCKED','STOPPED','NEEDS_REVIEW'].includes(r.state))fail('SELECTION_BUDGET_ROUND_PROTECTED','固定清单状态不允许调整额度');
  const before=this.revision(roundId);if(before!==expectedRevision)fail('SELECTION_BUDGET_STALE','商品或执行记录已变化，请重新检查');
  const prepared=sorted.map(key=>{
   const x=o.item(roundId,key),s=this.snapshot(roundId,x);this.allowed(s,roundId,'recheck',{allowBudgetGrant:true});
   if(!s.q||!['FAILED','RETRY'].includes(s.q.state)||s.q.attempts<s.q.max_attempts)fail('SELECTION_BUDGET_NOT_EXHAUSTED','只能为已达次数上限的原异常商品增加额度');
   if(this.manualBudgetUsed(s.q.id)+addAttempts>1)fail('SELECTION_BUDGET_MANUAL_CAP','每个商品最多手动增加1次额度');
   return {x,q:s.q,s};
   });
   // Files may change after preview; verify the frozen task inputs again
   // before any quota or audit write. Failure leaves the batch untouched.
   for(const {x} of prepared){try{await o.checkFiles(x.task);}catch(error){fail('SELECTION_BUDGET_FILES',`额度未增加：冻结资料复核失败。${String(error?.message||error).slice(0,300)}`);}}
   if(this.revision(roundId)!==expectedRevision)fail('SELECTION_BUDGET_STALE','商品或执行记录已变化，请重新检查');
   o.windows.assert(windowId,roundId);
  return o.source.store.transaction(()=>{
   o.assertIdle();if(o.hasUnsettledExecution?.()||this.db.prepare('SELECT id FROM round_item_attempts WHERE finished_at IS NULL LIMIT 1').get())fail('SELECTION_BUDGET_BUSY','现有执行或处理记录尚未结束，不能调整额度');if(this.revision(roundId)!==expectedRevision)fail('SELECTION_BUDGET_STALE','商品或执行记录已变化，请重新检查');
   const now=new Date().toISOString(),granted=[];
   for(const {x,q} of prepared){
    const current=this.snapshot(roundId,o.item(roundId,x.key));this.allowed(current,roundId,'recheck',{allowBudgetGrant:true});
    if(current.q.id!==q.id||current.q.attempts<current.q.max_attempts||this.manualBudgetUsed(q.id)+addAttempts>1)fail('SELECTION_BUDGET_STALE','额度条件已变化，请重新检查');
    const updated=this.db.prepare('UPDATE batch_items SET max_attempts=max_attempts+? WHERE id=? AND attempts>=max_attempts AND state IN (\'FAILED\',\'RETRY\')').run(addAttempts,q.id);
    if(updated.changes!==1)fail('SELECTION_BUDGET_STALE','原队列记录已变化，请重新检查');
    const payload={requestId,requestHash,roundId,windowId,key:x.key,attempts:q.attempts,oldLimit:q.max_attempts,newLimit:q.max_attempts+addAttempts,addAttempts,reason:reason.trim(),at:now};
    o.batch.store.event(q.batch,q.id,'MANUAL_RETRY_BUDGET_GRANTED',payload);o.event(roundId,x.key,'MANUAL_RETRY_BUDGET_GRANTED',payload);
    granted.push({key:x.key,attempts:q.attempts,maxAttempts:q.max_attempts+addAttempts,addAttempts});
   }
   return {accepted:true,replayed:false,roundId,windowId,granted};
  });
 }
 request(input){const config=this.config(input);if(![input.roundId,input.expectedRevision,input.selectionHash,input.requestId].every(text)||input.requestId.length>96)fail('SELECTION_REQUEST_INVALID','缺少原预检版本或幂等请求编号');return {roundId:input.roundId,...config,expectedRevision:input.expectedRevision,selectionHash:input.selectionHash,requestId:input.requestId};}
 replay(req){const prior=this.db.prepare('SELECT * FROM round_selections WHERE request_id=?').get(req.requestId);if(!prior)return null;if(prior.intent_hash!==digest(req))fail('SELECTION_REQUEST_CONFLICT','同一请求编号不能改变选择范围');return {selection:this.byId(prior.id),window:this.owner.windows.view(this.db.prepare('SELECT window_id FROM round_selection_items WHERE selection_id=? AND window_id IS NOT NULL ORDER BY ordinal LIMIT 1').get(prior.id)?.window_id),replayed:true};}
 receipt(input){return this.replay(this.request(input));}
 async create(input){
  const req=this.request(input),prior=this.replay(req);if(prior)return prior;
  const p=await this.preview(req.roundId,req),replay=this.replay(req);if(replay)return replay;
  if(p.expectedRevision!==req.expectedRevision||p.selectionHash!==req.selectionHash)fail('SELECTION_STALE_REVISION','预检内容或原状态已变化，请重新预检');
  if(!p.canCreate)fail(p.blockers[0]?.code||'SELECTION_EMPTY',p.blockers[0]?.reason||'没有可执行商品');
  const o=this.owner;
  return o.source.store.transaction(()=>{
   o.assertIdle();if(this.revision(req.roundId)!==req.expectedRevision)fail('SELECTION_STALE_REVISION','原状态已变化');
   const r=o.assertManifest(req.roundId),id=randomUUID(),at=new Date().toISOString();
   this.recheckScope(r.id,req);
   if(req.mode==='recheck'&&o.windows.open(r.id))o.windows.close(req.windowId,'STOPPED','操作者确认重新检索本批异常与跳过项；原批次结果封存，其余未执行商品保留');
   this.db.prepare('INSERT INTO round_selections(id,round_id,request_id,intent_hash,selection_hash,revision,manifest_hash,authorization_hash,keys_json,excluded_json,mode,limit_count,auto_continue,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,r.id,req.requestId,digest(req),p.selectionHash,p.expectedRevision,r.manifest_hash,r.authorization_hash,JSON.stringify(req.keys),JSON.stringify(p.excluded),req.mode,req.limit,Number(req.autoContinue),at);
   if(req.mode==='recheck')this.db.prepare('UPDATE round_selections SET origin_window_id=? WHERE id=?').run(req.windowId,id);
   const insert=this.db.prepare('INSERT INTO round_selection_items(selection_id,key,ordinal,task_hash,revision,baseline) VALUES(?,?,?,?,?,?)');
   p.eligible.forEach((e,i)=>{const x=o.item(r.id,e.key);insert.run(id,e.key,i+1,x.task_hash,this.snapshot(r.id,x).revision,JSON.stringify(o.windows.observation(x)));});
   const window=this.createWindow(id);
   o.state(r.id,'READY','已保存选中商品批次；核对后手动开始，原失败记录及次数保留');
   o.event(r.id,null,'SELECTION_CREATED',{selectionId:id,requestId:req.requestId,keys:p.eligible.map(x=>x.key),excluded:p.excluded,selectionHash:p.selectionHash,windowId:window.id});
   return {selection:this.byId(id),window:o.windows.view(window.id),replayed:false};
  });
 }
 row(id){return this.db.prepare('SELECT * FROM round_selections WHERE id=?').get(id)||null;}
 entries(id){return this.db.prepare('SELECT * FROM round_selection_items WHERE selection_id=? ORDER BY ordinal').all(id);}
 forWindow(id){return this.db.prepare('SELECT selection_id FROM round_window_selections WHERE window_id=?').get(id)?.selection_id||null;}
 byId(id){const s=this.row(id);if(!s)return null;const entries=this.entries(id),windows=this.db.prepare('SELECT window_id FROM round_window_selections WHERE selection_id=? ORDER BY rowid').all(id);return {id:s.id,roundId:s.round_id,selectionHash:s.selection_hash,expectedRevision:s.revision,keys:entries.map(e=>e.key),requestedKeys:JSON.parse(s.keys_json),excluded:JSON.parse(s.excluded_json),mode:s.mode,limit:s.limit_count,autoContinue:!!s.auto_continue,total:entries.length,remaining:entries.filter(e=>!e.window_id).length,at:s.at,windowIds:windows.map(w=>w.window_id)};}
 view(roundId){return this.byId(this.db.prepare('SELECT id FROM round_selections WHERE round_id=? ORDER BY rowid DESC LIMIT 1').get(roundId)?.id);}
 validate(id){const s=this.row(id);if(!s)fail('SELECTION_NOT_FOUND');const r=this.owner.assertManifest(s.round_id);if(s.manifest_hash!==r.manifest_hash||s.authorization_hash!==r.authorization_hash)fail('SELECTION_MANIFEST_CHANGED','固定资料或授权版本已变化');
  const entries=this.entries(id),config=this.config({keys:JSON.parse(s.keys_json),mode:s.mode,limit:s.limit_count,autoContinue:!!s.auto_continue,windowId:s.origin_window_id});
  if(entries.some((e,i)=>e.ordinal!==i+1)||digest({roundId:s.round_id,manifestHash:r.manifest_hash,authorizationHash:r.authorization_hash,...config,eligible:entries.map(e=>({key:e.key,taskHash:e.task_hash,revision:e.revision})),excluded:JSON.parse(s.excluded_json)})!==s.selection_hash)fail('SELECTION_INTEGRITY_CHANGED','冻结选择清单已变化');return s;}
 createWindow(id){
  const s=this.validate(id),o=this.owner,rows=this.entries(id).filter(e=>!e.window_id).slice(0,s.limit_count).map(e=>{
   const x=o.item(s.round_id,e.key),snapshot=this.snapshot(s.round_id,x);if(e.task_hash!==x.task_hash||snapshot.revision!==e.revision)fail('SELECTION_STALE_REVISION','选中商品原状态已变化，请重新预检');this.allowed(snapshot,s.round_id,s.mode);return x;
  });
  if(!rows.length)return null;
  const config={startPosition:Math.min(...rows.map(x=>x.position)),endPosition:Math.max(...rows.map(x=>x.position)),limit:s.limit_count,autoContinue:!!s.auto_continue};
  const p={roundId:s.round_id,manifestHash:s.manifest_hash,...config,selectionId:id,selectionHash:o.windows.assignmentHash(o.round(s.round_id),config,rows),items:rows.map(x=>({key:x.key}))};
  return o.windows.create(p);
 }
 validateWindowPreview(p,rows){
  const s=this.validate(p.selectionId),expected=this.entries(s.id).filter(e=>!e.window_id).slice(0,s.limit_count);
  if(p.roundId!==s.round_id||p.limit!==s.limit_count||p.autoContinue!==!!s.auto_continue||digest(rows.map(x=>x.key))!==digest(expected.map(e=>e.key)))fail('SELECTION_WINDOW_SCOPE_CHANGED','执行窗口超出冻结选择');
  rows.forEach((x,i)=>{const snapshot=this.snapshot(s.round_id,x);if(snapshot.revision!==expected[i].revision||x.task_hash!==expected[i].task_hash)fail('SELECTION_STALE_REVISION');this.allowed(snapshot,s.round_id,s.mode);});
 }
 bindWindow(id,windowId,rows){
  const selection=this.validate(id);
  this.db.prepare('INSERT INTO round_window_selections(window_id,selection_id) VALUES(?,?)').run(windowId,id);
  for(const x of rows){this.db.prepare('UPDATE round_selection_items SET window_id=? WHERE selection_id=? AND key=? AND window_id IS NULL').run(windowId,id,x.key);
   if(x.state==='FAILED')this.owner.update(x.round_id,x.key,{state:'PENDING',finished:null,reason:'选中商品恢复已排队；原失败、任务和次数保留'});
   if(selection.mode==='recheck'&&['MANUAL_SKIPPED','PREFLIGHT_SKIPPED'].includes(x.state)){
    const q=x.queue_id?this.owner.batch.store.item(x.queue_id):null;
    if(q?.state==='SKIPPED'){
     this.db.prepare("UPDATE batch_items SET state='RETRY',reason=?,finished=NULL WHERE id=? AND state='SKIPPED'").run('操作者确认重新检索原跳过商品；原次数和记录保留',q.id);
     this.owner.batch.store.event(q.batch,q.id,'RECHECK_SKIPPED_REOPENED',{selectionId:id,originWindowId:selection.origin_window_id,windowId});
    }
    this.owner.update(x.round_id,x.key,{state:'PENDING',finished:null,failure_stage:'',reason:'操作者确认重新检索；原跳过记录保留在来源批次'});
    this.owner.event(x.round_id,x.key,'RECHECK_SKIPPED_REOPENED',{selectionId:id,originWindowId:selection.origin_window_id,windowId,previousState:x.state,previousReason:x.reason});
   }
  }
 }
 assertWindow(window,rows){const id=this.forWindow(window.id);if(!id)return;const s=this.validate(id),entries=this.entries(id).filter(e=>e.window_id===window.id);if(s.round_id!==window.round_id||s.limit_count!==window.limit_count||!!s.auto_continue!==!!window.auto_continue||digest(rows.map(x=>({key:x.key,hash:x.task_hash})))!==digest(entries.map(e=>({key:e.key,hash:e.task_hash}))))fail('SELECTION_WINDOW_SCOPE_CHANGED','执行窗口偏离冻结选择');}
 async continueWindow(previous){
  const id=this.forWindow(previous.id);if(!id)return undefined;
  this.owner.assertLease(previous.round_id);this.validate(id);
  const remaining=this.entries(id).filter(e=>!e.window_id).slice(0,previous.limit_count);
  // File/content checks still occur in executeItem. A known per-product error
  // is recorded there and the next chosen product proceeds; shared faults pause.
  if(!remaining.length)return null;
  return this.owner.source.store.transaction(()=>this.createWindow(id));
 }
 assertExecutionItem(roundId,x){
  const w=this.owner.windows.open(roundId);if(!w||!this.forWindow(w.id))return;
  this.owner.windows.assert(w.id,roundId);
  // executeItem may just have created the original queue for a pre-existing
  // single run, before its normal attach step. Do not demand that transitional
  // mapping here; only the unchanged claim budget is checked synchronously.
  const q=x.queue_id?this.owner.batch.store.item(x.queue_id):null;
  if(q&&q.attempts>=q.max_attempts)fail('SELECTION_BUDGET_EXHAUSTED','已达原恢复次数上限；未增加额度，保留原断点');
 }
}
