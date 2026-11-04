import assert from 'node:assert/strict';
import {digest} from './source-store.mjs';
import {getPageLedger} from './page-ownership.mjs';
import {isNewPublishUrl,isNewSuccessUrl} from './publishing-address.mjs';

// Read-only identity evidence. It does not restore ownership/closing authority.
function matching(row,run){
 let scope;try{scope=JSON.parse(row.scope);}catch{return false;}
 return row.origin==='executor-created'&&row.purpose==='publish-form'&&
  ['created','retained'].includes(row.state)&&row.target_id&&row.browser_context_id&&
  scope.shopId===run.task.shopId&&scope.runId===run.id&&scope.taskKey===run.key&&scope.taskHash===digest(run.task);
}
export function originalPageBinding(ledger,page,run){
 const described=ledger?.describe(page);if(!described?.owned)return null;
 const row=ledger.db.prepare('SELECT * FROM page_owner_pages WHERE id=?').get(described.id);
 if(!row||!matching(row,run))return null;
 return {pageId:row.id,sessionId:row.session_id,targetId:row.target_id,browserContextId:row.browser_context_id,runId:run.id,taskHash:digest(run.task),shopId:run.task.shopId};
}
export async function recoverOriginalReceipt({context,run,events,guard,assertUnused,db=getPageLedger(context)?.db}){
 if(!run||run.state!=='RESULT_UNKNOWN'||!isNewPublishUrl(run.checkpoint?.formUrl||''))return null;
 const start=(events||[]).findLast(e=>e.kind==='SUBMITTING');
 if(!start||(events||[]).some(e=>e.seq>start.seq&&e.kind==='VERIFIED')||!(events||[]).some(e=>e.seq>start.seq&&e.kind==='STEP_INTENT'&&e.payload?.name==='submit-once'))return null;
 if(!db||!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='page_owner_pages'").get())return null;
 const rows=db.prepare("SELECT * FROM page_owner_pages WHERE origin='executor-created' AND purpose='publish-form' AND state IN ('created','retained')").all().filter(r=>matching(r,run));
 if(rows.length!==1)return null;
 const binding=rows[0],saved=run.checkpoint.submissionPageBinding;
 if(saved)assert(saved.pageId===binding.id&&saved.sessionId===binding.session_id&&saved.targetId===binding.target_id&&saved.browserContextId===binding.browser_context_id&&saved.runId===run.id&&saved.taskHash===digest(run.task)&&saved.shopId===run.task.shopId,'SUBMISSION_RECEIPT_BINDING_CHANGED');
 const found=[];
 for(const page of context.pages()){
  if(page.isClosed())continue;let session;
  try{session=await context.newCDPSession(page);const info=(await session.send('Target.getTargetInfo'))?.targetInfo;
   if(info?.type==='page'&&info.targetId===binding.target_id&&info.browserContextId===binding.browser_context_id)found.push(page);
  }finally{await session?.detach();}
 }
 if(!found.length)return null;assert.equal(found.length,1,'SUBMISSION_RECEIPT_PAGE_AMBIGUOUS');
 const page=found[0],{assertPublishIdentity,readSubmissionReceipt}=await import('./taobao-publisher.mjs');
 await guard(page);await assertPublishIdentity(page,run.task,{submitted:true,formUrl:run.checkpoint.formUrl});
 const itemId=await readSubmissionReceipt(page,run.checkpoint.formUrl);if(!itemId)return null;
 assert(typeof assertUnused==='function','SUBMISSION_RECEIPT_CLAIM_CHECK_REQUIRED');await assertUnused(itemId);
 await guard(page);await assertPublishIdentity(page,run.task,{submitted:true,formUrl:run.checkpoint.formUrl});
 assert.equal(await readSubmissionReceipt(page,run.checkpoint.formUrl),itemId,'SUBMISSION_RECEIPT_CHANGED');
 return {itemId,runId:run.id,taskHash:digest(run.task),shopId:run.task.shopId,formUrl:run.checkpoint.formUrl,successUrl:page.url(),observedAt:new Date().toISOString(),pageId:binding.id,targetId:binding.target_id,browserContextId:binding.browser_context_id,source:'ORIGINAL_PAGE_RECEIPT',originalSubmitEvent:start.seq};
}

// Called only after the original backend result has passed its existing checks.
// The caller owns its transaction. No CLICKED time or platform state is invented.
export function recordRecoveredReceipt(store,run,result){
 const receipt=result?.submissionReceipt;if(!receipt)return;
 assert(run&&['RESULT_UNKNOWN','SUBMITTING'].includes(run.state),'SUBMISSION_RECEIPT_RUN_CHANGED');
 assert(receipt.source==='ORIGINAL_PAGE_RECEIPT'&&receipt.runId===run.id&&receipt.taskHash===digest(run.task)&&receipt.shopId===run.task.shopId&&receipt.itemId===result.itemId,'SUBMISSION_RECEIPT_SCOPE_CHANGED');
 const submit=store.events(run.id).findLast(e=>e.kind==='SUBMITTING');
 assert(submit&&submit.seq===receipt.originalSubmitEvent,'SUBMISSION_RECEIPT_INTENT_CHANGED');
 assert(Number.isFinite(Date.parse(receipt.observedAt))&&Date.parse(receipt.observedAt)>=Date.parse(submit.at),'SUBMISSION_RECEIPT_TIME_INVALID');
 assert(receipt.formUrl===run.checkpoint.formUrl&&isNewPublishUrl(receipt.formUrl),'SUBMISSION_RECEIPT_FORM_CHANGED');
 assert(isNewSuccessUrl(receipt.successUrl),'SUBMISSION_RECEIPT_URL_CHANGED');const success=new URL(receipt.successUrl);
 assert(success.searchParams.getAll('primaryId').length===1&&success.searchParams.get('primaryId')===result.itemId,'SUBMISSION_RECEIPT_ID_CHANGED');
 assert(Number.isFinite(Date.parse(result.verifiedAt))&&Date.parse(result.verifiedAt)>=Date.parse(receipt.observedAt),'SUBMISSION_RECEIPT_VERIFICATION_TIME_INVALID');
 const row=store.db.prepare('SELECT * FROM page_owner_pages WHERE id=?').get(receipt.pageId);
 assert(row&&matching(row,run)&&row.target_id===receipt.targetId&&row.browser_context_id===receipt.browserContextId,'SUBMISSION_RECEIPT_BINDING_CHANGED');
 const prior=store.events(run.id).find(e=>e.kind==='SUBMIT_EVIDENCE'&&e.payload?.source==='ORIGINAL_PAGE_RECEIPT'&&e.payload?.itemId===result.itemId&&e.payload?.originalSubmitEvent===submit.seq);
 if(!prior)store.event(run.id,'SUBMIT_EVIDENCE',{...receipt,backendVerified:true,backendVerifiedAt:result.verifiedAt});
}
