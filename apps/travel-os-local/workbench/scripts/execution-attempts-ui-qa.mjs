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
const sourceFiles=['workbench/round-execution-attempts.mjs','workbench/travel-os.js','workbench/tasks.css','workbench/round-windows.mjs','workbench/listing-round.mjs','workbench/product-api.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
const sourceHashes=await hashes();
const out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/independent100-20261009/ui-qa',new Date().toISOString().replaceAll(':','-')));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'ly-round-window-ui-')),store=new SourceStore(join(dir,'source.sqlite'));
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
 const w=product.round.windows.create(await product.round.windows.preview(round.id,{limit:3}));
 const journal=product.round.executionAttempts.attempts,seal=journal.seal.bind(journal);
 journal.seal=()=>{throw Error('isolated outcome persistence fault');};product.round.start(round.id,{windowId:w.id});await product.round.pending;journal.seal=seal;
 const stopped=process.env.QA_STOPPED==='1';if(stopped)product.round.stop();
 const scope=product.round.summary(round.id).executionRecovery;check(!!scope&&flow.submits===1,'记录写入失败后保持唯一原任务，未执行下一条');
 await page.goto(base+'/travel-os.html#tasks');await button('round-resume').waitFor();await button('round-resume').scrollIntoViewIfNeeded();
 check((await button('round-resume').innerText()).includes('恢复原处理记录'),'页面提供具体记录恢复入口');
 check((await page.locator('.task-state-hero').innerText()).includes('处理记录待恢复'),'状态卡正确显示记录待恢复，不能宣称持续执行');
 check(await button('round-stop').isVisible(),'记录待恢复仍保留停止本轮入口');
 await page.screenshot({path:join(out,'01-recovery-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await button('round-resume').scrollIntoViewIfNeeded();
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'移动端恢复入口无横向溢出');
 await page.screenshot({path:join(out,'02-recovery-mobile.png'),fullPage:true});
 await button('round-resume').click();await page.waitForFunction(()=>!document.body.innerText.includes('恢复原处理记录'));await product.round.pending;
 const request=requests.find(r=>r.path==='/api/v1/rounds/resume');check(request?.input?.attemptId===scope.attemptId&&request?.input?.windowId===w.id&&request?.input?.id===round.id,'实际按钮提交原尝试及原窗口身份');
 check(flow.submits===1,'补存原记录不会直接启动剩余商品');
 if(!stopped){await button('round-resume').click();await product.round.pending;await page.waitForFunction(()=>!document.querySelector('[data-action="round-pause"]'));}
 check(flow.submits===(stopped?1:3),stopped?'停止后的恢复仅补存，不发布剩余商品':'恢复后原队列完成剩余两条，已发布首条不重投');
 check(launches.length===(stopped?1:3)&&new Set(launches).size===launches.length,'没有第二发布者或已提交商品重复执行');
 check(stopped?product.round.windows.get(w.id).state==='STOPPED':product.round.windows.get(w.id).state==='COMPLETED','页面恢复产生对应持久状态');
 await page.reload();await page.locator('.listing-round').waitFor();await page.locator('.listing-round').scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'03-recovered-mobile.png'),fullPage:true});
 check(errors.length===0&&external.length===0,'无页面脚本错误及外部网络请求');
 check(JSON.stringify(await hashes())===JSON.stringify(sourceHashes),'验收期间候选源文件未变');
}catch(e){failure={message:e.message,stack:e.stack};console.error(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
 if(product.round.active){product.round.pause();release?.();releasePreview?.();await product.round.pending;}
 const report={at:new Date().toISOString(),base,sourceHashes,checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,failure,errors,apiErrors,external,requests,launches,simulatedSubmissions:flow.submits,productionRequests:0,productionBrowserAccess:false,scope:'Temporary SQLite + real web UI/API + synthetic executor; NOT real 100-item platform acceptance'};
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,failure,errors,apiErrors,external}));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
 if(failure||report.failed||errors.length||external.length)process.exitCode=1;
}
