import {isNewSuccessUrl} from './publishing-address.mjs';
// Quiet, exact page bindings within the browser owner. No new browser, profile,
// credentials, foreground activation, or fallback to an arbitrary active tab.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {visibleChallenge} from './browser-environment.mjs';
import {readPageProtection} from './page-protection.mjs';
import {getPageLedger} from './page-ownership.mjs';

const roles=new WeakMap();
const backgroundPages=new WeakSet(),auxiliaryPages=new WeakSet();
export function isAuxiliaryPage(page,role){
 if(page.isClosed())return false;
 try{
  const u=new URL(page.url());
  if(role==='material')return u.origin==='https://qn.taobao.com' && u.pathname.replace(/\/$/,'')==='/home.htm/material-center/mine-material/sucai-tu';
  if(role==='verification')return ['https://myseller.taobao.com','https://qn.taobao.com'].includes(u.origin) && !u.username && !u.password && u.pathname.startsWith('/home.htm/SellManage/');
 }catch{}
 return false;
}
export function assertAuxiliaryPage(page,role){
 assert(isAuxiliaryPage(page,role),'辅助页面已关闭或地址改变，请保留原素材库/商品核验页后重试');
}

export async function createBackgroundPage(context,{timeout=10000,purpose='publish-form',check=()=>{}}={}){
 check();
 const before=new Set(context.pages());
 const anchor=[...before].find(p=>!p.isClosed());
 assert(anchor,'执行浏览器没有可用页面，请先连接店铺');
 const control=await context.newCDPSession(anchor);
 const ledger=getPageLedger(context);let reservation,bound=false;
 try{
  check();
  if(ledger)reservation=ledger.reserveCreation({purpose});
  const {targetInfo}=await control.send('Target.getTargetInfo');
  check();
  const params={url:'about:blank',background:true};
  if(targetInfo.browserContextId)params.browserContextId=targetInfo.browserContextId;
  const {targetId}=await control.send('Target.createTarget',params);
  check();
  assert(targetId,'后台页面创建失败；已停止，不切换其他页面');
  const deadline=Date.now()+timeout;
  do{
   check();
   for(const page of context.pages().filter(p=>!before.has(p)&&!p.isClosed())){
    const session=await context.newCDPSession(page);
    try{const info=(await session.send('Target.getTargetInfo')).targetInfo;check();if(info.targetId===targetId){
     if(ledger)ledger.bindCreated(reservation,page,{targetId,browserContextId:info.browserContextId||null});
     bound=true;backgroundPages.add(page);return page;
    }}
    finally{await session.detach().catch(()=>{});}
   }
   await delay(50);
  }while(Date.now()<deadline);
  throw Error('后台页面未能唯一绑定；已停止，不切换其他页面');
 }catch(error){
  if(ledger&&reservation&&!bound)ledger.creationFailed(reservation);
  throw error;
 }finally{await control.detach().catch(()=>{});}
}

export async function getAuxiliaryPage(context,{role,shopId,url,guard,deadline,signal}){
 const check=()=>assert(!signal?.aborted&&(deadline===undefined||Date.now()<deadline),'辅助页只读确认已超时，停止后续页面操作');
 const budget=maximum=>{check();return deadline===undefined?maximum:Math.max(1,Math.min(maximum,deadline-Date.now()));};
 check();
 assert(['material','verification'].includes(role)&&shopId,'辅助页面缺少店铺或用途');
 assert(isAuxiliaryPage({isClosed:()=>false,url:()=>url},role),'辅助页面入口不匹配');
 let pool=roles.get(context);if(!pool){pool=new Map();roles.set(context,pool);}
 const key=shopId+':'+role;
 let page=pool.get(key);
 if(page?.isClosed()){pool.delete(key);page=null;}
 if(!page){
  const candidates=context.pages().filter(p=>isAuxiliaryPage(p,role));
  // Multiple restored tabs may contain unfinished work. Do not guess which one
  // to take over: create one owned background helper and reuse it thereafter.
  page=candidates.length===1?candidates[0]:await createBackgroundPage(context,{purpose:role+'-helper',timeout:budget(10000),check});
  check();
  auxiliaryPages.add(page);
  pool.set(key,page);
  if(page.url()==='about:blank')await page.goto(url,{waitUntil:'domcontentloaded',timeout:budget(30000)});
 }
 // A user-navigated page is never forced back to its previous URL.
 check();await guard(page);check();assertAuxiliaryPage(page,role);
 getPageLedger(context)?.lease(page,{purpose:role+'-helper'});
 return page;
}

