import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(new URL('../package.json',import.meta.url))('playwright');
import {setTimeout as delay} from 'node:timers/promises';
import {waitDetailMaterialFrame} from '../taobao-publisher.mjs';
let browser,context,page,content,requests;
const url='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
const ready='<input placeholder="搜索图片名称"><button>确定</button>';
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{await context?.close();context=await browser.newContext();requests=[];content=ready;await context.route('**/*',async r=>{requests.push(r.request().url());if(r.request().url().startsWith(url))await r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:content});else await r.abort();});page=await context.newPage();});
const mount=async(html=`<div class="media-img-plug"><iframe src="${url}"></iframe></div>`)=>page.setContent(html);
const guard=async()=>{};
const options={timeout:1500};
test('old one-shot frame scan fails on delayed picker; candidate waits for that same picker',async()=>{
 content=`<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(ready)},500)</script>`;await mount();
 let old;for(const f of page.frames())if(await f.getByPlaceholder('搜索图片名称').isVisible())old=f;
 assert.equal(old,undefined);let checks=0;
 const found=await waitDetailMaterialFrame(page,async()=>{checks++;},options);
 assert.equal(found.url(),url);assert(checks>=2);assert.equal(requests.length,1);
});
test('picker may attach asynchronously after click without repeating click',async()=>{
 await mount('<button onclick="window.clicks=(window.clicks||0)+1;setTimeout(()=>document.body.insertAdjacentHTML(\'beforeend\',\'<div class=media-img-plug><iframe src='+url+'></iframe></div>\'),350)">图片</button>');
 await page.getByRole('button',{name:'图片'}).click();
 await waitDetailMaterialFrame(page,guard,options);assert.equal(await page.evaluate(()=>window.clicks),1);
});
test('optional entry has no picker and returns null without creating it',async()=>{
 await mount('<input placeholder="搜索图片名称"><button>确定</button>');assert.equal(await waitDetailMaterialFrame(page,guard,{required:false,...options}),null);assert.equal(requests.length,0);
});
test('resume with existing loading picker waits without editing or reopening',async()=>{
 content=`<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(ready)},300)</script>`;await mount();
 const f=await waitDetailMaterialFrame(page,guard,{required:false,...options});assert.equal(f.url(),url);assert.equal(requests.length,1);
});
test('permanent blank picker has finite timeout and no navigation retries',async()=>{
 content='';await mount();const start=Date.now();await assert.rejects(waitDetailMaterialFrame(page,guard,{timeout:350}),/DETAIL_MATERIAL_FRAME_NOT_READY/);assert(Date.now()-start<2500);assert.equal(requests.length,1);
});
test('unrelated ready main-image frame is never mistaken for details',async()=>{
 await mount(`<div class="media-img-plug"><iframe id="mainImagesGroup" src="${url}"></iframe></div>`);await assert.rejects(waitDetailMaterialFrame(page,guard,{timeout:300}),/DETAIL_MATERIAL_FRAME_NOT_READY/);
 assert.equal(await waitDetailMaterialFrame(page,guard,{required:false,...options}),null);
});
test('two visible detail picker hosts are ambiguous',async()=>{
 await mount(`<div class="media-img-plug"><iframe src="${url}"></iframe><iframe src="${url}"></iframe></div>`);await assert.rejects(waitDetailMaterialFrame(page,guard,options),/DETAIL_MATERIAL_FRAME_AMBIGUOUS/);
});
test('wrong origin or path rejected even if host exists',async()=>{
 for(const src of ['about:blank','https://example.com/picker',url+'-wrong']){await mount(`<div class="media-img-plug"><iframe src="${src}"></iframe></div>`);await assert.rejects(waitDetailMaterialFrame(page,guard,options),/DETAIL_MATERIAL_FRAME_ORIGIN/);}
});
test('replaced or hidden retained host cannot silently switch to another picker',async()=>{
 for(const mutation of ['document.querySelector("iframe").remove()','document.querySelector("iframe").style.display="none"']){
  content='';await mount();let calls=0;await assert.rejects(waitDetailMaterialFrame(page,async()=>{if(++calls===2)await page.evaluate(mutation);},options),/DETAIL_MATERIAL_FRAME_CHANGED/);
 }
});
test('guard failure during wait is propagated and does not retry operation',async()=>{
 content='';await mount();let calls=0;await assert.rejects(waitDetailMaterialFrame(page,async()=>{if(++calls===2)throw Error('PAUSED_BY_USER');},options),/PAUSED_BY_USER/);assert.equal(calls,2);assert.equal(requests.length,1);
});
test('fresh guard must pass again immediately before returning ready frame',async()=>{
 await mount();let calls=0;await assert.rejects(waitDetailMaterialFrame(page,async()=>{if(++calls===2)throw Error('WRONG_SHOP');},options),/WRONG_SHOP/);
});
test('search without confirmation and readonly search remain unready',async()=>{
 for(const html of ['<input placeholder="搜索图片名称">','<input placeholder="搜索图片名称" readonly><button>确定</button>']){content=html;await mount();await assert.rejects(waitDetailMaterialFrame(page,guard,{timeout:300}),/DETAIL_MATERIAL_FRAME_NOT_READY/);await page.setContent('');}
});
test('duplicate search control fails closed',async()=>{
 content=ready+'<input placeholder="搜索图片名称">';await mount();await assert.rejects(waitDetailMaterialFrame(page,guard,options),/DETAIL_MATERIAL_FRAME_AMBIGUOUS/);
});
test('visible CAPTCHA interrupts same-frame wait',async()=>{
 content='<div id="nc_1_wrapper">请拖动滑块验证</div>';await mount();await assert.rejects(waitDetailMaterialFrame(page,guard,options),/PAUSED_CAPTCHA/);
});
