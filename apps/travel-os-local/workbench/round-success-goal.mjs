import {randomUUID} from 'node:crypto';
import {digest} from './source-store.mjs';

const terminal=new Set(['TARGET_REACHED','EXHAUSTED','STOPPED']);
const now=()=>new Date().toISOString();
const fail=(code,message)=>{throw Object.assign(Error(message||code),{code});};
const exclusion=e=>/^SELECTION_(?:STATE_PROTECTED|SUBMISSION_PROTECTED|RUN_PROTECTED|QUEUE_PROTECTED|BUDGET_EXHAUSTED|DATA_INVALID)/.test(e.code||'')||['CONTENT_MISMATCH','CONTENT_REVIEW_REQUIRED','CONTENT_REVIEW_HELD'].includes(e.code);

// A bounded policy over original round items and windows, never a new executor,
// task identity, retry grant, or replacement for the submission/human gates.
export class RoundSuccessGoal {
 constructor(owner){
  this.owner=owner;this.db=owner.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS round_success_goals (
   id TEXT PRIMARY KEY,round_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,intent_hash TEXT NOT NULL,
   manifest_hash TEXT NOT NULL,config TEXT NOT NULL,baseline TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,
   reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS round_success_goal_items (
   goal_id TEXT NOT NULL,key TEXT NOT NULL,position INTEGER NOT NULL,task_hash TEXT NOT NULL,
   baseline TEXT NOT NULL,first_window TEXT,retry_window TEXT,excluded TEXT,
   PRIMARY KEY(goal_id,key));
   CREATE TABLE IF NOT EXISTS round_success_goal_windows(window_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL);`);
 }
 row(id){const x=this.db.prepare('SELECT * FROM round_success_goals WHERE id=?').get(id);return x?{...x,config:JSON.parse(x.config),baseline:JSON.parse(x.baseline)}:null;}
 latest(roundId){return this.row(this.db.prepare('SELECT id FROM round_success_goals WHERE round_id=? ORDER BY rowid DESC LIMIT 1').get(roundId)?.id||'');}
 forWindow(windowId){return this.row(this.db.prepare('SELECT goal_id FROM round_success_goal_windows WHERE window_id=?').get(windowId||'')?.goal_id||'');}
 entries(id){return this.db.prepare('SELECT * FROM round_success_goal_items WHERE goal_id=? ORDER BY position').all(id);}
 config(roundId,input){
  const range=this.owner.windows.config(roundId,{startPosition:input.startPosition,endPosition:input.endPosition,limit:input.windowLimit??100,autoContinue:true});
  const {targetSuccess=200,retryFailedOnce=true,autoParkEligible=false,confirmedBy}=input;
  if(!Number.isInteger(targetSuccess)||targetSuccess<1||targetSuccess>10000||typeof retryFailedOnce!=='boolean')fail('SUCCESS_GOAL_CONFIG_INVALID','成功目标须为1—10000条，失败重试须明确选择');
  if(autoParkEligible!==false)fail('SUCCESS_GOAL_AUTO_PARK_UNAVAILABLE','本版本挂起须由操作者确认，不会自动处理提交结果待核验商品');
  if(typeof confirmedBy!=='string'||!confirmedBy.trim()||confirmedBy.length>80)fail('SUCCESS_GOAL_CONFIRMATION_REQUIRED','请填写本次持续执行的确认人');
  return {startPosition:range.startPosition,endPosition:range.endPosition,windowLimit:range.limit,targetSuccess,retryFailedOnce,autoParkEligible:false,confirmedBy:confirmedBy.trim()};
 }
 safe(roundId,x){
  const s=this.owner.selections.snapshot(roundId,x);
  this.owner.selections.allowed(s,roundId,s.run||s.q?.attempts||x.reason||x.started||x.entered_publish||x.state==='FAILED'?'retry':'start');
  return s;
 }
 async preview(roundId,input){
  const o=this.owner;o.assertIdle();const r=o.assertManifest(roundId),config=this.config(roundId,input),prior=this.latest(roundId);
  if(prior&&!terminal.has(prior.state))fail('SUCCESS_GOAL_ALREADY_OPEN','已有未结束的持续目标，请继续或停止原目标');
  if(o.windows.open(roundId))fail('SUCCESS_GOAL_WINDOW_OPEN','请先结束或处理原执行窗口，持续目标不会接管旧窗口');
  const before=o.selections.revision(roundId),all=o.items(roundId),scope=all.filter(x=>x.position>=config.startPosition&&x.position<=config.endPosition),items=[],excluded=[];
  for(const x of scope){
   try{this.safe(roundId,x);items.push({key:x.key,position:x.position,taskHash:x.task_hash,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title});}
   catch(e){if(!exclusion(e))throw e;excluded.push({key:x.key,position:x.position,state:x.state,code:e.code,reason:e.message});}
  }
  const blockers=o.selections.blockers(roundId,items,{mode:'retry'});
  if(o.selections.revision(roundId)!==before)fail('SUCCESS_GOAL_STALE','预览期间状态已变化，请重新检查');
  const goalHash=digest({roundId,manifestHash:r.manifest_hash,config,revision:before,items,excluded});
  return {roundId,manifestHash:r.manifest_hash,...config,goalHash,expectedRevision:before,scopeTotal:scope.length,eligibleCount:items.length,
   historyExcludedCount:scope.filter(x=>['NEW_SUCCESS','EXISTING_VERIFIED'].includes(x.state)).length,firstWindowCount:Math.min(config.windowLimit,items.length),
   remainingShortfallEstimate:Math.max(0,config.targetSuccess-items.length),items,excluded,blockers,canCreate:items.length>0&&!blockers.length};
 }
 async create(roundId,input,{commit}={}){
  const config=this.config(roundId,input),intentHash=digest({roundId,manifestHash:input.manifestHash,goalHash:input.goalHash,config});
  const prior=this.db.prepare('SELECT id,intent_hash FROM round_success_goals WHERE request_id=?').get(input.requestId);
  if(prior){if(prior.intent_hash!==intentHash)fail('SUCCESS_GOAL_REQUEST_CONFLICT','操作编号已用于其他目标');return {goal:this.view(prior.id),window:this.owner.windows.view(this.db.prepare('SELECT window_id FROM round_success_goal_windows WHERE goal_id=? ORDER BY rowid LIMIT 1').get(prior.id)?.window_id),replayed:true};}
  if(input.confirmed!==true||typeof input.requestId!=='string'||!input.requestId)fail('SUCCESS_GOAL_CONFIRMATION_REQUIRED','请确认预览范围后开始');
  const p=await this.preview(roundId,input);
  const raced=this.db.prepare('SELECT id,intent_hash FROM round_success_goals WHERE request_id=?').get(input.requestId);
  if(raced){if(raced.intent_hash!==intentHash)fail('SUCCESS_GOAL_REQUEST_CONFLICT','操作编号已用于其他目标');return {goal:this.view(raced.id),window:this.owner.windows.view(this.db.prepare('SELECT window_id FROM round_success_goal_windows WHERE goal_id=? ORDER BY rowid LIMIT 1').get(raced.id)?.window_id),replayed:true};}
  if(p.goalHash!==input.goalHash||p.manifestHash!==input.manifestHash)fail('SUCCESS_GOAL_STALE','预览范围或任务状态已变化');
  if(!p.canCreate)fail(p.blockers[0]?.code||'SUCCESS_GOAL_EMPTY',p.blockers[0]?.reason||'当前范围没有可执行商品');
  return this.owner.source.store.transaction(()=>{
   this.owner.assertIdle();if(this.owner.selections.revision(roundId)!==p.expectedRevision)fail('SUCCESS_GOAL_STALE','预览后状态发生变化');
   const id=randomUUID(),at=now();
   this.db.prepare('INSERT INTO round_success_goals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,roundId,input.requestId,intentHash,p.manifestHash,JSON.stringify(config),JSON.stringify({scopeTotal:p.scopeTotal,historyExcludedCount:p.historyExcludedCount,excluded:p.excluded,policyHash:digest({roundId,manifestHash:p.manifestHash,config,scopeTotal:p.scopeTotal,items:p.items.map(e=>({key:e.key,position:e.position,taskHash:e.taskHash}))})}),'READY','FIRST','已确认成功目标；等待原执行器检查',at,at);
   const insert=this.db.prepare('INSERT INTO round_success_goal_items(goal_id,key,position,task_hash,baseline) VALUES(?,?,?,?,?)');
   for(const e of p.items)insert.run(id,e.key,e.position,e.taskHash,JSON.stringify(this.owner.windows.observation(this.owner.item(roundId,e.key))));
   const window=this.createWindow(id);
   this.owner.state(roundId,'READY','已保存持续成功目标；沿用原任务、次数和安全闸门');
   this.owner.event(roundId,null,'SUCCESS_GOAL_CREATED',{goalId:id,requestId:input.requestId,...config,scopeTotal:p.scopeTotal,eligibleCount:p.items.length,windowId:window.id});
   const result={goal:this.view(id),window,replayed:false};commit?.(result);return result;
  });
 }
 assertPolicy(g){
  const r=this.owner.assertManifest(g.round_id);
  const actual=digest({roundId:g.round_id,manifestHash:g.manifest_hash,config:g.config,scopeTotal:g.baseline.scopeTotal,items:this.entries(g.id).map(e=>({key:e.key,position:e.position,taskHash:e.task_hash}))});
  if(r.manifest_hash!==g.manifest_hash||actual!==g.baseline.policyHash)fail('SUCCESS_GOAL_POLICY_CHANGED','持续目标或冻结范围已变化，停止执行并保留原记录');
 }
 assertWindow(w,rows){
  const g=this.forWindow(w.id);if(!g)return;this.assertPolicy(g);
  const entries=this.entries(g.id),keys=new Set(entries.filter(e=>e.first_window===w.id||e.retry_window===w.id).map(e=>e.key));
  if(g.round_id!==w.round_id||g.manifest_hash!==this.owner.assertManifest(w.round_id).manifest_hash||rows.length!==keys.size||rows.some(x=>!keys.has(x.key)||entries.find(e=>e.key===x.key)?.task_hash!==x.task_hash)||w.limit_count>100)fail('SUCCESS_GOAL_SCOPE_CHANGED','持续目标窗口范围或冻结资料已变化');
 }
 createWindow(id){
  const g=this.row(id),o=this.owner;if(!g||terminal.has(g.state))return null;this.assertPolicy(g);
  const field=g.phase==='FIRST'?'first_window':'retry_window',rows=[];
  for(const e of this.entries(id)){
   if(e[field]||e.excluded)continue;const x=o.item(g.round_id,e.key);
   if(g.phase==='RETRY'&&(!e.first_window||x.state!=='FAILED'))continue;
   try{if(x.task_hash!==e.task_hash)fail('SUCCESS_GOAL_SCOPE_CHANGED','商品资料已变化');this.safe(g.round_id,x);rows.push(x);}
   catch(error){if(!exclusion(error))throw error;this.db.prepare('UPDATE round_success_goal_items SET excluded=? WHERE goal_id=? AND key=?').run(JSON.stringify({phase:g.phase,code:error.code,reason:error.message}),id,e.key);o.event(g.round_id,e.key,'SUCCESS_GOAL_ITEM_EXCLUDED',{goalId:id,phase:g.phase,code:error.code,reason:error.message});}
   if(rows.length>=g.config.windowLimit)break;
  }
  if(!rows.length){
   if(g.phase==='FIRST'&&g.config.retryFailedOnce){this.db.prepare("UPDATE round_success_goals SET phase='RETRY',updated_at=? WHERE id=?").run(now(),id);o.event(g.round_id,null,'SUCCESS_GOAL_RETRY_PASS',{goalId:id,maxPasses:1});return this.createWindow(id);}
   return null;
  }
  const config={startPosition:g.config.startPosition,endPosition:g.config.endPosition,limit:g.config.windowLimit,autoContinue:true};
  return o.windows.create({roundId:g.round_id,manifestHash:g.manifest_hash,...config,successGoalId:id,selectionHash:o.windows.assignmentHash(o.round(g.round_id),config,rows),items:rows.map(x=>({key:x.key}))});
 }
 validatePreview(p,rows){
  const g=this.row(p.successGoalId);if(!g||terminal.has(g.state)||p.roundId!==g.round_id||p.startPosition!==g.config.startPosition||p.endPosition!==g.config.endPosition||p.limit!==g.config.windowLimit||p.autoContinue!==true)fail('SUCCESS_GOAL_SCOPE_CHANGED','持续目标窗口配置已变化');
  for(const x of rows){const e=this.entries(g.id).find(e=>e.key===x.key);if(!e||e.task_hash!==x.task_hash||e.excluded||(g.phase==='FIRST'?e.first_window:e.retry_window||!e.first_window||x.state!=='FAILED'))fail('SUCCESS_GOAL_SCOPE_CHANGED','持续目标商品不在本次可执行范围');this.safe(g.round_id,x);}
 }
 bindWindow(id,windowId,rows){
  const g=this.row(id),field=g.phase==='FIRST'?'first_window':'retry_window';
  this.db.prepare('INSERT INTO round_success_goal_windows VALUES(?,?)').run(windowId,id);
  for(const x of rows){this.db.prepare('UPDATE round_success_goal_items SET '+field+'=? WHERE goal_id=? AND key=?').run(windowId,id,x.key);if(x.state==='FAILED')this.owner.update(g.round_id,x.key,{state:'PENDING',finished:null,reason:'持续目标恢复原未提交失败项；未增加额度，原失败记录保留'});}
 }
 stopRequested(roundId){const g=this.latest(roundId);if(g&&!terminal.has(g.state)){this.db.prepare("UPDATE round_success_goals SET state='STOPPED',reason=?,updated_at=? WHERE id=?").run('操作者停止持续目标；不会自动恢复',now(),g.id);this.owner.event(roundId,null,'SUCCESS_GOAL_STOPPED',{goalId:g.id,source:'operator'});}}
 state(roundId,state,reason){
  const g=this.forWindow(this.owner.windows.latest(roundId)?.id);if(!g||terminal.has(g.state))return;
  this.db.prepare('UPDATE round_success_goals SET state=?,reason=?,updated_at=? WHERE id=?').run(state,reason,now(),g.id);
 }
 finish(g,state,reason){
  this.db.prepare('UPDATE round_success_goals SET state=?,reason=?,updated_at=? WHERE id=?').run(state,reason,now(),g.id);
  const w=this.owner.windows.open(g.round_id);if(w)this.owner.windows.close(w.id,'COMPLETED',reason);
  const latest=this.owner.windows.latest(g.round_id);if(latest)this.owner.windows.finishContinuation(latest.id,reason);
  this.owner.event(g.round_id,null,'SUCCESS_GOAL_'+state,{goalId:g.id,...this.view(g.id)});
  this.owner.state(g.round_id,'PAUSED',reason);
 }
 boundary(roundId){
  const g=this.forWindow(this.owner.windows.latest(roundId)?.id);if(!g)return false;
  if(terminal.has(g.state))return true;this.assertPolicy(g);
  const v=this.view(g.id);if(v.newSuccess>=v.targetSuccess){this.finish(g,'TARGET_REACHED','本次新增核验成功已达目标，已停止领取下一条');return true;}return false;
 }
 next(previous){
  const g=this.forWindow(previous.id);if(!g)return undefined;
  this.owner.assertLease(g.round_id);if(this.boundary(g.round_id))return null;
  const next=this.owner.source.store.transaction(()=>this.createWindow(g.id));
  if(!next)this.finish(this.row(g.id),'EXHAUSTED','所选范围可安全执行商品已用完；未达目标的缺口已保留');return next;
 }
 assertClaim(roundId,x){
  const g=this.forWindow(this.owner.windows.open(roundId)?.id);if(!g)return;this.assertPolicy(g);
  if(terminal.has(g.state)||this.view(g.id).newSuccess>=g.config.targetSuccess)fail('SUCCESS_GOAL_TARGET_REACHED','成功目标已结束，禁止继续领取商品');
  const q=x.queue_id?this.owner.batch.store.item(x.queue_id):null;
  if(q&&q.attempts>=q.max_attempts)fail('SELECTION_BUDGET_EXHAUSTED','原任务额度已耗尽，持续目标不会授予额外次数');
 }
 view(id){
  const g=this.row(id);if(!g)return null;const entries=this.entries(id),rows=entries.map(e=>({...this.owner.item(g.round_id,e.key),assigned:!!e.first_window,excluded:e.excluded}));
  const newSuccess=rows.filter(x=>x.assigned&&x.state==='NEW_SUCCESS'&&x.result?.itemId).length;
  return {id:g.id,roundId:g.round_id,state:g.state,phase:g.phase,...g.config,scopeTotal:g.baseline.scopeTotal,eligibleTotal:entries.length,historyExcludedCount:g.baseline.historyExcludedCount,
   newSuccess,remaining:Math.max(0,g.config.targetSuccess-newSuccess),failed:rows.filter(x=>x.state==='FAILED').length,parked:rows.filter(x=>this.owner.parking.has(g.round_id,x)).length,
   resultUnknown:rows.filter(x=>x.state==='RESULT_UNKNOWN').length,waitingHuman:rows.filter(x=>x.state==='WAITING_HUMAN').length,pending:rows.filter(x=>x.state==='PENDING').length,
   excluded:rows.filter(x=>x.excluded).length,reason:g.reason,createdAt:g.created_at,updatedAt:g.updated_at};
 }
 summary(roundId){return this.view(this.latest(roundId)?.id||'');}
}
