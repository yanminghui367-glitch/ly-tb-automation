import {isPublishOrigin,isNewPublishUrl,isNewSuccessUrl} from './publishing-address.mjs';
// Consolidated from the recorded September 18 real Taobao field mapping.
// Receives one immutable PublishTask; never reads ranking rules or closes Chrome.
import {expect} from 'playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import assert from 'node:assert/strict';
import {visibleChallenge} from './browser-environment.mjs';
import {fillAttributes,verifyAttributes,validateSelections,selectedCustomState} from './publishing-attributes.mjs';
import {uploadMaterial,waitDetailThumbnail,materialDomSnippet} from './publishing-materials.mjs';
import {createBackgroundPage,getAuxiliaryPage,assertAuxiliaryPage} from './publishing-pages.mjs';
import {captureTaskScreenshot} from './task-screenshot.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {sellerTable,listingEvidence} from './listing-verification.mjs';
import {materialTask} from './round-material-binding.mjs';
export const MAPPING_VERSION = 'taobao-custom-service-20261008-controls';
export const selectors = {title:'#sell-field-title input',guide:'#sell-field-shopping_title input',price:'#sell-field-price input',stock:'#sell-field-batchInventory-card input',main:'#sell-field-mainImagesGroup',details:'#sell-field-descRepublicOfSell img.image-item'};
const norm=u=>u.split('?')[0].split('.png')[0];
export async function assertTaskFiles(task,{cache=new Map(),materialBinding=null}={}) {
 task=materialTask(task,materialBinding);
 for(const c of materialBinding?.changes||[]){let hash=cache?.get(c.path);if(!hash){hash=createHash('sha256').update(await readFile(c.path)).digest('hex');cache?.set(c.path,hash);}assert.equal(hash,c.toSha256,'SOURCE_OR_ASSET_CHANGED');}
 for(const a of [{path:task.source.workbook,sha256:task.source.sha256},...(task.sourceReferences||[]).map(s=>({path:s.workbook,sha256:s.sha256})),...Object.values(task.assets).flat()]){
  let hash=cache?.get(a.path);if(!hash){hash=createHash('sha256').update(await readFile(a.path)).digest('hex');cache?.set(a.path,hash);}
  assert.equal(hash,a.sha256,'SOURCE_OR_ASSET_CHANGED');
 }
 const b=task.business;
 assert(/个性定制\/设计服务\/DIY.*其它定制.*其它商品定制/.test(b.category_path),'UNVERIFIED_CATEGORY');
 assert(b.custom_service && b.procurement==='中国内地（大陆）' && b.ship_from.replaceAll(' ','')==='北京/北京' && b.shipping_time==='24小时内发货' && b.ship_from_region==='大陆及港澳台' && b.region_restriction==='不设置商品维度区域限售模板','UNSUPPORTED_SOURCE_SETTINGS');
 assert(['立刻上架','立即上架','放入仓库'].includes(b.listing_time),'UNSUPPORTED_LISTING_STATE');
 assert.equal(task.assets.main.length,1);assert.equal(task.assets.secondary.length,4);assert(Number.isInteger(task.assets.details.length)&&task.assets.details.length>0&&task.assets.details.length<=50,'DETAIL_COUNT_INVALID');validateSelections(task);
}
export function newForm(page) { try { return isNewPublishUrl(page.url()); } catch { return false; } }
function submissionAddress(page,formUrl){
 const u=new URL(page.url());
 assert(isPublishOrigin(u),'SUBMISSION_PAGE_ORIGIN_CHANGED');
 if(u.pathname==='/sell/v2/publish.htm'){assert(newForm(page)&&page.url()===formUrl,'SUBMISSION_FORM_CHANGED');return null;}
 assert(isNewSuccessUrl(u.href),'SUBMISSION_PAGE_CHANGED');
 const ids=u.searchParams.getAll('primaryId');assert(ids.length===1&&/^\d{6,30}$/.test(ids[0]),'SUCCESS_URL_WITHOUT_UNIQUE_ID');return ids[0];
}
// Before the click, require the original form. After the recorded click, only
// observe the same page's official form/success transition; no title input exists
// on success. Recheck addresses after awaited DOM reads to catch navigation.
export async function assertPublishIdentity(page,task,{submitted=false,formUrl,requireTitle=false,shopName=task.business.shop_name}={}){
 const address=()=>submitted?submissionAddress(page,formUrl):assert(newForm(page),'NEW_ITEMS_ONLY');address();
 const identity=page.locator('div.UserArea_shopName__3xGhm');
 await expect(identity).toHaveCount(1);await expect(identity).toBeVisible({timeout:8000});
 await expect(identity).toHaveText(shopName,{timeout:8000,useInnerText:true});address();
 if(!submitted){const title=await page.locator(selectors.title).inputValue();assert((!title&&!requireTitle)||title===task.listing.title,'ANOTHER_TASK_FORM');address();}
}
export async function readSubmissionReceipt(page,formUrl){
 const before=page.url(),id=submissionAddress(page,formUrl);if(!id)return null;
 const text=await page.locator('body').innerText();if(page.url()!==before)return null;
 submissionAddress(page,formUrl);if(!/商品提交成功/.test(text))return null;
 const ids=[...text.matchAll(/商品ID[：:]\s*(\d+)/g)].map(m=>m[1]);
 assert(ids.length===1&&ids[0]===id,'SUCCESS_WITHOUT_MATCHING_UNIQUE_ITEM_ID');return id;
}
// A blank price may be refilled once with the frozen value. Any different
// nonempty value is a conflict, never a reason to overwrite or normalize it.
export async function fillPriceWithBlankRecovery(page,value,guard,{timeout=5000,onEvent=async()=>{}}={}){
 const expected=String(value),input=page.locator(selectors.price),formUrl=page.url();let fills=0;
 assert(/^\d+(?:\.\d{1,2})?$/.test(expected)&&Number(expected)>0,'INVALID_FROZEN_PRICE');
 assert(Number.isFinite(timeout)&&timeout>0&&timeout<=5000,'PRICE_WAIT_BUDGET_INVALID');
 const read=async()=>{
  await guard();assert.equal(page.url(),formUrl,'FORM_PRICE_PAGE_CHANGED');
  assert.equal(await input.count(),1,'FORM_PRICE_CONTROL_CHANGED');
  assert(await input.isVisible()&&await input.isEditable(),'FORM_PRICE_CONTROL_NOT_EDITABLE');
  const actual=await input.inputValue();assert.equal(page.url(),formUrl,'FORM_PRICE_PAGE_CHANGED');
  assert(actual===''||actual===expected,'FORM_PRICE_CONFLICT');return actual;
 };
 const finish=async()=>{
  await onEvent({kind:'PRICE_VALUE_OBSERVED',fills,value:expected});
  assert.equal(await read(),expected,'FORM_PRICE_CHANGED_AFTER_CHECK');
  return {fills,value:expected};
 };
 if(await read()===expected)return finish();
 while(fills<2){
  await onEvent({kind:fills?'PRICE_BLANK_REFILL_INTENT':'PRICE_FILL_INTENT',fill:fills+1,value:expected});
  if(await read()===expected)return finish();
  await input.fill(expected);fills++;
  await read();await input.press('Tab');
  const deadline=Date.now()+timeout;
  do{
   if(await read()===expected)return finish();
   if(Date.now()>=deadline)break;
   await delay(Math.min(100,deadline-Date.now()));
  }while(true);
  await onEvent({kind:'PRICE_EMPTY_AFTER_FILL',fill:fills,value:expected});
 }
 throw Error('FORM_PRICE_EMPTY：价格填写后仍为空；已有限补填原任务价格，未提交商品');
}

