import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {submitTask} from '../taobao-publisher.mjs';
import {recoverOriginalReceipt,originalPageBinding} from '../submission-receipt.mjs';
import {digest} from '../source-store.mjs';

const form='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945',id='1095269536185',success='https://item.upload.taobao.com/sell/v2/success.htm?primaryId='+id+'&isEdit=false';
const receipt='商品提交成功 商品ID：'+id;
function mockPage({error,body=receipt}={}){let clicks=0,options,current=form;return {url:()=>current,
 getByRole:()=>({click:async o=>{options=o;clicks++;current=success;if(error)throw error;}}),
 locator:()=>({innerText:async()=>body}),clicks:()=>clicks,options:()=>options};}

test('navigation timeout after click side effect still captures exact original receipt, no invented click event',async()=>{
 const p=mockPage({error:Error('locator.click timeout waiting scheduled navigations to finish')}),events=[];
 const result=await submitTask(p,async()=>{},async()=>events.push('CLICKED'),{timeout:100,onDispatch:async()=>events.push('DISPATCH'),onReceipt:async r=>events.push(r),readBackend:async()=>{throw Error('must not query by title');}});
 assert.equal(result,id);assert.equal(p.clicks(),1);assert.deepEqual(p.options(),{noWaitAfter:true});
 assert.equal(events[0],'DISPATCH');assert.equal(events.length,2);assert.equal(events[1].itemId,id);assert.equal(events[1].clickReturned,false);
});
test('normal click records click then receipt once; noWaitAfter prevents navigation wait owning dispatch',async()=>{
 const p=mockPage(),events=[];assert.equal(await submitTask(p,async()=>{},async()=>events.push('CLICKED'),{onDispatch:async()=>events.push('DISPATCH'),onReceipt:async()=>events.push('RECEIPT')}),id);
 assert.deepEqual(events,['DISPATCH','CLICKED','RECEIPT']);assert.equal(p.clicks(),1);assert.equal(p.options().noWaitAfter,true);
});
test('dispatch write failure prevents click',async()=>{const p=mockPage();await assert.rejects(submitTask(p,async()=>{},async()=>{},{onDispatch:async()=>{throw Error('SQLITE_IOERR');}}),/SQLITE_IOERR/);assert.equal(p.clicks(),0);});
test('receipt persistence failure never retries click or falls back to title lookup',async()=>{const p=mockPage();let backend=0;await assert.rejects(submitTask(p,async()=>{},async()=>{},{onReceipt:async()=>{throw Error('SQLITE_IOERR');},readBackend:async()=>{backend++;}}),/SQLITE_IOERR/);assert.equal(p.clicks(),1);assert.equal(backend,0);});
test('unknown click with no receipt cannot use backend fallback or become success',async()=>{const p=mockPage({error:Error('dispatch uncertain'),body:'still loading'});let backend=0,recorded=0;await assert.rejects(submitTask(p,async()=>{},async()=>recorded++,{timeout:20,readBackend:async()=>backend++}),/dispatch uncertain/);assert.equal(p.clicks(),1);assert.equal(backend,0);assert.equal(recorded,0);});
for(const reason of ['PAUSED_CAPTCHA','WRONG_SHOP'])test('uncertain click preserves '+reason+' protection',async()=>{const p=mockPage({error:Error('navigation timeout')});let calls=0,saved=0;await assert.rejects(submitTask(p,async()=>{if(++calls>1)throw Error(reason);},async()=>{},{timeout:20,onReceipt:async()=>saved++}),new RegExp(reason));assert.equal(p.clicks(),1);assert.equal(saved,0);});
test('uncertain click with mismatching URL/body ID does not record result',async()=>{const p=mockPage({error:Error('navigation timeout'),body:'商品提交成功 商品ID：9999999999999'});let saved=0;await assert.rejects(submitTask(p,async()=>{},async()=>{},{timeout:20,onReceipt:async()=>saved++}),/MATCHING_UNIQUE/);assert.equal(saved,0);assert.equal(p.clicks(),1);});

let browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});after(async()=>{await browser?.close();});
async function fixture(t){
 const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<body></body>'}));const page=await context.newPage();await page.goto(success);await page.setContent('<div class="UserArea_shopName__3xGhm">隔离店铺</div>'+receipt);
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE page_owner_pages(id TEXT,session_id TEXT,origin TEXT,purpose TEXT,scope TEXT,target_id TEXT,browser_context_id TEXT,state TEXT)');
 const task={shopId:'isolated-shop',listing:{country:'美国',city:'休斯敦',title:'休斯敦服务'},business:{shop_name:'隔离店铺'}},run={id:'original-run',key:'original-key',task,state:'RESULT_UNKNOWN',checkpoint:{formUrl:form}};
 const scope={shopId:task.shopId,runId:run.id,taskKey:run.key,taskHash:digest(task)};
 db.prepare('INSERT INTO page_owner_pages VALUES(?,?,?,?,?,?,?,?)').run('page-record','original-session','executor-created','publish-form',JSON.stringify(scope),'original-target','original-context','retained');
 const events=[{seq:1,kind:'SUBMITTING'},{seq:2,kind:'STEP_INTENT',payload:{name:'submit-once'}},{seq:3,kind:'RESULT_UNKNOWN'}];
 let claimed=[],guards=0;const observedContext={pages:()=>[page],newCDPSession:async p=>({send:async()=>({targetInfo:{type:'page',targetId:'original-target',browserContextId:'original-context'}}),detach:async()=>{}})};
 t.after(async()=>{db.close();await context.close();});return {db,run,page,context:observedContext,events,guard:async()=>guards++,assertUnused:async id=>claimed.push(id),claimed,guards:()=>guards};
}
test('legacy original retained page recovers receipt without CLICKED timestamp, only read-only ID candidate',async t=>{const f=await fixture(t),r=await recoverOriginalReceipt(f);assert.equal(r.itemId,id);assert.equal(r.source,'ORIGINAL_PAGE_RECEIPT');assert.equal(r.originalSubmitEvent,1);assert.deepEqual(f.claimed,[id]);assert(f.guards()>=2);assert.equal(f.run.state,'RESULT_UNKNOWN');assert(!f.run.checkpoint.itemId);});
for(const scenario of ['other-task','other-shop','other-hash','other-context','other-target','closed-page','no-intent','no-form','duplicate-binding'])test('original receipt refuses '+scenario,async t=>{
 const f=await fixture(t);
 if(scenario==='other-task')f.db.exec("UPDATE page_owner_pages SET scope=json_set(scope,'$.runId','other-run')");
 if(scenario==='other-shop')f.db.exec("UPDATE page_owner_pages SET scope=json_set(scope,'$.shopId','other-shop')");
 if(scenario==='other-hash')f.db.exec("UPDATE page_owner_pages SET scope=json_set(scope,'$.taskHash','wrong')");
 if(scenario==='other-context')f.context.newCDPSession=async()=>({send:async()=>({targetInfo:{type:'page',targetId:'original-target',browserContextId:'another-context'}}),detach:async()=>{}});
 if(scenario==='other-target')f.context.newCDPSession=async()=>({send:async()=>({targetInfo:{type:'page',targetId:'other-target',browserContextId:'original-context'}}),detach:async()=>{}});
 if(scenario==='closed-page')await f.page.close();
 if(scenario==='no-intent')f.events=[];
 if(scenario==='no-form')f.run.checkpoint.formUrl='https://example.invalid/';
 if(scenario==='duplicate-binding')f.db.exec('INSERT INTO page_owner_pages SELECT * FROM page_owner_pages');
 assert.equal(await recoverOriginalReceipt(f),null);assert.equal(f.claimed.length,0);
});
test('original page must still be the frozen shop',async t=>{const f=await fixture(t);await f.page.locator('.UserArea_shopName__3xGhm').evaluate(e=>e.textContent='另一店铺');await assert.rejects(recoverOriginalReceipt(f));assert.equal(f.claimed.length,0);});
test('original page challenge blocks receipt and ID claim',async t=>{const f=await fixture(t);f.guard=async()=>{throw Error('PAUSED_CAPTCHA');};await assert.rejects(recoverOriginalReceipt(f),/PAUSED_CAPTCHA/);assert.equal(f.claimed.length,0);});
test('ID already used by another task cannot be recovered',async t=>{const f=await fixture(t);f.assertUnused=async()=>{throw Error('already claimed');};await assert.rejects(recoverOriginalReceipt(f),/already claimed/);});
test('saved binding must still match the original ledger',async t=>{const f=await fixture(t);f.run.checkpoint.submissionPageBinding={targetId:'other'};await assert.rejects(recoverOriginalReceipt(f),/BINDING_CHANGED/);});
test('recording an original binding only reads the exact ledger row',async t=>{const f=await fixture(t);const ledger={db:f.db,describe:()=>({owned:true,id:'page-record'})},r=originalPageBinding(ledger,f.page,f.run);assert.equal(r.runId,f.run.id);assert.equal(r.targetId,'original-target');assert.equal(r.taskHash,digest(f.run.task));assert.equal(originalPageBinding({describe:()=>({owned:false})},f.page,f.run),null);});

test('real Chromium stalled navigation cannot delay durable click recording',async()=>{
 const context=await browser.newContext();let heldRoute,releaseObserved,clickRecorded;
 const observed=new Promise(r=>releaseObserved=r),recorded=new Promise(r=>clickRecorded=r);
 await context.route('**/*',async route=>{
  if(route.request().url()===success){heldRoute=route;releaseObserved();return;}
  await route.fulfill({contentType:'text/html; charset=utf-8',body:'<button onclick="location.href=\''+success+'\'">提交宝贝信息</button>'});
 });
 const page=await context.newPage();page.setDefaultTimeout(1500);await page.goto(form);
 let recordedBeforeNavigation=false;
 const operation=submitTask(page,async()=>{},async()=>{recordedBeforeNavigation=true;clickRecorded();},{timeout:5000});
 let timer;
 try{
  await observed;
  await Promise.race([recorded,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('click receipt blocked behind navigation')),1000))]);
  assert.equal(recordedBeforeNavigation,true);
  await heldRoute.fulfill({contentType:'text/html; charset=utf-8',body:receipt});heldRoute=null;
  assert.equal(await operation,id);
 }finally{clearTimeout(timer);if(heldRoute)await heldRoute.fulfill({contentType:'text/html; charset=utf-8',body:receipt}).catch(()=>{});await operation.catch(()=>{});await context.close();}
});

test('receipt disappearing during final guard never returns the stale ID',async()=>{
 const p=mockPage();let calls=0,saved=0;const original=p.locator;
 await assert.rejects(submitTask(p,async()=>{if(++calls===3)p.locator=()=>({innerText:async()=>''});},async()=>{},{onReceipt:async()=>saved++}),/SUBMISSION_RECEIPT_CHANGED/);
 assert.equal(saved,0);assert.equal(p.clicks(),1);
});

test('pause arriving during durable dispatch intent prevents the click',async()=>{const p=mockPage();let paused=false;await assert.rejects(submitTask(p,async()=>{},async()=>{},{onDispatch:async()=>{paused=true;},beforeClick:()=>{if(paused)throw Error('操作者暂停');}}),/操作者暂停/);assert.equal(p.clicks(),0);});
