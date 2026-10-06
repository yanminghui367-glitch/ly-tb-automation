// Isolated end-to-end product QA. Fake executor, temporary SQLite, no seller browser.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.QA_OUTPUT_DIR||resolve(root,'../output/playwright/travel-os-journey-'+Date.now()));await mkdir(out,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'travel-os-ui-')),store=new SourceStore(join(dir,'source.sqlite'));
const shop={id:'qa-shop',name:'隔离 QA 店铺'},shops=[shop];
const task=(city,country,n)=>({shopId:shop.id,priority:n,source:{sheet:'境外城市热度',row:n+1},listing:{type:'city',country,city,title:city+' 隔离测试产品'},business:{price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]});
const tasks=[task('东京','日本',1),task('巴黎','法国',2)];const importId=store.imported({sheet:'境外城市热度',sourceHash:'isolated-qa',tasks});
let outcome='CAPTCHA',fakeLaunches=0,mutationCount=0;
const flow={store,active:null,artifacts:join(dir,'artifacts'),stop:false,
 pause(){this.stop=true;},launch(id){fakeLaunches++;this.active=id;this.pending=Promise.resolve().then(()=>{store.move(id,'RUNNING');store.event(id,'STEP_INTENT',{name:'price'});store.checkpoint(id,{step:'price'});if(outcome==='CAPTCHA')store.move(id,'PAUSED_CAPTCHA','CAPTCHA：隔离验证，请人工处理');else if(outcome==='UNKNOWN'){store.move(id,'SUBMITTING');store.checkpoint(id,{itemId:'QA-ID-ONLY'});store.move(id,'RESULT_UNKNOWN','隔离测试提交结果不明');}else store.move(id,'DRY_RUN_COMPLETE','隔离测试，仅填写');}).finally(()=>this.active=null);},async resume({id}){store.move(id,'QUEUED');this.launch(id);}};
