import test from 'node:test';
import assert from 'node:assert/strict';
import {clickMainImageAndVerify} from '../taobao-publisher.mjs';

const urls=[1,2,3].map(i=>`https://img.alicdn.com/imgextra/i1/step3/image-${i}.png`);
function fixture(afterRead,{initial=urls.slice(0,2),clickError=null}={}){
 let clicked=false,clicks=0,reads=0,currentUrl='https://item.upload.taobao.com/sell/v2/publish.htm?catId=50014945';
 const events=[];
 const page={url:()=>currentUrl,locator:()=>({evaluateAll:async()=>clicked?afterRead(++reads):initial})};
 const card={locator:()=>({click:async()=>{clicked=true;clicks++;if(clickError)throw clickError;}})};
 return {page,card,events,get clicks(){return clicks;},get reads(){return reads;},get clicked(){return clicked;},navigate:()=>{currentUrl+='&another-form=1';},options:{onEvent:async event=>events.push(event),stabilityTimeout:500}};
}

test('sequence 12 reproduction: third image arrives between two reads; observe stable 3 and click only once',async()=>{
 const f=fixture(n=>n===1?urls.slice(0,2):urls);
 await clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options);
 assert.equal(f.clicks,1);assert(f.reads>=3);assert.deepEqual(f.events,[]);
});

test('stable but wrong order remains a hard MAIN_IMAGE_STATE_CHANGED error',async()=>{
 const f=fixture(()=>[urls[1],urls[0],urls[2]]);
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options),error=>/MAIN_IMAGE_STATE_CHANGED/.test(error.message)&&!String(error.code).startsWith('SAFE_RETRY_'));
 assert.equal(f.clicks,1);
});

test('oscillating image state is bounded and emits SAFE_RETRY_MAIN_IMAGE_STATE without another click',async()=>{
 const f=fixture(n=>n%2?urls.slice(0,2):urls),started=performance.now();
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options),error=>error.code==='SAFE_RETRY_MAIN_IMAGE_STATE');
 assert(performance.now()-started<1500);assert.equal(f.clicks,1);assert(f.reads>=3);
});

test('a stable old prefix with no new image reaches the shared deadline, never re-clicks',async()=>{
 const f=fixture(()=>urls.slice(0,2)),started=performance.now();
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options),error=>error.code==='SAFE_RETRY_MAIN_IMAGE_STATE');
 assert(performance.now()-started<1500);assert.equal(f.clicks,1);
});

test('CAPTCHA arriving while the third image settles is not converted into safe retry or success',async()=>{
 const f=fixture(n=>n===1?urls.slice(0,2):urls),captcha=Error('PAUSED_CAPTCHA');
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{if(f.clicked&&f.reads>=1)throw captcha;},f.options),error=>error===captcha);
 assert.equal(f.clicks,1);
});

test('same original form is checked throughout observation',async()=>{
 const f=fixture(()=>urls);
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{if(f.clicked)f.navigate();},f.options),/MAIN_IMAGE_FORM_CHANGED/);
 assert.equal(f.clicks,1);
});

test('foreign CDN stays a hard identity error',async()=>{
 const f=fixture(()=>[...urls.slice(0,2),'https://unrelated.example/image.png']);
 await assert.rejects(clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options),/MAIN_IMAGE_ORIGIN_CHANGED/);
 assert.equal(f.clicks,1);
});

test('an applied click timeout reconciles delayed image and keeps the original diagnostic',async()=>{
 const f=fixture(n=>n===1?urls.slice(0,2):urls,{clickError:Object.assign(Error('navigation completion timed out'),{name:'TimeoutError'})});
 await clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options);
 assert.equal(f.clicks,1);assert.equal(f.events.length,1);assert.equal(f.events[0].kind,'MAIN_IMAGE_CLICK_TIMEOUT_RECONCILED');assert.equal(f.events[0].clickRepeated,false);
});

test('already-selected exact images remain read-only',async()=>{
 const f=fixture(()=>urls,{initial:urls});
 await clickMainImageAndVerify(f.page,f.card,urls,async()=>{},f.options);
 assert.equal(f.clicks,0);assert.equal(f.events[0].kind,'MAIN_IMAGE_ALREADY_SELECTED_RECONCILED');
});
