import test from 'node:test';
import assert from 'node:assert/strict';
import {clickMainImageAndVerify} from '../dev/workbench/taobao-publisher.mjs';

const urls=[1,2,3].map(n=>'https://img.alicdn.com/imgextra/i1/test-shop/'+n+'.png');
function scene(afterClick,{initial=urls.slice(0,2),guard=async()=>{},clickError=null}={}){
 let clicked=0,reads=0,postReads=0,checks=0,address='https://item.upload.taobao.com/sell/v2/publish.htm?catId=test';
 const state={get clicks(){return clicked;},get reads(){return reads;},get postReads(){return postReads;},get checks(){return checks;},changeAddress:()=>address+='&different=true'};
 const page={url:()=>address,locator:()=>({evaluateAll:async fn=>{reads++;const values=clicked?afterClick(++postReads,state):typeof initial==='function'?initial(reads):initial;return fn(values.map(src=>({src})));}})};
 const card={locator:()=>({click:async()=>{clicked++;if(clickError)throw clickError;}})};
 return {...state,page,card,state,guard:async()=>{checks++;await guard(state);}};
}
test('2-to-3 asynchronous transition settles without a duplicate card click',async()=>{
 const s=scene(n=>n===1?urls.slice(0,2):urls);
 await clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:1000});
 assert.equal(s.state.clicks,1);assert(s.state.postReads>=5);
});
test('already-selected images becoming stable are reconciled without clicking',async()=>{
 const events=[],s=scene(()=>urls,{initial:n=>n===1?urls.slice(0,2):urls});
 await clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:1000,onEvent:e=>events.push(e)});
 assert.equal(s.state.clicks,0);assert.equal(events[0].kind,'MAIN_IMAGE_ALREADY_SELECTED_RECONCILED');
});
test('perpetual transition ends with only the safe readiness code within its own budget',async()=>{
 const s=scene(n=>n%2?urls.slice(0,2):urls),start=performance.now();
 await assert.rejects(clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:350}),e=>e.code==='SAFE_RETRY_MAIN_IMAGE_STATE');
 assert.equal(s.state.clicks,1);assert(performance.now()-start<1200);
});
for(const [name,guard] of [['captcha',async s=>{if(s.postReads>=1)throw Error('PAUSED_CAPTCHA');}],['login',async s=>{if(s.postReads>=1)throw Error('请人工登录目标店铺');}],['retained page',async s=>{if(s.postReads>=1)throw Error('PAGE_LEDGER_PERSISTENCE_FAILED');}]])test('settling observation preserves '+name+' guard unchanged',async()=>{
 const s=scene(n=>n===1?urls.slice(0,2):urls,{guard});
 await assert.rejects(clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:1000}),e=>!e.code&&/CAPTCHA|登录|PAGE_LEDGER/.test(e.message));
 assert.equal(s.state.clicks,1);
});
test('stable wrong order remains a hard conflict, not a safe readiness retry',async()=>{
 const s=scene(()=>[urls[1],urls[0],urls[2]]);
 await assert.rejects(clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:1000}),e=>e.code==='ERR_ASSERTION'&&/MAIN_IMAGE_STATE_CHANGED/.test(e.message));assert.equal(s.state.clicks,1);
});
test('original form mutation while settling is preserved as a hard identity error',async()=>{
 const s=scene((n,state)=>{if(n===1)state.changeAddress();return urls;});
 await assert.rejects(clickMainImageAndVerify(s.page,s.card,urls,s.guard,{stabilityTimeout:1000}),e=>e.code==='ERR_ASSERTION'&&/MAIN_IMAGE_FORM_CHANGED/.test(e.message));assert.equal(s.state.clicks,1);
});
