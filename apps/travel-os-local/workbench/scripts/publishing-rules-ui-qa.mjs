// Isolated UI + synthetic publisher checks. No production profile or network access.
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';
import {ATTRIBUTE_FIELDS,NO_BRAND,captureAttributes,fillAttributes,verifyAttributes} from '../publishing-attributes.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/publishing-rules-20261004');await mkdir(out,{recursive:true});
const dir=await realpath(await mkdtemp(join(tmpdir(),'travel-random-ui-'))),store=new SourceStore(join(dir,'state.sqlite'));
const shop={id:'qa-shop',name:'隔离测试店铺'},checks=[],errors=[];
const check=(value,name)=>{assert(value,name);checks.push(name);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==','base64');
const assets=[];for(let i=0;i<14;i++){const path=join(dir,`${i<9?'副图':'首页'}-${i}.png`);await writeFile(path,png);assets.push({path,sha256:digest(png)});}
const source=join(dir,'source.xlsx');await writeFile(source,'ISOLATED');
const tasks=['东京','巴黎'].map((city,i)=>({shopId:shop.id,priority:i+1,source:{sheet:'境外城市热度',row:i+2,workbook:source,sha256:digest('ISOLATED')},listing:{type:'city',country:i?'法国':'日本',city,title:city+' 隔离测试商品'},business:{brand:NO_BRAND,price_cny:'20',inventory:'10'},assets:{main:[assets[0]],secondary:assets.slice(1,5),details:assets.slice(5,13)},adapterIssues:[]}));
const importId=store.imported({sheet:'境外城市热度',sourceHash:'ISOLATED',tasks});
const flow={store,active:null,artifacts:join(dir,'artifacts'),launch(){throw Error('NO_EXECUTION');},pause(){}};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch,owner,shop,runtime:dir,integrity:async()=>({ok:true,files:11,baseline:'ISOLATED'}),checkFiles:async()=>{},launch:async()=>{throw Error('NO_EXECUTION');}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime:dir,launch:async()=>{throw Error('NO_EXECUTION');}});
await product.saveSettings({assets:dir});
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const body=async req=>{let value='';for await(const b of req)value+=b;return value?JSON.parse(value):{};};
const staticHandler=createStaticHandler(root),server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/os/state')return json(res,200,{...await os.snapshot(),testMode:true});if(url.pathname.startsWith('/api/os/'))return await os.handle(req,res,url,{json,body});if(url.pathname.startsWith('/api/v1/'))return await product.handle(req,res,url,{json,body});if(url.pathname.startsWith('/api/'))throw Error('ISOLATED_API_ONLY');await staticHandler(req,res);}catch(e){json(res,e.statusCode||409,{error:e.message});}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
let externalRequests=0;await context.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();externalRequests++;return route.abort();});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const sellerContext=await browser.newContext();await sellerContext.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>ISOLATED</body></html>'}));
const seller=await sellerContext.newPage();await seller.goto('https://item.upload.taobao.com/sell/v2/publish.htm');owner.sessions.set(shop.id,{context:sellerContext});
const nativeHtml=()=>`<div class="UserArea_shopName__3xGhm">${shop.name}</div>`+Object.entries(ATTRIBUTE_FIELDS).map(([key,label],i)=>`<section><label>${label}</label><div id="struct-p-${101+i}"><select><option value="">请选择</option><option value="a">${key} A</option><option value="b">${key} B</option></select></div></section>`).join('');
const request=async(path,input)=>{const res=await fetch(base+path,{method:input?'POST':'GET',headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined});const data=await res.json();return {status:res.status,data};};
const post=async(path,input)=>{const r=await request(path,input);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
try{
 await seller.setContent(nativeHtml());
 product.capturing=true;await assert.rejects(product.assertExecution(),/读取属性/);product.capturing=false;checks.push('统一入口在属性读取期间禁止启动或恢复');
 await seller.locator('body').evaluate(e=>e.insertAdjacentHTML('afterbegin','<p id="qa-captcha">请拖动滑块</p>'));
 const blocked=await request('/api/v1/publishing-capture',{});assert.equal(blocked.status,409);check((await request('/api/v1/publishing-rules')).data.checkpoint.state==='WAITING_HUMAN','合成验证码立即暂停并持久保存 checkpoint');
 check((await readFile(join(dir,'artifacts/attribute-capture/paused.png'))).length>0,'验证码截图已保存到隔离目录');
 await seller.locator('#qa-captcha').evaluate(e=>e.remove());
 await page.goto(base+'/travel-os.html#settings');await page.locator('[data-setup=step][data-step="4"]').click();await page.locator('.setup-more summary').click();await page.locator('#publishingConfigure').waitFor();await expect(page.locator('#testBanner')).toBeVisible();
 await expect(page.locator('[data-rules-paused]')).toContainText('属性读取已暂停');
 await page.locator('#publishingConfigure').click();await page.locator('#publishingCapture').click();await expect(page.locator('.publishing-field input')).toHaveCount(10);
 check(!(await request('/api/v1/publishing-rules')).data.checkpoint,'人工处理后重新读取，真实条件通过才清除暂停记录');
 for(const [group,start,count] of [['A',1,4],['B',5,4],['covers',9,2]])for(let i=0;i<count;i++){
  await page.locator(`[data-pick="${group}"][data-index="${i}"]`).click();await page.locator('#publishingSearch').fill(`${start+i}.png`);await page.locator('#publishingGallery button').filter({hasText:`-${start+i}.png`}).click();
 }
 for(const box of await page.locator('.publishing-field input').all())await box.check();
 await page.locator('#publishingConfirmed').check();await page.locator('.publishing-scroll').evaluate(e=>e.scrollTop=0);await page.screenshot({path:join(out,'settings-desktop.png')});
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 规则配置无横向溢出');await page.screenshot({path:join(out,'settings-mobile.png')});
 await page.setViewportSize({width:1440,height:1000});await page.locator('#publishingSave').click();await expect(page.locator('.publishing-editor')).not.toBeVisible();
 const config=(await request('/api/v1/publishing-rules')).data;check(config.preset.enabled&&config.preset.secondary.A.length===4&&config.preset.secondary.B.length===4&&config.preset.covers.length===2,'界面保存两套4张副图、两张首页及五项候选');
 await page.reload();await page.locator('[data-setup=step][data-step="4"]').click();await page.locator('.setup-more summary').click();await page.locator('#publishingConfigure').click();await expect(page.locator('.publishing-field input:checked')).toHaveCount(10);await page.locator('#publishingClose').click();checks.push('刷新后配置与勾选仍存在');
 const draft=await post('/api/v1/publishing-preview',{importId,limit:1}),same=await post('/api/v1/publishing-preview',{importId,limit:1});check(draft.draftId===same.draftId&&digest(draft.tasks)===digest(same.tasks),'HTTP重复预览返回相同随机快照');
 const selection=draft.tasks[0];const steps=[];await fillAttributes(seller,selection,{guard:async()=>{},step:async(name,fn)=>{steps.push(name);await fn();}});await verifyAttributes(seller,selection);check(steps.length===5,'真实浏览器合成原生下拉：填写与逐项回读通过');
 await seller.locator('#struct-p-101 select option:checked').evaluate(e=>e.disabled=true);await assert.rejects(fillAttributes(seller,selection,{guard:async()=>{},step:async(_,fn)=>fn()}),/选项已失效/);checks.push('原生候选失效拒绝替代选择');await seller.setContent(nativeHtml());
 await post('/api/os/preparations/create',{requestId:randomUUID(),productKey:destinationKey(tasks[0]),shopId:shop.id});
 await page.goto(base+'/travel-os.html#tasks');await page.reload();await page.locator('[data-action=review-selected]').click();await page.locator('.publishing-image-review summary').click();await expect(page.locator('.publishing-image-review img')).toHaveCount(13);await expect.poll(()=>page.locator('.publishing-image-review img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBeTruthy();
 await page.screenshot({path:join(out,'random-preview.png')});check((await page.locator('#selectedForm').innerText()).includes('已固定：副图'),'单商品预览显示实际固定图片、顺序与属性');
 const selectedInput={productKey:destinationKey(tasks[0]),shopId:shop.id,mode:'DRY_RUN',draftId:await page.locator('#selectedForm [name=draftId]').inputValue(),review:{reviewed:true,selectionHash:await page.locator('#selectedForm [name=selectionHash]').inputValue(),authorization:'ISOLATED_QA'}};
 const results=await Promise.all([post('/api/os/selected-create',selectedInput),post('/api/os/selected-create',selectedInput)]);check(results[0].id===results[1].id,'单商品重复POST只创建一个批次');check(store.db.prepare('SELECT count(*) n FROM history').get().n===0&&store.list().length===0,'仅创建未执行，隔离成功记录为零');
 // Custom dropdowns are synthetic. Every outgoing request is fulfilled locally.
 const customHtml=()=>Object.entries(ATTRIBUTE_FIELDS).map(([key,label],i)=>`<section><label>${label}</label><div id="struct-p-${101+i}"><input readonly aria-controls="options-${i}" onclick="document.getElementById('options-${i}').hidden=false" onkeydown="if(event.key==='Escape'){window.escapes++;document.getElementById('options-${i}').hidden=true}"><div role="listbox" id="options-${i}" hidden>${['a','b'].map(v=>`<div role="option" data-value="${v}" onclick="this.parentElement.parentElement.querySelector('input').value=this.textContent;this.parentElement.parentElement.querySelector('input').dataset.value=this.dataset.value;this.parentElement.hidden=true">${key==='people'?'2人、3人、4人 '+v:key+' '+v}</div>`).join('')}</div></div></section>`).join('')+'<script>window.escapes=0</script>';
 await seller.setContent(customHtml());const captured=await captureAttributes(seller,async()=>{});check(captured[4].options[0].text==='2人、3人、4人 a','组合人数标签作为一个候选，未拆造数值');
 const task=structuredClone(selection);task.publishVariant.attributes=captured.map(f=>({...f,...f.options[0]}));
 let paused=true;const guard=async()=>{if(paused&&await seller.locator('#struct-p-103 input').inputValue()==='style a')throw Error('PAUSED_CAPTCHA');};
 await assert.rejects(fillAttributes(seller,task,{guard,step:async(_,fn)=>fn()}),/PAUSED_CAPTCHA/);check(await seller.locator('#struct-p-104 input').inputValue()==='','第3属性遇验证后第4、第5属性未操作');
 const before=await seller.locator('#struct-p-101 input').inputValue();paused=false;await fillAttributes(seller,task,{guard,step:async(_,fn)=>fn()});check(before===await seller.locator('#struct-p-101 input').inputValue(),'人工完成后继续原选择，没有重抽');
 await seller.locator('#struct-p-101 input').evaluate(e=>e.dataset.value='changed');await assert.rejects(verifyAttributes(seller,task),/标识不一致/);checks.push('文本正确但已选属性ID变化仍拒绝');
 await seller.setContent(customHtml());let guards=0;await assert.rejects(captureAttributes(seller,async()=>{if(++guards===4)throw Error('PAUSED_CAPTCHA');}),/PAUSED_CAPTCHA/);check(await seller.evaluate(()=>window.escapes)===0,'捕获验证码后未发送Escape或其他收尾按键');
 await seller.setContent(customHtml());await seller.locator('#options-4').evaluate(e=>e.hidden=false);await assert.rejects(captureAttributes(seller,async()=>{}),/其他候选列表/);checks.push('已存在其他可见候选列表时拒绝混读');
 await seller.setContent(customHtml());await seller.locator('#struct-p-101 input').evaluate(e=>e.onclick=()=>{document.querySelector('#options-0').hidden=false;document.querySelector('#options-1').hidden=false;});await assert.rejects(captureAttributes(seller,async()=>{}),/唯一识别/);checks.push('同时弹出多个下拉列表拒绝读取');
 check(errors.length===0,'界面无未捕获JavaScript错误');check(externalRequests===0,'工作台测试无外部网络请求');
}finally{
 await writeFile(join(out,'browser-qa.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,externalRequests,productionRequests:0,productionSuccessWrites:0},null,2));console.log(JSON.stringify({checks,errors,externalRequests},null,2));
 await browser.close();product.closeStreams();server.closeAllConnections();await new Promise(r=>server.close(r));os.store.close();store.close();assert.equal(dirname(dir),await realpath(tmpdir()));await rm(dir,{recursive:true,force:true});
}
