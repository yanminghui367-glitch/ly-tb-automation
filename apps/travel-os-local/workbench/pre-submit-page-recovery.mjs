// A single, durable fresh-page recovery inside the original claim. The old
// page remains retained until replacement binding and exact disposal checks pass.
import {lstat,realpath,open} from 'node:fs/promises';
import {isAbsolute,resolve,relative,dirname,basename,sep} from 'node:path';
import {createHash} from 'node:crypto';
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
async function verifiedDisposalEvidence(file,root,id){
 if(typeof root!=='string'||!isAbsolute(root)||basename(resolve(root))!==id||!isAbsolute(file))return null;
 const inside=(parent,child)=>{const rel=relative(parent,child);return !!rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
 if(!inside(resolve(root),resolve(file)))return null;
 try{
  // Reject file links and directory junctions, including the artifact root's
  // ancestors; no evidence outside this run may confer a close grant.
  for(let path=resolve(file);;){if((await lstat(path)).isSymbolicLink())return null;const parent=dirname(path);if(parent===path)break;path=parent;}
  const [realRoot,realFile]=await Promise.all([realpath(root),realpath(file)]);if(!inside(realRoot,realFile))return null;
  const handle=await open(file,'r');try{const before=await handle.stat();if(!before.isFile()||before.size===0)return null;
   const bytes=await handle.readFile(),after=await handle.stat();if(!bytes.length||before.size!==bytes.length||after.size!==before.size||after.mtimeMs!==before.mtimeMs)return null;
   return {sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  }finally{await handle.close();}
 }catch{return null;}
}

// This is a close grant for the exact replaced pre-submit page, never a general
// failure-page cleanup. Store evidence and new-page binding must precede it.
export async function disposeRecoveredPreSubmitPage({store,id,task,hash,oldPage,newPage,oldUrl,context,ledger,guard,readProtection,visibleChallenge,recoveryField,evidenceRoot}){
 if(!['navigationPageRecovery','residualPageRefill'].includes(recoveryField))fail('PRE_SUBMIT_DISPOSAL_RECORD_INVALID：恢复类型不匹配，保留旧页');
 const recovery=store.run(id).checkpoint[recoveryField],taskHash=hash(task);let evidenceProof=null;
 const audit=(disposition,reason)=>{const data={recoveryField,oldTargetId:recovery?.oldTargetId||null,newTargetId:recovery?.newTargetId||null,disposition,reason,evidence:evidenceProof};store.event(id,'PRE_SUBMIT_RECOVERY_DISPOSITION',data);return {closed:disposition==='CLOSED',reason};};
 if(!ledger?.beginRecoveredClose)return audit('RETAINED','CLOSE_GRANT_UNAVAILABLE');
 if(typeof visibleChallenge!=='function')fail('PRE_SUBMIT_DISPOSAL_CHALLENGE_CHECK_REQUIRED：旧页验证检测不可用，保留现场');
 const evidence=recovery?.screenshot||store.events(id).findLast(e=>e.kind==='STEP_PAUSED'&&e.payload?.name==='open-new-form'&&e.payload?.attemptId===recovery?.attemptId)?.payload?.screenshot;
 if(typeof evidence!=='string'||!evidence)return audit('RETAINED','RECOVERY_EVIDENCE_UNAVAILABLE');
 evidenceProof=await verifiedDisposalEvidence(evidence,evidenceRoot,id);if(!evidenceProof)return audit('RETAINED','RECOVERY_EVIDENCE_FILE_UNVERIFIED');
 let navigated=false;const newUrl=newPage.url(),moved=()=>{navigated=true;};oldPage.on?.('framenavigated',moved);newPage.on?.('framenavigated',moved);
 const safe=()=>{
  const run=store.run(id),current=run.checkpoint[recoveryField],events=store.events(id);
  if(run.state!=='RUNNING'||hash(run.task)!==taskHash||hash(current)!==hash(recovery)||recovery?.status!=='BOUND'||recovery.count!==1)
   fail('PRE_SUBMIT_DISPOSAL_RECOVERY_CHANGED：恢复记录或原任务已变化，保留旧页');
  if(run.result||run.checkpoint.itemId||run.checkpoint.successUrl||run.checkpoint.reconciliation||store.completed(task)||events.some(e=>submissionKinds.has(e.kind)||e.kind==='STEP_INTENT'&&e.payload?.name==='submit-once'))
   fail('PRE_SUBMIT_DISPOSAL_SUBMISSION_PROTECTED：存在提交或结果证据，保留旧页');
  if(navigated||oldPage.isClosed()||newPage.isClosed()||oldPage.url()!==oldUrl||newPage.url()!==newUrl)fail('PRE_SUBMIT_DISPOSAL_PAGE_CHANGED：恢复页面已变化，保留旧页');
  const old=ledger.describe(oldPage),fresh=ledger.describe(newPage);
  if(!old?.owned||old.scope?.runId!==id||old.scope?.taskHash!==taskHash||old.targetId!==recovery.oldTargetId||!fresh?.owned||fresh.scope?.runId!==id||fresh.scope?.taskHash!==taskHash||fresh.targetId!==recovery.newTargetId)
   fail('PRE_SUBMIT_DISPOSAL_OWNERSHIP_UNVERIFIED：恢复页面归属未确认，保留旧页');
  ledger.assertHealthy();
 };
 const target=async page=>{let session;try{session=await context.newCDPSession(page);return (await session.send('Target.getTargetInfo')).targetInfo;}finally{await session?.detach();}};
 try{
  safe();await guard(oldPage);safe();
  if(await visibleChallenge(oldPage))fail('PAUSED_CAPTCHA');
  const first=await readProtection(oldPage),oldIdentity=await target(oldPage),freshIdentity=await target(newPage);safe();
  if(first.status!=='unpinned'||first.pageTargetId!==recovery.oldTargetId||oldIdentity?.type!=='page'||freshIdentity?.type!=='page'||oldIdentity?.targetId!==recovery.oldTargetId||freshIdentity?.targetId!==recovery.newTargetId||!oldIdentity.browserContextId||oldIdentity.browserContextId!==freshIdentity.browserContextId)
   return audit('RETAINED','RECOVERY_PROTECTION_UNVERIFIED');
  await guard(oldPage);safe();if(await visibleChallenge(oldPage))fail('PAUSED_CAPTCHA');
  const last=await readProtection(oldPage),finalIdentity=await target(oldPage),finalFreshIdentity=await target(newPage);safe();
  if(last.status!=='unpinned'||last.pageTargetId!==first.pageTargetId||last.tabTargetId!==first.tabTargetId||hash(finalIdentity)!==hash(oldIdentity)||hash(finalFreshIdentity)!==hash(freshIdentity))
   return audit('RETAINED','RECOVERY_PROTECTION_CHANGED');
  const finalEvidence=await verifiedDisposalEvidence(evidence,evidenceRoot,id);safe();
  if(!finalEvidence||hash(finalEvidence)!==hash(evidenceProof))return audit('RETAINED','RECOVERY_EVIDENCE_FILE_CHANGED');
  const ticket=ledger.beginRecoveredClose(oldPage,{replacementPage:newPage,oldTargetId:recovery.oldTargetId,newTargetId:recovery.newTargetId,runId:id,taskHash,evidencePersisted:true,submissionAbsent:true,unpinnedConfirmed:true,guardPassed:true});
  try{await oldPage.close({runBeforeUnload:false});}catch{ledger.finishClose(ticket,{closed:false});return audit('RETAINED','RECOVERY_CLOSE_FAILED');}
  const result=ledger.finishClose(ticket,{closed:oldPage.isClosed()});return audit(result.closed?'CLOSED':'RETAINED',result.closed?'RECOVERY_REPLACED':result.reason);
 }catch(error){
  const code=String(error?.code||error?.message||'DISPOSAL_CHECK_FAILED').match(/^[A-Z][A-Z0-9_]+/)?.[0]||'DISPOSAL_CHECK_FAILED';
  audit(oldPage.isClosed()?'UNCERTAIN':'RETAINED',code);throw error;
 }finally{oldPage.off?.('framenavigated',moved);newPage.off?.('framenavigated',moved);}
}

export async function recoverPreSubmitNavigation({error,store,id,task,taskHash,hash,page,getPage,createdThisExecution,
 context,ledger,guard,readProtection,visibleChallenge,evidenceRoot,checkpoint,attemptId,open,now=()=>new Date().toISOString()}){
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
 await disposeRecoveredPreSubmitPage({store,id,task,hash,oldPage:page,newPage:result,oldUrl,context,ledger,guard,readProtection,visibleChallenge,evidenceRoot,recoveryField:'navigationPageRecovery'});
 return result;
}
