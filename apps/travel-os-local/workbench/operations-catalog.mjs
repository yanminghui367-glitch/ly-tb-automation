// Read-only import catalogue. No coordinator construction, recovery, file IO or mutation.
import {basename} from 'node:path';
import {destinationKey} from './source-store.mjs';
import {redact} from './product-state.mjs';

export const OPERATIONS_STATUSES=Object.freeze(['AVAILABLE','WAITING','RUNNING','VERIFIED','PUBLISHED_CONTENT_REVIEW','RETRYABLE','UNSUBMITTED_BLOCKED','HUMAN','VERIFY','SKIPPED','NEEDS_DATA']);
const labels={AVAILABLE:'尚未生成任务',WAITING:'等待执行',RUNNING:'执行中',VERIFIED:'平台已核验',PUBLISHED_CONTENT_REVIEW:'已上架·内容待整改',RETRYABLE:'执行异常',UNSUBMITTED_BLOCKED:'未提交·处理受限',HUMAN:'需人工处理',VERIFY:'待核验',SKIPPED:'人工跳过',NEEDS_DATA:'资料待处理'};
const parse=value=>{if(value===null||value===undefined)return null;if(typeof value==='object')return value;try{return JSON.parse(value);}catch{return null;}};
const clean=value=>redact(typeof value==='string'?value:String(value??''));
const array=value=>Array.isArray(value)?value:[];
const evidence=value=>!!(value&&/^\d{6,30}$/.test(String(value.itemId||''))&&typeof value.status==='string'&&value.status.trim()&&typeof value.rowText==='string'&&value.rowText.trim()&&typeof value.screenshot==='string'&&value.screenshot.trim()&&Number.isFinite(Date.parse(value.verifiedAt)));
const keyOf=task=>{try{return task?.shopId&&['country','city'].includes(task.listing?.type)&&task.listing.country&&(task.listing.type!=='city'||task.listing.city)?destinationKey(task):null;}catch{return null;}};
const contentHeld=item=>item?.state==='RESULT_UNKNOWN'&&item.failure_stage==='content-review';
const unknown=state=>['RESULT_UNKNOWN','SUBMITTING'].includes(state);
const resultView=value=>{
 if(!value||typeof value!=='object')return null;
 const itemId=/^\d{6,30}$/.test(String(value.itemId||''))?String(value.itemId):null;
 let url=null;
 try{const raw=new URL(value.url);if(itemId&&raw.protocol==='https:'&&['item.taobao.com','detail.tmall.com'].includes(raw.hostname)&&!raw.username&&!raw.password&&raw.searchParams.get('id')===itemId)url=raw.origin+'/item.htm?id='+itemId;}catch{}
 return {itemId,url,status:clean(value.status),verifiedAt:Number.isFinite(Date.parse(value.verifiedAt))?value.verifiedAt:null,evidenceComplete:evidence(value)};
};
function grouped(rows,key){const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row);}return map;}

