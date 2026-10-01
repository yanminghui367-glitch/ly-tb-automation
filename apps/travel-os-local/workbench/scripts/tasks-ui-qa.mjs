// Read-only production inspection + browser-intercepted state fixtures. No seller actions.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyKernel} from '../kernel-integrity.mjs';
const base=process.env.TASKS_QA_URL||'http://127.0.0.1:4318';
const out=resolve(import.meta.dirname,'../../output/tasks-template-20260925');
await mkdir(out,{recursive:true});
const seed=await fetch(base+'/api/os/state').then(r=>r.json());
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],writes=[];
const check=(ok,label)=>{assert(ok,label);checks.push(label);};
async function open(fixture){
 const context=await browser.newContext({viewport:{width:1672,height:941},reducedMotion:'reduce'});
 await context.addInitScript(()=>{if(localStorage.getItem('travel-os:sidebar-expanded')===null)localStorage.setItem('travel-os:sidebar-expanded','true');});
 if(fixture)await context.addInitScript(engine=>{
  window.EventSource=class extends EventTarget{
   constructor(){super();this.timer=setInterval(()=>this.dispatchEvent(new MessageEvent('state',{data:JSON.stringify(engine)})),2000);}
   close(){clearInterval(this.timer);}
  };
 },fixture.engine);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()!=='GET'){writes.push(url.pathname);return route.abort();}
  if(fixture){
   if(url.pathname==='/api/os/state')return route.fulfill({json:fixture});
   if(url.pathname==='/api/v1/state')return route.fulfill({json:fixture.engine});
   if(url.pathname==='/api/v1/events')return route.fulfill({contentType:'text/event-stream',body:`event: state\ndata: ${JSON.stringify(fixture.engine)}\n\n`});
   if(url.pathname==='/api/v1/task')return route.fulfill({json:{id:url.searchParams.get('id'),events:[{at:new Date().toISOString(),kind:'STEP_INTENT',label:'隔离 UI 测试事件',technical:{step:'title'}}]}});
  }
  return route.continue();
 });
 await page.goto(base+'/travel-os.html#tasks');await page.locator('.current-listing').waitFor();await page.evaluate(()=>document.fonts.ready);
 return {page,context};
}
function fixture(state){
 const f=structuredClone(seed);f.testMode=true;f.preparations=[];
 const item={id:'fixture-task',destination:'隔离测试城市',title:'隔离 UI 测试商品',state,displayState:state,runState:state,runId:'fixture-run',started:null,finished:null,result:{},reason:''};
 f.engine.batch={...f.engine.batch,current:item.id,state:'READY',items:[item],total:1,counts:{PENDING:1,FAILED:0},elapsedMs:0};
 f.engine.active=null;f.engine.execution={state:'IDLE',label:'空闲',detail:'隔离 UI 测试，没有实际执行。'};
 f.engine.browser={...f.engine.browser,loggedIn:true,label:'隔离测试已连接'};
 f.shops[0].browser=f.engine.browser;
 return f;
}
try{
 const {page,context}=await open();
 await page.screenshot({path:resolve(out,'desktop.png')});
 check((await page.locator('.task-outcomes>div').first().innerText()).includes(String(seed.engine.batch.items.filter(x=>['SUCCEEDED','VERIFIED'].includes(x.displayState)).length)),'核验上架数量来自当前批次');
 await page.locator('#taskSearch').fill('东京');check(await page.locator('.task-table tbody tr').count()===1,'任务搜索匹配目的地');
 check(await page.locator('#taskSearch').evaluate(e=>document.activeElement===e),'输入后保留搜索焦点');
 await page.locator('[data-action=queue-filter][data-filter=attention]').click();check(await page.locator('.task-table-empty').isVisible(),'分类与搜索交集为空时显示空状态');
 await page.locator('[data-action=queue-filter][data-filter=all]').click();await page.locator('#taskSearch').fill('');
 await page.locator('[data-action=task-next]').click();check((await page.locator('.task-table tbody tr').first().locator('td').first().innerText())==='11','下一页从第 11 项开始');
 await page.locator('[data-action=task-prev]').click();await page.locator('[data-action=task-logs]').first().click();
 await page.waitForFunction(()=>document.querySelector('#taskExecutionDetails')?.open);check(true,'日志入口展开执行详情');
 await page.locator('#taskExecutionDetails>summary').click();await page.evaluate(()=>scrollTo(0,0));
 await page.locator('#sidebarToggle').click();await page.reload();await page.locator('.current-listing').waitFor();check(await page.locator('#sidebarToggle').getAttribute('aria-expanded')==='false','侧栏折叠刷新后保持');
 await page.locator('#sidebarToggle').click();
 for(const width of [1672,1440,1024,768,390]){
  await page.setViewportSize({width,height:width===390?844:941});await page.waitForTimeout(150);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px 无页面横向溢出`);
  if(width===1672)await page.screenshot({path:resolve(out,'desktop.png')});
  if(width===390){check(await page.locator('.task-table').evaluate(e=>e.scrollWidth>e.clientWidth),'手机任务表内部横向滚动');check(await page.locator('.task-inspector').evaluate(e=>e.getBoundingClientRect().top<document.querySelector('.current-listing').getBoundingClientRect().top),'手机状态卡置于批次卡之前');await page.screenshot({path:resolve(out,'mobile.png'),fullPage:true});}
 }
 await page.evaluate(()=>dispatchEvent(new Event('offline')));
 check(await page.locator('#page-tasks [data-write]:enabled').count()===0,'断线后禁用写操作');
 check((await page.locator('.task-state-hero').innerText()).includes('连接中断'),'断线后状态卡不继续显示空闲');
 await context.close();
 for(const state of ['PENDING','RUNNING','PAUSED_CAPTCHA','RESULT_UNKNOWN','DRY_RUN_COMPLETE','PREPARING','EMPTY','FAILED']){
  const f=fixture(state),b=f.engine.batch,item=b.items[0];
  if(state==='RUNNING'){b.state='RUNNING';b.counts={RUNNING:1};f.engine.active=item.id;f.engine.execution={state:'RUNNING',label:'执行中',detail:'隔离 UI 测试'};}
  if(['PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(state)){b.state='WAITING_HUMAN';b.counts={WAITING_HUMAN:1,FAILED:1};item.state='WAITING_HUMAN';item.reason=state==='PAUSED_CAPTCHA'?'隔离测试：需人工验证':'隔离测试：提交结果不明';item.issue={category:state==='PAUSED_CAPTCHA'?'验证码':'结果待核验',condition:'人工检查原执行页面'};f.engine.execution={state:'WAITING_HUMAN',label:'等待人工',detail:item.reason};}
  if(state==='DRY_RUN_COMPLETE'){b.state='COMPLETED';b.counts={SUCCEEDED:1};item.state='SUCCEEDED';}
  if(state==='FAILED'){b.state='PAUSED';b.counts={FAILED:1};}
  if(state==='PREPARING'){b.items=[];b.counts={};f.preparations=[{id:'fixture-prep',shopId:f.engine.shop.id,productKey:f.products[0].key,destination:'隔离准备单',state:'PREPARING'}];}
  if(state==='EMPTY'){f.engine.batch=null;f.products=[];}
  const {page:p,context:c}=await open(f);
  if(state==='PENDING'){await p.locator('[data-action=start]').click();await p.locator('#executeForm').waitFor();check(await p.locator('#executeForm input[type=checkbox]').getAttribute('required')!==null,'开始批次仍需核对确认');await p.locator('#closeEditor').click();}
  if(state==='RUNNING')check(await p.locator('[data-action=pause]').isVisible(),'执行中显示停止并保存断点');
  if(['PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(state)){check(await p.locator('[data-action=continue]').isEnabled(),`${state} 保留人工检查恢复入口`);check(await p.locator('[data-action=retry],[data-action=skip]').count()===0,`${state} 不显示重试或跳过`);await p.locator('[data-action=continue]').click();check(await p.locator('#executeForm [name=humanVerified]').getAttribute('required')!==null,`${state} 恢复仍需人工确认`);await p.locator('#closeEditor').click();await p.screenshot({path:resolve(out,state.toLowerCase()+'.png'),fullPage:true});}
  if(state==='DRY_RUN_COMPLETE'){check((await p.locator('.task-outcomes>div').first().innerText()).startsWith('0'),'仅填写完成不会计作已核验上架');check((await p.locator('.task-table').innerText()).includes('仅填写完成'),'任务表标明仅填写完成');}
  if(state==='PREPARING')check(await p.locator('[data-action=review-selected]').isVisible(),'准备单核对入队按钮无需展开详情');
  if(state==='EMPTY'){check(await p.locator('.task-table-empty').isVisible(),'无任务显示明确空状态');check(!(await p.locator('.material-summary').innerText()).includes('NaN'),'无素材比例无 NaN');}
  if(state==='FAILED')check(await p.locator('[data-action=retry]').isVisible(),'普通失败保留受控重试入口');
  check((await p.locator('.task-table').innerText()).includes('—')||['PREPARING','EMPTY'].includes(state),`${state} 未发生的时间不造数`);
  await c.close();
 }
 const mixed=fixture('SUCCEEDED');mixed.engine.batch.state='WAITING_HUMAN';mixed.engine.batch.counts={SUCCEEDED:1,FAILED:1};mixed.engine.batch.items.push({id:'uncertain-other',displayState:'RESULT_UNKNOWN',state:'WAITING_HUMAN',destination:'其他待核验项'});
 const {page:mp,context:mc}=await open(mixed);check(await mp.locator('[data-action=retry]').count()===0,'选择已完成任务时，批次仍有待核验项也不显示重试');await mc.close();
 const f=fixture('PENDING');f.shops.push({id:'fixture-other',name:'隔离第二店铺',executionSupported:false,browser:{label:'待适配'}});f.preparations=[{id:'other-prep',shopId:'fixture-other',destination:'另一店铺城市',state:'PREPARING'}];
 const {page:p,context:c}=await open(f);check(!(await p.locator('.task-table').innerText()).includes('另一店铺城市'),'第一店铺不泄露第二店铺准备单');await p.locator('#taskShopSelector').selectOption('fixture-other');check((await p.locator('.task-table').innerText()).includes('另一店铺城市')&&!(await p.locator('.task-table').innerText()).includes('隔离测试城市'),'切店铺后只展示所选店铺任务');check(await p.locator('[data-action=start],[data-action=review-batch]').count()===0,'未适配店铺不展示批次执行按钮');await c.close();
 const kernel=await verifyKernel();check(kernel.ok,'10 个冻结内核文件未改动');check(errors.length===0,'无浏览器未捕获错误');check(writes.length===0,'验证没有发出业务写请求');
 const reference=await readFile('C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-ec715668-01ce-431d-a38c-5b6f1365b703.png');const actual=await readFile(resolve(out,'desktop.png'));
 const comparison=await browser.newPage({viewport:{width:3344,height:941}});await comparison.setContent(`<style>body{margin:0;display:flex}img{width:1672px;height:941px}</style><img src="data:image/png;base64,${reference.toString('base64')}"><img src="data:image/png;base64,${actual.toString('base64')}">`);await comparison.locator('img').evaluateAll(es=>Promise.all(es.map(e=>e.decode())));await comparison.screenshot({path:resolve(out,'comparison.png')});
}finally{
 await writeFile(resolve(out,'verification.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,writes,fixtureNote:'状态变体为浏览器拦截数据，不是真实执行结果'},null,2));console.log(JSON.stringify({checks,errors,writes},null,2));await browser.close();
}
