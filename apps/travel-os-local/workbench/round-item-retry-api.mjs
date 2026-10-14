const messages={
 ITEM_RETRY_REQUEST_INVALID:'重试请求不完整，请刷新任务详情。',
 ITEM_RETRY_REQUEST_CONFLICT:'操作编号已用于其他请求，请核对原处理记录。',
 ITEM_RETRY_STALE_REVISION:'任务状态已变化，请刷新后重新确认。',
 ITEM_RETRY_IN_PROGRESS:'此条正在重试，请等待原处理结果。',
 ITEM_RETRY_RECORD_RECOVERY_REQUIRED:'处理记录尚未收口，请从轮次状态区恢复原记录。',
 ITEM_RETRY_STOP_RECOVERY_REQUIRED:'原停止记录尚未保存完整，请核对上次重试结果；不会重新发布。',
 ITEM_RETRY_OPEN_ATTEMPT:'此商品还有未结束的处理记录，请先恢复原记录。',
 ITEM_RETRY_OTHER_OPEN_ATTEMPT:'还有其他未结束的处理记录，请先恢复原记录。',
 ITEM_RETRY_OTHER_RESOLUTION_REQUIRED:'请先处理原轮次的人工验证或提交结果核验。',
 ITEM_RETRY_OTHER_CHECKPOINT_OPEN:'另一条商品还有未结束断点，请先处理原商品。',
 ITEM_RETRY_OTHER_WINDOW_OPEN:'另一个轮次尚未结束，请先处理或停止该轮次。',
 ITEM_RETRY_RELEASE_GATE_REQUIRED:'首次小批验收尚未完成，请先从原轮次完成验收。',
 ITEM_RETRY_SUBMISSION_PROTECTED:'已有提交或商品结果证据，只能先核验，不能重新发布。',
 ITEM_RETRY_STATE_PROTECTED:'当前状态不允许重试，请按原问题提示处理。',
 ITEM_RETRY_RUN_PROTECTED:'原执行现场仍需人工处理或结果核验。',
 ITEM_RETRY_NOT_ATTEMPTED:'此商品尚未处理，请从原轮次开始。',
 ITEM_RETRY_BUDGET_EXHAUSTED:'原任务已达尝试次数上限，不能继续重试；原次数和记录保留。',
 ITEM_RETRY_BUDGET_EXTRA_UNSAFE:'原任务已达尝试上限，且不满足原定额外安全恢复条件；保留原次数与断点，不能继续重试。',
 ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED:'原任务已达尝试上限，尚未确认属于允许额外恢复的提交前系统故障；不能继续重试。',
 ITEM_RETRY_FAILED:'重试条件或记录校验未通过，请查看原任务详情。'
};
export const retryIssue=error=>{const raw=error?.code||error?.message,code=Object.hasOwn(messages,raw)?raw:'ITEM_RETRY_FAILED';return {code,error:messages[code]};};
export class RoundItemRetryApi {
 constructor(retry){this.retry=retry;}
 capability(s,hostIssue){
  const r=this.retry;
  try{
   const held=r.owner.executionAttempts.blocked;
   if(held)throw Object.assign(Error('ITEM_RETRY_RECORD_RECOVERY_REQUIRED'),{code:'ITEM_RETRY_RECORD_RECOVERY_REQUIRED'});
   if(hostIssue)throw Object.assign(Error(hostIssue.code),{code:hostIssue.code});
   const open=r.attempts.openFor(s.x.key)||r.attempts.list(s.r.id,s.x.key).findLast(a=>a.kind==='MANUAL_RETRY'&&a.finished_at&&[a.window_id,a.before?.request?.windowId].includes(s.w.id)&&r.needsStop(a));
   if(open?.kind==='MANUAL_RETRY'){
    const req=r.request(open.before?.request),verified=r.lookup(req);
    if(verified?.id!==open.id||req.roundId!==s.r.id||req.key!==s.x.key||![req.windowId,open.window_id].includes(s.w.id))throw Error('ITEM_RETRY_FAILED');
    return {allowed:true,mode:'RECOVER',reason:'上次重试中断，先保存原处理记录。本次不会重新发布。',request:req,executionWindowId:open.window_id};
   }
   r.allowed(s);return {allowed:true,mode:'RETRY',reason:'重新检查原资料、店铺及后台重复商品，仅重试此条，结束后暂停。'};
  }catch(e){const i=retryIssue(e);return {allowed:false,mode:null,code:i.code,reason:i.error};}
 }
 async handle(req,res,url,{body,json}){
  if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{code:'METHOD_NOT_ALLOWED',error:'此入口只接受重试请求。'});return true;}
  let input;
  try{
   if(url.search)throw Object.assign(Error('ITEM_RETRY_REQUEST_INVALID'),{code:'ITEM_RETRY_REQUEST_INVALID'});
   let value;try{value=await body(req);}catch{throw Object.assign(Error('ITEM_RETRY_REQUEST_INVALID'),{code:'ITEM_RETRY_REQUEST_INVALID'});}
   input=this.retry.request(value);json(res,200,await this.retry.retry(input));
  }catch(e){
   const i=retryIssue(e);let retainRequest=false;
   if(input){try{retainRequest=!!this.retry.lookup(input);}catch{}}
   json(res,i.code==='ITEM_RETRY_REQUEST_INVALID'?400:409,{...i,retainRequest});
  }
  return true;
 }
}
