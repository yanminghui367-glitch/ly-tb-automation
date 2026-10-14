// Isolated browser UI verification. Temporary databases and a random local port only.
// The fixture never launches an executor or contacts the production service.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {chromium} from 'playwright';
import {createStaticHandler} from '../static-files.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/execution-monitor-20261013'));
await mkdir(out,{recursive:true});
const runtime=await mkdtemp(join(out,'fixture-')),store=new SourceStore(':memory:');
const shop={id:'wuzhou-changyou',name:'执行监控隔离测试店'};
const tasks=[1,2].map(n=>({shopId:shop.id,priority:n,source:{sheet:'隔离测试',row:n+1},listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试商品'+n},business:{shop_name:shop.name,price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
const importId=store.imported({sourceHash:'MONITOR_UI_ONLY',tasks,summary:{total:2}});
const flow={store,runtime,artifacts:runtime,active:null,preflight:async()=>{},launch(){throw Error('No executor allowed in UI fixture');}};
const owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch:new BatchWorkflow(flow),owner,shop,runtime,integrity:async()=>({ok:true,files:0,revision:'UI_FIXTURE'}),checkFiles:async()=>{},launch:async()=>{throw Error('No browser execution allowed');}});
await product.round.create({importId,repairVersion:'UI_FIXTURE',expectedCount:2,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:2}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime});
const snapshot=await os.snapshot();
const checks=[],writes=[],errors=[],streams=new Set();
const check=(ok,label)=>{checks.push({ok:!!ok,label});console.log((ok?'PASS ':'FAIL ')+label);assert.ok(ok,label);};
let fixture=structuredClone(snapshot),logFail=false,logDelay=null;
const r=fixture.engine.round;
Object.assign(r,{id:'ui-round',manifestHash:'ui-manifest',shop:fixture.engine.shop.id,state:'WAITING_HUMAN',active:false,reason:'PAUSED_CAPTCHA',executionRecovery:null,verificationControl:null,processed:259,total:700,currentItem:'current-key',current:{key:'current-key',destination:'当前测试城市',stage:'existing-listing-query',runId:'current-run',state:'WAITING_HUMAN',submitted:false,submissionUncertain:false,reason:'PAUSED_CAPTCHA'},window:{id:'ui-window',sequence:3,state:'WAITING_HUMAN',total:100,ended:59,submitted:40,resumedCount:1,counts:{NEW_SUCCESS:40,PREFLIGHT_SKIPPED:19,PENDING:41},autoContinue:false},windowHistory:[]});
fixture.engine.active=null;fixture.engine.execution={state:'PAUSED',label:'已暂停',detail:'旧批次提示不应进入监控'};
fixture.engine.batch ||= {id:'fixture-batch',counts:{FAILED:0,RETRY:0},elapsedMs:0,items:tasks.map(task=>({task,shopId:shop.id,title:task.listing.title}))};
fixture.engine.batch.items=fixture.engine.batch.items.slice(0,2).map((x,i)=>({...x,id:'history-'+i,runId:'history-run-'+i,destination:'历史测试城市'+i,title:'历史任务 '+i,state:'SKIPPED',displayState:'SKIPPED',roundHold:false,candidateHold:false,contentHold:false,issue:null,reason:'历史原因',kind:'execution'}));
fixture.engine.batch.current='history-0';fixture.engine.batch.state='PAUSED';fixture.engine.batch.failureBlocked=false;
fixture.preparations=[];fixture.engine.pageManagement=null;fixture.engine.settings.executionEnabled=true;
const serve=createStaticHandler(join(root,'workbench'));
const json=(res,x)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(x));};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(req.method!=='GET'){let body='';for await(const x of req)body+=x;writes.push({path:url.pathname,input:JSON.parse(body||'{}')});return json(res,{accepted:true});}
 if(url.pathname==='/api/os/state')return json(res,fixture);
 if(url.pathname==='/api/v1/state')return json(res,fixture.engine);
 if(url.pathname==='/api/v1/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
 if(url.pathname==='/api/v1/task'){const id=url.searchParams.get('id');if(logDelay&&id==='current-run')await logDelay;if(logFail){res.writeHead(500);return res.end('{"error":"isolated log failure"}');}return json(res,{id,events:[{at:new Date().toISOString(),label:id==='current-run'?'当前商品日志':'所选历史商品日志',kind:'STEP_INTENT',technical:{step:'attribute-style'},reason:''}],checkpoint:{step:'attribute-style'}});}
 if(url.pathname.startsWith('/api/'))return json(res,{});
 await serve(req,res);
 }catch(e){res.writeHead(500);res.end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const emit=async()=>{fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');await page.waitForTimeout(120);};
try{
 await page.goto(base+'/travel-os.html#tasks');await page.locator('.execution-monitor').waitFor();
 const monitor=page.locator('.execution-monitor');
 check((await monitor.innerText()).includes('当前测试城市'),'监控绑定本轮商品');
 check(!(await monitor.innerText()).includes('历史测试城市'),'监控不混入所选历史商品');
 check(await page.locator('#page-tasks [data-action=continue]').count()===0,'没有旧批次继续入口');
 check(await page.locator('#page-tasks [data-action=engine-browser]').count()===1,'只保留一个执行Chrome入口');
 check(await monitor.locator('.monitor-status.attention').count()===1,'等待人工为橙色而非绿色');
 check((await monitor.locator('.monitor-progress').innerText()).includes('59 / 100'),'本轮59/100不与总清单259/700混合');
 check(!(await page.locator('#taskHistoryPanel').evaluate(el=>el.open)),'历史记录默认收起');
 await page.locator('[data-action=select-task][data-id=history-1]').click();
 await page.waitForFunction(()=>document.getElementById('taskHistoryPanel')?.open===true);
 check(await page.locator('#taskHistoryPanel').evaluate(el=>el.open),'查看历史商品自动展开独立区域');
 check((await monitor.innerText()).includes('当前测试城市')&&!(await monitor.innerText()).includes('历史原因'),'选历史任务不会改变实时原因与商品');
 await page.locator('#taskHistoryPanel>summary').click();
 await page.locator('#monitorExecutionDetails>summary').click();
 await page.locator('#monitorExecutionDetails .log-list li').filter({hasText:'当前商品日志'}).waitFor();
 check(!(await page.locator('#monitorExecutionDetails').innerText()).includes('所选历史商品日志'),'监控日志独立绑定current run');
 await page.locator('#monitorExecutionDetails>summary').click();
 await page.locator('[data-action=round-resume]').click();await page.locator('#roundHumanVerified').check();await page.locator('[data-action=round-human-resume]').click();
 await page.waitForFunction(()=>!document.getElementById('editor').open);
 check(writes.length===1&&writes[0].path==='/api/v1/rounds/resume'&&writes[0].input.id==='ui-round'&&writes[0].input.windowId==='ui-window'&&writes[0].input.humanVerified,'人工确认继续沿用原轮次与窗口接口（隔离模拟）');
 await page.screenshot({path:join(out,'monitor-desktop.png'),fullPage:true});
 for(const [state,tone] of [['RUNNING','running'],['PAUSING','attention'],['PAUSED','attention'],['SYSTEM_BLOCKED','error'],['RESULT_UNKNOWN','error'],['STOPPED','offline'],['COMPLETED','complete']]){
  r.state=state;r.active=state==='RUNNING'||state==='PAUSING';r.reason=state==='SYSTEM_BLOCKED'?'UNKNOWN_CODE':'';r.window.state=state;await emit();
  check(await monitor.locator('.monitor-status.'+tone).count()===1,'状态色与本轮一致 '+state);
  if(state==='RUNNING')check(await page.locator('[data-action=round-current-skip]').isDisabled(),'运行中保留跳过入口，需安全暂停后操作');
 }
 r.state='SYSTEM_BLOCKED';r.active=false;r.window.state='SYSTEM_BLOCKED';r.reason='旧商品主图超时';
 r.current.state='MANUAL_SKIPPED';r.current.stage='manual-skip';r.captchaRecheck={eligible:true,count:1};
 fixture.engine.browser={running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString(),stale:false};await emit();
 check((await monitor.locator('.monitor-status').innerText()).includes('已跳过 · 等待继续'),'已跳过商品的旧异常不再显示为当前执行异常');
 check((await monitor.locator('.monitor-guidance').innerText()).includes('等待继续后续商品'),'明确区分跳过已完成和后续尚未启动');
 check(await page.locator('[data-action=round-current-skip]').innerText()==='已跳过此条'&&await page.locator('[data-action=round-current-skip]').isDisabled(),'保留已跳过按钮状态，禁止重复操作');
 await page.locator('[data-action=round-resume]').click();
 check(writes.at(-1).path==='/api/v1/rounds/resume'&&!writes.at(-1).input.humanVerified,'浏览器正常时请求后端实时复查旧验证码，无需重复人工勾选');
 await page.locator('.monitor-guidance details>summary').click();
 check((await monitor.locator('.monitor-guidance details').innerText()).includes('旧商品主图超时'),'原异常保留在上一条暂停记录中');
 await monitor.screenshot({path:join(out,'monitor-skipped-waiting.png')});
 r.state='WAITING_HUMAN';r.window.state='WAITING_HUMAN';r.reason='PAUSED_CAPTCHA';
 fixture.engine.browser={running:true,loggedIn:false,loginState:'PAUSED_CAPTCHA',checkedAt:new Date().toISOString(),stale:false};await emit();
 check((await monitor.locator('.monitor-guidance').innerText()).includes('仍需验证'),'真实验证码仍显示人工处理提示');
 await page.locator('[data-action=round-resume]').click();await page.locator('#roundHumanVerified').waitFor();
 check(true,'当前验证码仍需人工处理确认');await page.locator('#closeEditor').click();
 delete r.captchaRecheck;
 r.state='READY';r.current=null;r.active=false;r.window=null;await emit();check((await monitor.innerText()).includes('尚未开始处理商品'),'无当前商品时显示空状态');
 r.state='PAUSED';r.current={key:'new-key',runId:'new-run',destination:'另一测试城市',stage:'attribute-style'};r.window={id:'ui-window',sequence:3,state:'PAUSED',total:100,ended:59,submitted:40,resumedCount:1,counts:{NEW_SUCCESS:40,PREFLIGHT_SKIPPED:19,PENDING:41}};await emit();
 logFail=true;await page.locator('#monitorExecutionDetails>summary').click();await page.getByText('日志读取失败，请重试；不影响已保存的执行记录。').waitFor();
 check(!(await page.locator('#monitorExecutionDetails').innerText()).includes('当前商品日志'),'日志失败不保留另一商品旧日志');
 logFail=false;await page.locator('[data-action=monitor-logs-refresh]').click();await page.locator('#monitorExecutionDetails .log-list').waitFor();
 check(true,'日志读取失败后可重试');
 await page.locator('#monitorExecutionDetails>summary').click();
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px页面无横向溢出');await page.screenshot({path:join(out,'monitor-mobile.png'),fullPage:true});
 // A delayed response for the previous current item must never replace the new item log.
 await page.setViewportSize({width:1440,height:1000});
 let releaseLog;logDelay=new Promise(resolve=>releaseLog=resolve);
 r.current={key:'current-key',runId:'current-run',destination:'等待旧响应的城市',stage:'existing-listing-query'};await emit();
 const pendingLog=page.waitForRequest(req=>req.url().includes('/api/v1/task?id=current-run'));
 await page.locator('#monitorExecutionDetails>summary').click();await pendingLog;
 r.current={key:'new-key-2',runId:'new-run-2',destination:'已切换的新城市',stage:'price'};await emit();
 await page.locator('#monitorExecutionDetails .log-list').waitFor();releaseLog();logDelay=null;await page.waitForTimeout(150);
 check(!(await page.locator('#monitorExecutionDetails').innerText()).includes('当前商品日志')&&(await monitor.innerText()).includes('已切换的新城市'),'旧商品日志迟到时不会覆盖新商品监控');
 fixture.engine.round=null;await emit();await page.locator('.task-inspector h2').waitFor();
 check(await monitor.count()===0&&await page.locator('[data-action=continue]').count()===1,'没有固定轮次时保留原批次操作');
 fixture.engine.round=r;await emit();await monitor.waitFor();
 for(const res of streams)res.write('event: problem\ndata: {}\n\n');await page.locator('.monitor-status.offline').waitFor();
 check(await page.locator('[data-action=round-resume]').isDisabled(),'断线时继续按钮禁用');check((await monitor.innerText()).includes('上次读取的数据'),'断线明确提示旧快照');
 check(errors.length===0,'页面无未捕获脚本错误');
 check(server.address().port!==4318&&writes.every(w=>w.input.id==='ui-round'),'执行请求仅发送到随机端口的隔离服务');
}catch(e){await page.screenshot({path:join(out,'failure.png'),fullPage:true});throw e;}
finally{await writeFile(join(out,'qa.json'),JSON.stringify({at:new Date().toISOString(),checks,writes,errors,productionWrites:0},null,2));for(const res of streams)res.end();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));os.store.db.close();store.close();}
