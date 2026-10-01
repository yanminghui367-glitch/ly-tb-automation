// Local workbench QA only. Never connects to the seller browser or dispatches a real task.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base='http://127.0.0.1:4318',out=fileURLToPath(new URL('../../output/interface-v1-20260921/',import.meta.url));
await mkdir(out,{recursive:true});
const state=await fetch(base+'/api/v1/state').then(r=>r.json());
assert.equal(state.active,null);assert.equal(state.settings.executionEnabled,false);assert.equal(state.records.length,30);
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');await page.locator('#homeStats .stat').first().waitFor();
 assert.match(await page.locator('#homeStats').innerText(),/30/);
 for(const [route,title]of Object.entries({home:'首页仪表盘',tasks:'任务中心',monitor:'实时执行监控',exceptions:'异常中心',records:'上架记录',settings:'系统设置'})){
  await page.locator('[data-nav="'+route+'"]').click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,route+' desktop overflow');
  await page.screenshot({path:out+route+'-desktop.png',fullPage:true});checks.push('desktop '+route);
 }
 await page.locator('[data-nav="records"]').click();await page.locator('#recordTable tbody tr').first().waitFor();
 assert.equal(await page.locator('#recordTable tbody tr').count(),15);await page.locator('#recordNext').click();assert.equal(await page.locator('#recordPager').innerText(),'2 / 2');
 await page.locator('#recordSearch').fill(state.records[0].itemId);assert.equal(await page.locator('#recordTable tbody tr').count(),1);await page.getByRole('button',{name:'查看记录'}).first().click();await page.locator('#detailDialog[open] .event-list li').first().waitFor();await page.getByRole('button',{name:'关闭详情'}).click();checks.push('record search pagination detail');
 await page.locator('[data-nav="tasks"]').click();assert.equal(await page.locator('#startButton').isDisabled(),true);assert.equal(await page.locator('#retryButton').isDisabled(),true);
 await page.getByRole('button',{name:'导入商品资料'}).click();await page.locator('#importLimit').fill('2');await page.locator('#recognize').click();
 await page.locator('#reviewed').waitFor({timeout:150000});assert.equal(await page.locator('#importPreview .preview-grid article').count(),2);assert.equal(await page.locator('#createBatch').isDisabled(),true);
 await page.waitForFunction(()=>[...document.querySelectorAll('#importPreview img')].every(x=>x.complete&&x.naturalWidth>0));
 await page.locator('[data-material="0"]').click();await page.locator('#detailDialog[open] img').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('#detailDialog img')].every(x=>x.complete&&x.naturalWidth>0));
 assert.equal(await page.locator('#detailDialog img').count(),13);await page.screenshot({path:out+'import-materials.png',fullPage:true});await page.getByRole('button',{name:'关闭详情'}).click();await page.screenshot({path:out+'import-preview.png',fullPage:true});
 await page.getByRole('button',{name:'关闭导入'}).click();checks.push('real read-only import, 2 previews, 13 verified images; no task created');
 const csv=await fetch(base+'/api/v1/records.csv').then(r=>r.text());assert.equal(csv.split('\r\n').length,31);checks.push('30 records exported');
 await page.setViewportSize({width:390,height:844});for(const route of ['home','tasks','monitor','exceptions','records','settings']){await page.locator('[data-nav="'+route+'"]').click();await page.waitForFunction(r=>document.querySelector('[aria-current="page"]').dataset.nav===r,route);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,route+' mobile overflow');await page.screenshot({path:out+route+'-mobile.png',fullPage:true});checks.push('mobile '+route);}
 // Synthetic states exercise the same client without mutating the production API.
 const mock=await browser.newPage({viewport:{width:1280,height:900}});await mock.addInitScript(()=>{window.EventSource=class{constructor(){window.qaStream=this;}addEventListener(){}close(){}};});mock.on('pageerror',e=>errors.push(e.message));
 let current=structuredClone(state),calls=[];
 current.testMode=true;current.browser={running:true,loggedIn:true,loginState:'LOGGED_IN',label:'已登录',checkedAt:new Date().toISOString()};current.settings.executionEnabled=true;current.batch.state='WAITING_HUMAN';current.batch.items[0].state='WAITING_HUMAN';current.batch.current=current.batch.items[0].id;
 const id=current.batch.items[0].runId;current.exceptions=[{id,batchId:current.batch.id,destination:'测试城市（隔离演示）',state:'PAUSED_CAPTCHA',reason:'请在专用 Chrome 人工完成验证',captcha:true,retryable:false}];
 await mock.route('**/api/v1/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:'event: state\ndata: '+JSON.stringify(current)+'\n\n'});if(u.pathname.endsWith('/state'))return route.fulfill({json:current});calls.push({path:u.pathname,input:route.request().postDataJSON()});return route.fulfill({json:u.pathname.endsWith('recovery-check')?{ready:true,checks:[{name:'测试恢复条件',ok:true,detail:'隔离执行器'}]}:{ok:true}});});
 await mock.goto(base+'/index.html#exceptions');await mock.locator('[data-recover]').waitFor();await mock.screenshot({path:out+'captcha-synthetic.png',fullPage:true});await mock.locator('[data-recover]').click();assert.equal(await mock.locator('#confirmAction').isDisabled(),true);await mock.locator('#humanChecked').check();await mock.locator('#confirmAction').click();await mock.waitForFunction(()=>location.hash==='#monitor');assert.equal(calls.find(x=>x.path==='/api/v1/continue').input.humanVerified,true);assert(calls.find(x=>x.path==='/api/v1/recovery-check'));assert.match(calls.find(x=>x.path==='/api/v1/continue').input.requestId,/^[a-f0-9-]{36}$/);checks.push('synthetic CAPTCHA confirmation and resume');
 current.settings.executionEnabled=false;current.exceptions=[];current.records=[];current.batch=null;current.batches=[];current.overview={published:0,totalBatches:0,waiting:0,failed:0};await mock.goto(base+'/index.html');await mock.getByText('还没有任务批次',{exact:true}).waitFor();await mock.screenshot({path:out+'empty-synthetic.png',fullPage:true});checks.push('empty state');
 await mock.evaluate(()=>window.qaStream.onerror());await mock.locator('#connection:not([hidden])').waitFor();checks.push('offline state');
 const p=await fetch(base+'/api/v1/preview?import='+state.latestImport+'&limit=2').then(r=>r.json());
 const wizard=await browser.newPage();wizard.on('pageerror',e=>errors.push(e.message));await wizard.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
 let demo=structuredClone(state),requests=[];demo.testMode=true;demo.browser={running:true,loggedIn:true,loginState:'LOGGED_IN',label:'已登录',checkedAt:new Date().toISOString()};demo.settings.executionEnabled=true;demo.batch=null;demo.batches=[];demo.exceptions=[];demo.records=[];
 await wizard.route('**/api/v1/**',async route=>{const u=new URL(route.request().url()),op=u.pathname.split('/').at(-1),input=route.request().method()==='POST'?route.request().postDataJSON():undefined;let result;
  if(op==='state')result=demo;
  else if(op==='preview'||op==='import')result=p;
  else if(op==='create'){requests.push({op,input});demo.batch=structuredClone(state.batch);demo.batch.state='READY';demo.batch.items=demo.batch.items.slice(0,2).map(x=>({...x,state:'PENDING',runId:null,result:null}));demo.batch.total=2;demo.batch.counts={PENDING:2};demo.batches=[{...demo.batch}];result=demo.batch;}
  else if(op==='start'){requests.push({op,input});demo.active=demo.batch.id;demo.batch.state='RUNNING';demo.batch.current=demo.batch.items[0].id;demo.batch.items[0].state='RUNNING';result={ok:true};}
  else if(op==='pause'){requests.push({op,input});demo.active=null;demo.batch.state='PAUSED';result={pauseRequested:true};}
  else if(op==='upload'){requests.push({op,input});result=input.begin?{id:'synthetic-upload'}:{path:'C:/test/'+input.name,root:'C:/test'};}
  else throw Error('Unexpected synthetic API: '+op);
  return route.fulfill({json:result});
 });
 await wizard.goto(base+'/index.html#tasks');await wizard.getByRole('button',{name:'导入商品资料'}).click();
 await wizard.locator('#poolFile').setInputFiles({name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic upload transport')});
 await wizard.waitForFunction(()=>document.querySelector('#importPool').value==='C:/test/pool/fixture.xlsx');assert.equal(requests.at(-1).input.name,'pool/fixture.xlsx');
 await wizard.locator('#recognize').click();await wizard.locator('#reviewed').check();await wizard.locator('#executeMode').selectOption('LIVE');await wizard.locator('#createBatch').click();await wizard.locator('#importDialog:not([open])').waitFor({state:'attached'});
 assert.equal(requests.find(x=>x.op==='create').input.review.selectionHash,p.selectionHash);assert.equal(requests.some(x=>x.op==='start'),false);checks.push('synthetic upload, preview, review and queue-only creation');
 await wizard.locator('#startButton').click();assert.equal(requests.some(x=>x.op==='start'),false);await wizard.locator('#confirmAction').click();await wizard.waitForFunction(()=>location.hash==='#monitor');await wizard.locator('#pauseButton').click();await wizard.waitForFunction(()=>document.querySelector('#continueButton').disabled===false);assert.equal(requests.at(-1).op,'pause');checks.push('synthetic explicit start, monitor and pause');
 assert.deepEqual(errors,[]);const final=await fetch(base+'/api/v1/state').then(r=>r.json());assert.equal(final.records.length,30);assert.equal(final.batch.id,state.batch.id);assert.equal(final.active,null);assert.equal(final.settings.executionEnabled,false);
 await writeFile(out+'ui-qa.json',JSON.stringify({at:new Date().toISOString(),checks,errors,realSubmissions:0,publishedBefore:state.records.length,publishedAfter:final.records.length},null,2));console.log(JSON.stringify({checks:checks.length,errors,out}));
}finally{await browser.close();}
