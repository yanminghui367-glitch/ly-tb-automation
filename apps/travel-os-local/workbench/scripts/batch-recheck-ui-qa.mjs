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
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/playwright/batch-recheck-20261014'));
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
const fixture=structuredClone(snapshot),checks=[],errors=[],writes=[],streams=new Set();
fixture.shops.push({id:'empty-shop',name:'无批次测试店',browser:{label:'未连接'}});
const windows=[1,2,3].map(n=>({id:'window-'+n,roundId:fixture.engine.round.id,shop:shop.id,sequence:n,at:`2026-10-0${n}T20:00:00Z`,started:`2026-10-0${n}T20:01:00Z`,finished:n<3?`2026-10-0${n}T21:00:00Z`:null,state:n<3?'COMPLETED':'RUNNING',total:n===3?45:23,ended:n<3?23:0,counts:{},items:Array.from({length:n===3?45:23},(_,i)=>({key:`w${n}-item-${i+1}`,position:i+1,destination:`批次${n}城市${i+1}`,title:`批次${n}商品${i+1}`,state:n<3?'NEW_SUCCESS':'PENDING',runId:i===0?'fixture-run':null}))}));
Object.assign(fixture.engine.round,{window:windows[2],windowHistory:windows.map(({items,...w})=>w),current:{key:'w3-item-1',destination:'当前监控商品',stage:'title'},state:'RUNNING',active:true});
const check=(ok,label)=>{checks.push({ok:!!ok,label});assert.ok(ok,label);console.log('PASS '+label);};
let failWindow=false,delayWindow=false,previewBlocked=false,capabilityEnabled=true,loseCreateReply=false,loseStartReply=false,loseBudgetReply=false,createCount=0,budgetGrantCount=0;
const savedCreates=new Map();
const savedBudgetGrants=new Map();
fixture.engine.round.state='SYSTEM_BLOCKED';fixture.engine.round.active=false;
windows[2].state='SYSTEM_BLOCKED';
windows[2].items.forEach((x,i)=>{x.state=i<26?'MANUAL_SKIPPED':i===26?'FAILED':i===27?'NEW_SUCCESS':i===28?'WAITING_HUMAN':i===29?'RESULT_UNKNOWN':'PENDING';x.reason=i<26?'人工跳过':'';});
const serve=createStaticHandler(join(root,'workbench'));
const json=(res,x,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(x));};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){
   let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);writes.push({path:url.pathname,input});
   if(url.pathname.endsWith('/selection-budget')){let result=savedBudgetGrants.get(input.requestId);if(!result){budgetGrantCount++;result={accepted:true,replayed:false,granted:input.keys.map(key=>({key,attempts:3,maxAttempts:4,addAttempts:1}))};savedBudgetGrants.set(input.requestId,result);}if(loseBudgetReply){loseBudgetReply=false;return json(res,{error:'模拟额度回执丢失',retainRequest:true},500);}return json(res,result);}
   if(url.pathname.endsWith('/selection-preview')){const all=windows[2].items.filter(x=>input.keys.includes(x.key)),failed=all.find(x=>x.state==='FAILED'),eligible=budgetGrantCount?[...all.filter(x=>x.state==='MANUAL_SKIPPED').slice(0,1),failed].filter(Boolean):all.filter(x=>x.state==='MANUAL_SKIPPED').slice(0,1),excluded=all.filter(x=>!eligible.includes(x)).map(x=>x===failed&&!budgetGrantCount?{...x,code:'SELECTION_BUDGET_EXHAUSTED',attempts:3,maxAttempts:3,manualBudgetGrantAvailable:true,reason:'已达原恢复次数上限'}:{...x,reason:'需先处理原任务'});return json(res,{roundId:input.id,windowId:input.windowId,shop:shop.id,mode:'recheck',count:eligible.length,eligible,excluded,blockers:previewBlocked?[{reason:'原商品提交结果待核验'}]:[],canCreate:!previewBlocked&&eligible.length>0,expectedRevision:budgetGrantCount?'fixture-revision-after-budget':'fixture-revision',selectionHash:budgetGrantCount?'fixture-selection-after-budget':'fixture-selection'});}
   if(url.pathname.endsWith('/selection-create')){
    let receipt=savedCreates.get(input.requestId);if(!receipt){createCount++;receipt={accepted:true,roundId:input.id,windowId:'new-recheck-window',selection:{mode:'recheck',requestedKeys:input.keys}};savedCreates.set(input.requestId,receipt);}
    if(loseCreateReply){loseCreateReply=false;return json(res,{error:'模拟回执丢失',retainRequest:true},500);}return json(res,receipt);
   }
   if(url.pathname.endsWith('/rounds/start')){if(loseStartReply){loseStartReply=false;return json(res,{error:'模拟开始回执丢失',retainRequest:true},500);}return json(res,{accepted:true});}
   return json(res,{error:'Unexpected write'},405);
  }
  if(url.pathname==='/api/v1/rounds/selection-capabilities')return json(res,{batchRecheck:capabilityEnabled,manualRetryBudget:capabilityEnabled});
  if(url.pathname==='/api/os/state')return json(res,fixture);
  if(url.pathname==='/api/v1/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
  if(url.pathname==='/api/v1/state')return json(res,fixture.engine);
  if(url.pathname==='/api/v1/rounds/window'){
   const id=url.searchParams.get('id');
   if(delayWindow&&id==='window-1')await new Promise(r=>setTimeout(r,650));
   return failWindow?json(res,{error:'测试读取失败'},500):json(res,windows.find(w=>w.id===id));
  }
  if(url.pathname==='/api/v1/task')return json(res,{id:'fixture-run',task:{listing:{title:'批次3商品1',city:'批次3城市1'}},checkpoint:{},events:[],state:'PENDING'});
  if(url.pathname.startsWith('/api/'))return json(res,{});
  await serve(req,res);
 }catch(error){json(res,{error:error.message},500);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const rows=page.locator('.queue-panel tbody tr'),selector=page.locator('#taskHistoryBatchSelector');
const waitText=text=>page.locator('.queue-panel tbody').getByText(text,{exact:true}).waitFor();
try{
 await page.goto(base+'/travel-os.html#tasks');await waitText('批次3城市1');
 const skip=page.locator('[data-action=queue-filter][data-filter=skipped]'),recheck=page.locator('[data-action=queue-recheck]');
 check((await skip.innerText()).includes('26'),'跳过分类显示真实数量');
 await skip.click();check(await rows.count()===20,'跳过列表仍每页20条');
 await page.locator('[data-action=task-next]').click();check(await rows.count()===6,'跳过列表末页6条');
 await page.locator('#taskSearch').fill('城市26');check(await rows.count()===1,'跳过筛选与搜索组合');
 check(await recheck.isEnabled(),'当前暂停批次提供重新检索入口');
 previewBlocked=true;await recheck.click();await page.getByText('重新检索结果',{exact:true}).waitFor();
 check(await page.locator('[data-action=queue-recheck-confirm]').isDisabled(),'存在结果不明阻塞时禁止执行');
 check(writes.at(-1).input.keys.length===29&&!writes.at(-1).input.keys.includes('w3-item-28'),'范围取全批异常和跳过项，排除成功与普通等待项，不受分页搜索缩小');
 check(writes.every(x=>x.path.endsWith('selection-preview')),'打开检查不会执行上架');
 await page.locator('#closeEditor').click();previewBlocked=false;await recheck.click();await page.getByText('重新检索结果',{exact:true}).waitFor();
 check((await page.locator('#editorBody').innerText()).includes('原批次尚未结束'),'确认前说明封存原批次、保留其余任务');
 await page.locator('#editorBody input[name=keys]').check();await page.locator('#editorBody textarea[name=reason]').fill('已核对为提交前页面控件问题');await page.locator('#editorBody input[name=confirmed]').check();
 loseBudgetReply=true;await page.locator('#manualRetryBudgetForm button[type=submit]').click();await page.getByText('额度调整结果待核对',{exact:true}).waitFor();
 const budgetRequest=writes.filter(x=>x.path.endsWith('/selection-budget')).at(-1).input.requestId;await page.locator('[data-action=queue-budget-resume]').click();await page.getByText('重新检索结果',{exact:true}).waitFor();
 const budgetWrites=writes.filter(x=>x.path.endsWith('/selection-budget'));
 check(budgetGrantCount===1&&budgetWrites.length===2&&budgetWrites.every(x=>x.input.requestId===budgetRequest),'额度回执丢失后核对原请求，不会重复增加次数');
 check(budgetWrites[0].input.addAttempts===1&&budgetWrites[0].input.keys.length===1&&!writes.some(x=>x.path.endsWith('/selection-create')),'只为人工勾选商品增加一次额度，保存时没有创建或启动执行');
 check((await page.locator('#editorBody').innerText()).includes('可重新上架 2 条'),'重新预检立即联动显示新额度下可继续处理的商品');
 await page.screenshot({path:join(out,'manual-budget-desktop.png')});
 await page.screenshot({path:join(out,'preview-desktop.png')});
 loseCreateReply=true;await page.locator('[data-action=queue-recheck-confirm]').click();await page.getByText('原请求待核对',{exact:true}).waitFor();
 check(createCount===1&&writes.filter(x=>x.path.endsWith('/rounds/start')).length===0,'创建回执丢失时不盲目开始');
 const requestId=writes.find(x=>x.path.endsWith('selection-create')).input.requestId;
 await page.reload();await waitText('批次3城市1');await recheck.click();await page.getByText('核对原重新上架请求',{exact:true}).waitFor();
 check(true,'刷新后保留原请求并提示核对');
 await page.locator('[data-action=queue-recheck-confirm]').click();await page.waitForFunction(()=>!document.getElementById('editor').open);
 const creates=writes.filter(x=>x.path.endsWith('selection-create')),starts=writes.filter(x=>x.path.endsWith('/rounds/start'));
 check(createCount===1&&creates.length===2&&creates.every(x=>x.input.requestId===requestId),'重试复用同一创建请求，不产生第二批');
 check(starts.length===1&&starts[0].input.windowId==='new-recheck-window','仅开始服务返回的确定批次');
 check(await page.evaluate(()=>sessionStorage.getItem('travel-os.batch-recheck.v1'))===null,'接收执行回执后清除待核对请求');
 await recheck.click();await page.getByText('重新检索结果',{exact:true}).waitFor();loseStartReply=true;await page.locator('[data-action=queue-recheck-confirm]').click();await page.getByText('原请求待核对',{exact:true}).waitFor();
 const firstStart=writes.filter(x=>x.path.endsWith('/rounds/start')).at(-1).input;
 await page.locator('[data-action=queue-recheck-confirm]').click();await page.waitForFunction(()=>!document.getElementById('editor').open);
 const lastStart=writes.filter(x=>x.path.endsWith('/rounds/start')).at(-1).input;
 check(firstStart.requestId===lastStart.requestId&&firstStart.windowId===lastStart.windowId,'开始回执丢失仍沿用同一开始请求与窗口');

 await skip.click();await page.locator('.queue-panel').screenshot({path:join(out,'skipped-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('.queue-panel').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:join(out,'skipped-mobile.png')});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px筛选与按钮无整页横向溢出');
 fixture.engine.round.active=true;fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');await page.waitForTimeout(100);check(await recheck.isDisabled(),'正在执行时禁止并行重试');
 fixture.engine.round.active=false;fixture.engine.kernel={ok:false};fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');await page.waitForTimeout(100);check(await recheck.isDisabled(),'服务版本校验失败时禁用重新上架');
 fixture.engine.kernel={ok:true};capabilityEnabled=false;await page.reload();await waitText('批次3城市1');check(await recheck.isDisabled(),'旧服务未加载能力时禁用按钮并保留筛选');
 check(errors.length===0,'无页面脚本错误');
}finally{
 await writeFile(join(out,'ui-qa.json'),JSON.stringify({checks,errors,writes,createCount},null,2));await browser.close();for(const res of streams)res.end();await new Promise(r=>server.close(r));store.close?.();
}
