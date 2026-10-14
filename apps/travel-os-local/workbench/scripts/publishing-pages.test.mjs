import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {setPageScope} from '../page-ownership.mjs';
import {createBackgroundPage,getAuxiliaryPage,isAuxiliaryPage,closeVerifiedOwnedPage} from '../publishing-pages.mjs';
const material='https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu';
const page=(id,url='about:blank')=>Object.assign(new EventEmitter(),{id,closed:false,address:url,text:'',challenge:false,closeCalls:0,isClosed(){return this.closed;},url(){return this.address;},frames(){return [this];},async goto(u){this.address=u;this.emit('framenavigated',this);},locator(selector){return selector==='body'?{innerText:async()=>this.text}:{first:()=>({isVisible:async()=>this.challenge})};},async close(options){this.closeCalls++;this.closeOptions=options;this.closed=true;}});
function fixture({concurrent=true}={}){
 const front=page('front'),pages=[front],calls=[];
 const tabInfo=p=>({type:'tab',targetId:'tab-'+p.id,browserContextId:'owned-context',embedderData:{tabPinned:p.pinned??false,tabActive:p.active??false}});
 const browser={isConnected:()=>true,async newBrowserCDPSession(){
  const bindings=new Map();let seq=0;
  return Object.assign(new EventEmitter(),{async send(method,params){
   if(method==='Target.getTargets')return {targetInfos:pages.filter(p=>!p.closed).map(tabInfo)};
   if(method==='Target.getTargetInfo')return {targetInfo:tabInfo(pages.find(p=>'tab-'+p.id===params.targetId&&!p.closed))};
   if(method==='Target.attachToTarget'){const id=String(++seq);bindings.set(id,params.targetId);return {sessionId:id};}
   if(method==='Target.detachFromTarget')return {};
   if(method==='Target.sendMessageToTarget'){
    this.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,message:JSON.stringify({method:'Target.attachedToTarget',params:{sessionId:'child-'+params.sessionId,waitingForDebugger:false,targetInfo:{type:'page',targetId:bindings.get(params.sessionId).slice(4)}}})});
    this.emit('Target.receivedMessageFromTarget',{sessionId:params.sessionId,message:JSON.stringify({id:1,result:{}})});return {};
   }
   throw Error('Unexpected fake protection command');
  },async detach(){}});
 }};
 const context={pages:()=>pages,browser:()=>browser,newPage:()=>{throw Error('foreground creation forbidden');},async newCDPSession(p){return {async send(method,params){calls.push({id:p.id,method,params});if(method==='Target.getTargetInfo')return {targetInfo:{type:'page',targetId:p.id,browserContextId:'owned-context'}};if(method==='Target.createTarget'){if(concurrent)pages.push(page('unrelated'));const created=page('target');created.context=()=>context;pages.push(created);return {targetId:'target'};}},async detach(){}};}};
 return {context,pages,calls};
}
test('background creation identifies exact target even when another tab opens concurrently',async()=>{
 const {context,calls}=fixture();const result=await createBackgroundPage(context);
 assert.equal(result.id,'target');assert.deepEqual(calls.find(c=>c.method==='Target.createTarget').params,{url:'about:blank',background:true,browserContextId:'owned-context'});
});
test('unsupported background creation stops without foreground fallback',async()=>{
 const {context}=fixture();context.newCDPSession=async()=>({send:async m=>{if(m==='Target.getTargetInfo')return {targetInfo:{}};throw Error('protocol unavailable');},detach:async()=>{}});
 await assert.rejects(createBackgroundPage(context),/protocol unavailable/);
});
test('missing target binding times out instead of taking an unrelated page',async()=>{
 const {context,pages}=fixture();const original=context.newCDPSession;context.newCDPSession=async p=>{const s=await original(p),send=s.send;s.send=async(...args)=>{const r=await send(...args);if(args[0]==='Target.createTarget')pages.pop();return r;};return s;};
 await assert.rejects(createBackgroundPage(context,{timeout:1}),/未能唯一绑定/);
});
test('same material role reuses page despite tracking query changes; guard runs every time',async()=>{
 const {context,pages}=fixture();pages.push(page('material',material+'?spm=old'));let checked=0;
 for(let i=0;i<100;i++)assert.equal((await getAuxiliaryPage(context,{role:'material',shopId:'shop',url:material+'?spm='+i,guard:async()=>{checked++;}})).id,'material');
 assert.equal(pages.length,2);assert.equal(checked,100);
});
test('multiple old helper tabs are preserved; one background page is pinned',async()=>{
 const {context,pages,calls}=fixture();pages.push(page('old-1',material),page('old-2',material));
 const args={role:'material',shopId:'shop',url:material,guard:async()=>{}};
 const p=await getAuxiliaryPage(context,args);assert.equal(p.id,'target');assert.equal(await getAuxiliaryPage(context,args),p);
 assert.equal(calls.filter(c=>c.method==='Target.createTarget').length,1);assert(pages.some(p=>p.id==='old-1')&&pages.some(p=>p.id==='old-2'));
});
test('navigated pinned page pauses without overwriting its URL or choosing another tab',async()=>{
 const {context,pages}=fixture();pages.push(page('material',material));const args={role:'material',shopId:'shop',url:material,guard:async()=>{}};
 const p=await getAuxiliaryPage(context,args);p.address='https://example.test/manual-work';
 await assert.rejects(getAuxiliaryPage(context,args),/地址改变/);assert.equal(p.url(),'https://example.test/manual-work');assert.equal(pages.length,2);
});
test('closed helper reference is discarded and fresh page must pass guard',async()=>{
 const {context,pages}=fixture();pages.push(page('material',material));let checked=0;const args={role:'material',shopId:'shop',url:material,guard:async()=>{checked++;}};
 (await getAuxiliaryPage(context,args)).closed=true;assert.equal((await getAuxiliaryPage(context,args)).id,'target');assert.equal(checked,2);
});
test('wrong shop or captcha guard stops before consumer can perform an upload',async()=>{
 for(const message of ['WRONG_SHOP','PAUSED_CAPTCHA']){
  const {context,pages}=fixture();pages.push(page('material',material));let uploaded=false;
  await assert.rejects((async()=>{await getAuxiliaryPage(context,{role:'material',shopId:'shop',url:material,guard:async()=>{throw Error(message);}});uploaded=true;})(),new RegExp(message));assert.equal(uploaded,false);
 }
});
test('role URL matching refuses other origins, lookalikes and unrelated paths',()=>{
 for(const u of ['https://qn.taobao.com.evil.test/home.htm/material-center/mine-material/sucai-tu','http://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu','https://qn.taobao.com/home.htm/another','https://myseller.taobao.com/home.htm/QnworkbenchHome/'])assert.equal(isAuxiliaryPage(page('x',u),'material'),false);
});

