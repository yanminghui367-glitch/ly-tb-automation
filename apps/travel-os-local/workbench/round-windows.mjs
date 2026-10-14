import {randomUUID} from 'node:crypto';
import {digest} from './source-store.mjs';

const terminal=new Set(['COMPLETED','STOPPED']);
const now=()=>new Date().toISOString();
const fail=message=>{throw Error(message);};
const parse=value=>value?JSON.parse(value):null;
const csv=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';

// Bounded assignments within the existing fixed manifest, not a second queue.
// Original task, queue, run and authorization identities are never replaced.
export class RoundWindows {
 constructor(owner){
  this.owner=owner;this.db=owner.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS round_windows (
   id TEXT PRIMARY KEY,round_id TEXT NOT NULL,sequence INTEGER NOT NULL,shop TEXT NOT NULL,
   manifest_hash TEXT NOT NULL,selection_hash TEXT NOT NULL,scope_start INTEGER NOT NULL,scope_end INTEGER NOT NULL,
   limit_count INTEGER NOT NULL,auto_continue INTEGER NOT NULL DEFAULT 0,repair_version TEXT NOT NULL,
   state TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,started TEXT,finished TEXT,updated TEXT NOT NULL,continuation_pending INTEGER NOT NULL DEFAULT 0,
   UNIQUE(round_id,sequence));
   CREATE TABLE IF NOT EXISTS round_window_items (
   window_id TEXT NOT NULL,key TEXT NOT NULL,ordinal INTEGER NOT NULL,task_hash TEXT NOT NULL,
   baseline TEXT NOT NULL,outcome TEXT,PRIMARY KEY(window_id,key),UNIQUE(window_id,ordinal));`);
 }
 get(id){if(!id)return null;const row=this.db.prepare('SELECT * FROM round_windows WHERE id=?').get(id);return row||null;}
 latest(roundId){return this.db.prepare('SELECT * FROM round_windows WHERE round_id=? ORDER BY sequence DESC LIMIT 1').get(roundId)||null;}
 open(roundId){const row=this.latest(roundId);return row&&!terminal.has(row.state)?row:null;}
 entries(id){return this.db.prepare('SELECT * FROM round_window_items WHERE window_id=? ORDER BY ordinal').all(id).map(row=>({...row,baseline:parse(row.baseline),outcome:parse(row.outcome)}));}
 assignmentHash(round,config,rows){return digest({roundId:round.id,manifestHash:round.manifest_hash,shop:round.shop,...config,items:rows.map(x=>({key:x.key,taskHash:x.task_hash}))});}
 config(roundId,input={}){
  const total=this.owner.items(roundId).length;
  const {startPosition=1,endPosition=total,limit=100,autoContinue=false}=input;
  if(!Number.isInteger(startPosition)||!Number.isInteger(endPosition)||startPosition<1||endPosition>total||endPosition<startPosition)fail('任务范围须为清单内的有效序号');
  if(!Number.isInteger(limit)||limit<1||limit>100)fail('本轮数量须为 1—100 条');
  if(typeof autoContinue!=='boolean')fail('自动衔接须明确选择开启或关闭');
  return {startPosition,endPosition,limit,autoContinue};
 }
 fingerprint(rows){return digest(rows.map(x=>{
  const q=x.queue_id?this.owner.batch.store.item(x.queue_id):null,run=x.run_id?this.owner.source.store.run(x.run_id):null;
  return {key:x.key,taskHash:x.task_hash,state:x.state,runId:x.run_id,queueId:x.queue_id,submitted:x.submitted,uncertain:x.submission_uncertain,updated:x.updated,
   queue:q?{key:q.key,state:q.state,attempts:q.attempts,runId:q.run_id,taskHash:digest(q.task)}:null,
   run:run?{state:run.state,checkpoint:run.checkpoint,result:run.result,taskHash:digest(run.task)}:null};
 }));}
 resolutionRequired(id){
  const w=this.get(id);if(!w)return null;
  for(const e of this.entries(id)){
   const x=this.owner.item(w.round_id,e.key),run=x.run_id?this.owner.source.store.run(x.run_id):null;
   if(['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state)||x.submission_uncertain||x.state==='RESULT_UNKNOWN'&&!['existing-listing-check','content-review'].includes(x.failure_stage))return 'RESULT_UNKNOWN';
   if(run?.state==='PAUSED_CAPTCHA')return 'WAITING_HUMAN';
  }
  return null;
 }
 async preview(roundId,input={},{internal=false}={}){
  const o=this.owner;
  if(internal)o.assertLease(roundId);else o.assertIdle();
  if(this.open(roundId))fail('已有未结束的执行轮次，请继续或停止原轮次');
  const round=o.assertManifest(roundId),config=this.config(roundId,input),rows=o.items(roundId),fingerprint=this.fingerprint(rows);
  if(round.state==='COMPLETED')fail('总清单已完成');
  if(rows.some(x=>x.state==='RESULT_UNKNOWN'&&!['existing-listing-check','content-review'].includes(x.failure_stage)||x.run_id&&['SUBMITTING','RESULT_UNKNOWN','PAUSED_CAPTCHA'].includes(o.source.store.run(x.run_id).state)&&x.failure_stage!=='content-review'))fail('请先核验原商品或处理人工验证，再配置新轮次');
  const selected=[],excluded=[];
  for(const x of rows){
   if(x.position<config.startPosition||x.position>config.endPosition)continue;
   if(x.state!=='PENDING'){excluded.push({key:x.key,position:x.position,reason:'原状态：'+x.state});continue;}
   if(selected.length>=config.limit)continue;
   const run=x.run_id?o.source.store.run(x.run_id):null;
   const queue=x.queue_id?o.batch.store.item(x.queue_id):null;
   if(queue&&(queue.key!==x.key||digest(queue.task)!==x.task_hash))fail('原队列与固定资料不一致');
   if(queue&&['SKIPPED','SUCCEEDED'].includes(queue.state)){excluded.push({key:x.key,position:x.position,reason:queue.state==='SKIPPED'?'原队列已人工跳过':'原队列已有成功记录'});continue;}
   if(x.submitted||x.submission_uncertain||o.wasSubmitted(run)||run?.state==='VERIFIED'||o.source.store.completed(x.task)){excluded.push({key:x.key,position:x.position,reason:'有提交或成功记录，须先核验原商品'});continue;}
   try{
    o.assertContentForTask(x.task,roundId);
    if(x.task.adapterIssues?.length)fail('资料缺失：'+x.task.adapterIssues.join('；'));
    if(run&&(!['QUEUED','PAUSED'].includes(run.state)||run.mode!=='LIVE'))fail('原任务不支持本轮执行，请先处理原任务');
    await o.checkFiles(x.task);
   }catch(e){
    // Known per-product data issues can be excluded. Unknown/shared faults do
    // not silently produce a smaller or empty supposedly healthy assignment.
    const kind=o.classifyFailure(e,{preflight:true}).kind;
    if(!['PREFLIGHT','PRODUCT'].includes(kind)&&!['CONTENT_MISMATCH','CONTENT_REVIEW_REQUIRED'].includes(e.code)&&!/^资料缺失：/.test(e.message))throw e;
    excluded.push({key:x.key,position:x.position,reason:String(e.message).slice(0,400)});continue;
   }
   selected.push(x);
  }
  if(internal)o.assertLease(roundId);else o.assertIdle();
  o.assertManifest(roundId);
  if(this.fingerprint(o.items(roundId))!==fingerprint)fail('预检期间任务状态已变化，请重新检查范围');
  const current=rows.find(x=>x.key===round.current_item&&x.state==='PENDING'&&x.entered_publish);
  if(current&&!selected.some(x=>x.key===current.key))fail('原商品仍有未结束断点，请先将其纳入本轮：'+(current.task.listing.city||current.task.listing.country));
  const selectionHash=this.assignmentHash(round,config,selected);
  return {roundId,manifestHash:round.manifest_hash,shop:round.shop,...config,selectionHash,count:selected.length,
   resumedCount:selected.filter(x=>!!x.run_id).length,eligibleRemaining:rows.filter(x=>x.state==='PENDING'&&x.position>=config.startPosition&&x.position<=config.endPosition).length,
   items:selected.map(x=>({key:x.key,position:x.position,taskHash:x.task_hash,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,resuming:!!x.run_id})),excluded};
 }
 create(preview,{commit}={}){
  const o=this.owner,r=o.assertManifest(preview.roundId);
  if(this.open(r.id))fail('已有未结束的执行轮次');
  const config=this.config(r.id,preview),rows=preview.items.map(x=>o.item(r.id,x.key));
  if(!rows.length||rows.length>config.limit||new Set(rows.map(x=>x.key)).size!==rows.length||rows.some(x=>(preview.selectionId?!['PENDING','FAILED'].includes(x.state):x.state!=='PENDING')||x.position<config.startPosition||x.position>config.endPosition))fail('预检范围失效，请重新检查');
  if(preview.selectionId)o.selections.validateWindowPreview(preview,rows);
  if(preview.manifestHash!==r.manifest_hash||this.assignmentHash(r,config,rows)!==preview.selectionHash)fail('执行轮次清单或资料版本已变化');
  const id=randomUUID(),at=now(),sequence=(this.latest(r.id)?.sequence||0)+1;
  const create=()=>{
   this.db.prepare('INSERT INTO round_windows(id,round_id,sequence,shop,manifest_hash,selection_hash,scope_start,scope_end,limit_count,auto_continue,repair_version,state,at,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,r.id,sequence,r.shop,r.manifest_hash,preview.selectionHash,config.startPosition,config.endPosition,config.limit,Number(config.autoContinue),r.repair_version,'READY',at,at);
   const insert=this.db.prepare('INSERT INTO round_window_items(window_id,key,ordinal,task_hash,baseline) VALUES(?,?,?,?,?)');
   rows.forEach((x,i)=>insert.run(id,x.key,i+1,x.task_hash,JSON.stringify(this.observation(x))));
   if(preview.selectionId)o.selections.bindWindow(preview.selectionId,id,rows);
   this.db.prepare('UPDATE round_windows SET continuation_pending=0 WHERE round_id=? AND id!=? AND continuation_pending=1').run(r.id,id);
   this.db.prepare('UPDATE rounds SET stopped=0 WHERE id=?').run(r.id);
   o.event(r.id,null,'WINDOW_CREATED',{windowId:id,sequence,count:rows.length,selectionHash:preview.selectionHash,...config});
   commit?.({id,roundId:r.id,sequence});
  };
  if(this.db.isTransaction)create();else o.source.store.transaction(create);
  return this.view(id);
 }
 assert(id,roundId){
  const w=this.get(id),r=this.owner.assertManifest(roundId);
  if(!w||w.round_id!==r.id||w.shop!==r.shop||w.manifest_hash!==r.manifest_hash)fail('执行轮次不属于原固定清单');
  const entries=this.entries(id),rows=entries.map(e=>this.owner.item(r.id,e.key));
  if(!entries.length||entries.length>w.limit_count||entries.some((e,i)=>e.ordinal!==i+1||e.task_hash!==rows[i].task_hash))fail('执行轮次冻结资料不一致');
  if(this.assignmentHash(r,{startPosition:w.scope_start,endPosition:w.scope_end,limit:w.limit_count,autoContinue:!!w.auto_continue},rows)!==w.selection_hash)fail('执行轮次范围校验失败');
  this.owner.selections?.assertWindow(w,rows);
  return w;
 }
 state(id,state,reason=''){
  const w=this.get(id);if(!w||terminal.has(w.state))return;
  const at=now();
  this.db.prepare('UPDATE round_windows SET state=?,reason=?,updated=?,started=CASE WHEN ?=\'RUNNING\' THEN COALESCE(started,?) ELSE started END,finished=? WHERE id=?').run(state,reason,at,state,at,terminal.has(state)?at:null,id);
  this.owner.event(w.round_id,null,'WINDOW_'+state,{windowId:id,reason});
 }
 observation(x){return {key:x.key,position:x.position,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,state:x.state,runId:x.run_id,queueId:x.queue_id,
  attempts:x.queue_id?this.owner.batch.store.item(x.queue_id).attempts:0,enteredPublish:!!x.entered_publish,submitted:!!x.submitted,submissionUncertain:!!x.submission_uncertain,stage:x.failure_stage,reason:x.reason,started:x.started,finished:x.finished,result:x.result};}
 close(id,state,reason){
  const w=this.assert(id,this.get(id)?.round_id);
  if(terminal.has(w.state))return;
  const close=()=>{
   const update=this.db.prepare('UPDATE round_window_items SET outcome=? WHERE window_id=? AND key=?');
   for(const e of this.entries(id))update.run(JSON.stringify(this.observation(this.owner.item(w.round_id,e.key))),id,e.key);
   this.state(id,state,reason);
   if(state==='COMPLETED'&&w.auto_continue)this.db.prepare('UPDATE round_windows SET continuation_pending=1 WHERE id=?').run(id);
  };
  if(this.db.isTransaction===true)close();else this.owner.source.store.transaction(close);
 }
 finishContinuation(id,reason){
  const w=this.get(id);if(!w?.continuation_pending)return;
  this.db.prepare('UPDATE round_windows SET continuation_pending=0 WHERE id=?').run(id);
  this.owner.event(w.round_id,null,'WINDOW_CONTINUATION_ENDED',{windowId:id,reason});
 }
 bindExecution(roundId,key,runId){
  const w=this.open(roundId);if(!w)return;
  this.assert(w.id,roundId);
  if(!this.entries(w.id).some(e=>e.key===key))fail('商品未分配到当前执行轮次，禁止启动');
  const seq=this.db.prepare('SELECT COALESCE(MAX(seq),0) n FROM events WHERE run=?').get(runId).n;
  this.owner.event(roundId,key,'WINDOW_EXECUTION_BOUND',{windowId:w.id,runId,sourceEventAfter:seq});
 }
 view(id,{items=false}={}){
  const w=this.get(id);if(!w)return null;
  const entries=this.entries(id),observations=entries.map(e=>e.outcome||this.observation(this.owner.item(w.round_id,e.key)));
  const counts={};for(const x of observations)counts[x.state]=(counts[x.state]||0)+1;
  const ended=observations.filter(x=>['NEW_SUCCESS','EXISTING_VERIFIED','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED'].includes(x.state)).length;
  return {id:w.id,roundId:w.round_id,sequence:w.sequence,shop:w.shop,state:w.state,reason:w.reason,selectionHash:w.selection_hash,...(this.owner.selections?.forWindow(w.id)?{selectionId:this.owner.selections.forWindow(w.id)}:{}),startPosition:w.scope_start,endPosition:w.scope_end,limit:w.limit_count,autoContinue:!!w.auto_continue,continuationPending:!!w.continuation_pending,
   at:w.at,started:w.started,finished:w.finished,total:entries.length,ended,counts,submitted:observations.filter((x,i)=>x.submitted&&!entries[i].baseline.submitted).length,
   resumedCount:entries.filter(e=>e.baseline.runId).length,...(items?{items:observations.map((x,i)=>({...x,baseline:entries[i].baseline}))}:{})};
 }
 history(roundId){return this.db.prepare('SELECT id FROM round_windows WHERE round_id=? ORDER BY sequence DESC').all(roundId).map(w=>this.view(w.id));}
 csv(id){
  const w=this.view(id,{items:true});if(!w)fail('执行轮次不存在');
  const rows=[['总清单ID','执行轮次ID','序号','商品唯一键','店铺','目的地','状态','本轮点击提交','恢复旧任务','步骤','原因','任务ID','开始时间','结束时间','商品ID','平台状态','证据']];
  for(const x of w.items)rows.push([w.roundId,w.id,x.position,x.key,w.shop,x.destination,x.state,x.submitted&&!x.baseline.submitted?'是':x.submissionUncertain?'待核验':'否',x.baseline.runId?'是':'否',x.stage,x.reason,x.runId,x.started,x.finished,x.result?.itemId,x.result?.status,x.result?.screenshot]);
  return '\ufeff'+rows.map(row=>row.map(csv).join(',')).join('\r\n');
 }
}
