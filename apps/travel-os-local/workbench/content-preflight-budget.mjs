import {digest,destinationKey} from './source-store.mjs';

const REASON='CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核';
const denied=reason=>({eligible:false,credit:0,reason});
const stores=({source,batch})=>({source:source?.store||source,batch:batch?.store||batch});
const parse=x=>typeof x==='string'?JSON.parse(x):x;
function originalScope(input){
 const {source,batch}=stores(input),db=source?.db;
 if(!db||batch?.source!==source||batch.db!==db)throw Error('原资料与队列不属于同一执行环境');
 const r=db.prepare('SELECT * FROM rounds WHERE id=?').get(input.round?.id);
 const x=r&&db.prepare('SELECT * FROM round_items WHERE round_id=? AND key=?').get(r.id,input.item?.key);
 if(!r||!x||input.round.shop!==r.shop||input.item.task_hash!==x.task_hash||digest(input.item.task)!==x.task_hash)throw Error('原固定清单或商品快照已变化');
 const q=x.queue_id?batch.item(x.queue_id):null,b=q&&batch.batch(q.batch),run=q?.run_id?source.run(q.run_id):null;
 if(!q||!b||!run||x.batch_id!==b.id||x.run_id!==run.id||b.shop!==r.shop||b.imported!==r.import_id||b.mode!=='LIVE'||run.mode!=='LIVE'||run.batch!==r.import_id||q.key!==x.key||run.key!==x.key||q.task.shopId!==r.shop||run.task.shopId!==r.shop||digest(q.task)!==x.task_hash||digest(run.task)!==x.task_hash||destinationKey(q.task)!==x.key)throw Error('原店铺、导入、队列、任务或执行记录不匹配');
 return {source,batch,db,r,x,q,b,run};
}
function inspect(input){
 const s=originalScope(input),{source,db,r,x,q,run}=s;
 const prior=db.prepare('SELECT * FROM content_preflight_credits WHERE queue_id=?').get(q.id);
 if(prior){
  if(verifiedContentPreflightCredit(source,q,{round:r,entry:x})!==prior.credit)throw Error('原恢复抵扣记录与当前任务不匹配');
  return {...s,prior,credit:prior.credit};
 }
 if(!['READY','PAUSED','SYSTEM_BLOCKED','STOPPED','NEEDS_REVIEW'].includes(r.state)||!['PENDING','FAILED'].includes(x.state)||x.entered_publish||x.submitted||x.submission_uncertain||x.result||q.state!=='FAILED'||q.result||run.state!=='PAUSED'||run.reason!==REASON||run.result||source.completed(q.task))throw Error('仅允许未打开填写页的原内容预检暂停任务');
 if(!Number.isInteger(q.attempts)||q.attempts<1||q.attempts>q.max_attempts||!Number.isInteger(q.max_attempts)||q.max_attempts<1)throw Error('原尝试次数不符合有界恢复条件');
 const cp=run.checkpoint;
 // Only the catch-path metadata produced before any page exists is accepted.
 const allowed=['pausedAt','reason','errorCode','screenshot','screenshotAt','screenshotError'];
 if(Object.keys(cp).some(k=>!allowed.includes(k))||cp.screenshot||cp.reason!==REASON||![null,'CONTENT_REVIEW_REQUIRED'].includes(cp.errorCode)||cp.screenshotError!=='当前没有可截图的页面')throw Error('原断点存在页面或其他错误证据');
 const events=source.events(run.id);
 if(events.length!==q.attempts*3||events[0]?.kind!=='CREATED'||events[0].payload?.mode!=='LIVE'||events[0].payload?.review?.taskHash!==x.task_hash)throw Error('原事件历史与尝试次数不一致');
 for(let n=0;n<q.attempts;n++){
  if(n&&!(events[n*3]?.kind==='QUEUED'&&events[n*3].payload?.reason==='操作者请求恢复；重新校验页面'))throw Error('原历史包含其他恢复或操作');
  if(events[n*3+1]?.kind!=='RUNNING'||events[n*3+1].payload?.result||events[n*3+2]?.kind!=='PAUSED'||events[n*3+2].payload?.reason!==REASON||events[n*3+2].payload?.result)throw Error('原历史包含非内容预检暂停');
 }
 return {...s,credit:q.attempts,events};
}

// Read-only. This never creates schema, approves content, resets a counter or starts work.
export function contentPreflightRepairPlan(input){
 try{const s=inspect(input);return {eligible:!s.prior,alreadyApplied:!!s.prior,credit:s.credit,reason:s.prior?'原未启动次数已经抵扣':'仅抵扣原未进入填写页的内容预检失败',queueId:s.q.id,roundId:s.r.id,runId:s.run.id,rawAttempts:s.q.attempts};}
 catch(e){return denied(e.message);}
}
export function applyContentPreflightRepair(input){
 const {source}=stores(input);
 return source.transaction(()=>{
  let s;try{s=inspect(input);}catch(e){throw Object.assign(e,{statusCode:409,code:'CONTENT_PREFLIGHT_REPAIR_INELIGIBLE'});}
  if(s.prior)return {accepted:true,alreadyApplied:true,credit:s.prior.credit,queueId:s.q.id,roundId:s.r.id,runId:s.run.id,rawAttempts:s.q.attempts,executionStarted:false};
  const {db,batch,r,x,q,run,credit,events}=s;
  db.prepare('INSERT INTO content_preflight_credits(queue_id,round_id,key,task_hash,run_id,raw_attempts,credit,event_count,event_hash,at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(q.id,r.id,x.key,x.task_hash,run.id,q.attempts,credit,events.length,digest(events),new Date().toISOString());
  batch.move(q.id,'RETRY','原内容预检未启动，已记录有界次数抵扣；保留全部历史');
  const result={accepted:true,alreadyApplied:false,credit,queueId:q.id,roundId:r.id,runId:run.id,rawAttempts:q.attempts,effectiveAttempts:q.attempts-credit,executionStarted:false};
  batch.event(q.batch,q.id,'CONTENT_PREFLIGHT_BUDGET_CREDIT',result);return result;
 });
}

// Credit applies only to the exact immutable round/queue/run snapshot. New
// attempts stay raw and consume the one fixed credit; later failures cannot add it.
export function verifiedContentPreflightCredit(source,q,permit){
 if(!permit)return 0;
 const c=source.db.prepare('SELECT * FROM content_preflight_credits WHERE queue_id=?').get(q.id);
 if(!c)return 0;
 const {round:r,entry:x}=permit;
 if(c.round_id!==r.id||r.shop!==q.task.shopId||x.queue_id!==q.id||x.round_id!==r.id||x.key!==q.key||x.task_hash!==digest(q.task)||c.key!==q.key||c.task_hash!==x.task_hash||c.run_id!==q.run_id||x.run_id!==q.run_id||!Number.isInteger(c.credit)||c.credit<1||c.credit!==c.raw_attempts||c.credit>q.max_attempts||q.attempts<c.raw_attempts||c.event_count!==c.credit*3)return 0;
 const run=source.run(c.run_id),entry=source.db.prepare('SELECT * FROM round_items WHERE round_id=? AND key=?').get(c.round_id,c.key);
 if(!entry||entry.queue_id!==q.id||entry.run_id!==run.id||entry.task_hash!==c.task_hash||run.mode!=='LIVE'||run.key!==c.key||run.task.shopId!==r.shop||digest(run.task)!==c.task_hash)return 0;
 const events=source.events(c.run_id).slice(0,c.event_count);
 return events.length===c.event_count&&digest(events)===c.event_hash?c.credit:0;
}
