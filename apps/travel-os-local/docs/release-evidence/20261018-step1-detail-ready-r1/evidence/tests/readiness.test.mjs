import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(new URL('./dev/workbench/package.json',import.meta.url))('playwright');
const {expect}=createRequire(new URL('./dev/workbench/package.json',import.meta.url))('playwright/test');
import {openMaterialUpload as originalOpen} from '../../workbench/publishing-materials.mjs';
import {openMaterialUpload,uploadMaterial,waitDetailThumbnail,waitMaterialReadiness,DETAIL_MATERIAL_BUDGETS} from './dev/workbench/publishing-materials.mjs';
import {waitDetailMaterialFrame} from './dev/workbench/taobao-publisher.mjs';
import {ExecutionSteps} from './dev/workbench/execution-steps.mjs';
import {classifyRoundFailure} from './dev/workbench/listing-round.mjs';
import {SourceStore,digest} from './dev/workbench/source-store.mjs';

const evidence=JSON.parse(await readFile(new URL('./original-item12-evidence.json',import.meta.url),'utf8'));
const asset=evidence.item.assets.details[0],imageBytes=await readFile(asset.path),name=basename(asset.path);
assert.equal(createHash('sha256').update(imageBytes).digest('hex'),asset.sha256);
const out=join(import.meta.dirname,'tests',new Date().toISOString().replaceAll(/[:.]/g,'-'));await mkdir(out,{recursive:true});
let browser,context,page,diagnostics=[],records=[],networkAttempts=[];
const guard=async()=>{};
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
beforeEach(async()=>{
 await context?.close();context=await browser.newContext({serviceWorkers:'block'});diagnostics=[];
 await context.route('**/*',async route=>{networkAttempts.push(route.request().url());if(route.request().url()==='https://fixture.invalid/item12.png')await route.fulfill({contentType:'image/png',body:imageBytes});else await route.abort();});
 page=await context.newPage();page.setDefaultTimeout(8000);
});
after(async()=>{
 await context?.close();await browser?.close();
 await writeFile(join(out,'reproduction.json'),JSON.stringify({item:12,originalAsset:{name,sha256:asset.sha256},scope:'Isolated DOM with actual item 12 detail asset; injected delays are not historical platform latency',records,networkPolicy:'All requests fulfilled locally or aborted, no continuation',requests:networkAttempts},null,2));
 console.log('REPRODUCTION_JSON='+join(out,'reproduction.json'));
});
const onDiagnostic=async d=>{const entry={...d};if(d.status==='failed'){entry.screenshot=join(out,'failure-'+diagnostics.length+'-'+Date.now()+'.png');await page.screenshot({path:entry.screenshot});}diagnostics.push(entry);};
const uploadFixture=({entryDelay=0,receiptDelay=0,receipt='1 个文件上传成功',disabled=false}={})=>`<section role="dialog" aria-label="上传素材" hidden><label><input type="checkbox">添加水印</label><label><input type="checkbox" checked>原图上传</label><label><input type="checkbox">上传后自动关闭</label><div id="sucai-tu-upload-pannel"><input type="file" onchange="window.uploads=(window.uploads||0)+1;setTimeout(()=>document.querySelector('#receipt').textContent=${JSON.stringify(receipt).replaceAll('"','&quot;')},${receiptDelay})"></div><p id="receipt">0 个文件上传中</p><button>完成</button></section><script>window.clicks=0;window.uploads=0;setTimeout(()=>{const b=document.createElement('button');b.textContent='上传文件';b.disabled=${disabled};b.onclick=()=>{window.clicks++;document.querySelector('[role=dialog]').hidden=false;};document.body.appendChild(b);},${entryDelay});</script>`;
const cardHtml=(src='')=>`<div class="PicList_pic_background__pGTdV"><span class="PicList_tip_title__aQfti">${name}</span><div class="PicList_pic_imgBox__c0HXw"><img style="width:40px;height:40px" ${src?`src="${src}"`:''}></div><input type="checkbox"></div>`;
const card=()=>page.locator('.PicList_pic_background__pGTdV').filter({hasText:name});
async function timed(label,fn){const start=performance.now();let error=null;try{await fn();}catch(e){error=e;}const result={label,durationMs:performance.now()-start,error:error?.message||null,diagnostics:[...diagnostics]};records.push(result);return {error,result};}