const successUrl='https://item.upload.taobao.com/sell/v2/success.htm?primaryId=123&isEdit=false';
const verified={createdThisExecution:true,verifiedPersisted:true,itemId:'123',successUrl};
const noRisk=async()=>{};
async function successfulPage(context){const p=await createBackgroundPage(context);p.address=successUrl;p.text='商品提交成功\n商品ID：123';return p;}

test('100 verified owned publications keep live tab count bounded and preserve all unowned tabs',async()=>{
 const {context,pages}=fixture({concurrent:false});const old=page('old-success',successUrl),manual=page('manual','https://example.test/work');pages.push(old,manual);
 for(let i=0;i<100;i++){
  const p=await successfulPage(context);assert.equal(pages.filter(p=>!p.closed).length,4);
  assert.deepEqual(await closeVerifiedOwnedPage(p,verified,noRisk),{closed:true,itemId:'123'});
  assert.deepEqual(p.closeOptions,{runBeforeUnload:false});assert.equal(p.listenerCount('framenavigated'),0);
  assert.equal(pages.filter(p=>!p.closed).length,3);
 }
 assert.equal(old.closeCalls,0);assert.equal(manual.closeCalls,0);assert.equal(pages[0].closeCalls,0);
});

test('restored, failed, unknown-result and not-persisted executions never close their page',async()=>{
 const {context}=fixture({concurrent:false});
 for(const opts of [{...verified,createdThisExecution:false},{...verified,verifiedPersisted:false},{...verified,verifiedPersisted:'true'},{}]){
  const p=await successfulPage(context);const result=await closeVerifiedOwnedPage(p,opts,noRisk);assert.equal(result.closed,false);assert.equal(p.closeCalls,0);
 }
 const unowned=page('restored',successUrl);unowned.text='商品提交成功 商品ID：123';
 assert.equal((await closeVerifiedOwnedPage(unowned,verified,noRisk)).closed,false);assert.equal(unowned.closeCalls,0);
});

