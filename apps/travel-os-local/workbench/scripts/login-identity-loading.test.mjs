import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {BrowserEnvironment,inspectLogin} from '../browser-environment.mjs';

const shop={name:'隔离测试店'};
const identitySelector='div.shopName--x6nyUylx';

// Mutable browser-shaped fixture: every call reads current DOM state, never a
// previous login result. It has no connection to the production browser owner.
function fixture({name=shop.name,count=1,visible=true,challenge=false,closed=false,url='https://myseller.taobao.com/home.htm/SellManage/all'}={}){
 const state={name,count,visible,challenge,closed,url,reads:0};
 const page={
  isClosed:()=>state.closed,
  url:()=>state.url,
  frames:()=>[page],
  screenshot:async()=>{},
  locator:selector=>({
   count:async()=>selector===identitySelector?state.count:0,
   isVisible:async()=>selector===identitySelector&&state.visible,
   innerText:async()=>{if(selector===identitySelector){state.reads++;return state.name;}return '';},
   first:()=>({isVisible:async()=>state.challenge})
  })
 };
 return {page,state};
}

for(const name of ['', ' \n\t ', '\u00a0\u3000']){
 test('empty or whitespace identity stays unverified: '+JSON.stringify(name),async()=>{
  const {page}=fixture({name});const result=await inspectLogin([page],shop);
  assert.equal(result.loginState,'LOGIN_UNVERIFIED');assert.equal(result.loggedIn,false);
 });
}

for(const reverse of [false,true]){
 test('one correct identity plus loading blank does not become WRONG_SHOP; reverse='+reverse,async()=>{
  const pages=[fixture().page,fixture({name:' '}).page];if(reverse)pages.reverse();
  const result=await inspectLogin(pages,shop);
  assert.equal(result.loginState,'LOGGED_IN');assert.equal(result.loggedIn,true);
 });
 test('explicit wrong shop overrides a correct tab; reverse='+reverse,async()=>{
  const pages=[fixture().page,fixture({name:'另一家测试店'}).page];if(reverse)pages.reverse();
  const result=await inspectLogin(pages,shop);
  assert.equal(result.loginState,'WRONG_SHOP');assert.equal(result.loggedIn,false);
 });
}

for(const challengeIndex of [0,1,2]){
 test('CAPTCHA overrides both correct and wrong identities; position='+challengeIndex,async()=>{
  const pages=[fixture().page,fixture({name:'另一家测试店'}).page];pages.splice(challengeIndex,0,fixture({name:'',challenge:true}).page);
  const result=await inspectLogin(pages,shop);
  assert.equal(result.loginState,'PAUSED_CAPTCHA');assert.equal(result.loggedIn,false);
 });
}

for(const [name,options] of [['hidden',{visible:false}],['duplicate',{count:2}],['missing',{count:0}]]){
 test(name+' identity cannot establish a logged-in session',async()=>{
  const result=await inspectLogin([fixture(options).page],shop);
  assert.equal(result.loginState,'LOGIN_UNVERIFIED');assert.equal(result.loggedIn,false);
 });
}

test('blank to correct to wrong to blank uses fresh identity reads',async()=>{
 const {page,state}=fixture({name:''});
 for(const [name,expected,loggedIn] of [['','LOGIN_UNVERIFIED',false],[shop.name,'LOGGED_IN',true],['另一家测试店','WRONG_SHOP',false],['  ','LOGIN_UNVERIFIED',false]]){
  state.name=name;const result=await inspectLogin([page],shop);
  assert.equal(result.loginState,expected);assert.equal(result.loggedIn,loggedIn);
 }
 assert.equal(state.reads,4);
});

test('closed and non-seller pages cannot supply a valid shop identity',async()=>{
 const pages=[fixture({closed:true}).page,fixture({url:'https://example.invalid/'}).page,fixture({url:'http://127.0.0.1:4318/'}).page];
 const result=await inspectLogin(pages,shop);assert.equal(result.loginState,'LOGIN_UNVERIFIED');assert.equal(result.loggedIn,false);
});

test('identity diagnostics omit URL userinfo/query/fragment and bound visible names',async()=>{
 const f=fixture({name:'错'.repeat(180),url:'https://synthetic-user:synthetic-password@myseller.taobao.com/home.htm/SellManage/all?token=synthetic-secret&session=synthetic-session#synthetic-fragment'});
 const result=await inspectLogin([f.page],shop);
 assert.equal(result.loginState,'WRONG_SHOP');
 assert.deepEqual(result.identityEvidence,[{page:'https://myseller.taobao.com/home.htm/SellManage/all',name:'错'.repeat(120)}]);
 assert.doesNotMatch(JSON.stringify(result),/synthetic-|password|token|session|fragment/);
});

