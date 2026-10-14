import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from 'playwright/test';
import {assertPublishIdentity,newForm,readSubmissionReceipt,submitTask} from '../taobao-publisher.mjs';
const form='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945',id='1088040871383',success='https://item.upload.taobao.com/sell/v2/success.htm?primaryId='+id+'&isEdit=false';
const task={business:{shop_name:'五洲畅游'},listing:{title:'哥斯达黎加定制行程'}};
let browser,context,page;
const actionTimeout=10000;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));page=await context.newPage();page.setDefaultTimeout(actionTimeout);});
after(async()=>{await context?.close();await browser?.close();});
const shop='<div class="UserArea_shopName__3xGhm">五洲畅游</div>';
const receipt=(value=id)=>shop+'<h1>商品提交成功</h1><p>商品ID：'+value+'</p>';
async function setup(){await page.goto(form);await page.setContent(shop+'<div id="sell-field-title"><input value="哥斯达黎加定制行程"></div><button onclick="window.clicks++">提交宝贝信息</button>');await page.evaluate(()=>window.clicks=0);}
async function transition(url=success,html=receipt()){await page.evaluate(({url,html})=>{history.pushState({},'',url);document.body.innerHTML=html;},{url,html});}
function phase(){let clicked=false;return {guard:()=>assertPublishIdentity(page,task,{submitted:clicked,formUrl:form,requireTitle:true}),record:async()=>{clicked=true;}};}
function signal(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function reachedRace(signal,operation){await Promise.race([signal.promise,operation.then(()=>{throw Error('Submission ended before the post-click guard race was reached');})]);}

test('old title guard reproduces success navigation while awaiting shop; only one click',async()=>{
 await setup();let recorded=0;const checkingShop=signal();
 const legacy=async()=>{if(newForm(page)){
  // Capture the old form branch, then block on the hidden shop until the test
  // explicitly installs the success document. No timer guesses this boundary.
  const visible=expect(page.locator('.UserArea_shopName__3xGhm')).toBeVisible({timeout:actionTimeout});
  if(recorded)checkingShop.resolve();await visible;
  await page.locator('#sell-field-title input').inputValue(recorded?{timeout:400}:{});
 }};
 const failed=assert.rejects(submitTask(page,legacy,async()=>{recorded++;await page.locator('.UserArea_shopName__3xGhm').evaluate(e=>e.hidden=true);},{timeout:actionTimeout}),error=>{
  assert.match(error.message,/locator\.inputValue/);assert.match(error.message,/#sell-field-title input/);return true;
 });
 await reachedRace(checkingShop,failed);assert.equal(recorded,1);assert.equal(newForm(page),true);
 await transition();await failed;
 assert.equal(recorded,1);assert.equal(await page.evaluate(()=>window.clicks),1);assert.match(await page.locator('body').innerText(),/商品提交成功/);
 assert.equal(page.url(),success);assert.equal(await page.locator('#sell-field-title input').count(),0);
});
test('recorded-click guard survives the same asynchronous form to success transition',async()=>{
 await setup();const p=phase(),checkingShop=signal();let recorded=0;
 const guard=()=>{const pending=p.guard();if(recorded)checkingShop.resolve();return pending;};
 const submitted=submitTask(page,guard,async()=>{recorded++;await p.record();await page.locator('.UserArea_shopName__3xGhm').evaluate(e=>e.hidden=true);},{timeout:actionTimeout});
 await reachedRace(checkingShop,submitted);assert.equal(recorded,1);assert.equal(newForm(page),true);
 await transition();const value=await submitted;
 assert.equal(value,id);assert.equal(recorded,1);assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(await page.locator('#sell-field-title input').count(),0);
 assert.equal(page.url(),success);assert.match(await page.locator('body').innerText(),/商品提交成功/);
});
for(const title of ['', '其他商品'])test('pre-click title must match: '+JSON.stringify(title),async()=>{await setup();await page.locator('#sell-field-title input').fill(title);const p=phase();await assert.rejects(submitTask(page,p.guard,p.record),/ANOTHER_TASK_FORM/);assert.equal(await page.evaluate(()=>window.clicks),0);});
test('missing pre-click title never clicks',async()=>{await setup();await page.locator('#sell-field-title').evaluate(e=>e.remove());const p=phase();page.setDefaultTimeout(400);try{await assert.rejects(submitTask(page,p.guard,p.record),/locator\.inputValue/);}finally{page.setDefaultTimeout(actionTimeout);}assert.equal(await page.evaluate(()=>window.clicks),0);});
test('wrong shop cannot submit',async()=>{await setup();await page.locator('.UserArea_shopName__3xGhm').evaluate(e=>e.textContent='其他店铺');const p=phase();await assert.rejects(submitTask(page,p.guard,p.record),/toHaveText/);assert.equal(await page.evaluate(()=>window.clicks),0);});
test('old success page is not a new form and cannot submit',async()=>{await setup();await transition();await assert.rejects(submitTask(page,async()=>{}),/NEW_ITEMS_ONLY/);assert.equal(await page.evaluate(()=>window.clicks),0);});
test('form without success times out after the single click',async()=>{await setup();const p=phase();await assert.rejects(submitTask(page,p.guard,p.record,{timeout:300}),/toBeTruthy|Timeout/);assert.equal(await page.evaluate(()=>window.clicks),1);});
for(const reason of ['PAUSED_CAPTCHA','登录失效','操作者暂停'])test('post-click guard '+reason+' never clicks twice',async()=>{await setup();const p=phase();let clicked=false;const guard=async()=>{if(clicked)throw Error(reason);await p.guard();};await assert.rejects(submitTask(page,guard,async()=>{clicked=true;await p.record();},{timeout:500}),new RegExp(reason));assert.equal(await page.evaluate(()=>window.clicks),1);});
test('durable click callback failure does not retry click',async()=>{await setup();const p=phase();await assert.rejects(submitTask(page,p.guard,async()=>{await transition();throw Error('disk failure');}),/disk failure/);assert.equal(await page.evaluate(()=>window.clicks),1);});
test('click throws after side effect; no second click or receipt callback',async()=>{
 let clicks=0,recorded=0;const p={url:()=>form,getByRole:()=>({click:async()=>{clicks++;throw Error('click transport timeout after dispatch');}})};
 await assert.rejects(submitTask(p,async()=>{},async()=>recorded++),/transport timeout/);assert.equal(clicks,1);assert.equal(recorded,0);
});
for(const [name,url,html] of [
 ['body has no ID',success,shop+'商品提交成功'],
 ['body ID differs',success,receipt('9999999999999')],
 ['body has duplicate IDs',success,receipt()+' 商品ID：'+id],
 ['URL duplicate IDs',success+'&primaryId='+id,receipt()],
 ['URL missing ID','https://item.upload.taobao.com/sell/v2/success.htm',receipt()],
 ['edit success',success.replace('isEdit=false','isEdit=true'),receipt()],
 ['another form',form+'&different=1',shop],
 ['wrong official path','https://item.upload.taobao.com/other',receipt()],
])test('rejects ambiguous/changed receipt: '+name,async()=>{await setup();await transition(url,html);await assert.rejects(readSubmissionReceipt(page,form));});
test('external domain cannot provide a receipt or pass post-click identity',async()=>{await page.goto('https://example.invalid/sell/v2/success.htm?primaryId='+id);await page.setContent(receipt());await assert.rejects(readSubmissionReceipt(page,form),/ORIGIN_CHANGED/);await assert.rejects(assertPublishIdentity(page,task,{submitted:true,formUrl:form}),/ORIGIN_CHANGED/);});
test('exact URL/body ID pair is returned only on the original page',async()=>{await setup();assert.equal(await readSubmissionReceipt(page,form),null);await transition();assert.equal(await readSubmissionReceipt(page,form),id);});