export async function fillStableInventory(page,value,guard,{settleMs=500,timeout=2000}={}){
 const expected=String(value),input=page.locator(selectors.stock);let actual='';
 assert(/^[1-9]\d*$/.test(expected),'INVALID_FROZEN_INVENTORY');
 for(let attempt=1;attempt<=2;attempt++){
  await guard();await expect(input).toHaveCount(1);await expect(input).toBeEditable();
  await input.fill(expected);await guard();await input.press('Tab');
  // The first guarded read establishes the observation window. Login/identity
  // checks may take longer than that window; they must not consume it before
  // there is even a first sample. Subsequent reads remain guarded and bounded.
  let deadline=null,stableSince=null;
  do{
   await guard();
   assert.equal(await input.count(),1,'FORM_INVENTORY_CONTROL_CHANGED');
   assert(await input.isEditable(),'FORM_INVENTORY_CONTROL_NOT_EDITABLE');
   actual=await input.inputValue();deadline??=Date.now()+timeout;
   if(actual===expected){stableSince??=Date.now();if(Date.now()-stableSince>=settleMs)return {attempts:attempt,value:actual};}
   else stableSince=null;
   await delay(80);
  }while(Date.now()<deadline);
  // Only one bounded, same-value refill on the same guarded original form.
  // Never retries uploads/submissions or changes the immutable business value.
 }
 throw Error(`FORM_INVENTORY_UNSTABLE：库存填写后未保持原任务值（应为${expected}，页面为${actual}）；已停止，未提交商品`);
}
// Observed 2026-10-09: the official detail picker is a visible iframe inside
// .media-img-plug. Its container can open before its search UI is ready.
// Poll that same picker only. Never reload it, re-click Image, or choose a
// similarly named search box from a main-image/preview/unrelated frame.
export async function waitDetailMaterialFrame(page,guard,{required=true,timeout=20000,onDiagnostic=async()=>{}}={}) {
 assert(Number.isFinite(timeout)&&timeout>0&&timeout<=30000,'DETAIL_WAIT_BUDGET_INVALID');
 const hosts=page.locator('.media-img-plug iframe:not(#mainImagesGroup):visible'),deadline=Date.now()+timeout;
 let host=null,frame=null,status='failed',actual={hosts:0},failure=null;const started=performance.now();
 const diagnostic=()=>({stage:'detail-panel',status,selector:'.media-img-plug iframe:not(#mainImagesGroup):visible',expected:'唯一官方详情面板、可编辑搜索框与可见确定按钮',actual,durationMs:Math.round((performance.now()-started)*1000)/1000,timeoutMs:timeout,screenshot:null});
 const allowed=url=>{try{const u=new URL(url);return u.origin==='https://market.m.taobao.com'&&u.pathname==='/app/crs-qn/sucai-selector-ng/index';}catch{return false;}};
 const checkHost=async()=>{
  assert.equal(await hosts.count(),1,'DETAIL_MATERIAL_FRAME_CHANGED');
  assert.equal(await page.locator('iframe#mainImagesGroup:visible').count(),0,'DETAIL_MATERIAL_FRAME_AMBIGUOUS');
  assert(await host.evaluate(el=>el.isConnected)&&await host.isVisible(),'DETAIL_MATERIAL_FRAME_CHANGED');
  assert(await hosts.evaluate((el,original)=>el===original,host),'DETAIL_MATERIAL_FRAME_CHANGED');
  assert(allowed(await host.getAttribute('src')),'DETAIL_MATERIAL_FRAME_ORIGIN');
 };
 try {
  do {
   await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');
    const count=await hosts.count();actual={hosts:count};assert(count<=1,'DETAIL_MATERIAL_FRAME_AMBIGUOUS');
   if(count)assert.equal(await page.locator('iframe#mainImagesGroup:visible').count(),0,'DETAIL_MATERIAL_FRAME_AMBIGUOUS');
    if(!host&&count===0&&!required){status='absent';return null;}
   if(!host&&count===1)host=await hosts.elementHandle();
   if(host){
    await checkHost();
    const current=await host.contentFrame();
    if(frame&&current!==frame)throw Error('DETAIL_MATERIAL_FRAME_CHANGED');
    frame=current;
    if(frame&&frame.url()!=='about:blank'){
     assert(allowed(frame.url()),'DETAIL_MATERIAL_FRAME_ORIGIN');
     const search=frame.getByPlaceholder('搜索图片名称',{exact:true});
     const confirm=frame.getByRole('button',{name:/^确定(?:\s*[（(]\d+[）)])?$/});
      const searches=await search.count(),confirms=await confirm.count();
      actual={hosts:count,search:searches,confirm:confirms,searchVisible:searches===1&&await search.isVisible(),searchEditable:searches===1&&await search.isEditable(),confirmVisible:confirms===1&&await confirm.isVisible()};
     assert((await search.count())<=1&&(await confirm.count())<=1,'DETAIL_MATERIAL_FRAME_AMBIGUOUS');
     if(await search.count()===1&&await search.isVisible()&&await search.isEditable()&&await confirm.count()===1&&await confirm.isVisible()){
      const readyUrl=frame.url();
      await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');
      await checkHost();assert(!frame.isDetached()&&frame.url()===readyUrl&&allowed(frame.url()),'DETAIL_MATERIAL_FRAME_CHANGED');
      assert(await search.count()===1&&await search.isVisible()&&await search.isEditable()&&await confirm.count()===1&&await confirm.isVisible(),'DETAIL_MATERIAL_FRAME_NOT_READY');
      if(Date.now()>=deadline)throw Error('DETAIL_MATERIAL_FRAME_NOT_READY');status='ready';return frame;
     }
    }
   }
   await delay(150);
  }while(Date.now()<deadline);
  throw Error('DETAIL_MATERIAL_FRAME_NOT_READY');
  }catch(error){failure=error;error.materialReadiness??=diagnostic();throw error;}
  finally{
   await host?.dispose();
   if(status!=='absent')try{const d=failure?.materialReadiness||diagnostic();d.dom_snippet=await materialDomSnippet(hosts);const evidence=await onDiagnostic(d);if(evidence)Object.assign(d,evidence);}catch{}
  }
}

