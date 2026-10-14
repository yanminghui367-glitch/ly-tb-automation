// Isolated HTTP projection of the existing VERIFY_ONLY action, not a new executor.
import {createHash} from 'node:crypto';
import {verifyFailureCode} from './round-item-verify.mjs';
const fields=['roundId','windowId','key','expectedRevision','requestId'];
const messages={
 ITEM_VERIFY_REQUEST_INVALID:'核验请求不完整，请刷新任务详情。',
 ITEM_VERIFY_REQUEST_CONFLICT:'操作编号已用于不同的请求，请先核对原操作记录。',
 ITEM_VERIFY_STALE_REVISION:'任务状态已经变化，请刷新后重新确认核验。',
 ITEM_VERIFY_STATE_PROTECTED:'此任务当前不属于待核验状态。',
 ITEM_VERIFY_RUN_PROTECTED:'原执行记录尚不允许单条核验。',
 ITEM_VERIFY_QUEUE_PROTECTED:'原队列状态尚不允许单条核验。',
 ITEM_VERIFY_PARENT_NOT_IDLE:'请先安全暂停当前轮次，再核验原商品。',
 ITEM_VERIFY_EXECUTION_NOT_SETTLED:'原执行器尚未停稳，请等待安全暂停。',
 ITEM_VERIFY_OPEN_ATTEMPT_PROTECTED:'已有其他处理记录尚未结束，请先完成原处理。',
 ITEM_VERIFY_WINDOW_ADAPTER_REQUIRED:'原轮次未保存此商品的待核验结果，暂不能关联本次核验。',
 ITEM_VERIFY_OTHER_WINDOW_OPEN:'另一个轮次尚未结束，请先完成或安全停止该轮次，再核验历史商品。',
 ITEM_VERIFY_WINDOW_SNAPSHOT_INVALID:'历史轮次的商品快照归属未通过核对，暂不能核验。',
 ITEM_VERIFY_PERSISTENCE_BLOCKED:'核验记录未保存完整，请使用原操作恢复记录保存。',
 ITEM_VERIFY_STOP_FINALIZATION_BLOCKED:'核验结果已保存，但停止轮次尚未完成，请恢复原操作。',
 ITEM_VERIFY_IN_PROGRESS:'正在核验原商品，请等待；不会再次提交。',
 ITEM_VERIFY_RECOVER_INTERRUPTED:'上次核验中断，先整理原操作记录，再重新核验。',
 ITEM_VERIFY_RECOVER_STOP:'原停止请求尚未完成，请完成停止记录。',
 ITEM_VERIFY_FAILED:'本次未取得完整核验结果，原商品仍受保护，请查看处理记录。',
 ITEM_VERIFY_NOT_CONNECTED:'单条核验服务尚未接入。',
 ITEM_HOST_SHOP_REMOVED:'执行店铺已移除，当前只可查看历史记录。',
 ITEM_HOST_CONFIG_BUSY:'正在读取设置或核验商品，请等待完成后操作。',
 ITEM_HOST_INTEGRITY_FAILED:'执行内核校验未通过，当前只可查看历史记录。',
 ITEM_OWNER_BUSY:'执行器正在运行，请先安全暂停，再核验原商品。'
};
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=req=>createHash('sha256').update(JSON.stringify(req)).digest('hex');
const same=(req,s)=>req.roundId===s.r.id&&req.windowId===s.w.id&&req.key===s.x.key;
export function verifyIssue(error){
 const raw=error?.code||error?.message;
 const code=Object.hasOwn(messages,raw)?raw:/已有执行任务或轮次|禁止第二发布者/.test(raw||'')?'ITEM_OWNER_BUSY':'ITEM_VERIFY_FAILED';
 return {code,error:messages[code]};
}
export class RoundItemVerifyApi {
 constructor(verifier){this.verifier=verifier;}
 request(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==fields.length||fields.some(k=>!Object.hasOwn(body,k)))fail('ITEM_VERIFY_REQUEST_INVALID');
  return this.verifier.request(body);
 }
 storedRequest(attempt,s){
  const req=this.request(attempt.before?.request);
  if(attempt.kind!=='VERIFY_ONLY'||attempt.round_id!==s.r.id||attempt.window_id!==s.w.id||attempt.key!==s.x.key||attempt.task_hash!==s.x.task_hash||!same(req,s)||attempt.request_id!=='verify-only:'+req.requestId||attempt.before.requestIntent!==digest(req))fail('ITEM_VERIFY_OPEN_ATTEMPT_PROTECTED');
  return req;
 }
 capability(s,hostIssue){
  const v=this.verifier;
  try{
   const held=v.persistenceBlocked||v.stopFinalizationBlocked;
   if(held){
    if(!same(held,s))fail('ITEM_OWNER_BUSY');
    v.owned(held,{allowPause:true});
    const a=v.attempts.list(s.r.id,s.x.key).find(a=>a.request_id==='verify-only:'+held.requestId);if(!a)fail('ITEM_VERIFY_OPEN_ATTEMPT_PROTECTED');
    const req=this.storedRequest(a,s),code=v.persistenceBlocked?'ITEM_VERIFY_PERSISTENCE_BLOCKED':'ITEM_VERIFY_STOP_FINALIZATION_BLOCKED';
    return {allowed:true,mode:'RECOVER',code,reason:messages[code],request:req};
   }
   const attempts=v.attempts.list(s.r.id,s.x.key).filter(a=>a.kind==='VERIFY_ONLY'&&a.window_id===s.w.id);
   const last=attempts.at(-1);
   if(last&&!last.finished_at){
    const req=this.storedRequest(last,s);
    if(hostIssue)throw Object.assign(Error(hostIssue.code),{code:hostIssue.code});
    v.allowed(s);
    return {allowed:true,mode:'RECOVER',code:'ITEM_VERIFY_RECOVER_INTERRUPTED',reason:messages.ITEM_VERIFY_RECOVER_INTERRUPTED,request:req};
   }
   if(last){
    const req=this.storedRequest(last,s);
    if(v.needsStop(req)){
     if(hostIssue)throw Object.assign(Error(hostIssue.code),{code:hostIssue.code});
     return {allowed:true,mode:'RECOVER',code:'ITEM_VERIFY_RECOVER_STOP',reason:messages.ITEM_VERIFY_RECOVER_STOP,request:req};
    }
   }
   if(hostIssue)throw Object.assign(Error(hostIssue.code),{code:hostIssue.code});
   v.allowed(s);return {allowed:true,mode:'VERIFY',code:null,reason:'只核验原商品，不重新提交，也不启动下一条。'};
  }catch(error){const i=verifyIssue(error);return {allowed:false,mode:null,code:i.code,reason:i.error};}
 }
 async handle(req,res,url,{body,json}){
  if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{code:'METHOD_NOT_ALLOWED',error:'此入口只接受核验请求。'});return true;}
  let input;
  const envelope=receipt=>({...receipt,outcome:{...receipt.outcome,...(receipt.outcome?.code?{code:verifyFailureCode({code:receipt.outcome.code})}:{})},roundId:input.roundId,windowId:input.windowId,key:input.key,requestId:input.requestId});
  try{
   if(url.search)fail('ITEM_VERIFY_REQUEST_INVALID');
   let value;try{value=await body(req);}catch{fail('ITEM_VERIFY_REQUEST_INVALID');}
   input=this.request(value);
   const receipt=await this.verifier.verify(input);json(res,200,envelope(receipt));
  }catch(error){
   const v=this.verifier;
   // A failed check can still have an immutable UNRESOLVED receipt. Read it,
   // never silently start a new attempt or retry a failed disk/stop operation.
   if(input&&!v.persistenceBlocked&&!v.stopFinalizationBlocked){
    try{const receipt=v.sealed(input);if(receipt&&!v.needsStop(input)){json(res,200,envelope(receipt));return true;}}catch{}
   }
   const held=v.persistenceBlocked||v.stopFinalizationBlocked;
   const i=verifyIssue(error),retain=!!(input&&held&&digest(input)===digest(held));
   json(res,i.code==='ITEM_VERIFY_REQUEST_INVALID'?400:409,{...i,retainRequest:retain});
  }
  return true;
 }
}