test('pinned and unavailable native protection retain an otherwise verified owned tab',async()=>{
 for(const protection of ['pinned','unknown']){
  const {context}=fixture({concurrent:false}),p=await successfulPage(context);
  if(protection==='pinned')p.pinned=true;
  if(protection==='unknown')context.browser=()=>null;
  const result=await closeVerifiedOwnedPage(p,verified,noRisk);
  assert.equal(result.closed,false);assert.equal(p.closeCalls,0);
  assert.equal(result.reason,{pinned:'PINNED_PAGE',unknown:'PAGE_PROTECTION_UNKNOWN'}[protection]);
 }
});

test('selected tab is not treated as user-owned when it is this execution verified page',async()=>{
 const {context}=fixture({concurrent:false}),p=await successfulPage(context);p.active=true;
 assert.deepEqual(await closeVerifiedOwnedPage(p,verified,noRisk),{closed:true,itemId:'123'});
 assert.equal(p.closeCalls,1);
});

test('wrong ID, non-success page, changed URL and ambiguous body keep the original tab',async()=>{
 const cases=[
  p=>{p.text='商品提交成功 商品ID：999';},
  p=>{p.text='提交结果待核验 商品ID：123';},
  p=>{p.text='商品提交成功 商品ID：123 商品ID：123';},
  p=>{p.address=successUrl+'&navigated=1';},
  p=>{p.address='https://example.test/manual';}
 ];
 for(const modify of cases){const {context}=fixture({concurrent:false}),p=await successfulPage(context);modify(p);assert.equal((await closeVerifiedOwnedPage(p,verified,noRisk)).closed,false);assert.equal(p.closeCalls,0);}
 for(const changed of [{itemId:'999'},{successUrl:'https://myseller.taobao.com/home.htm/SellManage/all'},{successUrl:'https://item.upload.taobao.com.evil.test/sell/v2/success.htm?primaryId=123'},{successUrl:'https://item.upload.taobao.com/sell/v2/success.htm?primaryId=123&primaryId=123'}]){
  const {context}=fixture({concurrent:false}),p=await successfulPage(context);assert.equal((await closeVerifiedOwnedPage(p,{...verified,...changed},noRisk)).closed,false);assert.equal(p.closeCalls,0);
 }
});

test('CAPTCHA text, challenge frame and failed shop guard preserve verified page without closing',async()=>{
 for(const challenge of ['text','frame','guard']){
  const {context}=fixture({concurrent:false}),p=await successfulPage(context);
  if(challenge==='text')p.text+=' 安全验证';if(challenge==='frame')p.challenge=true;
  if(challenge==='guard')await assert.rejects(closeVerifiedOwnedPage(p,verified,async()=>{throw Error('WRONG_SHOP');}),/WRONG_SHOP/);
  else assert.equal((await closeVerifiedOwnedPage(p,verified,noRisk)).reason,'CHALLENGE_PRESENT');
  assert.equal(p.closeCalls,0);assert.equal(p.listenerCount('framenavigated'),0);
 }
});

test('navigation or ID changes during asynchronous guard cancel cleanup even when URL returns unchanged',async()=>{
 for(const change of ['navigation','id']){
  const {context}=fixture({concurrent:false}),p=await successfulPage(context);
  const result=await closeVerifiedOwnedPage(p,verified,async()=>{if(change==='navigation'){await p.goto('https://example.test/manual');await p.goto(successUrl);}else p.text='商品提交成功 商品ID：999';});
  assert.equal(result.closed,false);assert.equal(p.closeCalls,0);assert.equal(p.listenerCount('framenavigated'),0);
 }
});

test('an auxiliary helper stays protected even if mistakenly passed verified publish metadata',async()=>{
 const {context}=fixture({concurrent:false});const p=await getAuxiliaryPage(context,{role:'material',shopId:'shop',url:material,guard:noRisk});p.address=successUrl;p.text='商品提交成功 商品ID：123';
 assert.equal((await closeVerifiedOwnedPage(p,verified,noRisk)).reason,'PAGE_NOT_OWNED_PUBLISH_FORM');assert.equal(p.closeCalls,0);
});

