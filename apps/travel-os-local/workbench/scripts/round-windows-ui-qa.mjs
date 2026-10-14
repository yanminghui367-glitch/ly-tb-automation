// Independent UI/API acceptance on a temporary store and random localhost port.
// The executor and platform/content checks are synthetic. Never platform proof.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';

const root=resolve(import.meta.dirname,'../..');
const sourceFiles=['workbench/travel-os.js','workbench/tasks.css','workbench/round-windows.mjs','workbench/listing-round.mjs','workbench/product-api.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
const sourceHashes=await hashes();
const out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/independent100-20261009/ui-qa',new Date().toISOString().replaceAll(':','-')));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'ly-round-window-ui-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'wuzhou-changyou',name:'轮次界面隔离测试店'},tasks=Array.from({length:102},(_,i)=>({shopId:shop.id,priority:i+1,source:{sheet:'境外城市热度',row:i+2},
 listing:{type:'city',country:'隔离测试国',city:'隔离城市'+(i+1),title:'轮次界面隔离商品'+(i+1)},business:{shop_name:shop.name,price_cny:20,inventory:999999},assets:{main:[],secondary:[],details:[]},adapterIssues:i===101?['隔离测试：缺少价格资料']:[]}));
const importId=store.imported({sourceHash:'ISOLATED_ROUND_WINDOW_UI',tasks,summary:{total:tasks.length}});
const checks=[],requests=[],external=[],errors=[],apiErrors=[],launches=[];
const check=(ok,label)=>{checks.push({ok:!!ok,label});console.log((ok?'PASS ':'FAIL ')+label);};
let hold=true,release,previewHold=false,releasePreview,previewStarted;
const flow={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,stop:false,submits:0,
 launch(id){assert.equal(this.active,null,'only one isolated executor');this.active=id;this.stop=false;launches.push(id);this.pending=(async()=>{
  const run=store.run(id);store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);
  if(this.stop){store.checkpoint(id,{step:'pre-submit-review'});store.move(id,'PAUSED','操作者暂停');return;}
  store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{isolated:true});
  store.move(id,'VERIFIED','',{itemId:String(991000000+run.task.priority),status:'出售中',rowText:'隔离平台模拟 '+run.task.listing.title,screenshot:'synthetic-only.png',verifiedAt:new Date().toISOString()});
 })().finally(()=>this.active=null);},
 async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}
};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch,owner,shop,runtime:dir,integrity:async()=>({ok:true,files:0,revision:'ISOLATED_UI_QA'}),checkFiles:async()=>{
 if(previewHold){previewStarted?.();await new Promise(r=>releasePreview=r);}
},launch:async()=>{throw Error('NO_PRODUCTION_BROWSER');}});
product.round.contentReviews={assertApproved:()=>({decision:'PASS'})};
product.round.verifyExisting=async({history})=>history||null;
const round=await product.round.create({importId,repairVersion:'ISOLATED_UI_QA',expectedCount:tasks.length,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:tasks.length}});
// Isolated fixture begins after the first-one/first-five gates; no real gate or
// production store is changed, and no simulated result is platform evidence.
store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(round.id);
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime:dir,launch:async()=>{throw Error('NO_PRODUCTION_BROWSER');}});
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const body=async req=>{let text='';for await(const part of req)text+=part;const input=JSON.parse(text||'{}');req.qaRecord.input=input;return input;};
const serve=createStaticHandler(join(root,'workbench'));
const server=createServer(async(req,res)=>{req.qaRecord={method:req.method,path:req.url};requests.push(req.qaRecord);try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/os/'))return await os.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/v1/'))return await product.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/'))throw Error('UNDECLARED_API');await serve(req,res);
}catch(e){apiErrors.push({path:req.url,message:e.message});json(res,e.statusCode||409,{error:e.message});}});
let browser,page,base,failure;
try{
 await product.saveSettings({executionEnabled:true,confirmShop:shop.name});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 assert.notEqual(server.address().port,4318);
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.locator('[data-action="'+name+'"]');
 const configure=async()=>{await button('window-configure').click();await page.locator('#windowLimit').waitFor();};
 const preview=async()=>{await button('window-preview').click();await page.locator('#windowPreviewResult .notice').waitFor();};
 await page.goto(base+'/travel-os.html#tasks');await configure();
 check(await page.locator('#windowLimit').inputValue()==='100'&&await page.locator('#windowLimit').getAttribute('max')==='100','本轮默认100且输入上限100');
 check(await page.locator('#windowStart').inputValue()==='1'&&await page.locator('#windowEnd').inputValue()==='102','默认范围显示固定清单全部序号');
 check(!(await page.locator('#windowAuto').isChecked()),'自动衔接默认关闭');
 await preview();check((await page.locator('#windowPreviewResult').innerText()).includes('本轮可分配 100 条'),'预检清楚展示100条分配数量');
 check(await page.locator('#windowPreviewResult ol li').count()===100,'预检明细确为100个不同条目');
 await page.screenshot({path:join(out,'01-desktop-preview.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px配置页面无整页横向溢出');
 await button('window-start').scrollIntoViewIfNeeded();check(await button('window-start').isVisible(),'390px可滚动到开始按钮');
 await page.screenshot({path:join(out,'02-mobile-preview.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.locator('#windowLimit').fill('2');check(await button('window-start').count()===0,'修改数量立即清除旧预检和开始入口');
 await preview();await page.locator('#windowStart').fill('2');check(await button('window-start').count()===0,'修改起始范围立即清除旧预检');
 await page.locator('#windowStart').fill('1');await page.locator('#windowEnd').fill('100');await page.locator('#windowLimit').fill('100');await preview();
 await page.setViewportSize({width:390,height:844});await button('window-start').click();await page.locator('#editor').waitFor({state:'hidden'});await button('round-pause').waitFor();
 check(true,'390px实际点击开始成功进入运行界面');await page.setViewportSize({width:1440,height:1000});
 const first=product.round.windows.latest(round.id);check(product.round.windows.view(first.id).total===100,'网站开始后服务端冻结100条分配');
 const startRequest=requests.find(r=>r.path==='/api/v1/rounds/resume');check(startRequest?.input?.windowId===first.id,'开始请求绑定刚创建的windowId');
 check(launches.length===1&&flow.submits===0,'只有一个执行器，首条在隔离未提交断点等待');
 await page.reload();await button('round-pause').waitFor();check((await page.locator('.monitor-progress .task-progress-heading').innerText()).includes('0 / 100'),'刷新保留同一执行轮次与0/100进度');
 await button('round-pause').click();await product.round.pending;await page.reload();await button('round-resume').waitFor();
 const pauseRequest=requests.find(r=>r.path==='/api/v1/rounds/pause');check(pauseRequest?.input?.id===round.id&&pauseRequest?.input?.windowId===first.id,'暂停请求明确绑定当前清单和执行轮次');
 check(await button('round-stop').isVisible(),'暂停后的真实页面保留停止本轮入口');
 await page.screenshot({path:join(out,'03-paused-desktop.png'),fullPage:true});
 const originalRun=product.round.items(round.id)[0].run_id;
 await button('round-stop').click();await button('window-configure').waitFor();const sealed=product.round.windows.view(first.id,{items:true});
 const stopRequest=requests.find(r=>r.path==='/api/v1/rounds/stop');check(stopRequest?.input?.id===round.id&&stopRequest?.input?.windowId===first.id,'停止请求明确绑定当前清单和执行轮次');
 check(sealed.state==='STOPPED'&&sealed.counts.PENDING===100&&flow.submits===0,'暂停后停止封存原轮次并保留100条未结束任务');
 await page.locator('#monitorLedger>summary').click();await page.locator('.round-window-history summary').click();await button('window-detail').first().click();await page.locator('#editorBody table tbody tr').first().waitFor();
 check(await page.locator('#editorBody table tbody tr').count()===100,'历史详情列出本轮100个冻结条目');
 const csvPath=await page.locator('#editorBody a').getAttribute('href');
 const download=page.waitForEvent('download');await page.locator('#editorBody a').click();const file=await download;await file.saveAs(join(out,'04-stopped-window.csv'));
 const csvResponse=await context.request.get(base+csvPath),csv=await csvResponse.text();check(csvResponse.ok()&&csv.trim().split('\r\n').length===101,'真实导出链接下载100条记录加表头');
 await page.locator('#closeEditor').click();await configure();await page.locator('#windowEnd').fill('100');await preview();
 check((await page.locator('#windowPreviewResult').innerText()).includes('恢复旧任务 1 条'),'下一轮预检明确恢复原断点一条');
 hold=false;await button('window-start').click();await page.locator('#editor').waitFor({state:'hidden'});await product.round.pending;
 const completed=product.round.windows.view(product.round.windows.latest(round.id).id,{items:true});
 check(completed.state==='COMPLETED'&&completed.total===100&&completed.submitted===100&&completed.counts.NEW_SUCCESS===100,'一次网站开始自主推进100个模拟结果');
 check(flow.submits===100&&new Set(launches).size===100&&launches.length===101,'100个不同商品各模拟提交一次，原暂停项沿用run');
 check(product.round.items(round.id)[0].run_id===originalRun,'暂停停止后的原任务runId保持');
 check(JSON.stringify(product.round.windows.view(first.id,{items:true}))===JSON.stringify(sealed),'下一轮处理不会倒改已停止历史快照');
 check(product.round.items(round.id)[100].state==='PENDING'&&!product.round.items(round.id)[100].run_id,'自动衔接关闭时第101条保持原始待处理');
 await page.reload();await button('window-configure').waitFor();check((await page.locator('.monitor-progress .task-progress-heading').innerText()).includes('100 / 100'),'刷新后100/100模拟进度与持久记录一致');
 await page.screenshot({path:join(out,'05-completed-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px完成与历史页面无整页横向溢出');await page.screenshot({path:join(out,'06-completed-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await configure();await page.locator('#windowStart').fill('102');await page.locator('#windowEnd').fill('102');await preview();
 check((await page.locator('#windowPreviewResult').innerText()).includes('本轮可分配 0 条')&&await button('window-start').count()===0,'零条合格任务只显示排除原因，不提供开始');
 await page.locator('#windowPreviewResult summary').click();
 check((await page.locator('#windowPreviewResult').innerText()).includes('缺少价格资料'),'零条预检明确显示原商品资料问题');await page.screenshot({path:join(out,'07-zero-eligible.png'),fullPage:true});
 await page.locator('#windowStart').fill('101');await page.locator('#windowEnd').fill('101');
 // Delay the real preview endpoint to exercise user editing while it is pending.
 previewHold=true;const reached=new Promise(r=>previewStarted=r);await button('window-preview').click();await reached;
 await page.locator('#windowStart').fill('102');await page.locator('#windowEnd').fill('102');previewHold=false;releasePreview();
 await page.waitForFunction(()=>!document.querySelector('[data-action="window-preview"]').disabled);
 check(await button('window-start').count()===0,'预检等待期间修改范围也不能恢复旧范围开始按钮');
 await page.screenshot({path:join(out,'08-inflight-scope-change.png'),fullPage:true});
 await page.locator('#closeEditor').click();await configure();await page.locator('#windowStart').fill('101');await page.locator('#windowEnd').fill('101');
 previewHold=true;const closeReached=new Promise(r=>previewStarted=r);await button('window-preview').click();await closeReached;await page.locator('#closeEditor').click();
 previewHold=false;releasePreview();await page.waitForTimeout(150);
 await configure();check(await button('window-start').count()===0,'关闭等待中的预检后重新打开设置不会保留旧开始按钮');
 check(errors.length===0&&external.length===0,'浏览器无未捕获错误或外部网络请求');
 check(requests.filter(x=>x.path==='/api/v1/rounds/window-create').length===2&&requests.filter(x=>x.path==='/api/v1/rounds/resume').length===2,'100条模拟过程仅两次人为开始（暂停轮一次、完整轮一次），没有逐条请求接力');
 check(JSON.stringify(await hashes())===JSON.stringify(sourceHashes),'验收期间五个相关生产文件哈希稳定');
}catch(e){failure={message:e.message,stack:e.stack};console.error(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
 if(product.round.active){product.round.pause();release?.();releasePreview?.();await product.round.pending;}
 const report={at:new Date().toISOString(),base,sourceHashes,checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,failure,errors,apiErrors,external,requests,launches,simulatedSubmissions:flow.submits,productionRequests:0,productionBrowserAccess:false,scope:'Temporary SQLite + real web UI/API + synthetic executor; NOT real 100-item platform acceptance'};
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,failure,errors,apiErrors,external}));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
 if(failure||report.failed||errors.length||external.length)process.exitCode=1;
}
