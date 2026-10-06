import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve(process.argv[2]||'../output/overview-reference-qa');await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile(resolve(out,'read-only-fixture.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],writes=[];let context,page,state,offline=false;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);};
const screenshot=async name=>{await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});await page.screenshot({path:resolve(out,name+'.png'),fullPage:page.viewportSize().width===390});};
async function open(next=fixture,width=1672,height=941){
 await context?.close();state=structuredClone(next);state.testMode=true;offline=false;
 context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
 await context.addInitScript(()=>{
  localStorage.setItem('travel-os:sidebar-expanded','true');
  // Test transport only: keep SSE alive using the same intercepted API snapshot.
  window.EventSource=class {constructor(){this.listeners={};this.timer=setInterval(()=>this.tick(),1500);this.first=setTimeout(()=>this.tick(),20);}addEventListener(n,f){(this.listeners[n]??=[]).push(f);}async tick(){try{const r=await fetch('/api/os/state'),s=await r.json();for(const f of this.listeners.state||[])f({data:JSON.stringify(s.engine)});}catch{this.onerror?.();}}close(){clearInterval(this.timer);clearTimeout(this.first);}};
 });
 // Every API request is intercepted; no production writes or execution browser access.
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(offline)return route.abort();
  if(req.method()!=='GET'){writes.push(url.pathname);if(url.pathname==='/api/v1/check')return route.fulfill({json:{ok:true}});return route.fulfill({status:409,json:{error:'隔离测试禁止写入'}});}
  if(url.pathname==='/api/os/state')return route.fulfill({json:state});
  if(url.pathname==='/api/v1/events')return route.fulfill({status:200,contentType:'text/event-stream',body:'event: state\ndata: '+JSON.stringify(state.engine)+'\n\n'});
  if(url.pathname==='/api/v1/state')return route.fulfill({json:state.engine});
  if(url.pathname==='/api/v1/globe')return route.fulfill({json:{items:[]}});
  return route.fulfill({status:404,json:{error:'隔离测试未提供此详情接口'}});
 });
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4318/travel-os.html#overview');await page.locator('.overview-metric').first().waitFor();await page.evaluate(()=>document.fonts.ready);
}
try{
 await open();
 check(JSON.stringify(await page.locator('.ov-metric-copy strong').allTextContents())===JSON.stringify(['700','45','0','33']),'real snapshot counts: 700 products, 45 verified, 0 active, 33 distinct problems');
 check((await page.locator('.ov-outcomes').innerText()).includes('成功 15 · 失败 5'),'processed 20/20 is separate from success 15 and failure 5');
 check(await page.locator('#overviewShopSelect option').count()===fixture.shops.length,'shop choices use existing store data');
 const initialMetrics=await page.locator('#overviewMetrics').innerText();
 await page.locator('#overviewShopSelect').selectOption(fixture.shops[1].id);
 check((await page.locator('#overviewShop').innerText()).includes('非当前执行店铺'),'non-executor shop is explicitly labelled');
 check((await page.locator('.ov-shop-stats').innerText()).includes('尚无执行记录'),'another store never inherits executor progress');
 check((await page.locator('#overviewMetrics').innerText())===initialMetrics,'viewing another shop keeps global metrics unchanged');
 await page.locator('#overviewShopSelect').selectOption(fixture.engine.shop.id);
 await page.locator('.overview-metric[data-action="overview-attention"]').click();
 await page.locator('#editor[open]').waitFor();
 check((await page.locator('#editor').innerText()).includes('共 33 项'),'attention dialog counts distinct affected products');
 check((await page.locator('#editor').innerText()).includes('执行失败')&&(await page.locator('#editor').innerText()).includes('资料待补充'),'ordinary failures and source deficiencies are separated');
 check(await page.locator('.ov-issue-group details').count()===33,'each affected product has an individual explanation');
 await page.locator('.ov-issue-group details').first().locator('summary').click();
 check((await page.locator('.ov-issue-group details').first().innerText()).includes('查看执行记录'),'failure supplies an existing record action');
 await screenshot('qa-attention');await page.keyboard.press('Escape');
 await page.locator('#citySearch').fill('不存在的测试目的地');await page.locator('#searchResults').filter({hasText:'没有匹配的目的地'}).waitFor();checks.push('search no-result state');
 await page.locator('#citySearch').fill('东京');await page.locator('#destinationSearch').press('Enter');await page.locator('#overviewSelection[open]').waitFor();
 check((await page.locator('#destinationPanel').innerText()).includes('东京'),'search opens the existing destination relation panel');await screenshot('qa-tokyo-relations');
 await page.reload();await page.locator('.overview-metric').first().waitFor();check((await page.locator('.ov-metric-copy strong').first().innerText())==='700','reload restores backend data without starting execution');
 await page.locator('.ov-region[data-region="欧洲"]').click();await page.locator('#page-destinations:not([hidden])').waitFor();
 check(await page.locator('[data-action="directory-region"][data-region="欧洲"]').getAttribute('aria-pressed')==='true','world map opens the actual continent filter');
 for(const module of ['tasks','shops','products','destinations','quotes','records','settings','overview']){
  await page.locator('#navigation a[href="#'+module+'"]').click();await page.locator('#page-'+module+':not([hidden])').waitFor();
  check(await page.title()==='星途 Travel OS',module+' retains existing route and fixed page title');
 }
 await page.locator('[data-action="overview-verified"]').click();await page.locator('#page-records:not([hidden])').waitFor();
 check(await page.locator('#recordResult').inputValue()==='success','verified metric opens success filter');
 await page.locator('#navigation a[href="#overview"]').click();
 await page.locator('[data-action="overview-running"]').click();await page.locator('#page-tasks:not([hidden])').waitFor();
 check(await page.locator('[data-action="queue-filter"][data-filter="running"]').getAttribute('aria-pressed')==='true','running metric opens running queue');
 await page.locator('#navigation a[href="#overview"]').click();
 await page.locator('#checkBrowser').click();await page.locator('#page-settings:not([hidden])').waitFor();check(writes.length===0,'connection shortcut navigates to single settings entry without opening Chrome or starting a task');await page.locator('#navigation a[href="#overview"]').click();
 // Explicitly verify stale evidence, connection loss, and recovery using fixture updates.
 state.engine.browser={...state.engine.browser,checkedAt:'2000-01-01T00:00:00Z',stale:true};await page.reload();await page.locator('.overview-metric').first().waitFor();
 check((await page.locator('#overviewShop .ov-state').innerText())==='待检查','stale login evidence is not presented as ready');
 offline=true;await page.locator('#connectionNotice:not([hidden])').waitFor();check((await page.locator('#connectionNoticeText').innerText()).includes('上次读取的数据'),'connection loss retains and labels the prior snapshot');
 await page.reload();await page.locator('#connectionNotice:not([hidden])').waitFor();check(await page.locator('#checkBrowser').isDisabled(),'offline browser check is disabled');check(await page.locator('body.is-overview').count()===1,'first-load failure retains overview layout');check((await page.locator('#connectionNoticeText').innerText()).includes('尚未读取到数据')&&(await page.locator('.ov-loading').innerText()).includes('数据暂时无法读取'),'first-load failure is an error state without claiming cached data');await screenshot('qa-offline');
 offline=false;await page.locator('#reconnect').click();await page.locator('.overview-metric').first().waitFor();checks.push('reconnect restores real snapshot');
 // Multi-state fixtures are synthetic and labelled as test mode, never persisted.
 const edge=structuredClone(fixture);edge.engine.exceptions=[{id:'captcha-test',state:'PAUSED_CAPTCHA',captcha:true,destination:'验证码示例',reason:'等待人工验证'},{id:'unknown-test',state:'RESULT_UNKNOWN',unknown:true,destination:'待核验示例',reason:'平台结果不明'}];edge.engine.batch=null;edge.products=[];edge.attempts=[];edge.engine.records=[];edge.engine.active=null;edge.engine.batches=[];
 await open(edge);await page.locator('[data-action="overview-attention"]').first().click();
 check((await page.locator('#editor').innerText()).includes('人工验证')&&(await page.locator('#editor').innerText()).includes('结果待核验'),'captcha and unknown result are separate normal categories');
 await page.locator('.ov-issue-group details').nth(1).locator('summary').click();check((await page.locator('#editor').innerText()).includes('禁止直接重新发布'),'unknown result gives verification-only recovery');await screenshot('qa-captcha-unknown');
 const empty=structuredClone(edge);empty.shops=[];empty.engine.exceptions=[];await open(empty);
 check((await page.locator('#overviewShop').innerText()).includes('还没有店铺'),'empty store state');check((await page.locator('#overviewActivity').innerText()).includes('暂无执行记录'),'empty record state');check((await page.locator('#overviewMetrics').innerText()).includes('0'),'empty metrics use zero without samples');await screenshot('qa-empty');
 const paused=structuredClone(fixture);paused.engine.active=paused.engine.batch.id;paused.engine.execution={state:'PAUSING'};await open(paused);
 check((await page.locator('#overviewMetrics').innerText()).includes('正在暂停，等待断点保存'),'pausing is never labelled safely paused');
 const interrupted=structuredClone(edge);interrupted.engine.batch={id:'interrupted',mode:'LIVE',state:'WAITING_HUMAN',total:1,items:[{id:'resume',runId:'resume',state:'WAITING_HUMAN',issue:{category:'恢复检查'}}],counts:{WAITING_HUMAN:1}};interrupted.engine.exceptions=[];await open(interrupted);await page.locator('[data-action="overview-attention"]').first().click();check((await page.locator('#editor').innerText()).includes('暂停待检查')&&!(await page.locator('#editor').innerText()).includes('人工验证'),'interrupted task is not misrepresented as captcha');
 const retry=structuredClone(fixture);retry.engine.batch.state='PAUSED';retry.engine.batch.items=[{id:'retry-task',runId:'retry',state:'RETRY',displayState:'RETRY'}];retry.engine.batch.counts={RETRY:1};retry.engine.batch.total=1;retry.engine.batches=[{id:retry.engine.batch.id,state:'PAUSED'}];await open(retry);check((await page.locator('[data-action="overview-pending"]').innerText()).includes('1'),'paused retry batch appears as waiting to continue');await page.locator('[data-action="overview-pending"]').click();check((await page.locator('#page-tasks').innerText()).includes('等待重试'),'pending shortcut opens the actual retry queue without starting it');
 await open();
 for(const [width,height] of [[1672,941],[1440,900],[1920,1080],[390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' no document horizontal overflow');
  check(await page.locator('#checkBrowser').isVisible()&&await page.locator('#connectionState').isVisible(),width+' service and browser check remain accessible');
  if(width===1672)check(await page.evaluate(()=>document.documentElement.scrollHeight-document.querySelector('#testBanner').getBoundingClientRect().height-parseFloat(getComputedStyle(document.querySelector('#testBanner')).marginBottom)<=innerHeight+1), 'reference content fits excluding the explicit test-mode banner');
  await screenshot('qa-'+width+'x'+height);
 }
 await page.locator('#sidebarToggle').click();check(await page.locator('#navigation a[href="#tasks"]').isVisible(),'mobile navigation opens');await page.locator('#navigation a[href="#tasks"]').click();check(!await page.locator('.main-shell').getAttribute('inert'),'mobile navigation releases workspace after route selection');
 check(errors.length===0,'no script errors across the tested flows');
}finally{await writeFile(resolve(out,'browser-qa.json'),JSON.stringify({checks,errors,interceptedWrites:writes,at:new Date().toISOString()},null,2));await browser.close();}
console.log(JSON.stringify({passed:checks.length,errors,writes}));