// This is a display category, never an action capability. The original detail
// endpoint must recheck scope, submission protection, content review and budget.
function classify({item,run,queue,history,held,issues,submitted,active}){
 const reason=clean(held?.reason||item?.reason||run?.reason||queue?.reason||'');
 if(held)return evidence(held.result)?{status:'PUBLISHED_CONTENT_REVIEW',reason:'淘宝已核验商品ID及出售状态；主图内容需整改，保留原商品并禁止重发'}:{status:'VERIFY',reason:reason||'原商品内容仍待核验；保留原商品，禁止重发'};
 if(item?.state==='RESULT_UNKNOWN'&&item.failure_stage==='existing-listing-check'&&!submitted&&!history&&!item.submission_uncertain&&!item.result&&!run?.result&&!queue?.result&&!unknown(run?.state)&&!unknown(queue?.state)&&!['VERIFIED','SUCCEEDED'].includes(run?.state)&&queue?.state!=='SUCCEEDED')return {status:'UNSUBMITTED_BLOCKED',reason:'本轮确认未提交；'+(Number.isInteger(queue?.attempts)&&Number.isInteger(queue?.max_attempts)&&queue.max_attempts>0&&queue.attempts>=queue.max_attempts?'原队列记录次数已达常规上限；':'')+'保留断点，请查看原任务处理条件'};
 if(item?.state==='RESULT_UNKNOWN'||item?.submission_uncertain||unknown(run?.state)||unknown(queue?.state))return {status:'VERIFY',reason:reason||'原商品或提交结果待核验，禁止再次提交'};
 if(['NEW_SUCCESS','EXISTING_VERIFIED'].includes(item?.state))return evidence(item.result)?{status:'VERIFIED',reason}:{status:'VERIFY',reason:'轮次标记成功，但完整平台核验证据缺失；请核对原记录'};
 if(submitted&&!evidence(run?.result)&&!evidence(history))return {status:'VERIFY',reason:reason||'存在提交记录，尚无完整平台核验结果'};
 // A frozen round row is authoritative. A historical success must not hide a
 // current manual hold, data rejection, failure or unreconciled pending row.
 if(item?.state==='PREFLIGHT_SKIPPED')return {status:'NEEDS_DATA',reason:reason||'资料预检未通过，未执行'};
 if(item?.state==='WAITING_HUMAN'||run?.state==='PAUSED_CAPTCHA'||/CAPTCHA|验证码|滑块|风险验证|请人工登录|登录失效|店铺身份/.test(reason)&&!['VERIFIED','SUCCEEDED'].includes(run?.state))return {status:'HUMAN',reason:reason||'请处理原人工检查项'};
 if(item?.state==='MANUAL_SKIPPED')return submitted?{status:'VERIFY',reason:'跳过记录与已有提交证据冲突；请核对原商品'}:{status:'SKIPPED',reason};
 if(item?.state==='FAILED')return {status:'RETRYABLE',reason:reason||'原执行失败，请查看处理条件'};
 if(active||run?.state==='RUNNING'||queue?.state==='RUNNING')return {status:'RUNNING',reason};
 if(item){
  if(item.state==='PENDING'){
   if(run?.state==='VERIFIED'||history||run?.result?.itemId||queue?.result?.itemId)return {status:'VERIFY',reason:reason||'已有商品结果，当前轮次尚未完成核对；禁止重发'};
   if(run?.state==='DRY_RUN_COMPLETE')return {status:'HUMAN',reason:reason||'仅填写完成，尚未提交'};
   if(['PAUSED','FAILED','RETRY'].includes(run?.state)||['FAILED','RETRY'].includes(queue?.state)||item.failure_stage||/失败|错误|异常|超时|中断|阻塞|未成功|FAILED|ERROR|TIMEOUT|BLOCKED|MATERIAL_|ATTRIBUTE_|FORM_|ITEM_RETRY_/i.test(item.reason||''))return {status:'RETRYABLE',reason:reason||'原任务中断，请检查断点和预算'};
   if(queue?.state==='WAITING_HUMAN')return {status:'HUMAN',reason:reason||'原队列等待人工处理'};
   return {status:issues.length?'NEEDS_DATA':'WAITING',reason};
  }
  return {status:'VERIFY',reason:'轮次状态无法识别，请核对原记录'};
 }
 if(evidence(history)||run?.state==='VERIFIED'&&evidence(run.result)||queue?.state==='SUCCEEDED'&&evidence(queue.result))return {status:'VERIFIED',reason};
 if(history||['VERIFIED','SUCCEEDED'].includes(run?.state)||queue?.state==='SUCCEEDED'||run?.result?.itemId||queue?.result?.itemId)return {status:'VERIFY',reason:'已有结果记录，但完整平台核验证据缺失；禁止重发'};
 if(run?.state==='DRY_RUN_COMPLETE'||queue?.state==='WAITING_HUMAN')return {status:'HUMAN',reason:reason||'原任务需人工核对；仅填写不代表发布成功'};
 if(['PAUSED','FAILED','RETRY'].includes(run?.state)||['FAILED','RETRY'].includes(queue?.state))return {status:'RETRYABLE',reason:reason||'执行异常，请查看原任务'};
 // Old queue SKIPPED did not distinguish manual and preflight decisions.
 if(queue?.state==='SKIPPED')return {status:'NEEDS_DATA',reason:reason||'旧队列已跳过，须查看原资料与跳过原因'};
 if(issues.length)return {status:'NEEDS_DATA',reason};
 if(run||queue)return {status:'WAITING',reason};
 return {status:'AVAILABLE',reason};
}

