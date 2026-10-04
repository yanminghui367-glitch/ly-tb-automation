// Consolidated from the recorded September 18 real Taobao field mapping.
// Receives one immutable PublishTask; never reads ranking rules or closes Chrome.
import {expect} from 'playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import assert from 'node:assert/strict';
import {visibleChallenge} from './browser-environment.mjs';
import {fillAttributes,verifyAttributes,validateSelections} from './publishing-attributes.mjs';
export const MAPPING_VERSION = 'taobao-custom-service-20261004-random';
export const selectors = {title:'#sell-field-title input',guide:'#sell-field-shopping_title input',price:'#sell-field-price input',stock:'#sell-field-batchInventory-card input',main:'#sell-field-mainImagesGroup',details:'#sell-field-descRepublicOfSell img.image-item'};
const norm=u=>u.split('?')[0].split('.png')[0];
export async function assertTaskFiles(task) {
 for(const a of [{path:task.source.workbook,sha256:task.source.sha256},...(task.sourceReferences||[]).map(s=>({path:s.workbook,sha256:s.sha256})),...Object.values(task.assets).flat()]) assert.equal(createHash('sha256').update(await readFile(a.path)).digest('hex'),a.sha256,'SOURCE_OR_ASSET_CHANGED');
 const b=task.business;
 assert(/个性定制\/设计服务\/DIY.*其它定制.*其它商品定制/.test(b.category_path),'UNVERIFIED_CATEGORY');
 assert(b.custom_service && b.procurement==='中国内地（大陆）' && b.ship_from.replaceAll(' ','')==='北京/北京' && b.shipping_time==='24小时内发货' && b.ship_from_region==='大陆及港澳台' && b.region_restriction==='不设置商品维度区域限售模板','UNSUPPORTED_SOURCE_SETTINGS');
 assert(['立刻上架','立即上架','放入仓库'].includes(b.listing_time),'UNSUPPORTED_LISTING_STATE');
 assert.equal(task.assets.main.length,1);assert.equal(task.assets.secondary.length,4);assert(Number.isInteger(task.assets.details.length)&&task.assets.details.length>0&&task.assets.details.length<=50,'DETAIL_COUNT_INVALID');validateSelections(task);
}
export function newForm(page) { try { const u=new URL(page.url()); return u.origin==='https://item.upload.taobao.com' && u.pathname==='/sell/v2/publish.htm' && !['itemId','item_num_id','copyItem'].some(k=>u.searchParams.has(k)); } catch { return false; } }
export async function fillTask({page:p, task,dir,target,step,guard}) {
 const order=task.priority;
 const risk=async()=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');};
 async function fill(selector,value){const l=p.locator(selector);await guard();await l.fill(String(value));await l.press('Tab');await expect(l).toHaveValue(String(value));}
 async function radio(scope,text){const l=p.locator(scope).locator('label').filter({hasText:text}).filter({has:p.locator('input[type=radio]')}).first();await guard();await l.click();await expect(l.locator('input[type=radio]')).toBeChecked();}
 async function ensureMaterial(f,a,card) {
  if(await card.isVisible().catch(()=>false))return;
  // The native Playwright owner handles the real file chooser; never injects uploads.
  const exists=await card.waitFor({state:'visible',timeout:4000}).then(()=>true).catch(()=>false);
  if(exists)return;
  await guard();
  // Use the official top-level material library; its native file chooser was
  // verified on September 21. Embedded chooser did not emit filechooser.
  const link=f.getByText('图片空间',{exact:true});
  const href=await link.locator('..').getAttribute('href');
  assert(href&&new URL(href).origin==='https://qn.taobao.com','MATERIAL_LIBRARY_LINK');
  let library=p.context().pages().find(page=>page.url()===href);
  if(!library){library=await p.context().newPage();await library.setViewportSize({width:1450,height:1100});await library.goto(href,{waitUntil:'domcontentloaded'});}
  await guard();if(await visibleChallenge(library))throw Error('PAUSED_CAPTCHA');
  try {await expect(library.locator('div.shopName--x6nyUylx')).toHaveText(task.business.shop_name,{useInnerText:true,timeout:8000});}
  catch {throw Error('素材库店铺身份不匹配或未加载完成');}
  if((await library.locator('body').innerText()).includes('支持所有商品测图'))await library.getByRole('button',{name:'关闭',exact:true}).click();
  await library.getByRole('button',{name:'上传文件',exact:true}).click();await guard();
  const chooser=library.waitForEvent('filechooser',{timeout:10000});chooser.catch(()=>{});
  await library.locator('#sucai-tu-upload').click();await (await chooser).setFiles(a.path);
  await expect(library.locator('[role=dialog]')).toContainText(/1\s*个文件上传成功/,{timeout:60000});await guard();
  await library.screenshot({path:dir+`uploaded-${basename(a.path)}.png`});
  await library.getByRole('button',{name:'完成',exact:true}).click();await p.bringToFront();
  const search=f.getByPlaceholder('搜索图片名称');await search.fill('');await search.press('Enter');
  await expect(card).toBeVisible({timeout:30000});
 }
 await assertTaskFiles(task);
 const mains=[...task.assets.main,...task.assets.secondary];
 const details=task.assets.details;
 for(const a of [...mains,...details])assert.equal(createHash('sha256').update(await readFile(a.path)).digest('hex'),a.sha256);
 await writeFile(dir+'task.json',JSON.stringify({...task,selectedDetails:details,executionInstruction:'User: new listings only, source order, existing listings unchanged'},null,2));
 await p.setViewportSize({width:1249,height:1100});await p.bringToFront();p.setDefaultTimeout(8000);await guard();
 const currentTitle=await p.locator('#sell-field-title input').inputValue();assert(!currentTitle||currentTitle===task.listing.title,'ANOTHER_TASK_FORM');
 await expect(p.locator('#global-card')).toContainText(/其[它他]商品定制/);
 const images=p.locator('#sell-field-mainImagesGroup img');
 let receipts=JSON.parse(await readFile(dir+'main-receipts.json','utf8').catch(()=>'[]'));
 let openDetailFrame;for(const f of p.frames())if(await f.getByPlaceholder('搜索图片名称').isVisible().catch(()=>false))if((await f.locator('body').innerText()).includes('确定'))openDetailFrame=f;
 if(!openDetailFrame){
 for(const [i,a] of mains.entries())await step('main-image-'+(i+1),async()=>{
  const existing=await images.evaluateAll(es=>es.map(e=>e.src).filter(s=>s.includes('/2215038760087/')));
  if(existing.length>i){assert(receipts[i]&&norm(existing[i])===norm(receipts[i].url),'UNRECONCILED_EXISTING_IMAGE');return;}
  assert.equal(existing.length,i);
  if(!await p.locator('iframe#mainImagesGroup').isVisible())await p.locator('#sell-field-mainImagesGroup').getByText('上传图片',{exact:true}).first().click();
  const f=p.frameLocator('iframe#mainImagesGroup'),name=basename(a.path);
  await expect(f.getByPlaceholder('搜索图片名称')).toBeVisible();
  const card=f.locator('.PicList_pic_background__pGTdV').filter({hasText:name}).first();
  if(!await card.count()){await f.getByPlaceholder('搜索图片名称').fill(name);await f.getByPlaceholder('搜索图片名称').press('Enter');}
  await ensureMaterial(f,a,card);
  await expect(card.locator('.PicList_tip_title__aQfti')).toHaveText(name);
  const url=await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src');
  receipts[i]={order:i+1,source:a,url};await writeFile(dir+'main-receipts.json',JSON.stringify(receipts,null,2));
  await card.locator('.PicList_pic_imgBox__c0HXw').click();
  await expect.poll(()=>images.evaluateAll(es=>es.filter(e=>e.src.includes('/2215038760087/')).length)).toBe(i+1);
  const actual=await images.evaluateAll(es=>es.map(e=>e.src).filter(s=>s.includes('/2215038760087/')));assert.equal(norm(actual[i]),norm(url));
 });
 await step('title',()=>fill('#sell-field-title input',task.listing.title));
 await step('guide-title',()=>fill(selectors.guide,task.listing.guideTitle));
 await step('price',()=>fill('#sell-field-price input',task.business.price_cny));
 await step('inventory',()=>fill('#sell-field-batchInventory-card input',task.business.inventory));
 await step('brand',async()=>{const brand=p.locator('#struct-p-20000 input');if(await brand.inputValue()!==task.business.brand){await brand.click();const option=p.locator('.options-item').filter({has:p.getByText(task.business.brand,{exact:true})});await expect(option).toHaveCount(1);await option.click();await expect(brand).toHaveValue(task.business.brand);}await brand.press('Tab');await expect(brand).toHaveValue(task.business.brand);});
 await step('custom-service',()=>radio('#sell-field-customize',/^是$/));
 await step('listing-state',()=>radio('#sale-card',target === 'WAREHOUSE' ? /^放入仓库$/ : /^(立刻|立即)上架$/));
 await step('shipping-time',()=>radio('#deliver-card',/^24小时内发货/));
 await step('shipping-region',()=>radio('#sell-field-shippingArea',/^大陆及港澳台$/));
 await step('single-origin',()=>radio('#sell-field-shippingArea',/^单一发货地$/));
 await step('logistics',async()=>{const l=p.locator('#sell-field-tbExtractWay input[type=checkbox][value="2"]');await l.check();await expect(l).toBeChecked();});
 await step('freight-template',async()=>{await p.locator('#sell-field-tbExtractWay input[role=combobox]').click();await p.getByText(task.business.freight_template,{exact:true}).last().click();await expect(p.locator('#sell-field-tbExtractWay')).toContainText(task.business.freight_template);});
 await step('ship-from',async()=>{const l=p.locator('#sell-field-shippingArea input[role=combobox]');if(await l.getAttribute('aria-valuetext')!=='北京 / 北京'){await l.click();await p.getByText('北京',{exact:true}).first().click();await p.getByText('北京',{exact:true}).last().click();}await expect(l).toHaveAttribute('aria-valuetext','北京 / 北京');});
 await step('procurement',async()=>{if(!await p.locator('#sell-field-globalStock').isVisible())await p.locator('#base-card').getByText('展开',{exact:true}).click();await radio('#sell-field-globalStock',/^中国内地（大陆）$/);});
 await step('region-restriction',async()=>{const l=p.locator('#deliver-card label').filter({hasText:/^不设置商品维度区域限售模板$/}).locator('input');if(!await l.isVisible())await p.locator('#deliver-card').getByText('展开',{exact:true}).click();await expect(l).toBeChecked();});
 }
 await fillAttributes(p,task,{guard,step});
 let detailReceipts=JSON.parse(await readFile(dir+'detail-receipts.json','utf8').catch(()=>'[]'));
 const detailImgs=p.locator('#sell-field-descRepublicOfSell img.image-item');
 const insertedDetails=await detailImgs.evaluateAll(es=>es.map(e=>e.src));
 assert(insertedDetails.length<=details.length,'TOO_MANY_DETAIL_IMAGES');
 if(insertedDetails.length<details.length){
  if(!openDetailFrame)await step('open-details',async()=>{await p.locator('#sell-field-descRepublicOfSell').getByText('图片',{exact:true}).click();});
  let f=openDetailFrame;
  if(!f)for(const frame of p.frames())if(await frame.getByPlaceholder('搜索图片名称').isVisible().catch(()=>false))f=frame;
  assert(f,'DETAIL_MATERIAL_FRAME_NOT_READY');
  for(const [i,a] of details.entries())await step('select-detail-'+(i+1),async()=>{
   const name=basename(a.path),search=f.getByPlaceholder('搜索图片名称'),matches=f.locator('.PicList_pic_background__pGTdV').filter({hasText:name});
   const inserted=insertedDetails[i];
   const targetCard=inserted?matches.filter({has:f.locator(`img[src^="${norm(inserted)}"]`)}).first():matches.first();
   // Reuse the current material list during checkpoint recovery. Search only
   // when the required filename is absent, preserving the user's selection.
   if(!await targetCard.isVisible()){await search.fill(name);await search.press('Enter');}
   if(inserted)await expect(targetCard).toBeVisible();else await ensureMaterial(f,a,targetCard);await risk();
   const checked=matches.filter({has:f.locator('input[type=checkbox]:checked')}).first();
   const card=inserted?targetCard:await checked.count()?checked:targetCard;
   await expect(card.locator('.PicList_tip_title__aQfti')).toHaveText(name);
   const url=await card.locator('.PicList_pic_imgBox__c0HXw img').getAttribute('src');
   if(inserted)assert.equal(norm(url),norm(inserted),'EXISTING_DETAIL_MISMATCH');
   else{if(!await card.locator('input[type=checkbox]').isChecked())await card.locator('.PicList_pic_imgBox__c0HXw').click();await expect(card.locator('input[type=checkbox]')).toBeChecked();}
   detailReceipts[i]={order:i+1,source:a,url};await writeFile(dir+'detail-receipts.json',JSON.stringify(detailReceipts,null,2));
  });
  await step('insert-details',async()=>{await f.getByRole('button',{name:/确定/}).click();await expect(detailImgs).toHaveCount(details.length);});
 }
 await step('pre-submit-review',async()=>{
  await expect(detailImgs).toHaveCount(details.length);const urls=await detailImgs.evaluateAll(es=>es.map(e=>e.src));assert(urls.every((u,i)=>norm(u)===norm(detailReceipts[i]?.url||'')),'DETAIL_ORDER');
  await expect(p.locator('#sell-field-title input')).toHaveValue(task.listing.title);await expect(p.locator('#sell-field-price input')).toHaveValue(String(task.business.price_cny));await expect(p.locator('#sell-field-batchInventory-card input')).toHaveValue(String(task.business.inventory));
  await verifyForm(p,task,target,{main:receipts,details:detailReceipts});
  assert.equal(createHash('sha256').update(await readFile(task.source.workbook)).digest('hex'),task.source.sha256);
  await p.screenshot({path:dir+'pre-submit-full.png',fullPage:true});
  await writeFile(dir+'review.json',JSON.stringify({at:new Date().toISOString(),decision:'PASS_SOURCE_AND_FORM',mappingVersion:MAPPING_VERSION,order,source:task.source,title:task.listing.title,main:receipts,details:detailReceipts},null,2));
 });

 return {main:receipts,details:detailReceipts};
}

