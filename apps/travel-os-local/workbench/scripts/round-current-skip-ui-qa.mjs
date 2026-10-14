// Independent UI/API acceptance on a temporary store and random localhost port.
// The executor and platform/content checks are synthetic. Never platform proof.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';

const root=resolve(import.meta.dirname,'../..');
const qaHost=process.env.QA_HTTP_HOST||'127.0.0.1';
const sourceFiles=['workbench/static-files.mjs','workbench/round-manual-skip.mjs','workbench/round-item-retry.mjs','workbench/round-item-retry-api.mjs','workbench/round-item-detail.js','workbench/round-item-detail.css','workbench/round-item-api.mjs','workbench/round-item-host-api.mjs','workbench/travel-os.js','workbench/tasks.css','workbench/round-windows.mjs','workbench/listing-round.mjs','workbench/product-api.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
const sourceHashes=await hashes();
const out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/playwright/current-skip',new Date().toISOString().replaceAll(':','-')));
await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'ly-item-retry-ui-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'wuzhou-changyou',name:'轮次界面隔离测试店'},tasks=Array.from({length:4},(_,i)=>({shopId:shop.id,priority:i+1,source:{sheet:'境外城市热度',row:i+2},
 listing:{type:'city',country:'隔离测试国',city:'隔离城市'+(i+1),title:'轮次界面隔离商品'+(i+1)},business:{shop_name:shop.name,price_cny:20,inventory:999999},assets:{main:[],secondary:[],details:[]},adapterIssues:i===101?['隔离测试：缺少价格资料']:[]}));
const importId=store.imported({sourceHash:'ISOLATED_ROUND_WINDOW_UI',tasks,summary:{total:tasks.length}});
const checks=[],requests=[],external=[],errors=[],apiErrors=[],launches=[];
const check=(ok,label)=>{checks.push({ok:!!ok,label});console.log((ok?'PASS ':'FAIL ')+label);};
let hold=false,release,previewHold=false,releasePreview,previewStarted,browserChallenge=true,captchaItem=3;
const flow={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,stop:false,submits:0,
 launch(id){assert.equal(this.active,null,'only one isolated executor');this.active=id;this.stop=false;launches.push(id);this.pending=(async()=>{
  const run=store.run(id);store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);
  if(run.task.priority===captchaItem){store.checkpoint(id,{step:'existing-listing-query'});store.move(id,'PAUSED_CAPTCHA','PAUSED_CAPTCHA');return;}
  if(this.stop){store.checkpoint(id,{step:'pre-submit-review'});store.move(id,'PAUSED','操作者暂停');return;}
  store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{isolated:true});
  store.move(id,'VERIFIED','',{itemId:String(991000000+run.task.priority),status:'出售中',rowText:'隔离平台模拟 '+run.task.listing.title,screenshot:'synthetic-only.png',verifiedAt:new Date().toISOString()});
 })().finally(()=>this.active=null);},
 async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}
};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:!browserChallenge,loginState:browserChallenge?'PAUSED_CAPTCHA':'LOGGED_IN',reason:browserChallenge?'当前仍有验证码，请人工完成验证':'',checkedAt:new Date().toISOString()})};
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

