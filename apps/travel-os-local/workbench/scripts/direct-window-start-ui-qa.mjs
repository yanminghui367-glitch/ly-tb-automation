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
let hold=true,release,previewHold=false,releasePreview,previewStarted,rejectPreview=false,staleCreateOnce=false;
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
const round=await product.round.create({importId,repairVersion:'ISOLATED_OLDER_DEPLOYMENT',expectedCount:tasks.length,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:tasks.length}});
// Isolated fixture begins after the first-one/first-five gates; no real gate or
// production store is changed, and no simulated result is platform evidence.
store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(round.id);
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime:dir,launch:async()=>{throw Error('NO_PRODUCTION_BROWSER');}});
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const body=async req=>{let text='';for await(const part of req)text+=part;const input=JSON.parse(text||'{}');req.qaRecord.input=input;return input;};
const serve=createStaticHandler(join(root,'workbench'));
const server=createServer(async(req,res)=>{req.qaRecord={method:req.method,path:new URL(req.url,'http://localhost').pathname};requests.push(req.qaRecord);try{
 if(req.qaRecord.path==='/api/v1/rounds/window-preview'){if(previewHold){previewStarted?.();await new Promise(r=>releasePreview=r);}if(rejectPreview)throw Error('隔离测试：范围请求失败');}
 if(req.qaRecord.path==='/api/v1/rounds/window-create'&&staleCreateOnce){staleCreateOnce=false;throw Error('预检范围已变化，请重新检查');}
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/os/'))return await os.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/v1/'))return await product.handle(req,res,u,{json,body});
 if(u.pathname.startsWith('/api/'))throw Error('UNDECLARED_API');await serve(req,res);
}catch(e){apiErrors.push({path:req.url,message:e.message});json(res,e.statusCode||409,{error:e.message});}});
let browser,page,base,failure;
try{
 await product.saveSettings({executionEnabled:true,confirmShop:shop.name});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.locator('[data-action="'+name+'"]');
 const configure=async()=>{await button('window-configure').click();await page.locator('#windowLimit').waitFor();};
 await page.goto(base+'/travel-os.html#tasks');await configure();
 check(await button('window-preview').innerText()==='开始执行','设置范围后直接开始，没有额外资料核对按钮');
 check(await button('window-start').count()===0,'不再要求预检后第二次点击开始');
 rejectPreview=true;await button('window-preview').click();await page.locator('#windowPreviewResult [role=alert]').waitFor();
 check(!(await page.locator('#windowPreviewResult').innerText()).includes('正在启动'),'错误显示明确结果，不遗留等待状态');
 await page.waitForFunction(()=>document.querySelector('[data-action="window-preview"]')?.disabled===false);
 check(!(await button('window-preview').isDisabled()),'请求失败后开始按钮恢复可用');
 await page.screenshot({path:join(out,'01-error-recovery.png'),fullPage:true});
 rejectPreview=false;await page.locator('#closeEditor').click();await configure();
 previewHold=true;const reached=new Promise(r=>previewStarted=r);await button('window-preview').click();await reached;
 const pendingRequests=requests.filter(r=>r.path==='/api/v1/rounds/window-preview').length;
 await button('window-preview').evaluate(el=>el.disabled=false);await button('window-preview').click();await page.waitForTimeout(100);
 check(requests.filter(r=>r.path==='/api/v1/rounds/window-preview').length===pendingRequests,'状态刷新误启用按钮时重复点击也不会重复发送启动请求');
 await page.locator('#closeEditor').click();previewHold=false;releasePreview();await page.waitForTimeout(150);
 check(product.round.windows.latest(round.id)===null&&flow.submits===0,'关闭等待窗口后返回的响应不会创建或启动任务');
 await configure();await page.locator('#windowLimit').fill('102');
 check(!(await page.locator('#windowAuto').isChecked()),'超过100条无需额外勾选也自动分轮');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'手机页面无横向溢出');
 await page.screenshot({path:join(out,'02-direct-start-mobile.png'),fullPage:true});
 staleCreateOnce=true;await button('window-preview').click();await page.locator('#windowPreviewResult [role=alert]').waitFor();
 const staleRequests=requests.filter(r=>r.path==='/api/v1/rounds/window-preview').length;
 hold=false;await button('window-preview').click();await page.locator('#editor').waitFor({state:'hidden'});await product.round.pending;
 check(requests.filter(r=>r.path==='/api/v1/rounds/window-preview').length===staleRequests+1,'范围失效后下一次点击使用新状态，不反复提交旧缓存');
 const creation=requests.find(r=>r.path==='/api/v1/rounds/window-create'&&r.input);
 check(creation?.input.limit===100&&creation?.input.autoContinue===true,'超过100自动变为每轮100并连续衔接');
 check(flow.submits===101&&new Set(launches).size===101,'一次点击连续处理101条合格模拟商品，资料异常条不提交');
 check(product.round.windows.history(round.id).map(w=>w.total).sort((a,b)=>b-a).join(',')==='100,1','执行器按同一范围自动分轮');
 await page.setViewportSize({width:1440,height:1000});await page.reload();await button('window-configure').waitFor();await page.screenshot({path:join(out,'03-completed.png'),fullPage:true});
 await configure();await page.locator('#windowStart').fill('102');await page.locator('#windowEnd').fill('102');await page.locator('#windowLimit').fill('100');
 await button('window-preview').click();await page.locator('#windowPreviewResult [role=alert]').waitFor();
 check((await page.locator('#windowPreviewResult').innerText()).includes('缺少价格资料'),'零条合格范围显示原因且不空转');
 check(errors.length===0&&external.length===0,'无浏览器错误或外部请求');
 check(JSON.stringify(await hashes())===JSON.stringify(sourceHashes),'相关生产文件在隔离测试中保持不变');
}catch(e){failure={message:e.message,stack:e.stack};console.error(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
 if(product.round.active){product.round.pause();release?.();releasePreview?.();await product.round.pending;}
 const report={at:new Date().toISOString(),base,sourceHashes,checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,failure,errors,apiErrors,external,requests,launches,simulatedSubmissions:flow.submits,productionRequests:0,productionBrowserAccess:false};
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,failure,errors}));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
 if(failure||report.failed||errors.length||external.length)process.exitCode=1;
}
