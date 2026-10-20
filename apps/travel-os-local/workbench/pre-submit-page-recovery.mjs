// A single, durable fresh-page recovery inside the original claim. The old
// page is retained: the page ledger deliberately has no pre-submit close grant.
const submissionKinds=new Set(['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']);
const readinessCodes=new Set(['SAFE_RETRY_MAIN_IMAGE_STATE','SAFE_RETRY_MAIN_PANEL','SAFE_RETRY_DETAIL_PANEL',
 'SAFE_RETRY_DETAIL_UPLOAD_ENTRY','SAFE_RETRY_DETAIL_UPLOAD_PANEL','SAFE_RETRY_DETAIL_UPLOAD_RECEIPT','SAFE_RETRY_DETAIL_MATERIAL']);
export const recoverableMaterialReadiness=error=>readinessCodes.has(error?.code);
export const navigationTimeout=error=>error?.name==='TimeoutError'&&/^page\.goto: Timeout \d+ms exceeded\b/.test(error.message||'');
const fail=message=>{throw Error(message);};
const entryUrl=value=>{
 if(value==='about:blank')return true;
 try{const u=new URL(value);return u.origin==='https://upload.taobao.com'&&u.pathname==='/auction/sell.jhtml'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}
};

export async function recoverPreSubmitNavigation({error,store,id,task,taskHash,hash,page,getPage,createdThisExecution,
 context,ledger,guard,readProtection,checkpoint,attemptId,open,now=()=>new Date().toISOString()}){
 if(!navigationTimeout(error)||!createdThisExecution||!page)throw error;
 const oldUrl=page.url();if(!entryUrl(oldUrl))throw error;
 const safeRun=()=>{
  const run=store.run(id),events=store.events(id);
  if(run.state!=='RUNNING'||hash(run.task)!==taskHash)fail('PRE_SUBMIT_RECOVERY_TASK_CHANGED：原任务状态或资料已变化');
  if(run.result||run.checkpoint.itemId||run.checkpoint.successUrl||run.checkpoint.reconciliation||store.completed(task)||
   events.some(e=>submissionKinds.has(e.kind)||e.kind==='STEP_INTENT'&&e.payload?.name==='submit-once'))fail('PRE_SUBMIT_RECOVERY_SUBMISSION_PROTECTED：存在提交或结果证据，保留现场');
  ledger.assertHealthy();return run;
 };
 const before=()=>{
  const run=safeRun();if(run.checkpoint.navigationPageRecovery||run.checkpoint.residualPageRefill)throw error;
  const owned=ledger.describe(page);
  if(getPage()!==page||page.isClosed()||page.url()!==oldUrl||!owned?.owned||owned.state!=='created'||owned.purpose!=='publish-form'||owned.scope?.runId!==id||owned.scope?.taskHash!==taskHash)
   fail('PRE_SUBMIT_RECOVERY_OWNERSHIP_UNVERIFIED：页面归属或保留状态未通过核验');
 };
 const identity=async p=>{
  let session;try{session=await context.newCDPSession(p);const info=(await session.send('Target.getTargetInfo'))?.targetInfo;
   if(info?.type!=='page'||!(/^[\w-]{1,256}$/).test(info.targetId||'')||!(/^[\w-]{1,256}$/).test(info.browserContextId||''))fail('PRE_SUBMIT_RECOVERY_IDENTITY_UNAVAILABLE：页面身份未确认');
   return {targetId:info.targetId,browserContextId:info.browserContextId};
  }finally{await session?.detach();}
 };
 before();await guard(page);before();
 const oldIdentity=await identity(page),first=await readProtection(page);
 if(first.status!=='unpinned'||first.pageTargetId!==oldIdentity.targetId||ledger.describe(page).targetId!==oldIdentity.targetId)
  fail('PRE_SUBMIT_RECOVERY_PAGE_PROTECTED：页面被固定或保护状态未确认');
 await guard(page);before();
 const last=await readProtection(page),finalIdentity=await identity(page);
 if(last.status!=='unpinned'||last.pageTargetId!==first.pageTargetId||last.tabTargetId!==first.tabTargetId||hash(finalIdentity)!==hash(oldIdentity))
  fail('PRE_SUBMIT_RECOVERY_PROTECTION_CHANGED：页面保护或身份发生变化');
 before();
 const reserved={count:1,status:'RESERVED',attemptId,at:now(),reason:'OPEN_NEW_FORM_NAVIGATION_TIMEOUT',oldTargetId:oldIdentity.targetId,newTargetId:null,attemptsPreserved:true,oldPageRetained:true};
 store.transaction(()=>{before();checkpoint({formUrl:null,refillPageTargetId:null,navigationPageRecovery:reserved});store.event(id,'PRE_SUBMIT_PAGE_RECOVERY',reserved);});
 ledger.retain(page,{reason:'PRE_SUBMIT_NAVIGATION_TIMEOUT'});
 let newIdentity,newPage;
 // No catch/retry around this second open. Its original error path is retained.
 const result=await open(async(p,ownership={})=>{
  safeRun();if(!ownership.createdThisExecution||p===page)fail('PRE_SUBMIT_RECOVERY_PAGE_NOT_NEW：必须创建新发布页');
  const owned=ledger.describe(p);newIdentity=await identity(p);
  if(newIdentity.targetId===oldIdentity.targetId||newIdentity.browserContextId!==oldIdentity.browserContextId||!owned?.owned||owned.state!=='created'||owned.purpose!=='publish-form'||owned.scope?.runId!==id||owned.scope?.taskHash!==taskHash||owned.targetId!==newIdentity.targetId)
   fail('PRE_SUBMIT_RECOVERY_OWNERSHIP_UNVERIFIED：新页归属未通过核验');
  newPage=p;
 });
 safeRun();await guard(result);safeRun();
 if(result!==newPage||getPage()!==newPage||result.isClosed()||hash(await identity(result))!==hash(newIdentity))fail('PRE_SUBMIT_RECOVERY_PAGE_CHANGED：新页身份已变化');
 const bound={...reserved,status:'BOUND',newTargetId:newIdentity.targetId,boundAt:now()};
 store.transaction(()=>{safeRun();checkpoint({formUrl:result.url(),refillPageTargetId:newIdentity.targetId,navigationPageRecovery:bound});store.event(id,'PRE_SUBMIT_PAGE_RECOVERY',bound);});
 return result;
}
