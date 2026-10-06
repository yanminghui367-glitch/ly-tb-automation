// Report evidence review only. Real local API/SSE; fake execution; no seller access.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/playwright/execution-scope-'+Date.now()));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'travel-report-a03-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'review-only',name:'报告复核隔离店铺'};
const tasks=[1,2,3].map(n=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度',row:n+1},listing:{type:'city',country:'测试国',city:'测试城'+n,title:'隔离商品'+n},business:{price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
const imported=store.imported({sheet:'境外城市热度',sourceHash:'REVIEW_ONLY',tasks});
const fakeLaunches=[],requests=[],external=[],errors=[],checks=[];
const check=(ok,label)=>{assert(ok,label);checks.push(label);};
const flow={store,runtime:dir,artifacts:join(dir,'artifacts'),active:null,pause(){},launch(id){
 this.active=id;this.pending=Promise.resolve().then(()=>{const r=store.run(id);fakeLaunches.push({runId:id,task:r.task.listing.title,mode:r.mode});store.move(id,'RUNNING');store.move(id,'PAUSED','操作者暂停：隔离执行器在填写前停止');}).finally(()=>this.active=null);
},resume:async()=>{throw Error('REVIEW_NO_RESUME');}};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch,owner,shop,runtime:dir,integrity:async()=>({ok:true,files:11}),checkFiles:async()=>{},launch:async()=>{throw Error('NO_PRODUCTION_BROWSER');}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime:dir,launch:async()=>{throw Error('NO_PRODUCTION_BROWSER');}});
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const body=async req=>{let text='';for await(const b of req)text+=b;const value=text?JSON.parse(text):{};requests.push({path:req.url,body:value});return value;};
const serve=createStaticHandler(join(root,'workbench'));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/os/state')return json(res,200,{...await os.snapshot(),testMode:true});
 if(u.pathname.startsWith('/api/os/'))return await os.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/v1/'))return await product.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/'))throw Error('UNDECLARED_API');await serve(req,res);
}catch(e){json(res,e.statusCode||409,{error:e.message});}});
let browser,proof={};
try{
 await product.saveSettings({executionEnabled:true,confirmShop:shop.name});
 const first=batch.create({importId:imported,limit:1,mode:'DRY_RUN',review:{reviewed:true,selectionHash:batch.preview(imported,1).selectionHash,authorization:'isolated report review'}},shop);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const contextA=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 const contextB=await browser.newContext({serviceWorkers:'block'});
 for(const context of [contextA,contextB])await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 const page=await contextA.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 // EventSource is the browser's native implementation: no injected state.
 let streams=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/v1/events')streams++;});
 await page.goto(base+'/travel-os.html#tasks');await page.locator('[data-action=start]').first().click();
 const oldText=await page.locator('#editorBody').innerText();check(/1 个商品/.test(oldText)&&oldText.includes('仅填写'),'客户端 A 确认弹窗对应旧批次 1 条 DRY_RUN');
 await page.screenshot({path:join(out,'01-confirm-old-batch.png')});
 const legacy=await contextB.newPage();await legacy.goto(base+'/index.html#tasks');await legacy.locator('[data-action=start]').click();await legacy.locator('#confirmDialog').waitFor({state:'visible'});
 // Client B finishes A by an allowed skip, then creates B via real product APIs.
 const post=async(path,data)=>{const res=await contextB.request.post(base+path,{data});const value=await res.json();assert(res.ok(),JSON.stringify(value));return value;};
 await post('/api/os/batch/skip',{id:first.id,taskId:batch.store.items(first.id)[0].id,reason:'隔离客户端 B 人工跳过'});
 check(batch.store.view(first.id).state==='COMPLETED','真实队列先结束旧批次，遵守单批次占用限制');
 const preview=product.preview(imported,2);
 const second=await post('/api/v1/create',{importId:imported,limit:2,mode:'LIVE',review:{reviewed:true,selectionHash:preview.selectionHash,authorization:'isolated client B fixture only'}});
 const secondView=batch.store.view(second.id);
 check(secondView.total===2&&secondView.items.length===2&&secondView.mode==='LIVE','新批次来自真实接口，数量与明细一致');
 check(fakeLaunches.length===0,'创建和跳过均没有启动执行器');
 await page.waitForFunction(id=>!!document.querySelector('#batchSelector option[value="'+id+'"]'),second.id);
 await legacy.waitForFunction(id=>!!document.querySelector('#batchPicker option[value="'+id+'"]'),second.id);
 check(streams===1,'新版使用一条真实 SSE 连接同步新批次');
 const retained=await page.locator('#editorBody').innerText();check(retained===oldText,'状态切换后确认弹窗仍保留旧范围');
 await page.screenshot({path:join(out,'02-new-state-old-confirmation.png')});
 await page.locator('#executeForm input[type=checkbox]').check();await page.locator('#executeForm button[type=submit]').click();
 await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('范围或状态已变化'));
 check(!requests.some(r=>r.path==='/api/v1/start')&&fakeLaunches.length===0,'新版工作台拒绝旧确认，没有启动请求');
 await legacy.locator('#confirmAction').click();await legacy.waitForFunction(()=>document.querySelector('#toast').textContent.includes('范围或状态已变化'));
 check(!requests.some(r=>r.path==='/api/v1/start')&&fakeLaunches.length===0,'旧版工作台同样拒绝旧确认');
 await page.screenshot({path:join(out,'03-stale-confirmation-blocked.png')});
 // Reopening the confirmation explicitly displays the new LIVE scope.
 await page.locator('[data-action=start]').first().click();
 const fresh=await page.locator('#editorBody').innerText();check(fresh.includes('2 个商品')&&fresh.includes('正式发布'),'重新确认明确显示新批次 2 条与 LIVE 模式');
 await page.locator('#executeForm input[type=checkbox]').check();await page.locator('#executeForm button[type=submit]').click();
 await page.locator('#editor').waitFor({state:'hidden'});if(batch.pending)await batch.pending;
 const sent=requests.findLast(r=>r.path==='/api/v1/start');
 check(sent?.body.id===second.id&&/^[a-f0-9]{64}$/.test(sent.body.scope),'新确认使用固定 ID 和服务器范围指纹');
 check(fakeLaunches.length===1&&fakeLaunches[0].mode==='LIVE','仅新确认调度一次替身，填写前停止');
 const events=store.db.prepare("SELECT kind FROM events WHERE kind IN ('SUBMITTING','VERIFIED')").all();check(events.length===0,'没有模拟提交或成功事件，更无平台发布');
 check(errors.length===0,'无浏览器未捕获异常');check(external.length===0,'未发起卖家或其他外部请求');
 proof={oldBatch:{id:first.id,mode:'DRY_RUN',total:1},newBatch:{id:second.id,mode:secondView.mode,total:secondView.total,items:secondView.items.length},oldDialog:oldText,sentBatch:sent.body.id,fakeLaunches,streams};
}finally{
 await writeFile(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,proof,requests,external,errors,productionWrites:0,productionBrowserAccess:false,limit:'Real local API/SSE and two frontend versions; stale confirmation blocked; explicit new confirmation dispatches fake only; not a seller test'},null,2));
 console.log(JSON.stringify({checks:checks.length,proof,errors,external},null,2));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();
 assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
}