// Main and detail pickers share .media-img-plug. Main is identified by its
// observed exact ID; wait for the same official iframe, never reopen/reload it.
export async function waitMainMaterialFrame(page,guard,{timeout=20000}={}) {
 assert(Number.isFinite(timeout)&&timeout>0&&timeout<=30000,'MAIN_WAIT_BUDGET_INVALID');
 const hosts=page.locator('.media-img-plug iframe#mainImagesGroup:visible'),deadline=Date.now()+timeout;
 const allowed=url=>{try{const u=new URL(url);return !u.username&&!u.password&&u.origin==='https://market.m.taobao.com'&&u.pathname==='/app/crs-qn/sucai-selector-ng/index';}catch{return false;}};
 let host=null,frame=null;
 const checkHost=async()=>{
  assert.equal(await hosts.count(),1,'MAIN_MATERIAL_FRAME_CHANGED');
  assert(await host.evaluate(el=>el.isConnected)&&await host.isVisible(),'MAIN_MATERIAL_FRAME_CHANGED');
  assert(await hosts.evaluate((el,original)=>el===original,host),'MAIN_MATERIAL_FRAME_CHANGED');
  assert(allowed(await host.getAttribute('src')),'MAIN_MATERIAL_FRAME_ORIGIN');
  assert.equal(await page.locator('.media-img-plug iframe:not(#mainImagesGroup):visible').count(),0,'MAIN_MATERIAL_FRAME_AMBIGUOUS');
 };
 try{
  do{
   await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');
   const count=await hosts.count();assert(count<=1,'MAIN_MATERIAL_FRAME_AMBIGUOUS');
   if(!host&&count===1)host=await hosts.elementHandle();
   if(host){
    await checkHost();const current=await host.contentFrame();
    if(frame&&current!==frame)throw Error('MAIN_MATERIAL_FRAME_CHANGED');
    frame=current;
    if(frame&&frame.url()!=='about:blank'){
     assert(allowed(frame.url()),'MAIN_MATERIAL_FRAME_ORIGIN');
     const search=frame.getByPlaceholder('搜索图片名称',{exact:true});
     assert(await search.count()<=1,'MAIN_MATERIAL_FRAME_AMBIGUOUS');
     if(await search.count()===1&&await search.isVisible()&&await search.isEditable()){
      const readyUrl=frame.url();await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');
      await checkHost();assert(!frame.isDetached()&&frame.url()===readyUrl&&allowed(frame.url()),'MAIN_MATERIAL_FRAME_CHANGED');
      assert(await search.count()===1&&await search.isVisible()&&await search.isEditable(),'MAIN_MATERIAL_FRAME_NOT_READY');
      return frame;
     }
    }
   }
   await delay(150);
  }while(Date.now()<deadline);
  throw Error('MAIN_MATERIAL_FRAME_NOT_READY：主图素材面板未就绪，已停止；保留原页面后重试此条');
 }finally{await host?.dispose();}
}

