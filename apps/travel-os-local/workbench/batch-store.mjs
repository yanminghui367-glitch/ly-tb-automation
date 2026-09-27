import {randomUUID} from 'node:crypto';
import {digest,destinationKey} from './source-store.mjs';

export const TASK_STATES=['PENDING','RUNNING','WAITING_HUMAN','SUCCEEDED','FAILED','RETRY','SKIPPED'];
const terminal=new Set(['SUCCEEDED','FAILED','SKIPPED']);
const moves={PENDING:['RUNNING','SKIPPED'],RETRY:['RUNNING','SKIPPED'],RUNNING:['WAITING_HUMAN','SUCCEEDED','FAILED','SKIPPED'],WAITING_HUMAN:['RUNNING','SUCCEEDED','SKIPPED'],FAILED:['RETRY','SKIPPED'],SUCCEEDED:[],SKIPPED:[]};
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
 create(imported,tasks,shop,mode,review){
  if(!['LIVE','DRY_RUN'].includes(mode)||!tasks.length||tasks.length>20)throw Error('本轮每批只允许 1—20 个商品');
  if(review?.reviewed!==true||review.selectionHash!==digest(tasks)||!review.authorization)throw Error('请核对本批完整商品清单和素材');
  if(tasks.some(t=>t.shopId!==shop||t.adapterIssues.length))throw Error('批次含店铺不匹配或资料缺失商品');
  if(new Set(tasks.map(destinationKey)).size!==tasks.length)throw Error('批次含重复目的地');
  const id=randomUUID(),now=new Date().toISOString();
  this.source.transaction(()=>{
   if(this.db.prepare("SELECT id FROM batches WHERE state IN ('READY','RUNNING','PAUSED','WAITING_HUMAN')").get())throw Error('已有未结束批次，请继续该批次');
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
 claim(id){return this.source.transaction(()=>{const x=this.item(id);if(!['PENDING','RETRY','WAITING_HUMAN'].includes(x.state))throw Error('任务不能启动');if(x.state!=='WAITING_HUMAN'&&x.attempts>=x.max_attempts)throw Error('已达重试上限');
  this.db.prepare('UPDATE batch_items SET attempts=attempts+?,started=COALESCE(started,?) WHERE id=?').run(x.state==='WAITING_HUMAN'?0:1,new Date().toISOString(),id);return this.move(id,'RUNNING');});}
 attach(id,runId){const x=this.item(id);if(x.run_id&&x.run_id!==runId)throw Error('不能替换原执行任务');this.db.prepare('UPDATE batch_items SET run_id=? WHERE id=?').run(runId,id);}
 retryFailed(id){let count=0;for(const x of this.items(id))if(x.state==='FAILED'&&x.attempts<x.max_attempts){this.move(x.id,'RETRY','人工请求有限重试');count++;}if(!count)throw Error('无可重试任务，或已达每条 3 次上限');this.setBatch(id,'PAUSED','失败任务已加入重试队列');return count;}
 recover(){
  for(const b of this.db.prepare("SELECT id FROM batches WHERE state='RUNNING'").all())this.setBatch(b.id,'PAUSED','程序已停止，请继续原批次');
  for(const row of this.db.prepare("SELECT id FROM batch_items WHERE state='RUNNING'").all()){
   const x=this.item(row.id),run=x.run_id?this.source.run(x.run_id):null;
   if(run?.state==='VERIFIED')this.move(x.id,'SUCCEEDED','从平台成功记录恢复',run.result);
   else this.move(x.id,'WAITING_HUMAN',run?.state==='RESULT_UNKNOWN'?'提交结果待核验，禁止再次提交':'程序或浏览器中断，等待恢复原任务');
  }
 }
 view(id){const b=this.batch(id);if(!b)return null;const items=this.items(b.id),counts=Object.fromEntries(TASK_STATES.map(s=>[s,items.filter(x=>x.state===s).length]));
  return {...b,review:undefined,total:items.length,counts,elapsedMs:b.elapsed_ms+(b.segment_started?Math.max(0,Date.now()-Date.parse(b.segment_started)):0),current:items.find(x=>x.state==='RUNNING')?.id||items.find(x=>x.state==='WAITING_HUMAN')?.id||null,
   items:items.map(x=>({id:x.id,position:x.position,rank:x.task.priority,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,state:x.state,attempts:x.attempts,maxAttempts:x.max_attempts,reason:x.reason,runId:x.run_id,result:x.result,started:x.started,finished:x.finished,checkpoint:x.run_id?this.source.run(x.run_id).checkpoint:null}))};}
}
