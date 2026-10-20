// The inline empty subtree is the redacted original read-only DOM, not a guessed
// selector fixture. No production Chrome, profile, platform traffic, or uploads.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep,resolve,dirname,basename} from 'node:path';
import * as publisher from '../taobao-publisher.mjs';
import {digest,destinationKey} from '../source-store.mjs';

// Source: output/round700-20261008/paused-sku-r12/sales-specifications.html
const EMPTY_HTML="<div id=\"struct-saleProp\" class=\"com-struct\"><div></div></div>\n<div id=\"struct-customSaleProp\" class=\"com-struct\"><div></div></div>\n<div id=\"struct-sku\" class=\"com-struct\"><div class=\"sell-component-info-wrapper-wrap sell-horizon-layout-info-wrapper full-width label-horizontal\" id=\"sell-field-sku\"><div class=\"sell-component-info-wrapper-label-wrap label-container label-align-left\" style=\"width: 120px;\"><span class=\"sell-component-info-wrapper-label\" title=\"销售规格\">销售规格</span><i class=\"next-icon next-small\"><svg class=\"next-icon-remote sell-component-info-wrapper-help-icon\" focusable=\"false\"><use xlink:href=\"#qn_question\"></use></svg></i></div><div class=\"sell-component-info-wrapper-component-wrap\"><div class=\"sell-rich-text sell-component-info-wrapper-component-info position-top\">近期已升级SKU面板，优化SKU创建流程提升操作体验。<a href=\"https://helpcenter.taobao.com/servicehall/video_detail\" target=\"_blank\"> 查看详情 </a><a>。</a></div><div class=\"sell-component-info-wrapper-component-child-wrap\"><div class=\"sell-component-info-wrapper-component-child\"><div class=\"sell-new-sku-table-content\"><div class=\"sell-sku-table-wrapper-new is-taobao\"><div><div><button type=\"button\" class=\"next-btn next-medium next-btn-normal\"><span class=\"next-btn-helper\">+ 创建规格</span></button></div></div></div></div></div></div></div></div></div>\n";
const EMPTY_SHA='ce4ccd8867aeba3b92a075820b618829625293bc9cb9b9f618e78cef80f2b39f';
let browser,context,page,network=0;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext();await context.route('**/*',r=>{network++;return r.abort();});page=await context.newPage();});
after(async()=>{await context?.close();await browser?.close();});
async function empty(){await page.setContent('<main><div id="sale-card">'+EMPTY_HTML+'</div></main>');await page.evaluate(()=>{window.clicks=0;document.addEventListener('click',()=>window.clicks++);});}
test('recorded empty subtree retains its evidence hash and zero-height placeholders are normal',async()=>{
 assert.equal(createHash('sha256').update(EMPTY_HTML).digest('hex'),EMPTY_SHA);await empty();
 for(const id of ['struct-saleProp','struct-customSaleProp'])assert.equal((await page.locator('#'+id).boundingBox()).height,0);
 assert.equal(typeof publisher.assertNoSku,'function');const before=await page.locator('body').innerHTML(),result=await publisher.assertNoSku(page);
 assert.equal(result.status,'VERIFIED_EMPTY');assert.equal(result.skuCount,0);assert.equal(result.structureVersion,'taobao-no-sku-empty-20261008');assert(!Number.isNaN(Date.parse(result.checkedAt)));
 assert.equal(await page.locator('body').innerHTML(),before);assert.equal(await page.evaluate(()=>window.clicks),0);assert.equal(network,0);
});