// A material click can apply its image before an unrelated iframe navigation
// times out. Never click again: reconcile the exact complete image prefix on
// the guarded original form. A timeout alone is not proof of success.
function mainImageKey(value){
 // Keep the seller asset path exact. Normalize only the observed Taobao
 // thumbnail transform and the 13-digit cache timestamp; all other query
 // parameters remain part of the identity.
  const u=new URL(value);
  assert(!u.username&&!u.password&&u.origin==='https://img.alicdn.com','MAIN_IMAGE_ORIGIN_CHANGED');
  const stablePath=u.pathname.replace(/(\.(?:png|jpe?g))_320x320q80_\.webp$/i,'$1_320x320');
  const query=[...u.searchParams]
   .filter(([key,val])=>!(key==='t'&&/^\d{13}$/.test(val)))
   .sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv))
   .map(([key,val])=>`${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&');
  return u.origin+stablePath+(query?`?${query}`:'')+u.hash;
}

// The actual form and this task's frozen receipts define image identity.
// Do not filter by one seller's CDN directory or silently ignore extra images.
export async function reconcileMainImages(page,receipts,assets){
 const actual=await page.locator(`${selectors.main} img`).evaluateAll(es=>es.map(e=>e.src));
 assert(actual.length<=assets.length,'MAIN_IMAGE_COUNT_CHANGED：表单图片超过当前商品数量');
 for(const [i,url]of actual.entries()){
  const receipt=receipts[i],asset=assets[i];
  assert(receipt?.source?.path===asset.path&&receipt?.source?.sha256===asset.sha256,'UNRECONCILED_EXISTING_IMAGE：已有图片缺少当前商品素材回执');
  assert.equal(mainImageKey(url),mainImageKey(receipt.url),'MAIN_IMAGE_ORDER：已有图片与当前商品回执顺序不一致');
 }
 return actual;
}

export async function clickMainImageAndVerify(page,card,expectedUrls,guard,{onEvent=async()=>{}}={}) {
 assert(Array.isArray(expectedUrls)&&expectedUrls.length>=1&&expectedUrls.length<=5,'MAIN_IMAGE_EXPECTATION_INVALID');
 assert(expectedUrls.every(u=>typeof u==='string'&&u.length>0),'MAIN_IMAGE_EXPECTATION_INVALID');
 const images=page.locator('#sell-field-mainImagesGroup img');
 const read=()=>images.evaluateAll(es=>es.map(e=>e.src));
 const expected=expectedUrls.map(mainImageKey),formUrl=page.url();
 const check=async()=>{await guard();assert.equal(page.url(),formUrl,'MAIN_IMAGE_FORM_CHANGED');};
 const stableRead=async()=>{
  await check();const first=(await read()).map(mainImageKey);
  await check();const second=(await read()).map(mainImageKey);
  await check();assert.deepEqual(second,first,'MAIN_IMAGE_STATE_CHANGED');return second;
 };
 const initial=await stableRead();
 if(initial.length===expected.length&&initial.every((value,index)=>value===expected[index])){
  await onEvent({kind:'MAIN_IMAGE_ALREADY_SELECTED_RECONCILED',order:expectedUrls.length,clickRepeated:false,expectedUrls});
  return;
 }
 assert.deepEqual(initial,expected.slice(0,-1),'MAIN_IMAGE_PREFIX_CHANGED');
 let clickTimeout=null;
 try{await card.locator('.PicList_pic_imgBox__c0HXw').click();}
 catch(error){if(error.name!=='TimeoutError')throw error;clickTimeout=error;}
 try{
  await expect.poll(stableRead,{timeout:5000}).toEqual(expected);
  const final=await stableRead();assert.deepEqual(final,expected,'MAIN_IMAGE_PREFIX_CHANGED');
 }catch(error){
  // Keep the original click diagnostic alongside a failed result check.
  if(clickTimeout)error.mainImageClickTimeout=clickTimeout.message;
  throw error;
 }
 if(clickTimeout)await onEvent({kind:'MAIN_IMAGE_CLICK_TIMEOUT_RECONCILED',order:expectedUrls.length,clickRepeated:false,expectedUrls,originalError:clickTimeout.message});
}

export async function closeMainImageActionMenu(page,guard) {
 const menu=page.locator('ul[role="menu"].sell-component-material-item-media-operator');
 if(!await menu.isVisible().catch(()=>false))return {closed:false};
 await guard();
 const labels=(await menu.locator('[role="menuitem"]').allTextContents()).map(text=>text.trim().replace(/\s+/g,' '));
 assert.deepEqual(labels,['裁剪','替换','删除','AI 作图'],'MAIN_IMAGE_MENU_CHANGED');
 await page.keyboard.press('Escape');
 await expect(menu).toBeHidden({timeout:1500});
 await guard();
 return {closed:true};
}

export async function fillBrand(page,value,guard,{timeout=8000}={}){
 assert(typeof value==='string'&&value.length>0,'FORM_BRAND_SOURCE_MISSING：原商品缺少品牌');
 const formUrl=page.url(),root=page.locator('#struct-p-20000'),input=root.locator('input').first();
 const options=page.locator(':is(.options-item,[role="option"]):visible:not(#struct-nav *):not(.sell-component-navigation-bar *)');
 const check=async()=>{await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');assert.equal(page.url(),formUrl,'FORM_BRAND_PAGE_CHANGED');};
 await check();await expect(root).toHaveCount(1);await expect(input).toBeVisible();await expect(input).toBeEnabled();
 if(await input.inputValue()===value){await input.press('Tab');await check();await expect(input).toHaveValue(value);return;}
 const expanded=await input.getAttribute('aria-expanded');
 if(expanded!=='true'){
  assert.equal(await options.count(),0,'FORM_BRAND_OTHER_MENU：存在其他候选面板，请先关闭');
  await input.click();
 }
 await expect.poll(()=>options.count(),{timeout,message:'FORM_BRAND_OPTIONS：品牌候选尚未加载'}).toBeGreaterThan(0);
 const target=options.filter({has:page.getByText(value,{exact:true})});
 if(!await target.count()){
  // The observed brand menu initially lists alphabetic results. Its search
  // input is distinct from the committed brand field; typing there is not a
  // selected value. Find that input through the menu's own DOM ancestry.
  const main=await input.elementHandle();let searchHandle;
  try{
   searchHandle=await options.first().evaluateHandle((option,main)=>{
    for(let node=option.parentElement,depth=0;node&&depth<6;node=node.parentElement,depth++){
     if(node.contains(main))break;
     const inputs=[...node.querySelectorAll('input')].filter(el=>el.type!=='hidden'&&!el.readOnly&&!el.disabled&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
     if(inputs.length>1)throw Error('FORM_BRAND_SEARCH_AMBIGUOUS：品牌搜索框不唯一');
     if(inputs.length===1)return inputs[0];
    }
    return null;
   },main);
   const search=searchHandle.asElement();
   assert(search,'FORM_BRAND_SEARCH_MISSING：品牌列表未找到独立搜索框');
   await check();await search.fill(value);
  }finally{await searchHandle?.dispose();await main?.dispose();}
 }
 await expect(target,{message:'FORM_BRAND_OPTION_MISSING：未找到原商品指定品牌，请保留页面'}).toHaveCount(1,{timeout});
 await expect(target).toHaveText(value);await expect(target).toBeEnabled();
 assert(await target.getAttribute('aria-disabled')!=='true'&&!await target.evaluate(el=>el.classList.contains('disabled')),'FORM_BRAND_OPTION_DISABLED');
 await check();await target.click();await expect(input).toHaveValue(value,{timeout});
 await input.press('Tab');await check();await expect(input).toHaveValue(value);await expect(options).toHaveCount(0,{timeout});
}

function freightTemplate(task,profile){
 if(!profile)return task.business.freight_template;
 assert(profile.version===1&&profile.shopId===task.shopId&&profile.confirmedBy==='用户'&&profile.sha256&&[profile.freightTemplate?.from,profile.freightTemplate?.to].includes(task.business.freight_template),'FORM_FREIGHT_TEMPLATE_BINDING_INVALID');
 return profile.freightTemplate.to;
}

export async function executionDetailImages(task,profile=null,materialBinding=null){
 if(materialBinding){assert(!(profile?.detailImagePadding||[]).some(e=>materialBinding.changes.some(c=>c.group==='details'&&c.path===e.sourcePath)),'FORM_DETAIL_PADDING_SOURCE_CHANGED');task=materialTask(task,materialBinding);}
 const changes=profile?.detailImagePadding||[];
 if(changes.length)assert(profile.shopId===task.shopId&&profile.confirmedBy==='用户'&&profile.sha256,'FORM_DETAIL_PADDING_INVALID');
 const pngSize=data=>{assert(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'FORM_DETAIL_PADDING_PNG_REQUIRED');return [data.readUInt32BE(16),data.readUInt32BE(20)];};
 const result=[];
 for(const asset of task.assets.details){
  const matches=changes.filter(e=>e.sourcePath===asset.path);assert(matches.length<=1,'FORM_DETAIL_PADDING_AMBIGUOUS');
  if(!matches.length){result.push(asset);continue;}
  const entry=matches[0];assert.equal(entry.sourceSha256,asset.sha256,'FORM_DETAIL_PADDING_SOURCE_CHANGED');
  const original=await readFile(asset.path),padded=await readFile(entry.path);
  assert.equal(createHash('sha256').update(original).digest('hex'),asset.sha256,'FORM_DETAIL_PADDING_SOURCE_CHANGED');
  assert.equal(createHash('sha256').update(padded).digest('hex'),entry.sha256,'FORM_DETAIL_PADDING_CHANGED');
  const [w,h]=pngSize(original),[pw,ph]=pngSize(padded);
  assert.deepEqual([w,h],entry.dimensions,'FORM_DETAIL_PADDING_DIMENSIONS');
  assert(pw===w+entry.left+entry.right&&ph===h&&h>w*2&&ph<=pw*2,'FORM_DETAIL_PADDING_DIMENSIONS');
  result.push({...asset,path:entry.path,sha256:entry.sha256,dimensions:[pw,ph],sourceAsset:asset,padding:{left:entry.left,right:entry.right,profileSha256:profile.sha256}});
 }
 return result;
}

export async function inspectShippingArea(page,task,profile=null,guard=async()=>{}){
 await guard();const area=page.locator('#sell-field-shippingArea'),count=await area.count();
 assert(count<=1,'FORM_SHIPPING_AREA_AMBIGUOUS');
 if(count===1)return {mode:'LEGACY_FIELDS',rendered:true};
 // Recorded current official form: delivery is defined by its selected freight
 // template and has no standalone shippingArea/address component at all.
 // Never invent a value for an absent field or ignore an unfamiliar replacement.
 const name=freightTemplate(task,profile),delivery=page.locator('#sell-field-tbExtractWay');
 await expect(page.locator('#global-card')).toContainText(/其[它他]商品定制/);
 await expect(page.locator('#sell-field-tmDeliveryTime')).toBeVisible();
 await expect(delivery).toBeVisible();
 await expect(delivery.locator('input[type=checkbox][value="2"]')).toBeChecked();
 const input=delivery.locator('input[role=combobox]');await expect(input).toHaveCount(1);
 const selected=await input.evaluate(selectedCustomState);
 assert(selected.committed&&!selected.ambiguous&&!selected.conflicting&&selected.text===name,'FORM_FREIGHT_TEMPLATE_UNCONFIRMED：运费模板尚未选定');
 const unknown=await page.locator('[id^="sell-field-"]').evaluateAll(nodes=>nodes.some(el=>/shipping|shipFrom|location|address|origin/i.test(el.id)||[...el.querySelectorAll('.sell-component-info-wrapper-label')].some(n=>/^(发货范围|配送范围|发货地|商品所在地|单一发货地)$/.test(n.textContent.trim()))));
 assert(!unknown,'FORM_SHIPPING_MAPPING_CHANGED：发现其他发货控件，需重新适配');
 await expect(page.locator('#sell-field-regionLimitSale')).toHaveCount(1);
 await guard();assert.equal(await area.count(),0,'FORM_SHIPPING_AREA_CHANGED');
 return {mode:'PLATFORM_TEMPLATE',rendered:false,template:name,standaloneRegionApplied:false,standaloneOriginApplied:false,contract:'taobao-template-shipping-20261015'};
}

export async function verifyMaterialUploadReceipt(asset,card){
 if(!asset.materialVersion)return true;
 if(typeof card!=='string'&&typeof card?.locator!=='function')return false;
 const receipt=await readFile(asset.path+'.upload.json','utf8').then(JSON.parse).catch(()=>null);
 const url=typeof card==='string'?card:await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src');
 return !!receipt&&receipt.sha256===asset.sha256&&receipt.path===asset.path&&JSON.stringify(receipt.materialVersion)===JSON.stringify(asset.materialVersion)&&receipt.url===url;
}

// Reuse only a proven prefix already inserted in the original form. Material
// search results and thumbnails may change; the saved source receipt must not.
export async function verifyInsertedDetails(urls,assets,receipts){
 assert(urls.length<=assets.length,'TOO_MANY_DETAIL_IMAGES');
 for(const [i,url]of urls.entries()){
  const a=assets[i],r=receipts[i];
  assert(r&&r.order===i+1&&typeof r.url==='string'&&r.url&&typeof url==='string'&&url,'EXISTING_DETAIL_RECEIPT_MISSING');
  assert.equal(r.source?.path,a.path,'DETAIL_SOURCE_MISMATCH');
  assert.equal(r.source?.sha256,a.sha256,'DETAIL_SOURCE_MISMATCH');
  assert.deepEqual(r.source?.materialVersion,a.materialVersion,'DETAIL_SOURCE_MISMATCH');
  assert.deepEqual(r.source?.padding,a.padding,'DETAIL_SOURCE_MISMATCH');
  assert.equal(norm(url),norm(r.url),'EXISTING_DETAIL_MISMATCH');
  assert(await verifyMaterialUploadReceipt(a,r.url),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED');
 }
 return urls.length;
}

export async function fillTask({page:p, task,dir,target,step,guard,executionProfile=null,materialBinding=null}) {
 const order=task.priority;
 const risk=async()=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');};
 const detailReadiness={onDiagnostic:async (diagnostic,evidencePage=p)=>{
  const evidence=diagnostic.status==='failed'?await captureTaskScreenshot(evidencePage,dir,'detail-readiness-'+diagnostic.stage):{};
  await writeFile(dir+'detail-readiness-'+randomUUID()+'.json',JSON.stringify({at:new Date().toISOString(),...diagnostic,...evidence},null,2),{flag:'wx'});
  return evidence;
 }};
 async function fill(selector,value){const l=p.locator(selector);await guard();await l.fill(String(value));await l.press('Tab');await expect(l).toHaveValue(String(value));}
 async function radio(scope,text){const l=p.locator(scope).locator('label').filter({hasText:text}).filter({has:p.locator('input[type=radio]')}).first();await guard();await l.click();await expect(l.locator('input[type=radio]')).toBeChecked();}
  async function ensureMaterial(f,a,card,{detail=false}={}) {
  if(await card.isVisible().catch(()=>false)){assert(await verifyMaterialUploadReceipt(a,card),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED：新版图片尚无上传回执，不能复用同名旧素材');return;}
  // The native Playwright owner handles the real file chooser; never injects uploads.
  const exists=await card.waitFor({state:'visible',timeout:4000}).then(()=>true).catch(()=>false);
  if(exists){assert(await verifyMaterialUploadReceipt(a,card),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED：新版图片尚无上传回执，不能复用同名旧素材');return;}
  await guard();
  // Use the official top-level material library; its native file chooser was
  // verified on September 21. Embedded chooser did not emit filechooser.
  const link=f.getByText('图片空间',{exact:true});
  const href=await link.locator('..').getAttribute('href');
  assert(href&&new URL(href).origin==='https://qn.taobao.com','MATERIAL_LIBRARY_LINK');
  let library;
  const materialGuard=async(page=library)=>{await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');assertAuxiliaryPage(page,'material');await expect(page.locator('div.shopName--x6nyUylx')).toHaveText(task.business.shop_name,{useInnerText:true,timeout:8000});assertAuxiliaryPage(page,'material');};
  library=await getAuxiliaryPage(p.context(),{role:'material',shopId:task.shopId,url:href,guard:materialGuard});
  if((await library.locator('body').innerText()).includes('支持所有商品测图'))await library.getByRole('button',{name:'关闭',exact:true}).click();
  let uploadDialog;
   try{uploadDialog=await uploadMaterial(library,a.path,materialGuard,{readiness:detail?{onDiagnostic:d=>detailReadiness.onDiagnostic(d,library)}:null});}
  catch(error){
    const evidence=error.materialReadiness?.screenshot?{screenshot:error.materialReadiness.screenshot,screenshotAt:error.materialReadiness.screenshotAt,screenshotError:null}:await captureTaskScreenshot(library,dir,'material-upload-paused');
    await writeFile(dir+'material-upload-checkpoint.json',JSON.stringify({at:new Date().toISOString(),reason:error.message,diagnostic:error.materialReadiness||error.uploadDiagnostic||null,...evidence},null,2)).catch(()=>{});
   throw error;
  }
  await library.screenshot({path:dir+`uploaded-${basename(a.path)}.png`});
  await materialGuard();await uploadDialog.getByRole('button',{name:'完成',exact:true}).click();await guard();
  const search=f.getByPlaceholder('搜索图片名称');await search.fill('');await search.press('Enter');
   if(detail)await waitDetailThumbnail(card,guard,detailReadiness);
   else await expect(card).toBeVisible({timeout:30000});
  if(a.materialVersion){
   const receipt={path:a.path,sha256:a.sha256,materialVersion:a.materialVersion,url:await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src'),at:new Date().toISOString()};
   await writeFile(a.path+'.upload.json',JSON.stringify(receipt,null,2),{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST'||!await verifyMaterialUploadReceipt(a,card))throw e;});
  }
 }
 await assertTaskFiles(task,{materialBinding});
 const effective=materialTask(task,materialBinding);
 const mains=[...effective.assets.main,...effective.assets.secondary];
 const details=await executionDetailImages(task,executionProfile,materialBinding);
 await writeFile(dir+'task.json',JSON.stringify({...task,selectedDetails:details,executionInstruction:'User: new listings only, source order, existing listings unchanged'},null,2));
 p.setDefaultTimeout(8000);await guard();
 const currentTitle=await p.locator('#sell-field-title input').inputValue();assert(!currentTitle||currentTitle===task.listing.title,'ANOTHER_TASK_FORM');
 await expect(p.locator('#global-card')).toContainText(/其[它他]商品定制/);
 let receipts=JSON.parse(await readFile(dir+'main-receipts.json','utf8').catch(()=>'[]'));
 let shippingArea=await p.locator('#sell-field-shippingArea').count()?{mode:'LEGACY_FIELDS',rendered:true}:null;
 // A retained loading detail picker must settle before any form refill.
 const openDetailFrame=await waitDetailMaterialFrame(p,guard,{required:false,...detailReadiness});
 if(openDetailFrame)shippingArea=await inspectShippingArea(p,task,executionProfile,guard);
 if(!openDetailFrame){
 for(const [i,a] of mains.entries())await step('main-image-'+(i+1),async()=>{
  const existing=await reconcileMainImages(p,receipts,mains);
  if(existing.length>i)return;
  assert.equal(existing.length,i,'MAIN_IMAGE_COUNT_CHANGED：前序主图尚未插入，请保留原页面');
  if(!await p.locator('iframe#mainImagesGroup').isVisible())await p.locator('#sell-field-mainImagesGroup').getByText('上传图片',{exact:true}).first().click();
  const f=await waitMainMaterialFrame(p,guard),name=basename(a.path);
  const card=f.locator('.PicList_pic_background__pGTdV').filter({hasText:name}).first();
  if(!await card.count()){await f.getByPlaceholder('搜索图片名称').fill(name);await f.getByPlaceholder('搜索图片名称').press('Enter');}
  await ensureMaterial(f,a,card);
  await expect(card.locator('.PicList_tip_title__aQfti')).toHaveText(name);
  const url=await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src');
  receipts[i]={order:i+1,source:a,url};await writeFile(dir+'main-receipts.json',JSON.stringify(receipts,null,2));
  await clickMainImageAndVerify(p,card,receipts.slice(0,i+1).map(r=>r.url),guard,{onEvent:event=>writeFile(dir+'main-click-'+randomUUID()+'.json',JSON.stringify({at:new Date().toISOString(),...event},null,2),{flag:'wx'})});
 });
 await step('close-main-image-menu',()=>closeMainImageActionMenu(p,guard));
 await step('title',()=>fill('#sell-field-title input',task.listing.title));
 await step('guide-title',()=>fill(selectors.guide,task.listing.guideTitle));
 await step('price',()=>fillPriceWithBlankRecovery(p,task.business.price_cny,guard,{onEvent:event=>writeFile(dir+'price-'+randomUUID()+'.json',JSON.stringify({at:new Date().toISOString(),...event},null,2),{flag:'wx'})}));
 await step('inventory',()=>fillStableInventory(p,task.business.inventory,guard));
 await step('brand',()=>fillBrand(p,task.business.brand,guard));
 await step('custom-service',()=>radio('#sell-field-customize',/^是$/));
 await step('listing-state',()=>radio('#sale-card',target === 'WAREHOUSE' ? /^放入仓库$/ : /^(立刻|立即)上架$/));
 await step('shipping-time',()=>radio('#deliver-card',/^24小时内发货/));
 await step('logistics',async()=>{const l=p.locator('#sell-field-tbExtractWay input[type=checkbox][value="2"]');await l.check();await expect(l).toBeChecked();});
 await step('freight-template',async()=>{const name=freightTemplate(task,executionProfile);await p.locator('#sell-field-tbExtractWay input[role=combobox]').click();await p.getByText(name,{exact:true}).last().click();await expect(p.locator('#sell-field-tbExtractWay')).toContainText(name);});
 // New shops may start with logistics disabled. Shipping-area controls are
 // rendered only after delivery/template selection; never wait for them first.
 await step('shipping-region',async()=>{const current=await inspectShippingArea(p,task,executionProfile,guard);if(shippingArea)assert.equal(current.mode,shippingArea.mode,'FORM_SHIPPING_AREA_CHANGED');shippingArea=current;if(shippingArea.rendered)await radio('#sell-field-shippingArea',/^大陆及港澳台$/);});
 await step('single-origin',async()=>{if(shippingArea.rendered)await radio('#sell-field-shippingArea',/^单一发货地$/);else{await guard();assert.equal(await p.locator('#sell-field-shippingArea').count(),0,'FORM_SHIPPING_AREA_CHANGED');}});
 await step('ship-from',async()=>{if(!shippingArea.rendered){await guard();assert.equal(await p.locator('#sell-field-shippingArea').count(),0,'FORM_SHIPPING_AREA_CHANGED');return;}const l=p.locator('#sell-field-shippingArea input[role=combobox]');if(await l.getAttribute('aria-valuetext')!=='北京 / 北京'){await l.click();await p.getByText('北京',{exact:true}).first().click();await p.getByText('北京',{exact:true}).last().click();}await expect(l).toHaveAttribute('aria-valuetext','北京 / 北京');});
 await step('procurement',async()=>{if(!await p.locator('#sell-field-globalStock').isVisible())await p.locator('#base-card').getByText('展开',{exact:true}).click();await radio('#sell-field-globalStock',/^中国内地（大陆）$/);});
 await step('region-restriction',async()=>{const l=p.locator('#deliver-card label').filter({hasText:/^不设置商品维度区域限售模板$/}).locator('input');if(!await l.isVisible())await p.locator('#deliver-card').getByText('展开',{exact:true}).click();await expect(l).toBeChecked();});
 }
 await fillAttributes(p,task,{guard,step,onEvent:event=>writeFile(dir+'attribute-click-'+randomUUID()+'.json',JSON.stringify({at:new Date().toISOString(),...event},null,2),{flag:'wx'})});
 let detailReceipts=JSON.parse(await readFile(dir+'detail-receipts.json','utf8').catch(()=>'[]'));
 const detailImgs=p.locator('#sell-field-descRepublicOfSell img.image-item');
 const insertedDetails=await detailImgs.evaluateAll(es=>es.map(e=>e.src));
 await verifyInsertedDetails(insertedDetails,details,detailReceipts);
 if(insertedDetails.length<details.length){
  let f=openDetailFrame;
  if(!f)await step('open-details',async()=>{
   await p.locator('#sell-field-descRepublicOfSell').getByText('图片',{exact:true}).click();
   f=await waitDetailMaterialFrame(p,guard,detailReadiness);
  });
  for(const [i,a] of details.entries())await step('select-detail-'+(i+1),async()=>{
   await guard();
   if(i<insertedDetails.length){await risk();return;}
   const name=basename(a.path),search=f.getByPlaceholder('搜索图片名称'),matches=f.locator('.PicList_pic_background__pGTdV').filter({hasText:name});
   const targetCard=matches.first();
   // Reuse the current material list during checkpoint recovery. Search only
   // when the required filename is absent, preserving the user's selection.
   if(!await targetCard.isVisible()){await search.fill(name);await search.press('Enter');}
   await ensureMaterial(f,a,targetCard,{detail:true});await risk();
   const checked=matches.filter({has:f.locator('input[type=checkbox]:checked')}).first();
   const card=await checked.count()?checked:targetCard;
   await waitDetailThumbnail(card,guard,detailReadiness);
   await expect(card.locator('.PicList_tip_title__aQfti')).toHaveText(name);
   const url=await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src');
   assert(await verifyMaterialUploadReceipt(a,card),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED');
   if(!await card.locator('input[type=checkbox]').isChecked())await card.locator('.PicList_pic_imgBox__c0HXw').click();await expect(card.locator('input[type=checkbox]')).toBeChecked();
   detailReceipts[i]={order:i+1,source:a,url};await writeFile(dir+'detail-receipts.json',JSON.stringify(detailReceipts,null,2));
  });
  await step('insert-details',async()=>{await f.getByRole('button',{name:/确定/}).click();await expect(detailImgs).toHaveCount(details.length);});
 }
 await step('pre-submit-review',async()=>{
  await expect(detailImgs).toHaveCount(details.length);const urls=await detailImgs.evaluateAll(es=>es.map(e=>e.src));assert(urls.every((u,i)=>norm(u)===norm(detailReceipts[i]?.url||'')),'DETAIL_ORDER');
  await expect(p.locator('#sell-field-title input')).toHaveValue(task.listing.title);await expect(p.locator('#sell-field-price input')).toHaveValue(String(task.business.price_cny));await expect(p.locator('#sell-field-batchInventory-card input')).toHaveValue(String(task.business.inventory));
  const {noSku,shippingArea:verifiedShippingArea}=await verifyForm(p,task,target,{main:receipts,details:detailReceipts,shippingArea,materialBindingSha256:materialBinding?.sha256||null},executionProfile,materialBinding);
  shippingArea=verifiedShippingArea;
  await p.screenshot({path:dir+'pre-submit-full.png',fullPage:true});
  await writeFile(dir+'review.json',JSON.stringify({at:new Date().toISOString(),decision:'PASS_SOURCE_AND_FORM',mappingVersion:MAPPING_VERSION,order,source:task.source,title:task.listing.title,main:receipts,details:detailReceipts,noSku,executionProfile,shippingArea},null,2));
 });

 return {main:receipts,details:detailReceipts,shippingArea,...(materialBinding?{materialBindingSha256:materialBinding.sha256}:{})};
}

// Positive empty-UI contract from the read-only 2026-10-08 seller DOM:
// paused-sku-r12/sales-specifications.html, SHA256
// ce4ccd8867aeba3b92a075820b618829625293bc9cb9b9f618e78cef80f2b39f.
// This inspects the identified sales-specification roots, not private React state.
// Unknown structures stop before submit; nothing is expanded, deleted or selected.
export async function assertNoSku(page) {
 const reason=await page.evaluate(()=>{
  const one=selector=>{const all=document.querySelectorAll(selector);return all.length===1?all[0]:null;};
  const sale=one('#sale-card'),prop=one('#struct-saleProp'),custom=one('#struct-customSaleProp'),sku=one('#struct-sku'),field=one('#sell-field-sku'),content=one('.sell-new-sku-table-content'),wrapper=one('.sell-sku-table-wrapper-new');
  if(!sale||!prop||!custom||!sku||!field||!content||!wrapper)return 'ROOT_MISSING_OR_DUPLICATE';
  // Recorded 2026-10-15 form hides only the empty custom-property placeholder
  // in one display:none div. Its subtree must still be structurally empty.
  const customParent=custom.parentElement;
  const wrappedCustom=customParent!==sale&&customParent?.parentElement===sale&&customParent.localName==='div'&&customParent.attributes.length===1&&customParent.hasAttribute('style')&&customParent.style.length===1&&customParent.style.display==='none'&&customParent.style.getPropertyPriority('display')===''&&!customParent.shadowRoot&&customParent.children.length===1&&customParent.firstElementChild===custom&&[...customParent.childNodes].every(n=>n===custom||n.nodeType===Node.TEXT_NODE&&!n.textContent.trim());
  if(prop.parentElement!==sale||sku.parentElement!==sale||customParent!==sale&&!wrappedCustom||field.parentElement!==sku||!field.contains(content)||wrapper.parentElement!==content)return 'ROOT_ANCESTRY_CHANGED';
  // Light-DOM emptiness cannot certify an additional public shadow subtree.
  // Reject its presence without inspecting its content or private component state.
  if(sale.shadowRoot||[prop,custom,sku].some(root=>root.shadowRoot||[...root.querySelectorAll('*')].some(el=>el.shadowRoot)))return 'UNKNOWN_SHADOW_ROOT';
  const shown=element=>{
   for(let el=element;el;el=el.parentElement){
    const style=getComputedStyle(el);
    if(el.hidden||el.hasAttribute('inert')||el.getAttribute('aria-hidden')==='true'||el.getAttribute('aria-expanded')==='false'||el.getAttribute('aria-busy')==='true'||style.display==='none'||style.visibility!=='visible'||style.contentVisibility==='hidden'||Number(style.opacity)===0)return false;
   }return true;
  };
  if(document.readyState==='loading'||[sale,prop,...(wrappedCustom?[]:[custom]),sku,field,content,wrapper].some(el=>!shown(el)))return 'NOT_VISIBLE_OR_READY';
  // The two recorded empty placeholders legitimately have height zero.
  for(const el of [prop,custom]){
   if(el.localName!=='div'||el.className!=='com-struct'||el.attributes.length!==2||el.children.length!==1||el.firstElementChild.localName!=='div'||el.firstElementChild.attributes.length||el.firstElementChild.childNodes.length||el.textContent.trim())return 'SALES_PROPERTIES_NOT_EMPTY';
  }
  // Ordered depth/tag/class/ID shape includes the inert help label and the only
  // create button. Extra hidden inputs, rows, templates or configuration nodes
  // are rejected even if the create button still exists.
  const expected=[
   [0,'div','com-struct','struct-sku'],
   [1,'div','sell-component-info-wrapper-wrap sell-horizon-layout-info-wrapper full-width label-horizontal','sell-field-sku'],
   [2,'div','sell-component-info-wrapper-label-wrap label-container label-align-left'],
   [3,'span','sell-component-info-wrapper-label'],[3,'i','next-icon next-small'],
   [4,'svg','next-icon-remote sell-component-info-wrapper-help-icon'],[5,'use',''],
   [2,'div','sell-component-info-wrapper-component-wrap'],
   [3,'div','sell-rich-text sell-component-info-wrapper-component-info position-top'],[4,'a',''],[4,'a',''],
   [3,'div','sell-component-info-wrapper-component-child-wrap'],[4,'div','sell-component-info-wrapper-component-child'],
   [5,'div','sell-new-sku-table-content'],[6,'div','sell-sku-table-wrapper-new is-taobao'],
   [7,'div',''],[8,'div',''],[9,'button','next-btn next-medium next-btn-normal'],[10,'span','next-btn-helper']
  ];
  const nodes=[];const walk=(el,depth)=>{nodes.push({el,depth});for(const child of el.children)walk(child,depth+1);};walk(sku,0);
  if(nodes.length!==expected.length)return 'EMPTY_STRUCTURE_CHANGED';
  const classes=text=>text.split(/\s+/).filter(Boolean).sort().join(' ');
  for(let i=0;i<expected.length;i++){
   const {el,depth}=nodes[i],[d,tag,cls,id='']=expected[i];
   if(depth!==d||el.localName!==tag||classes(el.getAttribute('class')||'')!==classes(cls)||el.id!==id)return 'EMPTY_STRUCTURE_CHANGED';
   const allowed=['class',...(id?['id']:[]),...(i===2?['style']:[]),...(i===3?['title']:[]),...(i===5?['focusable']:[]),...(i===6?['xlink:href']:[]),...(i===9?['href','target']:[]),...(i===17?['type']:[])];
   if([...el.attributes].some(a=>!allowed.includes(a.name)))return 'UNKNOWN_CONFIGURATION';
   if([...el.childNodes].some(n=>n.nodeType!==Node.ELEMENT_NODE&&n.nodeType!==Node.TEXT_NODE))return 'UNKNOWN_CONFIGURATION';
   if(!shown(el))return 'NOT_VISIBLE_OR_READY';
  }
  if(sku.textContent.replace(/\s+/g,'')!=='销售规格近期已升级SKU面板，优化SKU创建流程提升操作体验。查看详情。+创建规格')return 'EMPTY_TEXT_CHANGED';
  const button=nodes[17].el;
  if(button.type!=='button'||button.disabled||getComputedStyle(button).pointerEvents==='none')return 'CREATE_CONTROL_NOT_READY';
  for(const el of [sale,sku,field,content,wrapper,button]){const box=el.getBoundingClientRect();if(box.width<=0||box.height<=0)return 'NOT_VISIBLE_OR_READY';}
  return null;
 });
 assert.equal(reason,null,'NO_SKU_UNVERIFIED：销售规格空结构未通过（'+reason+'），已停止提交');
 return {structureVersion:'taobao-no-sku-empty-20261008',status:'VERIFIED_EMPTY',skuCount:0,checkedAt:new Date().toISOString()};
}

export async function verifyForm(p,task,target,receipts,executionProfile=null,materialBinding=null) {
 assert(newForm(p),'NEW_ITEMS_ONLY');
 await assertTaskFiles(task,{materialBinding});
 if(materialBinding)assert.equal(receipts.materialBindingSha256,materialBinding.sha256,'SOURCE_OR_ASSET_CHANGED: 图片回执与原任务绑定版本不一致');
 const effective=materialTask(task,materialBinding);
 await expect(p.locator('#global-card')).toContainText(/其[它他]商品定制/);
 for(const [selector,value] of [[selectors.title,task.listing.title],[selectors.price,task.business.price_cny],[selectors.stock,task.business.inventory],['#struct-p-20000 input',task.business.brand]])await expect(p.locator(selector)).toHaveValue(String(value));
 await expect(p.locator(selectors.guide)).toHaveValue(task.listing.guideTitle);
 for(const [scope,text] of [['#sale-card',target==='WAREHOUSE'?/^放入仓库$/:/^(立刻|立即)上架$/],['#sell-field-customize',/^是$/],['#deliver-card',/^24小时内发货/],['#sell-field-globalStock',/^中国内地（大陆）$/],['#deliver-card',/^不设置商品维度区域限售模板$/]]) {
  await expect(p.locator(scope).locator('label').filter({hasText:text}).locator('input').first()).toBeChecked();
 }
 const shippingArea=await inspectShippingArea(p,task,executionProfile,async()=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');});
 if(receipts.shippingArea)assert.equal(shippingArea.mode,receipts.shippingArea.mode,'FORM_SHIPPING_AREA_CHANGED：发货控件模式在填写后变化');
 if(shippingArea.rendered){
  for(const text of [/^大陆及港澳台$/,/^单一发货地$/])await expect(p.locator('#sell-field-shippingArea label').filter({hasText:text}).locator('input').first()).toBeChecked();
  await expect(p.locator('#sell-field-shippingArea input[role=combobox]')).toHaveAttribute('aria-valuetext','北京 / 北京');
 }
 await expect(p.locator('#sell-field-tbExtractWay input[type=checkbox][value="2"]')).toBeChecked();
 await expect(p.locator('#sell-field-tbExtractWay')).toContainText(freightTemplate(task,executionProfile));
 const main=await reconcileMainImages(p,receipts.main,[...effective.assets.main,...effective.assets.secondary]);
 for(const [i,asset]of [...effective.assets.main,...effective.assets.secondary].entries())if(asset.materialVersion)assert(await verifyMaterialUploadReceipt(asset,receipts.main[i]?.url),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED');
 const details=await p.locator(selectors.details).evaluateAll(es=>es.map(e=>e.src));
 const expectedDetails=await executionDetailImages(task,executionProfile,materialBinding);
 assert.equal(main.length,5);assert.equal(details.length,expectedDetails.length);
 for(const [i,asset]of expectedDetails.entries()){
  if(materialBinding||asset.padding||receipts.details[i]?.source?.padding){
   assert.equal(receipts.details[i]?.source?.path,asset.path,'DETAIL_SOURCE_MISMATCH');
   assert.equal(receipts.details[i]?.source?.sha256,asset.sha256,'DETAIL_SOURCE_MISMATCH');
   assert.equal(receipts.details[i]?.source?.padding?.profileSha256,asset.padding?.profileSha256,'DETAIL_SOURCE_MISMATCH');
  }
  if(asset.materialVersion)assert(await verifyMaterialUploadReceipt(asset,receipts.details[i]?.url),'SOURCE_OR_ASSET_CHANGED: BOUND_MATERIAL_UPLOAD_UNVERIFIED');
 }
  await verifyAttributes(p,task,async()=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');});
 assert(details.every((u,i)=>norm(u)===norm(receipts.details[i]?.url||'')),'DETAIL_IMAGE_ORDER');
 const noSku=await assertNoSku(p);return {noSku,shippingArea};
}

export async function openTaskPage(context,task,checkpoint,guard,record,onPage=()=>{}) {
 let p;
 if(checkpoint.formUrl) {
  const matches=[];
  for(const candidate of context.pages().filter(p=>p.url()===checkpoint.formUrl && newForm(p))) {
   const title=await candidate.locator(selectors.title).inputValue();
   if(title===task.listing.title)matches.push(candidate);
  }
  assert(matches.length<=1,'原填写页无法唯一识别，请保留目标商品页面后继续');p=matches[0];
  if(p){onPage(p);return p;}
  // A restarted tab can lose its unsaved DOM. Only pre-submit runs call here;
  // reconstruct the same task and revalidate every field instead of trusting flags.
  const blanks=[];
  for(const candidate of context.pages().filter(p=>p.url()===checkpoint.formUrl && newForm(p)))if(!await candidate.locator(selectors.title).inputValue())blanks.push(candidate);
  if(blanks.length===1){p=blanks[0];onPage(p);await guard(p);await p.locator(selectors.title).fill(task.listing.title);await p.locator(selectors.title).press('Tab');await record({formUrl:p.url(),reconstructed:true});return p;}
 }
 await guard();
 p=await createBackgroundPage(context);onPage(p,{createdThisExecution:true});await record({formPageCreated:true});
  await p.goto('https://upload.taobao.com/auction/sell.jhtml',{waitUntil:'domcontentloaded'});
 await guard(p);
 await p.getByText('其它商品定制',{exact:true}).click();
 await guard(p);
 await p.getByRole('button',{name:'确认，下一步',exact:true}).click();
 await expect.poll(()=>newForm(p),{timeout:30000,message:'新增发布页地址未通过校验；已保留现场，未提交，请检查页面入口'}).toBeTruthy();
 await guard(p);
 await p.locator(selectors.title).fill(task.listing.title);await p.locator(selectors.title).press('Tab');
 await expect(p.locator(selectors.title)).toHaveValue(task.listing.title);await record({formUrl:p.url()});
 return p;
}

export async function submitTask(p,guard,onClicked=async()=>{},{timeout=30000}={}) {
 await guard();
 assert(newForm(p),'NEW_ITEMS_ONLY');const formUrl=p.url();
 await p.getByRole('button',{name:'提交宝贝信息',exact:true}).click();
 await onClicked();
 let itemId;
 await expect.poll(async()=>{await guard();itemId=await readSubmissionReceipt(p,formUrl);return !!itemId;},{timeout}).toBeTruthy();
 assert(itemId,'SUCCESS_WITHOUT_ITEM_ID');return itemId;
}

export async function verifyResult(context,task,itemId,target,dir,guard) {
 assert(/^\d+$/.test(itemId),'ITEM_ID_REQUIRED_FOR_RECONCILIATION');
 const table=await sellerTable(context,task,guard);let row;
 // A not-yet-indexed new ID permits only bounded read-only lookups, never a
 // second submit. Each lookup must finish with a matching official response.
 for(let attempt=0;attempt<3;attempt++){
  const result=await table.search({itemId});
  row=result.records.find(x=>x.itemId===itemId);if(row)break;
  if(attempt<2){await guard(table.page);await delay(1200);}
 }
 assert(row,'后台尚未查到已提交商品ID，仅待核验，禁止再次提交');
 if(target==='WAREHOUSE')assert(row.status==='仓库中','后台商品未进入原定仓库状态');
 return listingEvidence(table,row,task,dir,{newSubmission:true});
}
