import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(new URL('../package.json',import.meta.url))('playwright');
import {waitMainMaterialFrame,waitDetailMaterialFrame} from '../taobao-publisher.mjs';
let browser,context,page,content,requests;
const url='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
const ready='<input placeholder="搜索图片名称" value="原搜索"><div class="PicList_pic_background__pGTdV">原图片</div>';
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{await context?.close();context=await browser.newContext();requests=[];content=ready;await context.route('**/*',async r=>{requests.push(r.request().url());if(r.request().url().startsWith(url))await r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:content});else await r.abort();});page=await context.newPage();});
const host=(id='mainImagesGroup',src=url)=>`<div class="media-img-plug"><iframe ${id?`id="${id}"`:''} src="${src}"></iframe></div>`;
const mount=(html=host())=>page.setContent(html);
const guard=async()=>{},options={timeout:1000};
test('main picker ready after former five-second limit; same iframe and search value retained',async()=>{
 content=`<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(ready)},5400)</script>`;await mount();
 const old=page.frameLocator('#mainImagesGroup').getByPlaceholder('搜索图片名称');
 await assert.rejects(old.waitFor({state:'visible',timeout:5000}));
 const f=await waitMainMaterialFrame(page,guard,{timeout:2000});assert.equal(f.url(),url);
 assert.equal(await f.getByPlaceholder('搜索图片名称').inputValue(),'原搜索');assert.equal(requests.length,1);
});
test('retained main inside media-img-plug is not a detail picker; read does not reopen it',async()=>{
 await mount();assert.equal(await waitDetailMaterialFrame(page,guard,{required:false,...options}),null);
 const f=await waitMainMaterialFrame(page,guard,options);assert.equal(f.name(),'mainImagesGroup');assert.equal(requests.length,1);
});
test('actual no-ID detail remains supported and never substitutes for main',async()=>{
 content=ready+'<button>确定</button>';await mount(host(''));
 assert.equal((await waitDetailMaterialFrame(page,guard,options)).url(),url);
 await assert.rejects(waitMainMaterialFrame(page,guard,{timeout:200}),/MAIN_MATERIAL_FRAME_NOT_READY/);
});
test('asynchronous main host is observed without a second opening click',async()=>{
 await mount(`<button onclick='window.clicks=(window.clicks||0)+1;setTimeout(()=>document.body.insertAdjacentHTML("beforeend",${JSON.stringify(host())}),250)'>上传图片</button>`);
 await page.getByRole('button').click();await waitMainMaterialFrame(page,guard,options);assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(requests.length,1);
});
test('two mains or simultaneous detail/main are rejected',async()=>{
 for(const html of [host()+host(),host()+host('')]){content=ready+'<button>确定</button>';await mount(html);await assert.rejects(waitMainMaterialFrame(page,guard,options),/MAIN_MATERIAL_FRAME_AMBIGUOUS/);}
 await assert.rejects(waitDetailMaterialFrame(page,guard,{required:false,...options}),/DETAIL_MATERIAL_FRAME_AMBIGUOUS/);
});
test('foreign, credential-bearing, lookalike, and wrong-path sources rejected',async()=>{
 for(const src of ['https://example.com/picker','https://market.m.taobao.com.evil.test/app/crs-qn/sucai-selector-ng/index','https://user@market.m.taobao.com/app/crs-qn/sucai-selector-ng/index',url+'-wrong']){
  await mount(host('mainImagesGroup',src));await assert.rejects(waitMainMaterialFrame(page,guard,options),/MAIN_MATERIAL_FRAME_ORIGIN/);
 }
});
test('blank, readonly or disabled search stops with bounded wait and no reload',async()=>{
 for(const html of ['',ready.replace('<input','<input readonly'),ready.replace('<input','<input disabled')]){
  content=html;await mount();const count=requests.length;await assert.rejects(waitMainMaterialFrame(page,guard,{timeout:200}),/MAIN_MATERIAL_FRAME_NOT_READY/);assert.equal(requests.length,count);
 }
});
test('replaced or hidden host is not silently reacquired',async()=>{
 for(const mutation of ['document.querySelector("iframe").outerHTML=document.querySelector("iframe").outerHTML','document.querySelector("iframe").style.display="none"']){
  content='';await mount();let calls=0;await assert.rejects(waitMainMaterialFrame(page,async()=>{if(++calls===2)await page.evaluate(mutation);},options),/MAIN_MATERIAL_FRAME_CHANGED/);
 }
});
test('duplicate searches and visible CAPTCHA fail closed',async()=>{
 content=ready+ready;await mount();await assert.rejects(waitMainMaterialFrame(page,guard,options),/MAIN_MATERIAL_FRAME_AMBIGUOUS/);
 content='<div id="nc_1_wrapper">请拖动滑块验证</div>';await mount();await assert.rejects(waitMainMaterialFrame(page,guard,options),/PAUSED_CAPTCHA/);
});
test('fresh final guard and final readiness cannot be skipped',async()=>{
 for(const type of ['stop','disable','detail']){
  content=ready;await mount();let calls=0;await assert.rejects(waitMainMaterialFrame(page,async()=>{if(++calls!==2)return;if(type==='stop')throw Error('PAUSED_BY_USER');if(type==='disable')await page.frameLocator('#mainImagesGroup').getByPlaceholder('搜索图片名称').evaluate(e=>e.disabled=true);if(type==='detail')await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),host(''));},options),/PAUSED_BY_USER|MAIN_MATERIAL_FRAME_NOT_READY|MAIN_MATERIAL_FRAME_AMBIGUOUS/);
 }
});