const mutations=[
 ['public shadow configuration on sale-card',()=>{document.querySelector('#sale-card').attachShadow({mode:'open'}).innerHTML='<slot></slot><input value="sku">';}],
 ['public shadow configuration in sales placeholder',()=>{document.querySelector('#struct-saleProp > div').attachShadow({mode:'open'}).innerHTML='<input value="sku">';}],
 ['public shadow configuration in custom placeholder',()=>{document.querySelector('#struct-customSaleProp > div').attachShadow({mode:'open'}).innerHTML='<input value="sku">';}],
 ['public shadow configuration in SKU wrapper',()=>{document.querySelector('.sell-sku-table-wrapper-new').attachShadow({mode:'open'}).innerHTML='<slot></slot><input value="sku">';}],
 ['extra visible specification row',()=>document.querySelector('.sell-sku-table-wrapper-new').insertAdjacentHTML('beforeend','<div class="sku-row">颜色 红色</div>')],
 ['create button retained beside specification input',()=>document.querySelector('.sell-sku-table-wrapper-new').insertAdjacentHTML('beforeend','<input value="红色">')],
 ['hidden input configuration',()=>document.querySelector('#struct-sku').insertAdjacentHTML('beforeend','<input type="hidden" name="sku" value="configured">')],
 ['hidden nonempty row',()=>document.querySelector('.sell-sku-table-wrapper-new').insertAdjacentHTML('beforeend','<div hidden>红色</div>')],
 ['sales property content',()=>document.querySelector('#struct-saleProp > div').textContent='颜色'],
 ['custom property input',()=>document.querySelector('#struct-customSaleProp > div').insertAdjacentHTML('beforeend','<input value="行程">')],
 ['template content',()=>document.querySelector('.sell-sku-table-wrapper-new').insertAdjacentHTML('beforeend','<template><input value="sku"></template>')],
 ['configuration attribute',()=>document.querySelector('.sell-sku-table-wrapper-new').setAttribute('data-sku-values','configured')],
 ['unknown class state',()=>document.querySelector('.sell-sku-table-wrapper-new').classList.add('configured')],
 ['missing SKU root',()=>document.querySelector('#struct-sku').remove()],
 ['missing empty placeholder',()=>document.querySelector('#struct-saleProp').remove()],
 ['duplicate root even hidden',()=>{const x=document.querySelector('#struct-sku').cloneNode(true);x.hidden=true;document.body.append(x);}],
 ['duplicate sale-card',()=>document.body.insertAdjacentHTML('beforeend','<div id="sale-card"></div>')],
 ['duplicate content wrapper elsewhere',()=>document.body.insertAdjacentHTML('beforeend','<div class="sell-new-sku-table-content"></div>')],
 ['wrong direct ancestor',()=>{const x=document.querySelector('#struct-sku'),w=document.createElement('div');x.before(w);w.append(x);}],
 ['displaced custom placeholder',()=>document.body.append(document.querySelector('#struct-customSaleProp'))],
 ['collapsed main sale card',()=>document.querySelector('#sale-card').style.display='none'],
 ['collapsed ancestor',()=>document.querySelector('main').setAttribute('aria-expanded','false')],
 ['visibility hidden placeholder',()=>document.querySelector('#struct-saleProp').style.visibility='hidden'],
 ['zero-opacity SKU root',()=>document.querySelector('#struct-sku').style.opacity='0'],
 ['loading ancestor',()=>document.querySelector('#sale-card').setAttribute('aria-busy','true')],
 ['hidden create button',()=>document.querySelector('#struct-sku button').hidden=true],
 ['disabled create button',()=>document.querySelector('#struct-sku button').disabled=true],
 ['wrong create button text',()=>document.querySelector('#struct-sku button span').textContent='编辑规格'],
 ['additional button',()=>document.querySelector('#struct-sku button').after(document.querySelector('#struct-sku button').cloneNode(true))],
 ['empty tree changed',()=>document.querySelector('#struct-saleProp > div').append(document.createElement('span'))]
];
test('recorded hidden empty custom-property wrapper still certifies empty SKU without page writes',async()=>{
 await empty();await page.evaluate(()=>{const n=document.querySelector('#struct-customSaleProp'),w=document.createElement('div');w.style.display='none';n.before(w);w.append(n);});
 const before=await page.locator('body').innerHTML();assert.equal((await publisher.assertNoSku(page)).status,'VERIFIED_EMPTY');assert.equal(await page.locator('body').innerHTML(),before);assert.equal(await page.evaluate(()=>window.clicks),0);
});
for(const change of ['input','attribute','sibling-text','nested','shadow','other-style','visible-wrapper'])test('custom wrapper rejects extra '+change,async()=>{
 await empty();await page.evaluate(change=>{const n=document.querySelector('#struct-customSaleProp'),w=document.createElement('div');w.style.display='none';n.before(w);w.append(n);
  if(change==='input')w.append(document.createElement('input'));
  if(change==='attribute')w.setAttribute('data-values','configured');
  if(change==='sibling-text')w.append('规格');
  if(change==='nested'){const extra=document.createElement('div');n.before(extra);extra.append(n);}
  if(change==='shadow')w.attachShadow({mode:'open'}).innerHTML='<slot></slot>';
  if(change==='other-style')w.style.opacity='0';
  if(change==='visible-wrapper')w.removeAttribute('style');
 },change);await assert.rejects(publisher.assertNoSku(page),/NO_SKU_UNVERIFIED/);
});
for(const [name,mutate] of mutations)test('no-SKU rejects '+name+' without touching the page',async()=>{
 await empty();await page.evaluate(mutate);const before=await page.locator('body').innerHTML();
 await assert.rejects(publisher.assertNoSku(page),/NO_SKU_UNVERIFIED/);assert.equal(await page.locator('body').innerHTML(),before);assert.equal(await page.evaluate(()=>window.clicks),0);
});

