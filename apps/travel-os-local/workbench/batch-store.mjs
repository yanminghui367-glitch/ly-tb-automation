import {randomUUID} from 'node:crypto';
import {digest,destinationKey} from './source-store.mjs';
import {MAX_BATCH_SIZE} from './batch-policy.mjs';

export const TASK_STATES=['PENDING','RUNNING','WAITING_HUMAN','SUCCEEDED','FAILED','RETRY','SKIPPED'];
const terminal=new Set(['SUCCEEDED','FAILED','SKIPPED']);
const moves={PENDING:['RUNNING','SKIPPED'],RETRY:['RUNNING','SKIPPED'],RUNNING:['WAITING_HUMAN','SUCCEEDED','FAILED','SKIPPED'],WAITING_HUMAN:['RUNNING','SUCCEEDED','SKIPPED'],FAILED:['RETRY','SKIPPED'],SUCCEEDED:[],SKIPPED:[]};
const budgetFailure=(code,message)=>{throw Object.assign(Error(message),{code});};
export class BatchStore {
 constructor(source){this.source=source;this.db=source.db;this.db.exec(`
 CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, imported TEXT NOT NULL, shop TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, review TEXT NOT NULL, at TEXT NOT NULL, started TEXT, finished TEXT, elapsed_ms INTEGER NOT NULL DEFAULT 0, segment_started TEXT, reason TEXT NOT NULL DEFAULT '', consecutive INTEGER NOT NULL DEFAULT 0, max_consecutive INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS batch_items(id TEXT PRIMARY KEY, batch TEXT NOT NULL, key TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, task TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT UNIQUE, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, reason TEXT NOT NULL DEFAULT '', started TEXT, finished TEXT, result TEXT);
 CREATE TABLE IF NOT EXISTS batch_events(seq INTEGER PRIMARY KEY, batch TEXT NOT NULL, task TEXT, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);`);}
 event(batch,task,kind,payload={}){this.db.prepare('INSERT INTO batch_events(batch,task,at,kind,payload) VALUES(?,?,?,?,?)').run(batch,task,new Date().toISOString(),kind,JSON.stringify(payload));}
 events(id){return this.db.prepare('SELECT * FROM batch_events WHERE batch=? ORDER BY seq').all(id).map(r=>({...r,payload:JSON.parse(r.payload)}));}
 item(id){const r=this.db.prepare('SELECT * FROM batch_items WHERE id=?').get(id);if(!r)throw Error('队列商品不存在');return {...r,task:JSON.parse(r.task),result:r.result?JSON.parse(r.result):null};}
 items(id){return this.db.prepare('SELECT id FROM batch_items WHERE batch=? ORDER BY position').all(id).map(r=>this.item(r.id));}
 batch(id){const r=id?this.db.prepare('SELECT * FROM batches WHERE id=?').get(id):this.db.prepare('SELECT * FROM batches ORDER BY rowid DESC LIMIT 1').get();return r?{...r,review:JSON.parse(r.review)}:null;}
 reserved(task){return this.db.prepare('SELECT id,batch,state FROM batch_items WHERE key=?').get(destinationKey(task));}
 roundPermit(roundId,task,queueId=null){
  const r=this.db.prepare('SELECT * FROM rounds WHERE id=?').get(roundId);
  if(!r||r.state!=='RUNNING'||r.shop!==task.shopId)throw Error('持续轮次不在执行状态或店铺不匹配');
  const authorization=JSON.parse(r.authorization);
  if(authorization.allowLive!==true||authorization.maxSafeRecoveries!==2||!r.repair_version)throw Error('持续轮次缺少明确发布与有界恢复授权');
  const entry=this.db.prepare('SELECT * FROM round_items WHERE round_id=? AND key=?').get(roundId,destinationKey(task));
  if(!entry||entry.task_hash!==digest(task)||(queueId&&entry.queue_id!==queueId))throw Error('轮次商品快照或原任务身份不匹配');
  return {round:r,entry};
 }
 create(imported,tasks,shop,mode,review,{roundId}={}){
  if(!['LIVE','DRY_RUN'].includes(mode)||!tasks.length||tasks.length>MAX_BATCH_SIZE)throw Error(`本轮每批只允许 1—${MAX_BATCH_SIZE} 个商品`);
  if(review?.reviewed!==true||review.selectionHash!==digest(tasks)||!review.authorization)throw Error('请核对本批完整商品清单和素材');
  if(tasks.some(t=>t.shopId!==shop||t.adapterIssues.length))throw Error('批次含店铺不匹配或资料缺失商品');
  if(new Set(tasks.map(destinationKey)).size!==tasks.length)throw Error('批次含重复目的地');
  const id=randomUUID(),now=new Date().toISOString();
  this.source.transaction(()=>{
   const open=this.db.prepare("SELECT id FROM batches WHERE state IN ('READY','RUNNING','PAUSED','WAITING_HUMAN')").all();
   if(roundId){
    if(mode!=='LIVE')throw Error('持续轮次模式不匹配');
    for(const task of tasks)this.roundPermit(roundId,task);
    for(const b of open)for(const x of this.items(b.id)){
     const entry=this.db.prepare('SELECT task_hash FROM round_items WHERE round_id=? AND key=? AND queue_id=?').get(roundId,x.key,x.id);
     if(!entry||entry.task_hash!==digest(x.task))throw Error('其他未结束批次尚未纳入本轮，禁止竞争执行');
    }
   }else if(open.length)throw Error('已有未结束批次，请继续该批次');
   this.db.prepare('INSERT INTO batches(id,imported,shop,mode,state,review,at) VALUES(?,?,?,?,?,?,?)').run(id,imported,shop,mode,'READY',JSON.stringify(review),now);
   tasks.forEach((task,i)=>{if(this.source.completed(task)||this.reserved(task))throw Error('商品已成功或已有队列任务');
    const key=destinationKey(task),taskId=task.taskId||'task-'+key.slice(0,24);
    this.db.prepare('INSERT INTO batch_items(id,batch,key,position,task,state) VALUES(?,?,?,?,?,?)').run(taskId,id,key,i+1,JSON.stringify(task),'PENDING');});
   this.event(id,null,'BATCH_CREATED',{count:tasks.length,mode,selectionHash:review.selectionHash});
  });return this.batch(id);
 }
 setBatch(id,state,reason=''){
  const b=this.batch(id),now=new Date().toISOString();if(!b)throw Error('批次不存在');
  let elapsed=b.elapsed_ms,segment=b.segment_started;
  if(b.state==='RUNNING'&&state!=='RUNNING'&&segment){elapsed+=Math.max(0,Date.now()-Date.parse(segment));segment=null;}
  if(state==='RUNNING'&&b.state!=='RUNNING')segment=now;
  this.db.prepare('UPDATE batches SET state=?,reason=?,elapsed_ms=?,segment_started=?,started=COALESCE(started,?),finished=? WHERE id=?').run(state,reason,elapsed,segment,state==='RUNNING'?now:null,state==='COMPLETED'?now:null,id);
  this.event(id,null,state,{reason});return this.batch(id);
 }
 move(id,state,reason='',result=null){
  const x=this.item(id);if(!moves[x.state]?.includes(state))throw Error(`禁止队列状态跳转 ${x.state} → ${state}`);
  if(state==='SUCCEEDED'&&(!result?.itemId||!result?.screenshot||!result?.rowText))throw Error('队列成功必须有平台证据');
  const now=new Date().toISOString();this.db.prepare('UPDATE batch_items SET state=?,reason=?,result=?,finished=? WHERE id=?').run(state,reason,result?JSON.stringify(result):x.result?JSON.stringify(x.result):null,terminal.has(state)?now:null,id);
  if(state==='SUCCEEDED')this.db.prepare('UPDATE batches SET consecutive=consecutive+1,max_consecutive=MAX(max_consecutive,consecutive+1) WHERE id=?').run(x.batch);
  else if(['WAITING_HUMAN','FAILED'].includes(state))this.db.prepare('UPDATE batches SET consecutive=0 WHERE id=?').run(x.batch);
  this.event(x.batch,id,state,{reason,...(result?{itemId:result.itemId}:{})});return this.item(id);
 }
 // Shared read-only budget rule. It does not authorize a claim or alter counts.
 // claim() still obtains its original RUNNING-round permit inside its transaction;
 // the item UI supplies only its already-validated original round/queue snapshot.
 assertClaimBudget(x,permit=null){
  if(x.state!=='WAITING_HUMAN'&&x.attempts>=x.max_attempts){
   if(!permit)budgetFailure('ITEM_RETRY_BUDGET_EXHAUSTED','已达重试上限');
   const run=x.run_id?this.source.run(x.run_id):null;
   const submitted=run&&this.db.prepare("SELECT seq FROM events WHERE run=? AND kind IN ('SUBMITTING','RESULT_UNKNOWN','VERIFIED') LIMIT 1").get(run.id);
   const baseline=permit.entry.baseline_attempts;
   if(!run||run.state!=='PAUSED'||submitted||!Number.isInteger(baseline)||baseline<=0||x.attempts>=Math.min(x.max_attempts+2,baseline+3)||permit.entry.extra_attempts>=2||/CAPTCHA|验证码|登录|店铺身份/.test(run.reason))budgetFailure('ITEM_RETRY_BUDGET_EXTRA_UNSAFE','原任务不具备额外安全恢复条件，保留原次数与断点');
   if(!/expect\(locator\)|MATERIAL_|ATTRIBUTE_|FORM_|Timeout|页面|控件/.test(run.reason))budgetFailure('ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED','尚未证实是提交前系统故障，禁止额外恢复');
   return {extra:true,run};
  }
  return {extra:false,run:null};
 }
 claim(id,{roundId}={}){return this.source.transaction(()=>{const x=this.item(id);if(!['PENDING','RETRY','WAITING_HUMAN'].includes(x.state))throw Error('任务不能启动');
  const permit=roundId?this.roundPermit(roundId,x.task,id):null;
  const budget=this.assertClaimBudget(x,permit);
  if(budget.extra){
   const run=budget.run;
   this.db.prepare('UPDATE round_items SET extra_attempts=extra_attempts+1 WHERE round_id=? AND key=?').run(roundId,x.key);
   this.event(x.batch,x.id,'SYSTEM_REPAIR_EXTRA_CLAIM',{roundId,oldAttempts:x.attempts,newAttempts:x.attempts+1,extraAttempt:permit.entry.extra_attempts+1,limit:2,repairVersion:permit.round.repair_version,authorizationHash:permit.round.authorization_hash,runId:run.id,step:run.checkpoint.step,reason:run.reason});
  }
  this.db.prepare('UPDATE batch_items SET attempts=attempts+?,started=COALESCE(started,?) WHERE id=?').run(x.state==='WAITING_HUMAN'?0:1,new Date().toISOString(),id);return this.move(id,'RUNNING');});}
 attach(id,runId){const x=this.item(id);if(x.run_id&&x.run_id!==runId)throw Error('不能替换原执行任务');this.db.prepare('UPDATE batch_items SET run_id=? WHERE id=?').run(runId,id);}
 retryScope(id){const event=this.events(id).filter(x=>['RETRY_SCOPE_SET','RETRY_SCOPE_COMPLETE'].includes(x.kind)).at(-1);return event?.kind==='RETRY_SCOPE_SET'?event.payload.ids:null;}
 retryFailed(id){
  if(this.items(id).some(x=>['RUNNING','WAITING_HUMAN'].includes(x.state)||x.run_id&&['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','RUNNING'].includes(this.source.run(x.run_id).state)))throw Error('原商品正在执行或等待人工核验，不能替换重试范围');
  const items=this.items(id).filter(x=>['FAILED','RETRY'].includes(x.state)&&x.attempts<x.max_attempts);
  if(!items.length)throw Error('无可重试任务，或已达每条 3 次上限');
  this.source.transaction(()=>{
   for(const x of items)if(x.state==='FAILED')this.move(x.id,'RETRY','人工请求有限重试');
   this.event(id,null,'RETRY_SCOPE_SET',{ids:items.map(x=>x.id)});
   this.setBatch(id,'PAUSED','失败任务已加入重试队列；本次不执行原待上架商品');
  });return items.length;
 }
 recover(){
  for(const b of this.db.prepare("SELECT id FROM batches WHERE state='RUNNING'").all())this.setBatch(b.id,'PAUSED','程序已停止，请继续原批次');
  for(const row of this.db.prepare("SELECT id FROM batch_items WHERE state='RUNNING'").all()){
   const x=this.item(row.id),run=x.run_id?this.source.run(x.run_id):null;
   if(run?.state==='VERIFIED')this.move(x.id,'SUCCEEDED','从平台成功记录恢复',run.result);
   else this.move(x.id,'WAITING_HUMAN',run?.state==='RESULT_UNKNOWN'?'提交结果待核验，禁止再次提交':'程序或浏览器中断，等待恢复原任务');
  }
 }
 view(id){const b=this.batch(id);if(!b)return null;const items=this.db.prepare(`SELECT i.id,i.position,i.task,i.state,i.attempts,i.max_attempts,i.reason,i.run_id,i.result,i.started,i.finished,
   r.state run_state,r.checkpoint run_checkpoint FROM batch_items i LEFT JOIN runs r ON r.id=i.run_id WHERE i.batch=? ORDER BY i.position`).all(b.id).map(x=>{
    if(x.run_id&&!x.run_state)throw Error('队列关联的原执行记录缺失，停止状态核验');
    const task=JSON.parse(x.task);return {id:x.id,position:x.position,task,state:x.state,attempts:x.attempts,maxAttempts:x.max_attempts,reason:x.reason,runId:x.run_id,
     runState:x.run_state||null,result:x.result?JSON.parse(x.result):null,started:x.started,finished:x.finished,checkpoint:x.run_checkpoint?JSON.parse(x.run_checkpoint):null};
   }),counts=Object.fromEntries(TASK_STATES.map(s=>[s,items.filter(x=>x.state===s).length]));
  const retryScope=this.retryScope(b.id),failureBlocked=items.some(x=>x.state==='FAILED'&&(!retryScope||retryScope.includes(x.id)));
  return {...b,review:undefined,total:items.length,counts,failureBlocked,elapsedMs:b.elapsed_ms+(b.segment_started?Math.max(0,Date.now()-Date.parse(b.segment_started)):0),current:items.find(x=>x.state==='RUNNING')?.id||items.find(x=>x.state==='WAITING_HUMAN')?.id||null,
   items:items.map(x=>({id:x.id,position:x.position,rank:x.task.priority,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,state:x.state,attempts:x.attempts,maxAttempts:x.maxAttempts,reason:x.reason,runId:x.runId,runState:x.runState,result:x.result,started:x.started,finished:x.finished,checkpoint:x.checkpoint}))};}
}