test('item12 upload entry delayed 6.5 seconds: original 5 second expect fails; candidate continues once',async()=>{
 await page.goto('about:blank');await page.setContent(uploadFixture({entryDelay:6500}));
 const old=await timed('original upload entry',()=>originalOpen(page,guard));assert(old.error);assert.match(old.error.message,/5000ms/);assert.equal(await page.evaluate(()=>window.clicks),0);
 await page.goto('about:blank');await page.setContent(uploadFixture({entryDelay:6500}));
 const current=await timed('candidate upload entry',()=>openMaterialUpload(page,guard,{readiness:{onDiagnostic}}));assert.equal(current.error,null);
 const d=diagnostics.find(d=>d.stage==='upload-entry');assert(d.durationMs>6000&&d.durationMs<15000);assert.equal(d.status,'ready');assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(await page.evaluate(()=>window.uploads),0);
});
test('item12 thumbnail delayed 6.5 seconds: recorded assertion shape times out; candidate observes decoding',async()=>{
 const mount=async()=>{await page.goto('about:blank');await page.setContent(`<script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(cardHtml('https://fixture.invalid/item12.png'))},6500);</script>`);};
 await mount();const old=await timed('recorded thumbnail visible assertion shape',()=>expect(card()).toBeVisible());assert(old.error);assert.match(old.error.message,/5000ms/);
 await mount();const current=await timed('candidate delayed thumbnail',()=>waitDetailThumbnail(card(),guard,{onDiagnostic}));assert.equal(current.error,null);assert(diagnostics[0].durationMs>6000);assert(diagnostics[0].actual.complete);assert(diagnostics[0].actual.naturalWidth>0);
});
test('a visible card and img node are insufficient until real image data decodes',async()=>{
 await page.setContent(cardHtml()+`<script>setTimeout(()=>document.querySelector('img').src='https://fixture.invalid/item12.png',600);</script>`);
 assert(await card().isVisible());assert.equal(await card().locator('img').evaluate(e=>e.naturalWidth),0);
 await waitDetailThumbnail(card(),guard,{timeout:2000,onDiagnostic});assert(diagnostics[0].durationMs>=400);assert(diagnostics[0].actual.naturalHeight>0);
});
test('missing, broken and duplicate thumbnails never pass on node existence',async()=>{
 for(const html of ['',cardHtml('https://fixture.invalid/broken.png'),cardHtml()+cardHtml()]){
  await page.setContent(html);await assert.rejects(waitDetailThumbnail(card(),guard,{timeout:250,onDiagnostic}),e=>!e.code&&e.materialReadiness.stage==='thumbnail'&&classifyRoundFailure(e).kind==='SYSTEM');
 }
 assert(diagnostics.every(d=>d.status==='failed'&&d.durationMs>=250&&Object.hasOwn(d,'dom_snippet')&&d.screenshot));
});
test('entry requires visible and enabled; missing entry never triggers upload',async()=>{
 for(const html of ['<p>没有入口</p>',uploadFixture({disabled:true})]){
  await page.setContent(html);await assert.rejects(openMaterialUpload(page,guard,{readiness:{entryTimeout:250,onDiagnostic}}),e=>!e.code&&e.materialReadiness.stage==='upload-entry'&&classifyRoundFailure(e).kind==='SYSTEM');
  assert.equal(await page.locator('input[type=file]').evaluateAll(es=>es.reduce((n,e)=>n+e.files.length,0)),0);
 }
});
test('single native upload waits for its receipt; never accepts busy or failed receipt',async()=>{
 await page.setContent(uploadFixture({receiptDelay:600}));
 await uploadMaterial(page,asset.path,guard,{readiness:{onDiagnostic}});assert.equal(await page.evaluate(()=>window.uploads),1);
 assert(diagnostics.find(d=>d.stage==='upload-receipt').durationMs>=400);
 for(const receipt of ['1 个文件上传失败','1 个文件上传成功 1 个文件上传中']){
  await page.setContent(uploadFixture({receipt}));await assert.rejects(uploadMaterial(page,asset.path,guard,{readiness:{receiptTimeout:250,onDiagnostic}}),e=>!e.code&&e.materialReadiness.stage==='upload-receipt');assert.equal(await page.evaluate(()=>window.uploads),1);
 }
});
test('CAPTCHA and identity guard errors retain identity and stop observer immediately',async()=>{
 for(const message of ['PAUSED_CAPTCHA','店铺身份不一致']){
  await page.setContent('');const failure=Error(message);let calls=0;
  await assert.rejects(waitDetailThumbnail(card(),async()=>{calls++;throw failure;},{timeout:1000,onDiagnostic}),e=>e===failure&&e.message===message&&classifyRoundFailure(e).kind==='HUMAN');assert.equal(calls,1);
 }
});
test('existing STEP_PAUSED stores real stage reason duration without a new error code',async()=>{
 const dir=join(out,'step-paused');await mkdir(dir);const store=new SourceStore(join(dir,'synthetic.sqlite'));
 try{
  const task={shopId:'synthetic-only',priority:12,listing:{type:'country',country:'印度尼西亚',title:evidence.item.title},adapterIssues:[]};
  const run=store.create('isolated-item12',task,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(task)});
  const steps=new ExecutionSteps({store,id:run.id,dir,guard,getPage:()=>page,checkpoint:p=>store.checkpoint(run.id,p),errorText:e=>e.message});
  await page.setContent('');await assert.rejects(steps.run('select-detail-1',()=>waitDetailThumbnail(card(),guard,{timeout:250,onDiagnostic})));
  const event=store.events(run.id).find(e=>e.kind==='STEP_PAUSED');assert(event);assert.equal(event.payload.name,'select-detail-1');assert.equal(event.payload.errorCode,null);assert.match(event.payload.error,/stage=thumbnail/);assert(event.payload.durationMs>=250);assert(event.payload.screenshot);
  assert.equal(classifyRoundFailure(Error(event.payload.error)).kind,'SYSTEM');records.push({label:'unchanged STEP_PAUSED integration',event});
 }finally{store.close();}
});
test('receipt observer guard error is not swallowed by polling',async()=>{
 const e=Error('PAUSED_CAPTCHA');let n=0;await assert.rejects(waitMaterialReadiness('upload-receipt',async()=>({ready:false,actual:{singleSuccess:false}}),async()=>{if(++n===2)throw e;},{timeout:2000,expected:'single receipt',selector:'fixture',onDiagnostic}),x=>x===e);assert.equal(n,2);
});
test('detail iframe readiness emits separate timing and keeps origin checks',async()=>{
 const url='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
 await context.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<script>setTimeout(()=>document.body.innerHTML=\'<input placeholder="搜索图片名称"><button>确定</button>\',400)</script>'}));
 await page.setContent(`<div class="media-img-plug"><iframe src="${url}"></iframe></div>`);
 await waitDetailMaterialFrame(page,guard,{timeout:1500,onDiagnostic});assert.equal(diagnostics[0].stage,'detail-panel');assert(diagnostics[0].durationMs>=250);assert.equal(diagnostics[0].status,'ready');
 await page.setContent('<div class="media-img-plug"><iframe src="https://fixture.invalid/wrong"></iframe></div>');await assert.rejects(waitDetailMaterialFrame(page,guard,{timeout:500,onDiagnostic}),/DETAIL_MATERIAL_FRAME_ORIGIN/);
});
test('budgets are explicit and upload receipt remains sixty seconds',()=>{
 assert.deepEqual(DETAIL_MATERIAL_BUDGETS,{entry:20000,panel:8000,receipt:60000,thumbnail:30000,poll:150});
});
test('ready iframe observed after budget is rejected with its existing untyped failure',async()=>{
 const url='https://market.m.taobao.com/app/crs-qn/sucai-selector-ng/index';
 await context.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<input placeholder="搜索图片名称"><button>确定</button>'}));
 await page.setContent(`<div class="media-img-plug"><iframe src="${url}"></iframe></div>`);
 await assert.rejects(waitDetailMaterialFrame(page,async()=>{await new Promise(r=>setTimeout(r,80));},{timeout:50,onDiagnostic}),e=>!e.code&&e.message==='DETAIL_MATERIAL_FRAME_NOT_READY'&&e.materialReadiness.status==='failed');
});