async function form(t){
 const dir=await mkdtemp(join(tmpdir(),'ly-no-sku-'));t.after(async()=>{const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert(basename(target).startsWith('ly-no-sku-'));await rm(target,{recursive:true,force:true});});const file=join(dir,'source.txt');await writeFile(file,'isolated source');
 const asset={path:file,sha256:createHash('sha256').update('isolated source').digest('hex')};
 const task={priority:1,source:{workbook:file,sha256:asset.sha256},assets:{main:[asset],secondary:[asset,asset,asset,asset],details:[asset]},listing:{title:'测试目的地旅行服务',guideTitle:'旅行服务'},business:{category_path:'个性定制/设计服务/DIY/其它定制/其它商品定制',custom_service:true,procurement:'中国内地（大陆）',ship_from:'北京 / 北京',shipping_time:'24小时内发货',ship_from_region:'大陆及港澳台',region_restriction:'不设置商品维度区域限售模板',listing_time:'立刻上架',price_cny:20,inventory:999999,brand:'无品牌/无注册商标',freight_template:'隔离模板'}};
 const receipts={main:Array.from({length:5},(_,i)=>({source:asset,url:'https://img.alicdn.com/imgextra/i1/3997268470/main-'+i+'.png'})),details:[{order:1,source:asset,url:'https://fixture.invalid/detail.png'}]};
 const radio=text=>'<label><input type="radio" checked>'+text+'</label>';
 const html='<div id="global-card">其它商品定制</div><section id="sell-field-title"><input value="'+task.listing.title+'"></section><section id="sell-field-shopping_title"><input value="旅行服务"></section><section id="struct-p-20000"><input value="无品牌/无注册商标"></section><div id="sale-card">'+EMPTY_HTML+radio('立刻上架')+'<section id="sell-field-price"><input value="20"></section><section id="sell-field-batchInventory-card"><input value="999999"></section></div><section id="sell-field-customize">'+radio('是')+'</section><div id="deliver-card">'+radio('24小时内发货')+radio('不设置商品维度区域限售模板')+'</div><div id="sell-field-shippingArea">'+radio('大陆及港澳台')+radio('单一发货地')+'<input role="combobox" aria-valuetext="北京 / 北京"></div><section id="sell-field-globalStock">'+radio('中国内地（大陆）')+'</section><section id="sell-field-tbExtractWay"><input type="checkbox" value="2" checked>隔离模板</section><section id="sell-field-mainImagesGroup">'+receipts.main.map(r=>'<img src="'+r.url+'">').join('')+'</section><section id="sell-field-descRepublicOfSell"><img class="image-item" src="'+receipts.details[0].url+'"></section>';
 await page.route('https://item.upload.taobao.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm');
 await writeFile(join(dir,'main-receipts.json'),JSON.stringify(receipts.main));await writeFile(join(dir,'detail-receipts.json'),JSON.stringify(receipts.details));
 return {task,receipts,dir:dir+sep};
}