// Cleanup is deliberately separate from publishing. The caller must have both
// persisted VERIFIED/history and retained a per-execute flag from the actual
// create branch (never a checkpoint flag from a previous execution).
export async function closeVerifiedOwnedPage(page,{createdThisExecution=false,verifiedPersisted=false,itemId,successUrl}={},guard){
 const ledger=page?.context?getPageLedger(page.context()):null;
 const keep=reason=>{
  if(ledger?.describe(page)?.owned&&!page.isClosed())ledger.retain(page,{reason});
  return {closed:false,reason};
 };
 if(createdThisExecution!==true||verifiedPersisted!==true)return keep('UNVERIFIED_OR_RESTORED_PAGE');
 if(!page||!backgroundPages.has(page)||auxiliaryPages.has(page))return keep('PAGE_NOT_OWNED_PUBLISH_FORM');
 if(page.isClosed())return keep('PAGE_ALREADY_CLOSED');
 if(typeof itemId!=='string'||!/^\d+$/.test(itemId)||typeof successUrl!=='string')return keep('SUCCESS_ID_OR_URL_MISSING');
 let url;try{url=new URL(successUrl);}catch{return keep('SUCCESS_URL_INVALID');}
 if(!isNewSuccessUrl(url.href)||url.searchParams.getAll('primaryId').length!==1||url.searchParams.get('primaryId')!==itemId)return keep('NOT_MATCHING_SUCCESS_PAGE');
 if(typeof guard!=='function')return keep('CLEANUP_GUARD_REQUIRED');
 if(ledger)ledger.markVerified(page,{verifiedPersisted,itemId});
 let navigated=false;
 const onNavigation=()=>{navigated=true;};
 page.on('framenavigated',onNavigation);
 try{
  const matches=async()=>{
   if(navigated||page.isClosed()||page.url()!==successUrl)return false;
   const text=await page.locator('body').innerText({timeout:3000});
   const ids=[...text.matchAll(/商品ID[：:]\s*(\d+)/g)].map(m=>m[1]);
   return !navigated&&!page.isClosed()&&page.url()===successUrl&&/商品提交成功/.test(text)&&ids.length===1&&ids[0]===itemId;
  };
  if(!await matches())return keep('SUCCESS_PAGE_CHANGED');
  await guard(page);
  if(await visibleChallenge(page))return keep('CHALLENGE_PRESENT');
  const firstProtection=await readPageProtection(page);
  if(firstProtection.status!=='unpinned')return keep(firstProtection.status==='pinned'?'PINNED_PAGE':'PAGE_PROTECTION_UNKNOWN');
  // `tabActive` only says this is Chrome's selected tab. Playwright-created
  // publisher tabs can be selected automatically; ownership, exact success
  // evidence and the guards below determine whether this executor may close it.
  // Recheck after all asynchronous guards: never close a tab navigated by the
  // user while account checks or DOM reads were in progress.
  if(!await matches())return keep('SUCCESS_PAGE_CHANGED');
  const finalProtection=await readPageProtection(page);
  if(finalProtection.status!=='unpinned')return keep(finalProtection.status==='pinned'?'PINNED_PAGE':'PAGE_PROTECTION_UNKNOWN');
  if(firstProtection.pageTargetId!==finalProtection.pageTargetId||firstProtection.tabTargetId!==finalProtection.tabTargetId||navigated||page.isClosed()||page.url()!==successUrl)return keep('PAGE_PROTECTION_CHANGED');
  const closeTicket=ledger?.beginClose(page,{unpinnedConfirmed:true,guardPassed:true,itemId});
  try{await page.close({runBeforeUnload:false});}
  catch(error){if(ledger)ledger.finishClose(closeTicket,{closed:false});throw error;}
  if(ledger)ledger.finishClose(closeTicket,{closed:true});
  backgroundPages.delete(page);
  return {closed:true,itemId};
 }catch(error){
  if(ledger&&!ledger.fault&&ledger.describe(page)?.owned&&!page.isClosed())ledger.retain(page,{reason:'CLEANUP_CHECK_FAILED'});
  throw error;
 }finally{page.off('framenavigated',onNavigation);}
}
