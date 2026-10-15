import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(new URL('../package.json',import.meta.url))('playwright');
import {clickMainImageAndVerify,closeMainImageActionMenu,reconcileMainImages} from '../taobao-publisher.mjs';
let browser,context,page,events,clicks;
const urls=[1,2,3].map(i=>'https://img.alicdn.com/imgextra/i1/2215038760087/test'+i+'.png');
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();});
beforeEach(async()=>{await context?.close();context=await browser.newContext();await context.route('**/*',r=>r.abort());page=await context.newPage();await page.setContent('<div id="sell-field-mainImagesGroup"></div>');events=[];clicks=0;});
const set=async values=>page.locator('#sell-field-mainImagesGroup').evaluate((e,values)=>{e.replaceChildren(...values.map(src=>Object.assign(document.createElement('img'),{src})));},values);
const timeout=()=>Object.assign(new Error('click action done; waiting for scheduled navigations to finish'),{name:'TimeoutError'});
const card=fn=>({locator:()=>({click:async()=>{clicks++;await fn();}})});
const guard=async()=>{},opts={onEvent:async e=>events.push(e)};
for(const seller of ['2215038760087','3997268470','new-shop-assets'])test('five images reconcile in order for seller '+seller+' without reselecting the first image',async()=>{
 const assets=Array.from({length:5},(_,i)=>({path:'frozen/main-'+i+'.png',sha256:String(i).repeat(64)}));
 const receipts=assets.map((source,i)=>({source,url:`https://img.alicdn.com/imgextra/i1/${seller}/main-${i}.png_320x320?t=1792068318000`}));
 await set([receipts[0].url.replace('.png_320x320?t=1792068318000','.png_320x320q80_.webp')]);
 assert.equal((await reconcileMainImages(page,receipts,assets)).length,1);
 for(let i=1;i<5;i++){
  const prefix=receipts.slice(0,i+1).map(r=>r.url);
  await clickMainImageAndVerify(page,card(()=>set(prefix)),prefix,guard,opts);
  assert.equal((await reconcileMainImages(page,receipts,assets)).length,i+1);
 }
 assert.equal(clicks,4);assert.deepEqual(events,[]);
});

test('resume rejects wrong order, foreign seller, missing receipt, changed source and unaccounted images',async()=>{
 const assets=urls.map((_,i)=>({path:'frozen-'+i,sha256:String(i).repeat(64)}));
 const receipts=assets.map((source,i)=>({source,url:urls[i]}));
 for(const actual of [[urls[1],urls[0]],[urls[0].replace('2215038760087','3997268470')],[...urls,urls[0]]]){
  await set(actual);await assert.rejects(reconcileMainImages(page,receipts,assets),/MAIN_IMAGE_ORDER|MAIN_IMAGE_COUNT_CHANGED/);
 }
 await set([urls[0]]);
 await assert.rejects(reconcileMainImages(page,[],assets),/UNRECONCILED_EXISTING_IMAGE/);
 await assert.rejects(reconcileMainImages(page,[{...receipts[0],source:{...assets[0],sha256:'changed'}}],assets),/UNRECONCILED_EXISTING_IMAGE/);
 assert.equal(clicks,0);
});