async function modernShipping(t){
 const f=await form(t);
 await page.locator('#sell-field-shippingArea').evaluate(el=>el.remove());
 await page.locator('#deliver-card').evaluate(el=>el.insertAdjacentHTML('beforeend','<div id="sell-field-tmDeliveryTime">发货时间24小时内发货</div><div id="sell-field-regionLimitSale">区域限售</div>'));
 await page.locator('#sell-field-tbExtractWay').evaluate(el=>el.insertAdjacentHTML('beforeend','<span class="next-select-single"><span class="next-select-values"><em>隔离模板</em><span><input role="combobox" aria-valuetext="隔离模板" aria-expanded="false"></span></span></span>'));
 return f;
}
test('current template-based form verifies without inventing absent standalone region/origin values',async t=>{
 const f=await modernShipping(t),before=JSON.stringify(f.task);
 const result=await publisher.verifyForm(page,f.task,'ONSALE',f.receipts);
 assert.equal(result.shippingArea.mode,'PLATFORM_TEMPLATE');assert.equal(result.shippingArea.standaloneOriginApplied,false);assert.equal(result.shippingArea.standaloneRegionApplied,false);
 assert.equal(result.noSku.status,'VERIFIED_EMPTY');assert.equal(JSON.stringify(f.task),before);
});
test('missing legacy controls cannot waive an uncommitted template or unfamiliar replacement',async t=>{
 const f=await modernShipping(t);
 await page.locator('.next-select-values > em').evaluate(el=>el.remove());
 await assert.rejects(publisher.inspectShippingArea(page,f.task),/FORM_FREIGHT_TEMPLATE_UNCONFIRMED/);
 await page.locator('.next-select-values').evaluate(el=>el.insertAdjacentHTML('afterbegin','<em>隔离模板</em>'));
 await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<div id="sell-field-newShipping"><span class="sell-component-info-wrapper-label">配送范围</span><input></div>'));
 await assert.rejects(publisher.inspectShippingArea(page,f.task),/FORM_SHIPPING_MAPPING_CHANGED/);
});

test('final review rejects changing legacy fields into template mode and the reverse',async t=>{
 const f=await modernShipping(t);
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',{...f.receipts,shippingArea:{mode:'LEGACY_FIELDS',rendered:true}}),/FORM_SHIPPING_AREA_CHANGED/);
 const current=await publisher.verifyForm(page,f.task,'ONSALE',f.receipts);
 await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<div id="sell-field-shippingArea">changed legacy fields</div>'));
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',{...f.receipts,shippingArea:current.shippingArea}),/FORM_SHIPPING_AREA_CHANGED/);
});

test('final review uses confirmed shop template while retaining original task business snapshot',async t=>{
 const f=await form(t);f.task.shopId='profile-fixture';const before=JSON.stringify(f.task);
 const profile={version:1,shopId:f.task.shopId,confirmedBy:'用户',sha256:'approved-fixture',freightTemplate:{from:'隔离模板',to:'旅游产品'}};
 await page.locator('#sell-field-tbExtractWay').evaluate(el=>{for(const n of el.childNodes)if(n.nodeType===Node.TEXT_NODE)n.textContent=n.textContent.replace('隔离模板','旅游产品');});
 await publisher.verifyForm(page,f.task,'ONSALE',f.receipts,profile);assert.equal(JSON.stringify(f.task),before);
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',f.receipts,{...profile,shopId:'other-shop'}),/FORM_FREIGHT_TEMPLATE_BINDING_INVALID/);
});

test('new-shop shipping controls load after logistics and template selection, before region and origin',async t=>{
 const f=await form(t),steps=[];
 await page.evaluate(()=>{
  const area=document.querySelector('#sell-field-shippingArea'),html=area.outerHTML;area.remove();
  const box=document.querySelector('#sell-field-tbExtractWay input[type=checkbox]');box.checked=false;
  const combo=document.createElement('input');combo.setAttribute('role','combobox');
  const menu=document.createElement('div');menu.hidden=true;menu.textContent='隔离模板';
  combo.onclick=()=>{if(box.checked)menu.hidden=false;};
  menu.onclick=()=>{menu.hidden=true;document.querySelector('#deliver-card').insertAdjacentHTML('beforeend',html);};
  document.querySelector('#sell-field-tbExtractWay').append(combo);document.body.append(menu);
 });
 await publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',guard:async()=>{},step:async(name,fn)=>{
  if(['logistics','freight-template','shipping-region','single-origin'].includes(name)){steps.push(name);await fn();}
 }});
 assert.deepEqual(steps,['logistics','freight-template','shipping-region','single-origin']);
 assert.equal(await page.locator('#sell-field-tbExtractWay input[type=checkbox]').isChecked(),true);
 assert.equal(await page.locator('#sell-field-shippingArea label').filter({hasText:'大陆及港澳台'}).locator('input').isChecked(),true);
 assert.equal(await page.locator('#sell-field-shippingArea label').filter({hasText:'单一发货地'}).locator('input').isChecked(),true);
});