/**
 * Each import is selectable; each destination key appears once in its package.
 * `round` optionally supplies the existing owner's in-memory execution phase.
 * No methods on it are called, and no runtime/credential tables are queried.
 */
export function buildOperationsCatalog(store,{shopId,importId,round=null}={}){
 if(typeof shopId!=='string'||!shopId)throw Object.assign(Error('请选择店铺'),{code:'OPERATIONS_SHOP_REQUIRED'});
 const db=store.db,tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 const read=(table,sql,params=[])=>tables.has(table)?db.prepare(sql).all(...params):[];
 const rounds=read('rounds','SELECT id,shop,import_id,manifest_hash,state,current_item,at,updated FROM rounds WHERE shop=? ORDER BY rowid DESC',[shopId]);
 const roundsById=new Map(rounds.map(r=>[r.id,r]));
 const liveId=round?.active||round?.id;
 const currentRound=roundsById.get(liveId)||rounds[0]||null;
 const ownerShop=round?.shop?.id||round?.shopId;
 const ownerMatches=!!round&&(!ownerShop||ownerShop===shopId)&&(!round.db||round.db===db);
 const allPackages=read('imports','SELECT id,at,payload FROM imports ORDER BY rowid DESC').flatMap(row=>{
  const data=parse(row.payload);if(!data||!Array.isArray(data.tasks))return [];
  const tasks=data.tasks.map((task,index)=>({task,position:index+1})).filter(x=>x.task?.shopId===shopId);
  if(!tasks.length)return [];
  const packageRound=rounds.find(r=>r.import_id===row.id)||null;
  const unique=new Set(tasks.map(x=>keyOf(x.task)||'invalid:'+row.id+':'+x.position));
  const validIdentity=tasks.every(x=>keyOf(x.task))&&unique.size===tasks.length;
  const executionSupported=!!(ownerMatches&&packageRound&&currentRound?.id===packageRound.id&&packageRound.manifest_hash&&validIdentity);
  return [{id:row.id,name:clean(basename(data.workbook||data.name||'导入资料包')),at:row.at,total:unique.size,sourceRows:tasks.length,sheet:clean(data.sheet||''),roundId:packageRound?.id||null,manifestHash:packageRound?.manifest_hash||null,executionSupported,
   reason:!validIdentity?'资料包的商品身份缺失或重复；请先核对原始资料。':!packageRound?'尚未建立与此资料包绑定的固定清单；当前可查看资料和历史任务。':!executionSupported?'此资料包的原轮次不属于当前执行入口；请查看原轮次详情。':'执行仍须通过现有范围、资料、店铺与预算检查。',_tasks:tasks,_data:data}];
 });
 const selected=importId?allPackages.find(p=>p.id===importId):allPackages.find(p=>p.id===currentRound?.import_id)||allPackages[0]||null;
 if(importId&&!selected)throw Object.assign(Error('资料包不存在或不属于所选店铺'),{code:'OPERATIONS_PACKAGE_NOT_FOUND'});
 const publicPackage=({_tasks,_data,...p})=>p;
 const counts=Object.fromEntries(OPERATIONS_STATUSES.map(s=>[s,0]));
 const response={at:new Date().toISOString(),shopId,packages:allPackages.map(publicPackage),selectedPackage:selected?publicPackage(selected):null,items:[],counts,total:0,needsData:0};
 if(!selected)return response;

 const rawRuns=read('runs','SELECT id,key,batch,task,mode,state,checkpoint,result,reason,at FROM runs ORDER BY rowid DESC');
 const runs=rawRuns.map(r=>({...r,task:parse(r.task),checkpoint:parse(r.checkpoint)||{},result:parse(r.result)})).filter(r=>r.task?.shopId===shopId&&keyOf(r.task)===r.key);
 const runsById=new Map(runs.map(r=>[r.id,r])),runsByKey=grouped(runs,r=>r.key);
 const queues=read('batch_items','SELECT id,batch,key,task,state,run_id,attempts,max_attempts,reason,result FROM batch_items ORDER BY rowid DESC').map(q=>({...q,task:parse(q.task),result:parse(q.result)})).filter(q=>q.task?.shopId===shopId&&keyOf(q.task)===q.key);
 const queuesById=new Map(queues.map(q=>[q.id,q])),queuesByKey=grouped(queues,q=>q.key);
 const history=new Map(read('history','SELECT key,payload FROM history').map(h=>[h.key,parse(h.payload)]));
 const roundItems=read('round_items','SELECT i.* FROM round_items i JOIN rounds r ON r.id=i.round_id WHERE r.shop=? ORDER BY r.rowid DESC,i.position',[shopId]).map(i=>({...i,task:parse(i.task),result:parse(i.result)}));
 const itemsByKey=grouped(roundItems,x=>x.key);
 const windows=tables.has('round_window_items')?read('round_windows','SELECT w.id,w.round_id,w.sequence,w.state,w.at,w.finished,i.key FROM round_windows w JOIN round_window_items i ON i.window_id=w.id WHERE w.shop=? ORDER BY w.rowid DESC',[shopId]):[];
 const windowsByItem=grouped(windows,w=>w.round_id+'\0'+w.key);
 const submittedRuns=new Set(read('events',"SELECT DISTINCT run FROM events WHERE kind IN ('SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED')").map(e=>e.run));
 const selectedRows=new Map();
 for(const source of selected._tasks){const key=keyOf(source.task)||'invalid:'+selected.id+':'+source.position;const old=selectedRows.get(key);if(old)old.positions.push(source.position);else selectedRows.set(key,{...source,key,positions:[source.position]});}

 response.items=[...selectedRows.values()].map(source=>{
  const related=itemsByKey.get(source.key)||[];
  const held=related.find(contentHeld);
  const item=held||related.find(i=>i.round_id===selected.roundId)||related[0]||null;
  const parent=item?roundsById.get(item.round_id):null;
  const candidateQueue=item?.queue_id?queuesById.get(item.queue_id):queuesByKey.get(source.key)?.[0]||null;
  const queue=candidateQueue?.key===source.key?candidateQueue:null;
  const runId=item?.run_id||queue?.run_id;
  const candidateRun=runId?runsById.get(runId):runsByKey.get(source.key)?.[0]||null;
  const run=candidateRun?.key===source.key?candidateRun:null;
  const completed=history.has(source.key)?history.get(source.key)||{}:null;
  const task=item?.task&&keyOf(item.task)===source.key?item.task:source.task;
  const issues=[...new Set([...array(source.task.adapterIssues),...array(task.adapterIssues)].map(clean))];
  if(!keyOf(source.task))issues.push('商品缺少有效店铺或目的地身份，不能生成执行任务');
  if(source.positions.length>1)issues.push('同一资料包内商品身份重复，已合并显示；请核对原始行 '+source.positions.join('、'));
  if(item?.state==='PREFLIGHT_SKIPPED'&&item.reason&&!issues.includes(clean(item.reason)))issues.push(clean(item.reason));
  const associationMismatch=!!(item&&(keyOf(item.task)!==source.key||item.run_id&&(!run||run.key!==source.key)||item.queue_id&&(!queue||queue.key!==source.key)))||!!(queue?.run_id&&(!run||run.key!==source.key));
  const submitted=!!(item?.submitted||item?.submission_uncertain||submittedRuns.has(run?.id)||run?.checkpoint?.itemId||unknown(run?.state)||evidence(item?.result)||evidence(run?.result)||evidence(queue?.result));
  const active=!!(parent&&round?.active===parent.id&&parent.current_item===source.key);
  let state=classify({item,run,queue,history:completed,held,issues,submitted,active});
  if(associationMismatch)state={status:'VERIFY',reason:'商品与原轮次、队列或执行记录的身份映射不一致；请先核对原记录'};
  const assignment=parent?windowsByItem.get(parent.id+'\0'+source.key)?.[0]:null;
  const attempts=queue?(Number.isInteger(queue.attempts)&&queue.attempts>=0?queue.attempts:null):0,maxAttempts=Number.isInteger(queue?.max_attempts)&&queue.max_attempts>0?queue.max_attempts:null;
  const budgetAvailable=attempts!==null&&maxAttempts!==null&&attempts<maxAttempts;
  const retryEligible=state.status==='RETRYABLE'&&!submitted&&!issues.length&&!associationMismatch&&budgetAvailable;
  const retryReason=state.status!=='RETRYABLE'?'':submitted?'已有提交证据，只能核验原商品':issues.length?'先核对原资料问题':maxAttempts===null||attempts===null?'尚无可确认的重试预算；请查看原任务处理条件':!budgetAvailable?'已达到原队列尝试上限；是否满足既有额外恢复条件须由原详情入口核对':'剩余预算仅供参考；原详情入口仍须检查全部恢复条件';
  let stage=clean(item?.failure_stage||run?.checkpoint?.step||'');
  if(active&&round.currentOperation?.roundId===parent.id&&round.currentOperation.key===source.key&&round.currentOperation.stage!=='source-execution')stage=clean(round.currentOperation.stage);
  if(state.status==='VERIFIED')stage=item?.state==='EXISTING_VERIFIED'?'existing-verified':'platform-verified';
  const rawResult=state.status==='VERIFIED'&&!item?[completed,run?.result,queue?.result].find(evidence):item?.result||run?.result||completed||queue?.result;
  const result=resultView(rawResult);
  const historyRows=[];
  for(const old of related){const w=windowsByItem.get(old.round_id+'\0'+source.key)?.[0];historyRows.push({kind:'round',roundId:old.round_id,windowId:w?.id||null,runId:old.run_id||null,queueId:old.queue_id||null,status:old.state,reason:clean(old.reason),stage:clean(old.failure_stage),at:old.updated||null,result:resultView(old.result)});}
  for(const old of runsByKey.get(source.key)||[])historyRows.push({kind:'run',runId:old.id,importId:old.batch,status:old.state,reason:clean(old.reason),stage:clean(old.checkpoint?.step),at:old.at,result:resultView(old.result)});
  if(completed)historyRows.push({kind:'platform-result',status:evidence(completed)?'VERIFIED':'VERIFY',result:resultView(completed)});
  const detail=parent&&assignment?{roundId:parent.id,windowId:assignment.id,key:source.key}:null;
  const updated=[item?.updated,run?.at].find(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))||null;
  const frozenImportId=parent?.import_id||null;
  return {key:source.key,position:item?.position||source.position,country:clean(task.listing?.country),destination:clean(task.listing?.city||task.listing?.country),title:clean(task.listing?.title),
   source:{name:selected.name,sheet:clean(source.task.source?.sheet||selected.sheet),row:source.task.source?.row??null,positions:source.positions,importId:selected.id,importedAt:selected.at},importId:selected.id,
   roundId:parent?.id||null,windowId:assignment?.id||null,runId:run?.id||null,queueId:queue?.id||null,batchId:queue?.batch||item?.batch_id||null,updated,frozenImportId,usesPriorSnapshot:!!frozenImportId&&frozenImportId!==selected.id,
   status:state.status,statusLabel:labels[state.status],sourceStatus:item?.state||run?.state||queue?.state||null,reason:state.reason,stage,issues,dataStatus:issues.length||item?.state==='PREFLIGHT_SKIPPED'?'NEEDS_DATA':'IMPORT_VALIDATED',
   result,itemId:result?.itemId||null,url:result?.url||null,attempts,maxAttempts,retryEligible,retryReason,submitted,contentHold:!!held,detail,history:historyRows};
 });
 for(const item of response.items)counts[item.status]++;
 response.total=response.items.length;
 response.needsData=response.items.filter(x=>x.dataStatus==='NEEDS_DATA').length;
 return response;
}
