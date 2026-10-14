import {readItemCandidates} from './round-item-candidates.mjs';
// Isolated candidate adapter for the existing server's network-restricted API.
// Existing network/Origin checks do not authenticate an operator account.
// Mount only behind its existing origin, access and removed-shop guards.
// Does not own a browser, execution queue, worker or database.
import {RoundItemVerifyApi} from './round-item-verify-api.mjs';
import {RoundItemRetryApi} from './round-item-retry-api.mjs';
const prefix='/api/v1/rounds/';
const explanations={
 ITEM_HOST_NOT_CONFIGURED:'单条操作尚未完成服务接入，暂不能使用。',
 ITEM_HOST_SCOPE_MISMATCH:'单条操作与当前执行器归属不一致，暂不能使用。',
 ITEM_HOST_SHOP_REMOVED:'执行店铺已移除，当前只可查看历史记录。',
 ITEM_HOST_CONFIG_BUSY:'正在读取设置或核验商品，请等待完成后操作。',
 ITEM_HOST_INTEGRITY_FAILED:'执行内核校验未通过，当前只可查看历史记录。',
 ITEM_HOST_CHECK_FAILED:'服务状态检查未完成，请刷新后重试。',
 ITEM_OWNER_BUSY:'执行器正在运行，请先安全暂停，再操作单条任务。',
 ITEM_SKIP_REQUEST_INVALID:'请填写跳过原因，并刷新任务详情后重试。',
 ITEM_SKIP_SCOPE_MISMATCH:'所选商品不属于此执行轮次，请重新选择。',
 ITEM_SKIP_RUN_MISMATCH:'任务与原执行记录尚未完成对账，暂不能操作。',
 ITEM_SKIP_QUEUE_MISMATCH:'任务与原队列尚未完成对账，暂不能操作。',
 ITEM_SKIP_EXECUTION_NOT_SETTLED:'执行器尚未停稳，请等待安全暂停后操作。',
 ITEM_SKIP_WINDOW_NOT_IDLE:'此轮次正在执行或已结束，当前不能跳过。',
 ITEM_SKIP_SUBMISSION_PROTECTED:'已有提交或商品结果证据，请先核验原商品，不能跳过。',
 ITEM_SKIP_STATE_PROTECTED:'此商品处于成功、隔离或待处理状态，不能直接跳过。',
 ITEM_SKIP_HUMAN_OR_RUN_STATE:'原执行现场仍需处理，请完成登录、验证或结果核验。',
 ITEM_SKIP_QUEUE_STATE:'原队列状态不允许跳过，请刷新并查看任务详情。',
 ITEM_SKIP_REQUEST_CONFLICT:'此操作编号已用于另一项操作，请刷新任务详情。',
 ITEM_SKIP_STALE_REVISION:'任务状态已变化，请刷新详情并重新确认。',
 ITEM_SKIP_ATTEMPT_SCOPE:'尝试记录与所选轮次不一致，请先完成对账。'
};
function issue(error){
 const raw=String(error?.code||error?.message||'');
 if(explanations[raw])return {code:raw,message:explanations[raw]};
 if(/已有执行任务或轮次|禁止第二发布者/.test(raw))return {code:'ITEM_OWNER_BUSY',message:'执行器正在运行，请先安全暂停，再操作单条任务。'};
 return {code:'ITEM_STATE_CHECK_FAILED',message:'任务范围或记录校验未通过，请查看原任务日志，暂不能操作。'};
}
function scopeFrom(url){
 const names=['roundId','windowId','key'];
 if([...url.searchParams.keys()].some(k=>!names.includes(k))||names.some(k=>url.searchParams.getAll(k).length!==1))throw Object.assign(Error('ITEM_SKIP_REQUEST_INVALID'),{code:'ITEM_SKIP_REQUEST_INVALID'});
 const s=Object.fromEntries(names.map(k=>[k,url.searchParams.get(k)]));
 if(Object.values(s).some(v=>!v||v.length>200))throw Object.assign(Error('ITEM_SKIP_REQUEST_INVALID'),{code:'ITEM_SKIP_REQUEST_INVALID'});
 return s;
}
function validateBody(value){
 const keys=['roundId','windowId','key','expectedRevision','requestId','reason'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw Object.assign(Error('ITEM_SKIP_REQUEST_INVALID'),{code:'ITEM_SKIP_REQUEST_INVALID'});
 return value;
}
export class RoundItemApi {
 constructor(action,{host=null,verifier=null,retry=null}={}){this.action=action;this.host=host;this.verification=verifier?new RoundItemVerifyApi(verifier):null;this.retry=retry?new RoundItemRetryApi(retry):null;}
 async detail(scope){
  const hostIssue=this.host?await this.host.inspect():null;
  // Read after asynchronous host checks; a stale GET never authorizes a POST.
  const a=this.action,s=a.read(scope),check=hostIssue?{allowed:false,revision:s.revision,reason:hostIssue.code}:a.inspect(scope);
  const attempts=a.attempts.list(scope.roundId,scope.key).map(v=>({
   id:v.id,parentAttemptId:v.parent_attempt_id,windowId:v.window_id,kind:v.kind,
   runId:v.run_id,taskHash:v.task_hash,repairVersion:v.repair_version,
   started:v.started_at,finished:v.finished_at,sourceEventAfter:v.source_event_after,sourceEventThrough:v.source_event_through,
   state:v.outcome?.state||null,disposition:v.outcome?.disposition||null,resultItemId:v.outcome?.result?.itemId||null,reason:v.outcome?.reason||v.outcome?.snapshot?.item?.reason||'',
   historyCoverage:v.before?.historyCoverage||'RECORDED_ATTEMPT'
  }));
  const candidates=await readItemCandidates(a.owner,s,a.attempts);
  if(a.read(scope).revision!==s.revision)throw Object.assign(Error('ITEM_SKIP_STALE_REVISION'),{code:'ITEM_SKIP_STALE_REVISION'});
  return {roundId:s.r.id,windowId:s.w.id,key:s.x.key,shopId:s.r.shop,taskHash:s.x.task_hash,candidates,
   revision:check.revision,current:s.snapshot.item,submissionEvidence:s.hasSubmit,
   windowOutcome:s.assignment.outcome||null,
   verificationControl:this.verification?.verifier.controlView(s.r.id)?.key===s.x.key&&this.verification.verifier.controlView(s.r.id)?.windowId===s.w.id?this.verification.verifier.controlView(s.r.id):null,
   // Do not claim old runs have segmented attempts or invent their timestamps.
   historyCoverage:attempts.length?'HAS_RECORDED_ATTEMPTS':'PRIOR_HISTORY_NOT_SEGMENTED',attempts,
   capabilities:{skip:{allowed:check.allowed,...(check.allowed?{code:null,reason:'尚未提交，可在此安全边界记录跳过原因。'}:{code:issue({code:check.reason}).code,reason:issue({code:check.reason}).message})},
    retry:this.retry?this.retry.capability(s,hostIssue):{allowed:false,code:'NOT_CONNECTED',reason:'单条补跑入口尚未接入。'},
    verify:this.verification?this.verification.capability(s,hostIssue):{allowed:false,code:'NOT_CONNECTED',reason:'单条核验入口尚未接入。'}}};
 }
 async handle(req,res,url,{body,json}){
  if(url.pathname===prefix+'item-retry'){
   if(this.retry)return this.retry.handle(req,res,url,{body,json});
   json(res,503,{code:'ITEM_RETRY_NOT_CONNECTED',error:'单条重试服务尚未接入。'});return true;
  }
  if(url.pathname===prefix+'item-verify'){
   if(this.verification)return this.verification.handle(req,res,url,{body,json});
   json(res,503,{code:'ITEM_VERIFY_NOT_CONNECTED',error:'单条核验服务尚未接入。'});return true;
  }
  if(![prefix+'item',prefix+'item-skip'].includes(url.pathname))return false;
  const expected=url.pathname.endsWith('item-skip')?'POST':'GET';
  if(req.method!==expected){res.setHeader('Allow',expected);json(res,405,{code:'METHOD_NOT_ALLOWED',error:'此入口不支持该请求方式。'});return true;}
  try{
   if(expected==='GET'){json(res,200,await this.detail(scopeFrom(url)));return true;}
   if(url.search)throw Object.assign(Error('ITEM_SKIP_REQUEST_INVALID'),{code:'ITEM_SKIP_REQUEST_INVALID'});
   let value;try{value=await body(req);}catch{throw Object.assign(Error('ITEM_SKIP_REQUEST_INVALID'),{code:'ITEM_SKIP_REQUEST_INVALID'});}
   const input=validateBody(value),replay=this.action.replay(input);
   // A sealed receipt is read-only. Server network/Origin boundaries still
   // apply, but disabled publishing or a removed shop cannot rewrite history.
   if(replay){json(res,200,replay);return true;}
   if(this.host){
    try{await this.host.assert();this.host.assertCurrent();}
    catch(error){
     // Another identical request may have sealed the decision during await.
     // Re-read its exact immutable receipt; changed intent still conflicts.
     const completed=this.action.replay(input);
     if(completed){json(res,200,completed);return true;}
     throw error;
    }
   }
   const receipt=this.action.skip(input);
   json(res,200,receipt);return true;
  }catch(e){const i=issue(e);json(res,i.code==='ITEM_SKIP_REQUEST_INVALID'?400:409,{code:i.code,error:i.message});return true;}
 }
}