export async function verifyForm(p,task,target,receipts) {
 assert(newForm(p),'NEW_ITEMS_ONLY');
 await assertTaskFiles(task);
 await expect(p.locator('#global-card')).toContainText(/其[它他]商品定制/);
 for(const [selector,value] of [[selectors.title,task.listing.title],[selectors.price,task.business.price_cny],[selectors.stock,task.business.inventory],['#struct-p-20000 input',task.business.brand]])await expect(p.locator(selector)).toHaveValue(String(value));
 await expect(p.locator(selectors.guide)).toHaveValue(task.listing.guideTitle);
 for(const [scope,text] of [['#sale-card',target==='WAREHOUSE'?/^放入仓库$/:/^(立刻|立即)上架$/],['#sell-field-customize',/^是$/],['#deliver-card',/^24小时内发货/],['#sell-field-shippingArea',/^大陆及港澳台$/],['#sell-field-shippingArea',/^单一发货地$/],['#sell-field-globalStock',/^中国内地（大陆）$/],['#deliver-card',/^不设置商品维度区域限售模板$/]]) {
  await expect(p.locator(scope).locator('label').filter({hasText:text}).locator('input').first()).toBeChecked();
 }
 await expect(p.locator('#sell-field-shippingArea input[role=combobox]')).toHaveAttribute('aria-valuetext','北京 / 北京');
 await expect(p.locator('#sell-field-tbExtractWay input[type=checkbox][value="2"]')).toBeChecked();
 await expect(p.locator('#sell-field-tbExtractWay')).toContainText(task.business.freight_template);
 const main=await p.locator(`${selectors.main} img`).evaluateAll(es=>es.map(e=>e.src).filter(u=>u.includes('/2215038760087/')));
 const details=await p.locator(selectors.details).evaluateAll(es=>es.map(e=>e.src));
 assert.equal(main.length,5);assert.equal(details.length,task.assets.details.length);
  await verifyAttributes(p,task,async()=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');});
 assert(main.every((u,i)=>norm(u)===norm(receipts.main[i]?.url||'')),'MAIN_IMAGE_ORDER');
 assert(details.every((u,i)=>norm(u)===norm(receipts.details[i]?.url||'')),'DETAIL_IMAGE_ORDER');
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
 p=await context.newPage();onPage(p);await p.setViewportSize({width:1249,height:1100});await record({formPageCreated:true});
  await p.goto('https://upload.taobao.com/auction/sell.jhtml',{waitUntil:'domcontentloaded'});
 await guard(p);
 await p.getByText('其它商品定制',{exact:true}).click();
 await guard(p);
 await p.getByRole('button',{name:'确认，下一步',exact:true}).click();
 await expect.poll(()=>newForm(p),{timeout:30000}).toBeTruthy();
 await guard(p);
 await p.locator(selectors.title).fill(task.listing.title);await p.locator(selectors.title).press('Tab');
 await expect(p.locator(selectors.title)).toHaveValue(task.listing.title);await record({formUrl:p.url()});
 return p;
}

export async function submitTask(p,guard) {
 await guard();
 await p.getByRole('button',{name:'提交宝贝信息',exact:true}).click();
 await expect.poll(async()=>{await guard();return /商品提交成功/.test(await p.locator('body').innerText());},{timeout:30000}).toBeTruthy();
 const itemId=(await p.locator('body').innerText()).match(/商品ID[：:]\s*(\d+)/)?.[1];
 assert(itemId,'SUCCESS_WITHOUT_ITEM_ID');return itemId;
}

export async function verifyResult(context,task,itemId,target,dir,guard) {
 assert(/^\d+$/.test(itemId),'ITEM_ID_REQUIRED_FOR_RECONCILIATION');
 const url='https://myseller.taobao.com/home.htm/SellManage/all';
 let list=context.pages().find(p=>p.url().startsWith('https://myseller.taobao.com/home.htm/SellManage/'));
 if(!list) {list=await context.newPage();await list.goto(url,{waitUntil:'domcontentloaded'});}
 await guard(list);
 await expect(list.locator('div.shopName--x6nyUylx')).toHaveText(task.business.shop_name,{useInnerText:true});
 await list.getByRole('tab',{name:target==='WAREHOUSE'?/^仓库中\(/:/^全部\(/}).click();
 await list.locator('#queryTitle').fill('');await list.locator('#queryItemId').fill(itemId);
 await guard(list);await list.getByRole('button',{name:'搜索',exact:true}).click();
 const row=list.locator('tr').filter({hasText:'ID:'+itemId});
 await expect(row).toHaveCount(1,{timeout:20000});
 await expect(row).toContainText(task.listing.title);
 await expect(row).toContainText(Number(task.business.price_cny).toFixed(2));
 await expect(row).toContainText(String(task.business.inventory));
 if(target!=='WAREHOUSE')await expect(row).toContainText('出售中');
 else await expect(list.getByRole('tab',{name:/^仓库中\(/})).toHaveAttribute('aria-selected','true');
 await guard(list);
 const screenshot=dir+'verified-in-list.png';await list.screenshot({path:screenshot,fullPage:true});
 return {itemId,url:'https://item.taobao.com/item.htm?id='+itemId,status:target==='WAREHOUSE'?'仓库中':'出售中',rowText:await row.innerText(),screenshot,verifiedAt:new Date().toISOString()};
}
