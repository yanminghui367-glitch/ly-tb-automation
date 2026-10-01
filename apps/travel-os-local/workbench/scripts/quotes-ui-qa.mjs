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
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/playwright/quotes-20260925/isolated');await mkdir(out,{recursive:true});
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
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1672,height:941}}),checks=[],errors=[];
page.setDefaultTimeout(10000);
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
const check=(ok,label)=>{assert(ok,label);checks.push(label);};
const rootPage=page.locator('#page-quotes'),rows=rootPage.locator('tbody tr');
const capture=async name=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(out,name+'.png'),fullPage:!name.startsWith('mobile')});};
try{
 await page.goto(base+'/travel-os.html#quotes');await page.locator('.quotes-stats').waitFor();
 check((await page.locator('.quotes-stat strong').allTextContents()).join(',')==='0,0,0,0','空库四项统计为零');
 check(await page.getByRole('button',{name:'录入第一条报价',exact:true}).isVisible(),'空库保留首次录入入口');
 await page.getByRole('button',{name:'录入第一条报价',exact:true}).click();await page.keyboard.press('Escape');
 check(!await page.locator('#editor').isVisible(),'抽屉支持 Escape 关闭');
 const add=async(kind,service,amount,currency='CNY',destination='东京')=>{
  await page.getByRole('button',{name:'录入报价',exact:true}).click();
  const f=page.locator('#quoteForm');
  const value=await f.locator('option').evaluateAll((opts,name)=>opts.find(o=>o.textContent.includes(name))?.value,destination);
  await f.locator('[name=productKey]').selectOption(value);
  await f.locator('[name=kind]').selectOption(kind);await f.locator('[name=service]').fill(service);await f.locator('[name=amount]').fill(amount);await f.locator('[name=currency]').selectOption(currency);await f.locator('[name=unit]').fill('人');
  if(kind==='COST'){
   await f.getByRole('button',{name:'保存报价',exact:true}).click();await page.locator('#editorError').filter({hasText:'供应商'}).waitFor();
   check(os.store.quotes().length===0,'缺少供应商被原接口拦截，表单保留');
   await f.locator('[name=supplier]').fill('隔离 QA 供应商');
  }
  await f.getByRole('button',{name:'保存报价',exact:true}).click();await page.locator('#editor').waitFor({state:'hidden'});
 };
 await add('COST','隔离成本服务','100');await add('SALE','隔离销售服务','150','USD','巴黎');
 check((await page.locator('.quotes-stat strong').allTextContents()).join(',')==='2,1,1,2','成本和销售条数、目的地去重正确，不混加币种');
 check((await rows.first().innerText()).includes('隔离销售服务'),'默认按最新创建排序');
 await page.locator('#quoteSort').selectOption('oldest');check((await rows.first().innerText()).includes('隔离成本服务'),'最早创建排序生效');
 await page.locator('#quoteFilter').fill('巴黎');check(await rows.count()===1,'目的地搜索生效');
 check(await page.locator('#quoteFilter').evaluate(el=>document.activeElement===el),'输入搜索后保留焦点');
 await page.locator('#quoteFilter').fill('没有这个目的地');check(await page.getByText('没有匹配的报价',{exact:true}).isVisible(),'无搜索结果独立空状态');
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();check(await rows.count()===2,'清除筛选恢复报价');
 await page.locator('[data-action=quote-kind][data-kind=COST]').click();check(await rows.count()===1&&(await rows.innerText()).includes('成本服务'),'成本类型筛选');
 await page.locator('[data-action=quote-show-all]').click();check(await rows.count()===2,'查看更多清除范围并显示全部报价');
 await page.locator('.quotes-recent-list button').first().click();check((await page.locator('#editorBody').innerText()).includes('150.00'),'最近记录打开对应详情');
 await page.locator('[data-action=archive-quote]').click();await page.locator('#editor').waitFor({state:'hidden'});
 check(os.store.quotes().length===2&&os.store.quotes()[0].archived,'归档保留历史，不删除记录');
 await page.reload();await rows.nth(1).waitFor();check(await rows.count()===2,'刷新后历史持久化');
 await capture('populated');
 const snapshot=await os.snapshot(),destination=snapshot.products[0];
 for(let i=0;i<21;i++)os.store.addQuote({requestId:crypto.randomUUID(),kind:'SALE',amount:20+i,currency:'CNY',service:i===0?'隔离长文本'.repeat(35):'隔离分页报价 '+i,unit:'人',supplier:'隔离来源'.repeat(30)},destination);
 await page.reload();await rows.nth(19).waitFor();check(await rows.count()===20,'每页最多20条');
 await page.locator('#page-quotes [data-action=next-page]').click();check(await rows.count()===3,'翻页展示剩余报价');
 check(await page.locator('.quotes-recent-list button').count()===5,'最近报价限制为5条');
 await page.locator('#page-quotes [data-action=previous-page]').click();check(await rows.first().evaluate(el=>el.getBoundingClientRect().height)<160,'超长供应商与服务名不会撑高列表行');await capture('long-text-pagination');
 for(const width of [1280,1024,768,390]){
  await page.setViewportSize({width,height:844});
  if(width<=850&&await page.locator('#sidebarToggle').getAttribute('aria-expanded')==='true')await page.locator('#sidebarToggle').click();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'宽度 '+width+' 无页面横向溢出');
  if(width===390){await capture('mobile-populated');await page.getByRole('button',{name:'录入报价',exact:true}).click();await capture('mobile-form');check(await page.locator('#quoteForm button[type=submit]').isEnabled(),'窄屏录入可操作');await page.keyboard.press('Escape');}
 }
 await page.context().setOffline(true);await page.locator('#connectionNotice:visible').waitFor();
 check(await rootPage.locator('[data-write]:enabled').count()===0,'断线禁用报价录入');
 await page.context().setOffline(false);await page.locator('#connectionNotice').waitFor({state:'hidden'});
 checks.push('恢复连接后重新读取状态');
 const failure=await browser.newPage();
 await failure.route('**/api/os/state',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"隔离连接故障"}'}));
 await failure.goto(base+'/travel-os.html#quotes');await failure.getByText('报价暂时无法加载',{exact:true}).waitFor();
 check(await failure.locator('.quotes-stat').count()===0,'首次加载失败不伪装成零报价');
 await failure.unroute('**/api/os/state');await failure.getByRole('button',{name:'重新加载',exact:true}).click();await failure.locator('.quotes-stats').waitFor();checks.push('首次加载失败可重试恢复');await failure.close();
 check(errors.length===0,'无浏览器未捕获错误');check(fakeLaunches===0,'没有启动任何模拟或真实执行任务');
}finally{
 await writeFile(join(out,'qa.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,fakeLaunches,isolatedQuotes:os.store.quotes().length,productionRequests:0},null,2));
 console.log(JSON.stringify({checks,errors},null,2));await browser.close();product.closeStreams();await new Promise(r=>server.close(r));os.store.close();store.close();
 assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});
}