test('successful click validates entire prefix and does not create recovery event',async()=>{
 await set(urls.slice(0,2));await clickMainImageAndVerify(page,card(()=>set(urls)),urls,guard,opts);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('actual native iframe click applies its parent form image exactly once',async()=>{
 await context.unroute('**/*');await context.route('https://picker.test/pending',()=>new Promise(()=>{}));
 await page.evaluate(src=>{window.clickCount=0;window.addEventListener('message',e=>{if(e.data==='pick'){window.clickCount++;document.querySelector('#sell-field-mainImagesGroup').append(Object.assign(document.createElement('img'),{src}));}});},urls[0]);
 await page.locator('body').evaluate(e=>{const f=document.createElement('iframe');f.srcdoc='<div class="PicList_pic_background__pGTdV"><div class="PicList_pic_imgBox__c0HXw" onclick="parent.postMessage(\'pick\',\'*\');location.href=\'https://picker.test/pending\'">图片</div></div>';e.append(f);});
 page.setDefaultTimeout(600);const nativeCard=page.frameLocator('iframe').locator('.PicList_pic_background__pGTdV');
 await clickMainImageAndVerify(page,nativeCard,[urls[0]],guard,opts);
 assert.equal(await page.evaluate(()=>window.clickCount),1);assert.equal(events.length,0);
});
test('applied timeout reconciles exact three-image prefix and retains diagnostic',async()=>{
 await set(urls.slice(0,2));await clickMainImageAndVerify(page,card(async()=>{await set(urls);throw timeout();}),urls,guard,opts);assert.equal(clicks,1);assert.equal(events[0].kind,'MAIN_IMAGE_CLICK_TIMEOUT_RECONCILED');assert.match(events[0].originalError,/navigation/);
});
test('timeout without effect stays paused and is never repeated',async()=>{
 await assert.rejects(clickMainImageAndVerify(page,card(async()=>{throw timeout();}),[urls[0]],guard,opts));assert.equal(clicks,1);assert.equal(events.length,0);
});
test('wrong order, wrong URL, or an extra image cannot be treated as success',async()=>{
 for(const actual of [[urls[1],urls[0],urls[2]],[urls[0],urls[1],urls[2]+'?t=resize_320x320'],[...urls,'https://img.alicdn.com/imgextra/i1/999999/wrong.png']]){
  await set(urls.slice(0,2));await assert.rejects(clickMainImageAndVerify(page,card(async()=>{await set(actual);throw timeout();}),urls,guard,opts));
 }
 assert.equal(clicks,3);assert.equal(events.length,0);
});
test('observed CDN thumbnail variants match; host and filename are preserved',async()=>{
 await clickMainImageAndVerify(page,card(async()=>{await set([urls[0]+'_320x320q80_.webp']);throw timeout();}),[urls[0]+'_320x320?t=1791781640000'],guard,opts);assert.equal(events.length,1);
});
test('preexisting prefix mismatch stops before any click',async()=>{
 await set([urls[1],urls[0]]);await assert.rejects(clickMainImageAndVerify(page,card(async()=>{}),urls,guard,opts),/MAIN_IMAGE_PREFIX_CHANGED/);assert.equal(clicks,0);
});
test('non-timeout click error is not swallowed even if images happen to match',async()=>{
 await assert.rejects(clickMainImageAndVerify(page,card(async()=>{await set([urls[0]]);throw Error('TARGET_CLOSED');}),[urls[0]],guard,opts),/TARGET_CLOSED/);assert.equal(events.length,0);
});
test('fresh guard stops after applied click; CAPTCHA is not converted to success',async()=>{
 let n=0;await assert.rejects(clickMainImageAndVerify(page,card(async()=>{await set([urls[0]]);throw timeout();}),[urls[0]],async()=>{if(++n===4)throw Error('PAUSED_CAPTCHA');},opts),/PAUSED_CAPTCHA/);assert.equal(clicks,1);assert.equal(events.length,0);
});
test('final guard detects mutation after first successful postcondition',async()=>{
 let n=0;await assert.rejects(clickMainImageAndVerify(page,card(async()=>{await set([urls[0]]);throw timeout();}),[urls[0]],async()=>{if(++n===5)await set([urls[1]]);},opts),/MAIN_IMAGE_STATE_CHANGED/);assert.equal(clicks,1);assert.equal(events.length,0);
});
test('closes only the known main-image action menu with Escape and verifies it is hidden',async()=>{
 await page.setContent('<ul role="menu" class="sell-component-material-item-media-operator"><li role="menuitem">裁剪</li><li role="menuitem">替换</li><li role="menuitem">删除</li><li role="menuitem">AI 作图</li></ul><input id="guide" value="卢布林波兰定制行程地陪导游商务">');
 await page.evaluate(()=>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('[role="menu"]').hidden=true;}));
 let guards=0;assert.deepEqual(await closeMainImageActionMenu(page,async()=>guards++),{closed:true});
 assert.equal(await page.locator('#guide').inputValue(),'卢布林波兰定制行程地陪导游商务');assert.equal(await page.locator('[role="menu"]').isVisible(),false);assert.equal(guards,2);
});
test('does not dismiss unrelated or changed menus',async()=>{
 await page.setContent('<ul role="menu" class="sell-component-material-item-media-operator"><li role="menuitem">裁剪</li><li role="menuitem">删除</li></ul>');
 let keys=0;await page.evaluate(()=>document.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapeSeen=true;}));
 await assert.rejects(closeMainImageActionMenu(page,async()=>{}),/MAIN_IMAGE_MENU_CHANGED/);keys=await page.evaluate(()=>window.escapeSeen?1:0);assert.equal(keys,0);assert.equal(await page.locator('[role="menu"]').isVisible(),true);
 await page.locator('[role="menu"]').evaluate(e=>e.remove());assert.deepEqual(await closeMainImageActionMenu(page,async()=>{}),{closed:false});
});
