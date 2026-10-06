// Bounded product audit: temporary SQLite, fake executor, isolated Chrome.
// No production server, profile, data, or seller endpoint is used.
// Diagnostic only: reproducing a known defect is evidence, not release approval.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';
import {verifyKernel} from '../kernel-integrity.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'../output/qa-audit-20261004/targeted-before'));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'travel-audit-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'audit-shop',name:'隔离审查店铺'},shops=[shop];
const task=(n,city='测试城市'+n)=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度',row:n+1},listing:{type:'city',country:'测试国',city,title:city+' 隔离商品'},business:{price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
const tasks=[task(1,'东京'),task(2,'巴黎'),task(3,'同名城')];
const imported=store.imported({sheet:'境外城市热度',sourceHash:'audit-only',tasks});
let launches=0,outcome='RESULT_UNKNOWN';
const flow={store,runtime:dir,artifacts:join(dir,'artifacts'),active:null,stop:false,pause(){this.stop=true;},launch(id){
 launches++;this.active=id;this.pending=Promise.resolve().then(()=>{store.move(id,'RUNNING');if(outcome==='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');store.checkpoint(id,{step:'submit-once'});}store.move(id,outcome,'隔离测试中断');}).finally(()=>this.active=null);
},async resume(){throw Error('审查替身禁止恢复执行');}};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch,owner,shop,runtime:dir,integrity:async()=>({ok:true,files:11}),checkFiles:async()=>{},launch:async()=>{throw Error('禁止启动正式浏览器');}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>shops,browser:owner,runtime:dir,launch:async()=>{throw Error('禁止启动正式浏览器');}});
const findings=[],checks=[],metrics={},requests=[],errors=[],external=[];
const check=(condition,label)=>{assert(condition,label);checks.push(label);};
const fixtureBatch=t=>batch.store.create(imported,[t],shop.id,'DRY_RUN',{reviewed:true,selectionHash:digest([t]),authorization:'isolated audit fixture'});
const first=fixtureBatch(tasks[0]);batch.start(first.id,shop);await batch.pending;
await product.saveSettings({executionEnabled:true,confirmShop:shop.name});
let browser,server;
try{
 const recovery=await product.recovery({id:first.id,operation:'continue'});
 check(!recovery.ready&&recovery.checks.some(c=>c.name==='提交结果核验'&&!c.ok),'缺少商品 ID 时恢复被阻止');
 const before=launches;
 await assert.rejects(product.handle({method:'POST'},{},new URL('http://isolated/api/v1/continue'),{body:async()=>({id:first.id,requestId:crypto.randomUUID(),humanVerified:true}),json(){}}),/无商品 ID/);
 check(launches===before,'勾选人工处理仍不重新提交结果不明商品');
 findings.push({id:'A01',kind:'REPRODUCED',problem:'结果不明且 ID 丢失时没有人工关联入口',ready:recovery.ready,failedChecks:recovery.checks.filter(x=>!x.ok)});
 check(destinationKey(tasks[0])!==destinationKey({...tasks[0],shopId:'other-shop'}),'同目的地跨店铺防重键独立');
 check(destinationKey(tasks[0])!==destinationKey({...tasks[0],listing:{...tasks[0].listing,country:'另一国'}}),'同名城市按国家区分');

 // Exercise the real workflow's screenshot failure path with a non-browser stub.
 const artifactStore=new SourceStore(join(dir,'artifact.sqlite'));
 try{
  const file=join(dir,'中文 空格 # 素材.png');await writeFile(file,'isolated fixture bytes');const asset={path:file,sha256:digest(await readFile(file))};
  const t={...task(99),source:{workbook:file,sha256:asset.sha256},assets:{main:[asset],secondary:[asset,asset,asset,asset],details:[asset]},business:{category_path:'个性定制/设计服务/DIY>>其它定制>>其它商品定制',custom_service:true,procurement:'中国内地（大陆）',ship_from:'北京/北京',shipping_time:'24小时内发货',ship_from_region:'大陆及港澳台',region_restriction:'不设置商品维度区域限售模板',listing_time:'立刻上架'}};
  const r=artifactStore.create('isolated',t,'DRY_RUN','SOURCE',{reviewed:true,taskHash:digest(t)});
  const art=join(dir,'artifact-files'),old=join(art,r.id,'paused.png');await mkdir(dirname(old),{recursive:true});await writeFile(old,'OLD EVIDENCE');
  const page={frames:()=>[],url:()=> 'about:blank',setViewportSize:async()=>{throw Error('ISOLATED_PAGE_CLOSED');},screenshot:async()=>{throw Error('ISOLATED_SCREENSHOT_FAILED');}};
  let createdPages=0;
  const session={...owner,sessions:new Map([[shop.id,{context:{newPage:async()=>{createdPages++;return page;},pages:()=>[]}}]])};
  const workflow=new SourceWorkflow(session,{store:artifactStore,runtime:join(dir,'fake-flow'),artifacts:art});workflow.launch(r.id,shop);await workflow.pending;
  const paused=artifactStore.run(r.id),event=artifactStore.events(r.id).find(x=>x.kind==='STEP_PAUSED');
  const exists=await stat(event.payload.screenshot).then(()=>true).catch(()=>false);
  check(paused.state==='PAUSED','模拟页面关闭在提交前暂停');
  findings.push({id:'A02',kind:'REPRODUCED',problem:'截图失败仍登记路径，paused.png 可能指向旧证据',eventPathExists:exists,checkpointUsesOldEvidence:paused.checkpoint.screenshot===old&&(await readFile(old,'utf8'))==='OLD EVIDENCE'});
  assert.equal(exists,false);assert.equal(findings.at(-1).checkpointUsesOldEvidence,true);
  artifactStore.move(r.id,'QUEUED');artifactStore.move(r.id,'RUNNING');artifactStore.move(r.id,'SUBMITTING');artifactStore.move(r.id,'RESULT_UNKNOWN','isolated missing ID');
  const pagesBefore=createdPages;workflow.launch(r.id,shop);await workflow.pending;
  check(artifactStore.run(r.id).state==='RESULT_UNKNOWN'&&/无商品 ID/.test(artifactStore.run(r.id).reason),'真实工作流缺失 ID 时保持待核验');
  check(createdPages===pagesBefore,'缺失 ID 恢复没有新建发布页或重新填写');
 }finally{artifactStore.close();}

 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const body=async req=>{let bytes='';for await(const b of req)bytes+=b;return bytes?JSON.parse(bytes):{};};
 const staticHandler=createStaticHandler(root);
 server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');requests.push({path:url.pathname,method:req.method});
  if(url.pathname==='/api/os/state')return json(res,200,{...await os.snapshot(),testMode:true});
  if(url.pathname.startsWith('/api/os/'))return await os.handle(req,res,url,{json,body});
  if(url.pathname.startsWith('/api/v1/'))return await product.handle(req,res,url,{json,body});
  if(url.pathname.startsWith('/api/'))throw Error('未声明的隔离接口');await staticHandler(req,res);
 }catch(e){json(res,e.statusCode||409,{error:e.message});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('travel-os:sidebar-expanded','true');window.EventSource=class{constructor(){window.auditStream=this;this.listeners={};}addEventListener(k,fn){this.listeners[k]=fn;}close(){}};});
 await page.goto(base+'/travel-os.html#tasks');await page.locator('[data-action=continue]').first().waitFor();
 await page.locator('[data-action=continue]').first().click();
 await page.screenshot({path:join(out,'unknown-recovery-desktop.png')});
 const initial=await page.locator('#editorBody').innerText();metrics.missingIdGuidanceVisible=/尚未取得商品 ID/.test(initial)&&/完整商品标题/.test(initial)&&/当前版本/.test(initial);
 await page.locator('#executeForm [name=humanVerified]').check();await page.locator('#executeForm button[type=submit]').click();await page.locator('#editorError').filter({hasText:'无商品 ID'}).waitFor();
 check(!requests.some(r=>r.path==='/api/v1/continue'),'恢复检查未通过时界面不发送继续请求');
 await page.screenshot({path:join(out,'unknown-recovery-checked.png')});
 await page.keyboard.press('Escape');
 for(const route of ['overview','tasks','shops','products','destinations','quotes','records','settings']){
  await page.locator('#navigation a[href="#'+route+'"]').click();await page.locator('#page-'+route).waitFor({state:'visible'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'1440px '+route+' 没有页面横向溢出');
 }
 await page.locator('[data-setup=step][data-step="2"]').click();await page.locator('#setupFormat').selectOption('legacy');
 const beforePool=(await product.settings()).pool;
 await page.locator('#setupLegacy-pool').fill('D:\\不存在的中文 空格 # 资料\\商品.xlsx');await page.locator('[data-setup=import]').click();
 await page.waitForFunction(()=>document.querySelector('#setupFeedback')?.dataset.error==='true');
 check((await product.settings()).pool===beforePool,'无法识别的路径不会覆盖已保存资料设置');
 await page.reload();await page.locator('[data-setup=step][data-step="2"]').click();await page.locator('#setupFormat').selectOption('legacy');
 check(await page.locator('#setupLegacy-pool').inputValue()===beforePool,'刷新后保留原有效配置而非失败的导入草稿');
 await page.locator('#navigation a[href="#tasks"]').click();await page.locator('[data-action=continue]').first().click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'unknown-recovery-mobile.png'),fullPage:true});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px 恢复弹窗无页面横向溢出');await page.keyboard.press('Escape');
 for(const route of ['overview','tasks','shops','products','destinations','quotes','records','settings']){
  await page.evaluate(r=>location.hash=r,route);await page.locator('#page-'+route).waitFor({state:'visible'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px '+route+' 没有页面横向溢出');
 }
 await page.setViewportSize({width:1440,height:900});
 // Adjacent recovery states must keep their existing handling and scope.
 const recoveryState=await os.snapshot();
 for(const scenario of ['known-id','captcha','other-batch']){
  const state=structuredClone(recoveryState);
  if(scenario==='known-id')state.engine.records.filter(r=>!r.verified).forEach(r=>r.itemId='123456');
  if(scenario==='captcha'){
   state.engine.batch.items.forEach(i=>{i.displayState='PAUSED_CAPTCHA';i.runState='PAUSED_CAPTCHA';});
   state.engine.records=[];
  }
  if(scenario==='other-batch')state.engine.records.filter(r=>!r.verified).forEach(r=>r.runId='unrelated-run');
  await page.route('**/api/os/state',r=>r.fulfill({json:{...state,testMode:true}}));
  await page.goto(base+'/travel-os.html?audit='+scenario+'#tasks');await page.locator('[data-action=continue]').first().click();
  check(await page.locator('[aria-label="缺少商品 ID 的处理说明"]').count()===0,scenario+' 不显示不适用的缺失 ID 提示');
  check(await page.locator('#executeForm button[type=submit]').innerText()==='检查条件，通过后继续',scenario+' 保留原恢复检查入口');
  await page.keyboard.press('Escape');await page.unroute('**/api/os/state');
 }
 // A separate synthetic UI response records intent only, never dispatching an engine.
 const uiState=await os.snapshot(),second={id:'audit-confirmed-batch'},third={id:'audit-next-batch'};
 uiState.engine.batch={...uiState.engine.batch,id:second.id,state:'READY',mode:'DRY_RUN',current:null,items:uiState.engine.batch.items.map(x=>({...x,runId:null,state:'PENDING',runState:null,displayState:'PENDING',reason:''}))};
 uiState.engine.batches=[{id:second.id,state:'READY',mode:'DRY_RUN'}];uiState.engine.active=null;
 await page.route('**/api/os/state',r=>r.fulfill({json:{...uiState,testMode:true}}));
 await page.goto(base+'/travel-os.html?audit=stale-confirmation#tasks');await page.locator('[data-action=start]').first().click();
 const shown=await page.locator('#editorBody').innerText();
 let sent=null;await page.route('**/api/v1/start',async r=>{sent=r.request().postDataJSON();await r.fulfill({json:{accepted:true,isolated:true}});});
 const newer=structuredClone(uiState.engine);newer.batch.id=third.id;newer.batch.mode='LIVE';newer.batch.total=2;newer.batches=[{id:third.id,state:'READY',mode:'LIVE'}];uiState.engine=newer;
 await page.evaluate(e=>window.auditStream.listeners.state({data:JSON.stringify(e)}),newer);
 await page.screenshot({path:join(out,'stale-confirmation.png')});
 await page.locator('#executeForm input[type=checkbox]').check();await page.locator('#executeForm button[type=submit]').click();
 await page.waitForFunction(()=>!document.querySelector('#editor').open);
 findings.push({id:'A03',kind:'REPRODUCED',problem:'确认弹窗打开后 SSE 切换批次，提交目标取了新批次',shownBatch:second.id,sentBatch:sent?.id,changedWhileOpen:sent?.id===third.id,shownText:shown});
 assert.equal(sent?.id,third.id,'Audit must actually reproduce stale confirmation before reporting it');
 check(launches===1,'浏览器测试没有启动执行器，唯一一次为预置故障替身');
 check(external.length===0,'隔离浏览器没有任何外部请求');check(errors.length===0,'当前八模块浏览器无未捕获异常');

 // Same-machine bounded benchmark, fake browser status, synthetic 700-item import.
 const large=[...tasks,...Array.from({length:697},(_,i)=>task(1000+i))];store.imported({sheet:'境外城市热度',sourceHash:'perf-only',tasks:large});
 const sample=async fn=>{const ms=[];let value;for(let i=0;i<11;i++){const t=performance.now();value=await fn();if(i)ms.push(performance.now()-t);}const sorted=[...ms].sort((a,b)=>a-b);return {samples:ms,medianMs:(sorted[4]+sorted[5])/2,maxMs:sorted.at(-1),jsonBytes:Buffer.byteLength(JSON.stringify(value))};};
 metrics.productSnapshot700=await sample(()=>product.snapshot());metrics.osSnapshot700=await sample(()=>os.snapshot());
 metrics.catalogProducts=(await os.catalog()).products.length;
 metrics.scenario='700 synthetic tasks, 1 batch, 1 unknown run, warm process, fake Chrome status, 10 measured iterations after 1 warmup';
 if(process.argv.includes('--expect-guidance'))check(metrics.missingIdGuidanceVisible,'待核验弹窗首次打开即说明商品 ID 缺失及人工核对步骤');
}finally{
 const kernel=await verifyKernel();await writeFile(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),verdict:'CORE_CHANGES_REQUIRE_APPROVAL',checks,findings,metrics,errors,external,requests,launches,kernel,productionRequests:0,productionWrites:0},null,2));
 console.log(JSON.stringify({checks:checks.length,findings:findings.map(f=>f.id),metrics,kernel},null,2));
 await browser?.close();product.closeStreams();if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();
 assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
}