const batch=new BatchWorkflow(flow),owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch,shop,owner,runtime:dir,integrity:async()=>({ok:true,files:10,baseline:'ISOLATED'}),checkFiles:async()=>{},launch:async()=>{throw Error('禁止打开真实店铺');}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>shops,browser:owner,runtime:dir,launch:async()=>{throw Error('禁止打开真实店铺');},addShop:async name=>{const s={id:'qa-added-'+shops.length,name,createdAt:new Date().toISOString()};shops.push(s);return s;}});
const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const body=async req=>{let bytes='';for await(const b of req)bytes+=b;return bytes?JSON.parse(bytes):{};};
const staticHandler=createStaticHandler(root),server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='POST')mutationCount++;if(url.pathname==='/api/os/state')return json(res,200,{...await os.snapshot(),testMode:true});if(url.pathname.startsWith('/api/os/'))return os.handle(req,res,url,{json,body}).catch(e=>json(res,e.statusCode||409,{error:e.message}));if(url.pathname.startsWith('/api/v1/'))return product.handle(req,res,url,{json,body}).catch(e=>json(res,e.statusCode||409,{error:e.message}));if(url.pathname.startsWith('/api/'))throw Error('隔离服务器拒绝未声明的 API');await staticHandler(req,res);}catch(e){json(res,409,{error:e.message});}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1536,height:960},serviceWorkers:'block'}),page=await context.newPage(),checks=[],errors=[];
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());page.setDefaultTimeout(10000);
page.on('pageerror',e=>errors.push(e.message));
const check=(ok,label)=>{assert(ok,label);checks.push(label);};
const nav=async name=>{const toggle=page.locator('#sidebarToggle');if(await toggle.count()&&page.viewportSize().width<=850&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();await page.locator('#navigation').getByRole('link',{name,exact:true}).click();};
try{
 // The overview now reveals its selected-destination section only after an explicit selection.
 await page.goto(base+'/travel-os.html#overview');await page.locator('#destinationPanel h2').waitFor({state:'attached'});await page.locator('#testBanner:visible').waitFor();
 check((await page.locator('#testBanner').innerText()).includes('隔离测试'),'隔离模式明显标识');
 check((await page.locator('#overviewMetrics').innerText()).includes('产品总数'),'总览读取真实产品统计');
 await page.locator('#citySearch').fill('巴黎');await page.locator('#citySearch').press('Enter');await page.waitForFunction(()=>document.querySelector('#destinationPanel h2').textContent==='巴黎');
 check(await page.locator('#overviewSelection').isVisible(),'搜索城市展开当前目的地资料；地球留在独立首页');
 await nav('报价库');
 for(const [kind,amount] of [['COST','100'],['SALE','150']]){
  await page.getByRole('button',{name:'录入报价',exact:true}).click();const f=page.locator('#quoteForm');await f.locator('[name=kind]').selectOption(kind);await f.locator('[name=service]').fill('隔离测试服务');await f.locator('[name=amount]').fill(amount);await f.locator('[name=unit]').fill('人');await f.locator('[name=supplier]').fill('QA 供应商');await f.getByRole('button',{name:'保存报价',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
 }
 check(os.store.quotes().length===2,'成本和销售报价独立保存');await page.reload();await page.locator('#page-quotes tbody tr').nth(1).waitFor();check(await page.locator('#page-quotes tbody tr').count()===2,'刷新保留报价历史');
 await nav('总览');await page.locator('#citySearch').fill('巴黎');await page.locator('#citySearch').press('Enter');check((await page.locator('#destinationPanel').innerText()).includes('150.00'),'目的地面板关联最新报价');
 await nav('店铺管理');await page.getByRole('button',{name:'新增店铺',exact:true}).click();await page.locator('#shopForm [name=name]').fill('新增 QA 店铺');await page.locator('#shopForm').getByRole('button',{name:'添加店铺'}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('.shops-table tbody tr').nth(1).waitFor();check(await page.locator('.shops-table tbody tr').count()===2,'店铺动态新增');const card=page.locator('.shops-table tbody tr').filter({hasText:'新增 QA 店铺'});check((await card.innerText()).includes('待完成店铺适配'),'新店铺不伪装可执行');await card.locator('summary').click();await card.getByRole('button',{name:'移除',exact:true}).click();await page.locator('#removeShopForm [name=confirmName]').fill('新增 QA 店铺');await page.locator('#removeShopForm').getByRole('button',{name:'确认移除'}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelectorAll('.shops-table tbody tr').length===1);check(await page.locator('.shops-table tbody tr').count()===1,'店铺移除保留历史');
 await nav('总览');await page.locator('#citySearch').fill('东京');await page.locator('#citySearch').press('Enter');await page.locator('#destinationPanel').getByRole('button',{name:'创建任务',exact:true}).click();await page.locator('#preparationForm').getByRole('button',{name:'保存准备单'}).click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('[data-action=review-selected]').waitFor();check(os.store.preparations().length===1&&fakeLaunches===0,'创建准备单不执行');
 await page.locator('[data-action=review-selected]').click();await page.locator('#selectedForm input[type=checkbox]').check();await page.locator('#selectedForm button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('[data-action=start]').waitFor();check(batch.store.view().counts.PENDING===1&&fakeLaunches===0,'核对后单商品任务入队仍不执行');
 const countBeforeReload=mutationCount;await page.reload();await page.locator('[data-action=start]').waitFor();check(mutationCount===countBeforeReload,'刷新工作台没有重复创建或启动请求');
 await nav('资料设置');await page.locator('[data-setup=step][data-step="4"]').click();await page.locator('.setup-more summary').click();await page.locator('[data-setup=permission]').click();await page.locator('#permitForm [name=confirmShop]').fill(shop.name);await page.locator('#permitForm button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});await nav('自动化任务');await page.locator('[data-action=start]').click();await page.locator('#executeForm input[type=checkbox]').check();await page.locator('#executeForm button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('[data-action=continue]').waitFor();check(batch.store.view().counts.WAITING_HUMAN===1&&fakeLaunches===1,'模拟验证码自动暂停并保留原任务');await page.getByText('查看执行详情',{exact:true}).click();await page.locator('.log-list li').first().waitFor();
 await page.screenshot({path:join(out,'captcha-paused.png'),fullPage:true});
 const runId=batch.store.view().items[0].runId;outcome='FILLED';await page.locator('[data-action=continue]').click();await page.locator('#executeForm [name=humanVerified]').check();await page.locator('#executeForm button[type=submit]').click();await page.locator('#editor').waitFor({state:'hidden'});check(batch.store.view().items[0].runId===runId&&fakeLaunches===2,'人工确认和恢复检查后继续原任务');check(store.run(runId).state==='DRY_RUN_COMPLETE','仅填写任务不会提交商品');check(store.db.prepare('SELECT COUNT(*) AS n FROM history').get().n===0,'模拟流程未写入成功记录');
 await nav('总览');store.move(runId,'QUEUED');store.move(runId,'RUNNING');store.move(runId,'PAUSED_CAPTCHA','CAPTCHA：隔离外部状态变化');await page.waitForFunction(()=>document.querySelector('#destinationPanel').textContent.includes('等待人工验证'),{},{timeout:10000});checks.push('SSE 后台变化同步目的地关系，无需刷新');
 await page.locator('#citySearch').fill('东京');await page.locator('#citySearch').press('Enter');await page.getByRole('button',{name:'查看东京的产品',exact:true}).click();await page.locator('#page-products h1').waitFor();check((await page.locator('#page-products').innerText()).includes('东京')&&await page.locator('[data-action=clear-product-destination]').count()===1,'目的地直达产品筛选');await nav('总览');await page.getByRole('button',{name:'查看东京执行记录',exact:true}).click();await page.locator('#page-records h1').waitFor();check((await page.locator('#page-records h1').innerText()).includes('东京'),'目的地直达执行记录筛选');
 await page.setViewportSize({width:390,height:844});for(const name of ['自动化任务','店铺管理','产品库','目的地中心','报价库','上架记录','资料设置']){await nav(name);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px '+name+'无文档横向溢出');}
 await page.screenshot({path:join(out,'settings-mobile.png'),fullPage:true});
 await page.context().setOffline(true);await page.locator('#connectionNotice:visible').waitFor({timeout:20000});check(await page.locator('[data-write]:enabled').count()===0,'连接中断时写操作禁用');await page.context().setOffline(false);await page.locator('#connectionNotice').waitFor({state:'hidden'});checks.push('重连恢复后端真实状态');
 check(errors.length===0,'无浏览器未捕获错误');
}finally{await writeFile(join(out,'qa.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,fakeLaunches,mutationsToIsolatedServer:mutationCount,productionRequests:0,productionSuccessWrites:0},null,2));console.log(JSON.stringify({checks,errors,fakeLaunches}));await browser.close();product.closeStreams();await new Promise(r=>server.close(r));os.store.close();store.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
