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
const qaHost=process.env.QA_HTTP_HOST||'127.0.0.1';
const sourceFiles=['workbench/round-item-retry.mjs','workbench/round-item-retry-api.mjs','workbench/round-item-detail.js','workbench/round-item-detail.css','workbench/round-item-api.mjs','workbench/round-item-host-api.mjs','workbench/travel-os.js','workbench/tasks.css','workbench/round-windows.mjs','workbench/listing-round.mjs','workbench/product-api.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
const sourceHashes=await hashes();
const out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/playwright/item-retry',new Date().toISOString().replaceAll(':','-')));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'ly-item-retry-ui-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'wuzhou-changyou',name:'轮次界面隔离测试店'},tasks=Array.from({length:3},(_,i)=>({shopId:shop.id,priority:i+1,source:{sheet:'境外城市热度',row:i+2},
 listing:{type:'city',country:'隔离测试国',city:'隔离城市'+(i+1),title:'轮次界面隔离商品'+(i+1)},business:{shop_name:shop.name,price_cny:20,inventory:999999},assets:{main:[],secondary:[],details:[]},adapterIssues:i===101?['隔离测试：缺少价格资料']:[]}));
const importId=store.imported({sourceHash:'ISOLATED_ROUND_WINDOW_UI',tasks,summary:{total:tasks.length}});
const checks=[],requests=[],external=[],errors=[],apiErrors=[],launches=[];
const check=(ok,label)=>{checks.push({ok:!!ok,label});console.log((ok?'PASS ':'FAIL ')+label);};
let hold=false,release,previewHold=false,releasePreview,previewStarted;
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
const product=new ProductApi({source:flow,batch,owner,shop,runtime:dir,isShopRemoved:()=>false,integrity:async()=>({ok:true,files:0,revision:'ISOLATED_UI_QA'}),checkFiles:async()=>{
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
 await product.saveSettings({executionEnabled:true,confirmShop:shop.name});await new Promise(r=>server.listen(0,qaHost,r));base='http://'+qaHost+':'+server.address().port;
 assert.notEqual(server.address().port,4318);
 const w=product.round.windows.create(await product.round.windows.preview(round.id,{limit:3}));
 hold=true;product.round.start(round.id,{windowId:w.id});
 for(let i=0;!release&&i<300;i++)await new Promise(r=>setTimeout(r,10));assert(release);product.round.pause();release();await product.round.pending;hold=false;release=null;
 const first=product.round.items(round.id)[0];
 store.db.prepare("UPDATE batch_items SET attempts=3,max_attempts=3,state='RETRY' WHERE id=?").run(first.queue_id);
 store.db.prepare("UPDATE runs SET reason=? WHERE id=?").run('FORM_DETAIL_IMAGE: fixture failure',first.run_id);
 const originalRun=first.run_id,originalQueue=first.queue_id,previousLaunches=launches.length;

 product.round.update(round.id,first.key,{reason:'后台商品查询失败，尚未提交',failure_stage:'existing-listing-query'});
 product.round.state(round.id,'SYSTEM_BLOCKED','后台商品查询失败，尚未提交');
 const untouched=JSON.stringify(product.round.items(round.id).slice(1));
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/travel-os.html#tasks');
 const detail=page.locator('#editorBody [data-action="round-item-detail"][data-key="'+first.key+'"]');
 const openHistory=async()=>{const ledger=page.locator('#monitorLedger');if(await ledger.count()&&!await ledger.evaluate(el=>el.open))await ledger.locator(':scope > summary').click();const history=page.locator('.round-window-history');if(!await history.evaluate(el=>el.open))await history.locator(':scope > summary').click();};
 const openDetail=async()=>{await openHistory();await page.locator('[data-action="window-detail"]').first().click();await detail.first().click();};
 await openDetail();
 const action=n=>page.locator('[data-item-action="'+n+'"]');
 await action('retry').waitFor();
 check((await page.locator('#editor').innerText()).includes('重新执行此条'),'实际任务详情展示单条重试入口');
 check((await page.locator('#editor').innerText()).includes('读取后台商品列表（查重）'),'查询失败使用真实查询步骤，非旧上传断点');
 await page.screenshot({path:join(out,'01-retry-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'移动端无横向溢出');
 await action('retry').scrollIntoViewIfNeeded();
 const mobileTarget=await action('retry').boundingBox();
 check(mobileTarget.width>=120&&mobileTarget.height>=40&&mobileTarget.x>=0&&mobileTarget.x+mobileTarget.width<=390,'移动端主按钮可见且触控尺寸足够');
 await page.screenshot({path:join(out,'02-retry-mobile.png'),fullPage:false});
 // The real button request reaches ProductApi; discard its first successful response.
 let lost=false;
 await context.route('**/api/v1/rounds/item-retry?**',async route=>{
  const response=await route.fetch();
  if(!lost&&response.status()===200){lost=true;return route.abort('failed');}
  return route.fulfill({response});
 });
 hold=true;
 await page.locator('#editorClose').count().then(async count=>{if(count)await page.locator('#editorClose').click();else await page.locator('#editor').evaluate(el=>el.close());});
 await page.locator('[data-action="round-current-retry"]').click();
 await page.waitForFunction(()=>document.body.innerText.includes('正在检查并处理所选商品'));
 for(let i=0;!release&&i<300;i++)await new Promise(r=>setTimeout(r,10));assert(release,'synthetic source began');
 check(await action('refresh').isDisabled()&&await action('retry').count()===0&&await action('verify').count()===0&&await page.locator('[data-item-skip]').count()===0,'进行中防止重复操作，原资料与结果不可另行修改');
 check(launches.length===previousLaunches+1&&flow.submits===0,'单条真实API请求只启动一个模拟执行者');
 release();hold=false;
 await page.waitForFunction(()=>{const x=document.querySelector('[data-item-action="retry-reconcile"]');return x&&!x.disabled;});
 check(lost&&flow.submits===1,'响应丢失时后台仅执行一次，页面保留核对入口');
 check((await page.locator('.round-item-summary').innerText()).includes('本次重试结果待核对')&&!(await page.locator('.round-item-summary').innerText()).includes('尚未点击提交')&&(await page.locator('.round-item-next').innerText()).includes('沿用原操作核对'),'响应丢失不把请求前快照当作当前未提交状态');
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:join(out,'03-response-lost.png'),fullPage:true});
 await page.reload();await openDetail();await action('retry-reconcile').waitFor();
 check(await action('retry').count()===0,'响应丢失后刷新仍只允许核对原请求');
 await action('retry-reconcile').click();
 await page.waitForFunction(()=>document.querySelector('.round-item-feedback')?.innerText.includes('本次单条处理已记录'));
 const attempts=requests.filter(x=>new URL(x.path,'http://localhost').pathname==='/api/v1/rounds/item-retry');
 check(attempts.length===2&&JSON.stringify(attempts[0].input)===JSON.stringify(attempts[1].input),'网络恢复沿用原请求，不生成第二次重试');
 check(flow.submits===1&&launches.length===previousLaunches+1&&JSON.stringify(product.round.items(round.id).slice(1))===untouched,'只处理选中商品，其余两条状态与记录不变');
 check(product.round.round(round.id).state==='PAUSED'&&!product.round.active,'单条结束后持久暂停，释放原执行器');
 check(product.round.item(round.id,first.key).run_id===originalRun&&product.round.item(round.id,first.key).queue_id===originalQueue&&product.round.selections.manualBudgetUsed(originalQueue)===1&&batch.store.item(originalQueue).attempts===4,'监控一键复用3/3原任务，仅追加并使用1次机会');
 check(await action('retry').count()===0&&await page.locator('[data-item-skip]').count()===0,'成功商品不再提供重试与跳过');
 await page.locator('.round-item-history summary').click();
 check((await page.locator('.round-item-history').innerText()).includes('手动重试'),'原尝试作为手动重试留在处理记录中');
 await page.screenshot({path:join(out,'04-retry-finished.png'),fullPage:true});
 await page.reload();await openDetail();await page.locator('.round-item-history').waitFor();
 check((await page.locator('#editor').innerText()).includes('新增上架已核验')&&await action('retry').count()===0,'刷新网站后保留原结果，不重复执行');
 // Exercise the new one-action path on a confirmed pre-submit blocker. The
 // second item is skipped with its audit record, then the original round
 // resumes and processes the third item; no second attempt is made for it.
 const second=product.round.items(round.id)[1],third=product.round.items(round.id)[2];
 product.round.update(round.id,second.key,{state:'PENDING',reason:'主图素材区域定位失败，原任务记录确认尚未提交',failure_stage:'main-image-1'});
 product.round.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(second.key,round.id);
 product.round.state(round.id,'SYSTEM_BLOCKED','系统问题已暂停；其余商品仍待处理：MAIN_MATERIAL_FRAME_ORIGIN');
 await page.reload();
 await openHistory();await page.locator('[data-action="window-detail"]').first().click();
 await page.locator('#editorBody [data-action="round-item-detail"][data-key="'+second.key+'"]').click();
 const skipContinue=page.locator('[data-item-skip] button[value="continue"]');
 await skipContinue.waitFor();
 check(await skipContinue.count()===1&&(await page.locator('#editor').innerText()).includes('跳过此条并继续本轮'),'当前商品未提交且轮次暂停时显示合并操作');
 await page.locator('[data-item-skip] textarea').fill('页面图片素材定位故障；确认尚未提交，跳过本条继续剩余商品');
 const skipRequestStart=requests.length;await skipContinue.click();
 await page.waitForFunction(()=>document.querySelector('.round-item-feedback')?.innerText.includes('本轮剩余商品已交由原执行器继续处理'));
 await product.round.pending;
 const skipContinueRequests=requests.slice(skipRequestStart).filter(x=>['/api/v1/rounds/item-skip','/api/v1/rounds/resume'].includes(new URL(x.path,'http://localhost').pathname));
 check(skipContinueRequests.length===2&&new URL(skipContinueRequests[0].path,'http://localhost').pathname==='/api/v1/rounds/item-skip'&&new URL(skipContinueRequests[1].path,'http://localhost').pathname==='/api/v1/rounds/resume','先记跳过，再恢复同一轮次');
 check(product.round.item(round.id,second.key).state==='MANUAL_SKIPPED'&&product.round.item(round.id,second.key).submitted===0,'跳过项保留人工跳过状态且没有提交');
 check(product.round.item(round.id,third.key).state==='NEW_SUCCESS'&&flow.submits===2&&launches.length===previousLaunches+2,'跳过项未重发，原轮次继续处理下一条');
 check(errors.length===0&&apiErrors.length===0&&external.length===0,'合并操作无页面错误、API错误或外网请求');
 check(errors.length===0&&external.length===0,'没有页面脚本异常或外部网络访问');
 check(JSON.stringify(await hashes())===JSON.stringify(sourceHashes),'测试期间候选源文件保持不变');
}catch(e){failure={message:e.message,stack:e.stack};console.error(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
 if(product.round.active){product.round.pause();release?.();releasePreview?.();await product.round.pending;}
 const report={at:new Date().toISOString(),base,sourceHashes,checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,failure,errors,apiErrors,external,requests,launches,simulatedSubmissions:flow.submits,productionRequests:0,productionBrowserAccess:false,scope:'Temporary SQLite + actual workbench UI/ProductApi + synthetic executor. No actual platform publication.'};
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,failure,errors,apiErrors,external}));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
 if(failure||report.failed||errors.length||external.length)process.exitCode=1;
}