test('real fill loop resumes all five new-shop images without selecting or uploading them again',async t=>{
 const f=await form(t),steps=[];
 await page.evaluate(()=>{window.clicks=0;document.addEventListener('click',()=>window.clicks++);});
 const result=await publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',guard:async()=>{},step:async(name,fn)=>{
  if(/^main-image-\d+$/.test(name)){steps.push(name);await fn();}
 }});
 assert.equal(steps.length,5);assert.equal(await page.evaluate(()=>window.clicks),0);assert.deepEqual(result.main,f.receipts.main);
});

test('new shop five-image final review passes and a foreign seller image is rejected',async t=>{
 const f=await form(t);assert.equal((await publisher.verifyForm(page,f.task,'ONSALE',f.receipts)).noSku.status,'VERIFIED_EMPTY');
 await page.locator('#sell-field-mainImagesGroup img').nth(3).evaluate(el=>el.src=el.src.replace('3997268470','2215038760087'));
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',f.receipts),/MAIN_IMAGE_ORDER/);
});

test('final review rereads files after filling and still blocks source changes',async t=>{
 const f=await form(t);await publisher.verifyForm(page,f.task,'ONSALE',f.receipts);
 await writeFile(f.task.source.workbook,'modified after filling');
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',f.receipts),/SOURCE_OR_ASSET_CHANGED/);
});

test('bound detail version is used in final review and rejects stale receipts or another file edit',async t=>{
 const f=await form(t),path=join(f.dir,'detail.png');f.task.shopId='binding-fixture';f.task.listing.type='country';f.task.listing.country='测试国';
 const old={path,sha256:digest(Buffer.from('old detail'))},effectivePath=join(f.dir,'detail--v-approved.png');f.task.assets.details=[old];await writeFile(path,'approved cropped detail');await writeFile(effectivePath,'approved cropped detail');
 const payload={version:1,confirmedBy:'用户',shopId:f.task.shopId,roundId:'original-round',manifestHash:'original-manifest',key:destinationKey(f.task),taskHash:digest(f.task),importId:'new-import',reason:'user approved crop',changes:[{group:'details',index:0,path,effectivePath,fromSha256:old.sha256,toSha256:digest(Buffer.from('approved cropped detail'))}]};
 const binding={...payload,sha256:digest(payload)},before=JSON.stringify(f.task),receipts={...f.receipts,materialBindingSha256:binding.sha256,details:[{...f.receipts.details[0],source:(await publisher.executionDetailImages(f.task,null,binding))[0]}]};
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',receipts,null,binding),/BOUND_MATERIAL_UPLOAD_UNVERIFIED/);
 await writeFile(effectivePath+'.upload.json',JSON.stringify({path:effectivePath,sha256:receipts.details[0].source.sha256,materialVersion:receipts.details[0].source.materialVersion,url:receipts.details[0].url}));
 await writeFile(join(f.dir,'detail-receipts.json'),JSON.stringify(receipts.details));
 const filled=await publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',materialBinding:binding,guard:async()=>{},step:async(name,fn)=>{if(name==='pre-submit-review')await fn();}});
 assert.equal(filled.materialBindingSha256,binding.sha256);
 await publisher.verifyForm(page,f.task,'ONSALE',filled,null,binding);assert.equal(JSON.stringify(f.task),before);
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',{...receipts,materialBindingSha256:'stale'},null,binding),/SOURCE_OR_ASSET_CHANGED/);
 await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',{...receipts,details:[{...receipts.details[0],source:old}]},null,binding),/DETAIL_SOURCE_MISMATCH/);
 await writeFile(path,'edited again');await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',receipts,null,binding),/SOURCE_OR_ASSET_CHANGED/);
});