test('owner retains sanitized transient identity anomaly after fresh successful status',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-login-identity-qa-'));
 const localShop={id:'isolated-shop',name:shop.name};
 const f=fixture({name:'另一家测试店',url:'https://synthetic-user:synthetic-password@myseller.taobao.com/home.htm/SellManage/all?token=synthetic-secret&session=synthetic-session#synthetic-fragment'});
 const context={pages:()=>[f.page],cookies:()=>{throw Error('Credentials must not be read');},storageState:()=>{throw Error('Credentials must not be exported');}};
 const owner=new BrowserEnvironment({checkpointRoot:dir,profilePath:()=>join(dir,'unused-profile')});
 owner.sessions.set(localShop.id,{context,profileDir:join(dir,'unused-profile'),generation:1,last:null,checking:null});
 const anomaly=join(dir,localShop.id+'-identity-anomalies.jsonl'),latest=join(dir,localShop.id+'.json');
 const wrong=await owner.status(localShop);assert.equal(wrong.loginState,'WRONG_SHOP');
 const original=await readFile(anomaly,'utf8'),record=JSON.parse(original.trim());
 assert.deepEqual(Object.keys(record).sort(),['at','identityEvidence','resumeRequiresRevalidation','shopId','state','taskMayResume'].sort());
 assert.equal(record.state,'WRONG_SHOP');assert.equal(record.taskMayResume,false);
 assert.deepEqual(record.identityEvidence,[{page:'https://myseller.taobao.com/home.htm/SellManage/all',name:'另一家测试店'}]);
 assert.doesNotMatch(original,/synthetic-|password|token|session|fragment|cookie|storageState/i);
 await owner.status(localShop);assert.equal(await readFile(anomaly,'utf8'),original,'same state must not flood anomaly log');
 f.state.name=shop.name;
 const correct=await owner.status(localShop);assert.equal(correct.loginState,'LOGGED_IN');assert.equal(correct.loggedIn,true);
 assert.equal(JSON.parse(await readFile(latest,'utf8')).state,'LOGGED_IN');
 assert.equal(await readFile(anomaly,'utf8'),original,'successful check must preserve previous wrong identity evidence');
 f.state.name='';
 const blank=await owner.status(localShop);assert.equal(blank.loginState,'LOGIN_UNVERIFIED');assert.equal(blank.loggedIn,false);
 const afterBlank=await readFile(anomaly,'utf8'),rows=afterBlank.trim().split('\n').map(s=>JSON.parse(s));
 assert.equal(rows.length,2);assert.deepEqual(rows[0],record);assert.equal(rows[1].state,'LOGIN_UNVERIFIED');assert.equal(rows[1].identityEvidence[0].name,'');
 f.state.name=shop.name;await owner.status(localShop);assert.equal(await readFile(anomaly,'utf8'),afterBlank);
 assert.doesNotMatch(afterBlank,/synthetic-|password|token|session|fragment|cookie|storageState/i);
});

test('isolated Chrome: visible empty shell loads, changes shop, and becomes ambiguous without cached success',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(()=>browser.close());
 const context=await browser.newContext();
 // All requests are synthetic. No persistent profile, CDP, real login or seller
 // page is used; URL-shaped fixture merely exercises the host allowlist.
 await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><body></body>'}));
 const stable=await context.newPage(),loading=await context.newPage();
 await stable.goto('https://myseller.taobao.com/home.htm/QnworkbenchHome/');
 await loading.goto('https://myseller.taobao.com/home.htm/SellManage/all');
 await stable.setContent('<div class="shopName--x6nyUylx">'+shop.name+'</div>');
 await loading.setContent('<div class="shopName--x6nyUylx" style="width:180px;min-height:28px"></div>');
 await expect(loading.locator(identitySelector)).toBeVisible();
 assert.equal((await inspectLogin([loading],shop)).loginState,'LOGIN_UNVERIFIED');
 assert.equal((await inspectLogin([stable,loading],shop)).loginState,'LOGGED_IN');
 assert.equal((await inspectLogin([loading,stable],shop)).loginState,'LOGGED_IN');
 await loading.evaluate(name=>setTimeout(()=>document.querySelector('div.shopName--x6nyUylx').textContent=name,40),shop.name);
 await expect(loading.locator(identitySelector)).toHaveText(shop.name);
 assert.equal((await inspectLogin([loading],shop)).loginState,'LOGGED_IN');
 await loading.locator(identitySelector).evaluate(e=>e.textContent='另一家测试店');
 assert.equal((await inspectLogin([stable,loading],shop)).loginState,'WRONG_SHOP');
 await loading.locator(identitySelector).evaluate(e=>e.textContent='');
 const cleared=await inspectLogin([loading],shop);assert.equal(cleared.loginState,'LOGIN_UNVERIFIED');assert.equal(cleared.loggedIn,false);
 await loading.setContent('<div class="shopName--x6nyUylx" hidden>'+shop.name+'</div>');
 assert.equal((await inspectLogin([loading],shop)).loginState,'LOGIN_UNVERIFIED');
 await loading.setContent('<div class="shopName--x6nyUylx">'+shop.name+'</div><div class="shopName--x6nyUylx">'+shop.name+'</div>');
 assert.equal((await inspectLogin([loading],shop)).loginState,'LOGIN_UNVERIFIED');
 await loading.setContent('<div class="shopName--x6nyUylx">另一家测试店</div><p>请拖动滑块完成安全验证</p>');
 const challenged=await inspectLogin([stable,loading],shop);assert.equal(challenged.loginState,'PAUSED_CAPTCHA');assert.equal(challenged.loggedIn,false);
});