let browser,page,base,failure,browserCrypto,feedbackAtFailure;
try{
 await product.saveSettings({executionEnabled:true,confirmShop:shop.name});await new Promise(r=>server.listen(0,qaHost,r));base='http://'+qaHost+':'+server.address().port;
 assert.notEqual(server.address().port,4318);
 const w=product.round.windows.create(await product.round.windows.preview(round.id,{limit:4}));
 const [first,second,third,fourth]=product.round.items(round.id);
 const blockCurrent=(item,state='WAITING_HUMAN',reason='PAUSED_CAPTCHA')=>{
  product.round.update(round.id,item.key,{state,reason,failure_stage:'existing-listing-query'});
  store.db.prepare('UPDATE rounds SET current_item=? WHERE id=?').run(item.key,round.id);
  product.round.state(round.id,state==='PENDING'?'SYSTEM_BLOCKED':state,reason);
  product.round.windows.state(w.id,state==='PENDING'?'SYSTEM_BLOCKED':state,reason);
 };
 blockCurrent(first);
 blockCurrent(second,'PENDING','图片上传超时');
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const button=()=>page.locator('[data-action="round-current-skip"]'),feedback=()=>page.locator('[data-current-skip-feedback]');
 await page.goto(base+'/travel-os.html#tasks');await button().waitFor();
 browserCrypto=await page.evaluate(()=>({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID,getRandomValues:typeof crypto.getRandomValues}));
 if(qaHost!=='127.0.0.1')check(!browserCrypto.secureContext&&browserCrypto.randomUUID==='undefined'&&browserCrypto.getRandomValues==='function','真实局域网HTTP缺少randomUUID，仍可使用安全随机数');
 check(await button().innerText()==='跳过此条'&&await button().isEnabled(),'截图所示本轮操作区直接提供跳过此条');
 const desktop=await button().boundingBox();check(desktop.height>=40,'桌面按钮沿用当前控件尺寸');
 await page.locator('.listing-round').screenshot({path:join(out,'01-captcha-desktop.png')});
 await page.setViewportSize({width:390,height:844});await button().scrollIntoViewIfNeeded();
 const mobile=await button().boundingBox();check(mobile.height>=44&&mobile.height<=65&&mobile.x>=0&&mobile.x+mobile.width<=390,'390px按钮可触控且不越界');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'窄屏没有横向溢出');await page.locator('.listing-round').screenshot({path:join(out,'02-captcha-mobile.png')});
 const requestStart=requests.length;await button().click();await feedback().filter({hasText:'继续本轮未通过检查'}).waitFor();
 const actionRequests=requests.slice(requestStart).filter(x=>['/api/v1/rounds/item-skip','/api/v1/rounds/resume'].includes(new URL(x.path,'http://localhost').pathname));
 check(actionRequests.length===2&&actionRequests[0].path==='/api/v1/rounds/item-skip'&&actionRequests[1].path==='/api/v1/rounds/resume','一次点击先保存跳过，再检查原轮次恢复');
 check(actionRequests.every(x=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x.input.requestId)),'跳过与恢复编号符合服务器UUID v4格式');
 check(product.round.item(round.id,second.key).state==='MANUAL_SKIPPED'&&flow.submits===0,'验证码未消失时跳过仍保存，未进行任何模拟提交');
 check((await feedback().innerText()).includes('验证码')&&await button().innerText()==='已跳过此条'&&await button().isDisabled(),'明确提示已跳过、验证仍待处理，保留禁用按钮且不重复跳过');
 await page.setViewportSize({width:1440,height:1000});await page.locator('.listing-round').screenshot({path:join(out,'03-skipped-challenge-remains.png')});
 // Clear the real fixture browser check while retaining the old first-item
 // CAPTCHA record. Resume via the visible UI; the server must recheck it.
 browserChallenge=false;
 await page.reload();await page.locator('.monitor-guidance').filter({hasText:'等待继续后续商品'}).waitFor();
 check(await button().isDisabled()&&await button().innerText()==='已跳过此条','实时浏览器正常时旧异常转为等待继续，跳过按钮保留状态');
 await page.locator('[data-action=round-resume]').click();
 for(let i=0;!product.round.active&&i<100;i++)await page.waitForTimeout(20);
 await product.round.pending;
 check(product.round.item(round.id,first.key).state==='NEW_SUCCESS'&&flow.submits===1,'旧验证码已消失时网页继续原任务，无需重复人工确认');
 const accepted=product.round.events(round.id).filter(e=>e.kind==='START_ACCEPTED').at(-1);
 check(accepted.payload.humanVerified===false&&accepted.payload.captchaVerification?.source==='fresh-browser-check','恢复记录注明服务器实时浏览器核验，不伪造人工勾选');
 const paused=product.round.item(round.id,third.key),originalRun=store.run(paused.run_id),originalQueue=batch.store.item(paused.queue_id);
 check(originalRun.state==='PAUSED_CAPTCHA'&&paused.state==='WAITING_HUMAN','原执行器在后续第三条提交前验证码持久暂停');
 await page.reload();await button().waitFor();check(await button().isEnabled(),'有原run的未提交验证码商品也可跳过');
 // Drop the first real HTTP receipt after its atomic decision was saved.
 let lost=false;
 await context.route('**/api/v1/rounds/item-skip',async route=>{const response=await route.fetch();if(!lost&&response.ok()){lost=true;return route.abort('failed');}return route.fulfill({response});});
 const lostStart=requests.length;await button().click();await page.getByRole('button',{name:'核对此次跳过',exact:true}).waitFor();
 check(product.round.item(round.id,third.key).state==='MANUAL_SKIPPED'&&flow.submits===1,'跳过响应丢失时不提前恢复或提交');
 await page.reload();await page.getByRole('button',{name:'核对此次跳过',exact:true}).waitFor();
 check(true,'刷新后能核对原跳过请求');await page.locator('.listing-round').screenshot({path:join(out,'04-reload-reconcile.png')});
 captchaItem=null;await button().click();
 await page.waitForFunction(()=>document.querySelector('[data-current-skip-feedback]')?.innerText.includes('已请求继续本轮'));
 await product.round.pending;
 const skipCalls=requests.slice(lostStart).filter(x=>x.path==='/api/v1/rounds/item-skip');
 check(skipCalls.length===2&&JSON.stringify(skipCalls[0].input)===JSON.stringify(skipCalls[1].input),'刷新核对使用完全相同请求，不重复生成跳过决定');
 check(JSON.stringify(store.run(paused.run_id))===JSON.stringify(originalRun)&&batch.store.item(paused.queue_id).attempts===originalQueue.attempts,'原暂停run、断点和次数完整保留');
 check(product.round.item(round.id,first.key).state==='NEW_SUCCESS'&&product.round.item(round.id,fourth.key).state==='NEW_SUCCESS'&&flow.submits===2,'原轮次继续下一条，跳过项始终不模拟提交');
 check(product.round.view(round.id).counts.MANUAL_SKIPPED===2&&product.round.windows.view(w.id).ended===4,'手动跳过计入本轮结束数与独立统计');
 await page.reload();await page.locator('.listing-round').waitFor();check(await button().count()===0,'已结束轮次不显示可重复跳过按钮');
 await page.locator('.listing-round').screenshot({path:join(out,'05-completed.png')});
 check(errors.length===0&&external.length===0,'真实网页没有脚本错误或外网请求');
 check(JSON.stringify(sourceHashes)===JSON.stringify(await hashes()),'浏览器验证期间源码未变化');
}catch(e){failure=e.stack||String(e);check(false,e.message);if(page){feedbackAtFailure=await page.locator('[data-current-skip-feedback]').allTextContents().catch(()=>[]);await page.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});}}
finally{
 await browser?.close();await new Promise(r=>server.close(r));product.closeStreams();store.close();
 await writeFile(join(out,'result.json'),JSON.stringify({ok:checks.every(x=>x.ok)&&!failure,checks,pageErrors:errors,apiErrors,external,sourceHashes,isolatedPort:base,browserCrypto,feedbackAtFailure,productionTouched:false,failure},null,2));
 console.log('RESULT '+join(out,'result.json'));if(checks.some(x=>!x.ok)||failure)process.exitCode=1;
}
