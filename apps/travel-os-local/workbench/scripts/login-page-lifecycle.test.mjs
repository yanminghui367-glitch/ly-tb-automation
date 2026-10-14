import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import * as after from '../browser-environment.mjs';
const shop={id:'isolated',name:'隔离测试店'},selector='div.shopName--x6nyUylx';
function pageFixture({name=shop.name,closeAtCount=false,throwAtCount=false,challenge=false}={}){
 let closed=false;
 const page={isClosed:()=>closed,url:()=> 'https://myseller.taobao.com/home.htm',frames:()=>[page],screenshot:async()=>{},locator:s=>({
  first:()=>({isVisible:async()=>challenge}),innerText:async()=>s===selector?name:'',isVisible:async()=>s===selector,
  count:async()=>{if(s!==selector)return 0;if(closeAtCount)closed=true;if(closeAtCount||throwAtCount)throw Error('locator.count: Target page, context or browser has been closed');return 1;}
 })};return page;
}
for(const first of [true,false])test('closed-page race discarded; fresh remaining shop required: '+first,async()=>{
 const pages=[pageFixture(),pageFixture({closeAtCount:true})];if(first)pages.reverse();
 assert.equal((await after.inspectLogin(pages,shop)).loginState,'LOGGED_IN');
});
test('only closed page is not a logged-in identity',async()=>assert.equal((await after.inspectLogin([pageFixture({closeAtCount:true})],shop)).loginState,'LOGIN_UNVERIFIED'));
test('a live page throwing a closed-looking error is never ignored',async()=>{
 await assert.rejects(after.inspectLogin([pageFixture(),pageFixture({throwAtCount:true})],shop),e=>e.inspectionFailure?.kind==='PAGE_READ_FAILED');
});
for(const first of [true,false])test('wrong-shop evidence survives another page closing: '+first,async()=>{
 const pages=[pageFixture({name:'其他店铺'}),pageFixture({closeAtCount:true}),pageFixture()];if(first)pages.reverse();
 assert.equal((await after.inspectLogin(pages,shop)).loginState,'WRONG_SHOP');
});
for(const first of [true,false])test('challenge remains a stop around page closure: '+first,async()=>{
 const pages=[pageFixture({challenge:true}),pageFixture({closeAtCount:true}),pageFixture()];if(first)pages.reverse();
 assert.equal((await after.inspectLogin(pages,shop)).loginState,'PAUSED_CAPTCHA');
});
test('unexpected inspection failure stored without exception text or URL secrets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-inspection-qa-')),page=pageFixture({throwAtCount:true});
 page.url=()=> 'https://fake-user:fake-password@myseller.taobao.com/home.htm?token=fake-token#fake-secret';
 const owner=new after.BrowserEnvironment({checkpointRoot:dir,profilePath:()=>join(dir,'unused')});
 owner.sessions.set(shop.id,{context:{pages:()=>[page]},profileDir:join(dir,'unused'),generation:1,last:null,checking:null});
 const state=await owner.status(shop);assert.equal(state.loggedIn,false);assert.equal(state.loginState,'LOGIN_UNVERIFIED');
 const bytes=await readFile(join(dir,'isolated-inspection-anomalies.jsonl'),'utf8'),saved=JSON.parse(bytes);
 assert.deepEqual(saved.inspectionFailure,{page:'https://myseller.taobao.com/home.htm',phase:'identity',kind:'PAGE_READ_FAILED'});assert.doesNotMatch(bytes,/fake-|Target page|password|token|cookie/i);
});
test('real isolated Chrome page closes at identity read; retains fresh identity',async()=>{
 const require=createRequire(join(resolve(import.meta.dirname,'..'),'package.json')),{chromium}=require('playwright');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="shopName--x6nyUylx">隔离测试店</div>'}));
  for(const impl of [after]){
   const stable=await context.newPage(),closing=await context.newPage();await stable.goto('https://myseller.taobao.com/home.htm');await closing.goto('https://myseller.taobao.com/home.htm');
   const locate=closing.locator.bind(closing);closing.locator=s=>{const l=locate(s);if(s===selector){const count=l.count.bind(l);l.count=async()=>{await closing.close();return count();};}return l;};
   assert.equal((await impl.inspectLogin([stable,closing],shop)).loginState,'LOGGED_IN');
   await stable.close();
  }
 }finally{await browser.close();}
});
