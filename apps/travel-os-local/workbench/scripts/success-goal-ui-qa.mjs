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
const out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/success-goal-ui-qa',new Date().toISOString().replaceAll(':','-')));
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
 await page.goto(base+'/travel-os.html#tasks');await button('success-goal-configure').click();
 check(await page.locator('#successGoalTarget').inputValue()==='102','小清单目标不超过总数');
 await page.locator('#successGoalActor').fill('隔离验收员');await page.locator('#successGoalTarget').fill('2');
 await button('success-goal-preview').click();await button('success-goal-start').waitFor();
 check((await page.locator('#successGoalPreviewResult').innerText()).includes('本次目标 2 条新增成功'),'预览明确新增成功目标');
 await page.locator('#successGoalPreviewResult summary').click();
 check((await page.locator('#successGoalPreviewResult').innerText()).includes('缺少价格资料'),'预览列出被排除的资料问题');
 await page.screenshot({path:join(out,'goal-preview-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px预览无横向溢出');
 await page.screenshot({path:join(out,'goal-preview-mobile.png'),fullPage:true});
 await page.locator('#successGoalTarget').fill('3');check(await button('success-goal-start').count()===0,'修改目标立即撤销旧确认');
 await page.locator('#successGoalTarget').fill('2');await button('success-goal-preview').click();await button('success-goal-start').waitFor();
 await button('success-goal-start').click();await page.locator('#editor').waitFor({state:'hidden'});await button('round-pause').waitFor();
 check(launches.length===1&&flow.submits===0,'网站启动仅一个执行者，等待首条模拟任务');
 await page.reload();await button('round-pause').waitFor();
 check((await page.locator('.success-goal-progress').innerText()).includes('0 / 2'),'刷新保留本次成功目标');
 check(product.round.summary(round.id).successGoal.targetSuccess===2,'网站目标持久化到原轮次');
 await button('round-pause').click();await product.round.pending;await page.reload();await button('round-resume').waitFor();
 check(flow.submits===0,'暂停没有执行提交');
 hold=false;await button('round-resume').click();await product.round.pending;await page.reload();
 await page.locator('.success-goal-progress').waitFor();
 check(flow.submits===2,'恰好模拟提交两条，达到成功目标即停');
 check(product.round.items(round.id)[2].run_id===null,'第三条未领取未创建任务');
 check((await page.locator('.success-goal-progress').innerText()).includes('2 / 2'),'目标完成显示实际新增核验2/2');
 check(!product.round.active,'目标达到后没有活动执行器');
 await page.screenshot({path:join(out,'goal-completed-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(out,'goal-completed-desktop.png'),fullPage:true});
 check(errors.length===0&&external.length===0,'无浏览器脚本错误且没有外部请求');
 check(requests.filter(x=>x.path.includes('success-goal-create')).length===1,'一次确认创建一个目标');
}catch(e){failure={message:e.message,stack:e.stack};console.error(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}
finally{
 if(product.round.active){product.round.pause();release?.();releasePreview?.();await product.round.pending;}
 const report={at:new Date().toISOString(),checks,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,failure,errors,apiErrors,external,requests,launches,simulatedSubmissions:flow.submits,productionRequests:0,scope:'Temporary SQLite, real local UI and API, synthetic executor only'};
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failed:report.failed,failure}));
 await browser?.close();product.closeStreams();await new Promise(r=>{server.close(r);server.closeAllConnections();});os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
 if(failure||report.failed||errors.length||external.length)process.exitCode=1;
}