test('verifyForm fails with extra SKU despite correct title, price, inventory, images and creation button',async t=>{
 const f=await form(t);await page.evaluate(mutations.find(([name])=>name==='extra visible specification row')[1]);await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',f.receipts),/NO_SKU_UNVERIFIED/);
});
test('verifyForm repeats the DOM check after a previously successful check',async t=>{
 const f=await form(t),first=await publisher.verifyForm(page,f.task,'ONSALE',f.receipts);assert.equal(first?.noSku?.status,'VERIFIED_EMPTY');
 await page.evaluate(mutations.find(([name])=>name==='hidden input configuration')[1]);await assert.rejects(publisher.verifyForm(page,f.task,'ONSALE',f.receipts),/NO_SKU_UNVERIFIED/);
});
test('pre-submit review persists the no-SKU result and refuses to write PASS for a changed structure',async t=>{
 const f=await form(t),step=async(name,fn)=>{if(name==='pre-submit-review')await fn();};
 await publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',guard:async()=>{},step});
 const good=JSON.parse(await readFile(join(f.dir,'review.json'),'utf8'));assert.equal(good.decision,'PASS_SOURCE_AND_FORM');assert.equal(good.noSku?.status,'VERIFIED_EMPTY');assert.equal(good.noSku?.skuCount,0);
 await page.evaluate(mutations.find(([name])=>name==='hidden nonempty row')[1]);await assert.rejects(publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',guard:async()=>{},step}),/NO_SKU_UNVERIFIED/);
 assert.deepEqual(JSON.parse(await readFile(join(f.dir,'review.json'),'utf8')),good);
});

test('partial detail recovery reuses proven inserted prefix even when that asset is absent in the picker',async t=>{
 const f=await form(t),next={path:join(f.dir,'second.txt'),sha256:f.task.assets.details[0].sha256};await writeFile(next.path,'isolated source');f.task.assets.details.push(next);
 const picker='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
 await page.route(picker,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<input placeholder="搜索图片名称"><div class="PicList_pic_background__pGTdV"><span class="PicList_tip_title__aQfti">second.txt</span><div class="PicList_pic_imgBox__c0HXw" onclick="document.querySelector('input[type=checkbox]').checked=true"><img src="https://fixture.invalid/second.png"></div><input type="checkbox"></div><button onclick="parent.postMessage('insert-second','https://item.upload.taobao.com')">确定</button>`}));
 await page.evaluate(url=>{window.addEventListener('message',e=>{if(e.origin==='https://market.m.taobao.com'&&e.data==='insert-second'){document.querySelector('#sell-field-descRepublicOfSell').insertAdjacentHTML('beforeend','<img class="image-item" src="https://fixture.invalid/second.png">');document.querySelector('.media-img-plug').remove();}});document.body.insertAdjacentHTML('beforeend','<div class="media-img-plug"><iframe src="'+url+'"></iframe></div>');},picker);
 const steps=[];const result=await publisher.fillTask({page,task:f.task,dir:f.dir,target:'ONSALE',guard:async()=>{},step:async(name,fn)=>{steps.push(name);if(name.startsWith('select-detail-')||name==='insert-details'||name==='pre-submit-review')await fn();}});
 assert.equal(result.details.length,2);assert.equal(result.details[0].source.path,f.task.assets.details[0].path);assert.equal(result.details[1].source.path,next.path);assert.equal(await page.locator('#sell-field-descRepublicOfSell img').count(),2);assert(steps.includes('pre-submit-review'));
});
test('partial detail recovery refuses missing receipt, wrong source, reordered image or changed bound version',async()=>{
 const a={path:'original.png',sha256:'fixed'},r={order:1,source:a,url:'https://fixture.invalid/original.png'};
 await assert.rejects(publisher.verifyInsertedDetails([r.url],[a],[]),/RECEIPT_MISSING/);
 await assert.rejects(publisher.verifyInsertedDetails([r.url],[{...a,sha256:'edited'}],[r]),/SOURCE_MISMATCH/);
 await assert.rejects(publisher.verifyInsertedDetails(['https://fixture.invalid/other.png'],[a],[r]),/EXISTING_DETAIL_MISMATCH/);
 await assert.rejects(publisher.verifyInsertedDetails([r.url],[{...a,materialVersion:{version:2}}],[r]),/SOURCE_MISMATCH/);
});
