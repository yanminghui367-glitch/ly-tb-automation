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
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/playwright/task-batch-list-20261014'));
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
let failWindow=false,delayWindow=false;
const serve=createStaticHandler(join(root,'workbench'));
const json=(res,x,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(x));};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){writes.push(url.pathname);return json(res,{error:'Writes forbidden'},405);}
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
 check(await rows.count()===20,'默认当前批次，每页20条');
 check((await page.locator('.queue-panel h2').innerText())==='正在进行的一批任务列表','当前列表标题');
 check((await selector.innerText()).includes('第一批 · 10月2日'),'日期使用上海时区，跨UTC日期正确');
 check((await page.locator('.queue-panel .pagination').innerText()).includes('45 条 · 每页 20 条 · 第 1 / 3 页'),'总数与页数正确');
 await page.locator('[data-action=task-next]').click();await waitText('批次3城市21');check(await rows.first().locator('td').first().innerText()==='21','第二页序号21起');
 await page.locator('[data-action=task-next]').click();check(await rows.count()===5,'最后一页剩余5条');check(await page.locator('[data-action=task-next]').isDisabled(),'末页下一页禁用');
 await selector.selectOption('window-1');await waitText('批次1城市1');check(await rows.count()===20,'历史批次显示对应20条，重置页码');
 check((await page.locator('.queue-panel h2').innerText())==='历史批次任务列表','历史状态清晰');
 check((await page.locator('.execution-monitor').innerText()).includes('当前监控商品'),'切历史不改变实时监控');
 await selector.selectOption('');await waitText('批次3城市1');
 await page.locator('#taskSearch').fill('商品45');await waitText('批次3城市45');check(await rows.count()===1,'搜索覆盖所有页');
 await page.locator('#taskSearch').fill('不存在');check((await rows.innerText()).includes('没有匹配任务'),'搜索空状态');
 await selector.selectOption('window-2');await waitText('批次2城市1');check(await page.locator('#taskSearch').inputValue()==='','切批次重置搜索');
 await page.locator('[data-action=queue-filter][data-filter=running]').click();check((await rows.innerText()).includes('没有匹配任务'),'分类仅筛选当前所选批次');
 await selector.selectOption('');await waitText('批次3城市1');check(await rows.count()===20,'切批次重置分类');
 const detail=rows.first().locator('[data-action=round-item-detail]');check(await detail.getAttribute('data-window')==='window-3'&&await detail.getAttribute('data-key')==='w3-item-1','详情绑定正确窗口和商品');
 await rows.first().locator('[data-action=queue-run-logs]').click();await page.locator('#editor[open]').waitFor();check((await page.locator('#editorBody').innerText()).includes('批次3商品1'),'日志读取对应run');await page.locator('#closeEditor').click();
 check(await rows.nth(1).locator('[data-action=queue-run-logs]').isDisabled(),'未执行商品明确禁用日志');
 delayWindow=true;await selector.selectOption('window-1');await selector.selectOption('window-2');await waitText('批次2城市1');await page.waitForTimeout(800);check((await rows.first().innerText()).includes('批次2城市1'),'迟到历史响应不能覆盖新选择');delayWindow=false;
 failWindow=true;await selector.selectOption('window-1');await page.locator('.queue-panel [role=alert]').waitFor();check(!(await page.locator('.queue-panel tbody').innerText()).includes('批次2城市'),'读取失败不残留另一批数据');
 failWindow=false;await page.locator('[data-action=queue-reload]').click();await waitText('批次1城市1');check(true,'失败后可重新读取');
 await page.locator('#taskShopSelector').selectOption('empty-shop');check(await selector.isDisabled()&&(await rows.innerText()).includes('此店铺暂无批次任务'),'切店铺不串数据');
 await page.locator('#taskShopSelector').selectOption(shop.id);await waitText('批次3城市1');check(true,'回到原店铺自动跟随当前批次');
 windows[2].items[0].state='NEW_SUCCESS';fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');await rows.first().getByText('新增上架已核验',{exact:true}).waitFor();check(true,'状态推送后当前列表更新');
 await page.locator('.queue-panel').screenshot({path:join(out,'isolated-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('.queue-panel').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:join(out,'isolated-mobile.png')});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px无整页横向溢出');
 const fourth={...windows[2],id:'window-4',sequence:4,items:[{...windows[2].items[0],key:'w4-item-1',destination:'批次4城市1'}]};windows.push(fourth);
 const emit=()=>{fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');};
 fixture.engine.round.window=fourth;fixture.engine.round.windowHistory=windows.map(({items,...w})=>w);emit();await waitText('批次4城市1');check(true,'默认模式自动跟随下一批次');
 await selector.selectOption('window-1');await waitText('批次1城市1');emit();await page.waitForTimeout(150);check((await rows.first().innerText()).includes('批次1城市1'),'实时更新保留人工选择的历史批次');
 fixture.engine.round=null;fixture.engine.batch={id:'legacy-batch',state:'RUNNING',counts:{},elapsedMs:1000,items:Array.from({length:25},(_,i)=>({id:'legacy-'+i,destination:'旧队列城市'+i,state:'PENDING'}))};fixture.engine.batches=[{id:'legacy-batch',at:'2026-10-01T00:00:00Z',state:'RUNNING'}];emit();await waitText('旧队列城市0');check(await rows.count()===20,'没有固定轮次时兼容原批次分页');
 check(writes.length===0,'浏览历史分页搜索与日志均无写请求');check(errors.length===0,'无浏览器脚本错误');
}finally{
 await writeFile(join(out,'qa.json'),JSON.stringify({checks,errors,writes},null,2));await browser.close();for(const res of streams)res.end();await new Promise(r=>server.close(r));store.close?.();
}