test('cleanup needs guard and propagates close failure without retry or orphan listeners',async()=>{
 const {context}=fixture({concurrent:false}),p=await successfulPage(context);
 assert.equal((await closeVerifiedOwnedPage(p,verified)).reason,'CLEANUP_GUARD_REQUIRED');assert.equal(p.closeCalls,0);
 p.close=async()=>{p.closeCalls++;throw Error('close failed');};
 await assert.rejects(closeVerifiedOwnedPage(p,verified,noRisk),/close failed/);assert.equal(p.closeCalls,1);assert.equal(p.listenerCount('framenavigated'),0);
});

test('isolated real Chrome closes only newly owned verified tabs and preserves restored, manual and challenge pages',async()=>{
 // A disposable browser with every request fulfilled locally; no production
 // CDP connection, profile, seller request, database, upload, or final submit.
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const db=new DatabaseSync(':memory:');
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><h1>商品提交成功</h1><p>商品ID：123</p>'}));
  const manual=await context.newPage();await manual.goto('https://fixture.test/manual');
  const restored=await context.newPage();await restored.goto(successUrl);
  const scope={db,shopId:'isolated',runId:null,taskKey:'task-0',taskHash:'hash-0',roundId:'round-local',executionWindowId:'window-local'};
  const ledger=setPageScope(context,scope);
  assert.equal((await closeVerifiedOwnedPage(restored,verified,noRisk)).closed,false);
  for(let i=0;i<100;i++){
   setPageScope(context,{...scope,runId:'run-'+i,taskKey:'task-'+i,taskHash:'hash-'+i});ledger.assertCanStartTask();
   const owned=await createBackgroundPage(context);await owned.goto(successUrl);
   assert.equal(context.pages().length,3);
   assert.equal((await closeVerifiedOwnedPage(owned,verified,noRisk)).closed,true);
   assert.equal(context.pages().length,2);
   assert.equal(ledger.counts().owned,0);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM page_owner_pages WHERE state='closed'").get().n,100);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM page_owner_events WHERE kind='close-intent'").get().n,100);
  assert.equal(ledger.counts().peak,1);
  const challenged=await createBackgroundPage(context);await challenged.goto(successUrl);
  await challenged.evaluate(()=>{const iframe=document.createElement('iframe');iframe.src='https://fixture.test/punish';document.body.append(iframe);});
  await challenged.waitForFunction(()=>document.querySelector('iframe')?.contentWindow!==null);
  assert.equal((await closeVerifiedOwnedPage(challenged,verified,noRisk)).reason,'CHALLENGE_PRESENT');
  assert.equal(challenged.isClosed(),false);assert.equal(restored.isClosed(),false);assert.equal(manual.isClosed(),false);
  assert.equal(context.pages().length,3);
  assert.equal(ledger.counts().retained,1);ledger.dispose();
 }finally{await browser.close();db.close();}
});

test('verification accepts only exact HTTPS seller origins and refuses lookalikes, credentials and non-list pages',()=>{
 for(const host of ['qn.taobao.com','myseller.taobao.com']){
  for(const path of ['all','on_sale'])assert(isAuxiliaryPage(page('x','https://'+host+'/home.htm/SellManage/'+path),'verification'));
  for(const url of ['http://'+host+'/home.htm/SellManage/all','https://'+host+'.evil.test/home.htm/SellManage/all','https://user@'+host+'/home.htm/SellManage/all','https://'+host+'/error.htm','https://'+host+'/home.htm/shop-manage/shop-center','https://'+host+'/home.htm/SellManageFake/all'])assert.equal(isAuxiliaryPage(page('x',url),'verification'),false);
 }
});
test('QianNiu verification helper is reused; user navigation is not overwritten',async()=>{
 const {context,pages,calls}=fixture();const url='https://qn.taobao.com/home.htm/SellManage/all';pages.push(page('verify',url));
 const args={role:'verification',shopId:'shop',url,guard:noRisk};const p=await getAuxiliaryPage(context,args);
 assert.equal(p.id,'verify');assert.equal(await getAuxiliaryPage(context,args),p);assert.equal(calls.filter(c=>c.method==='Target.createTarget').length,0);
 p.address='https://qn.taobao.com/home.htm/shop-manage/shop-center';await assert.rejects(getAuxiliaryPage(context,args));assert.equal(p.address,'https://qn.taobao.com/home.htm/shop-manage/shop-center');
});
