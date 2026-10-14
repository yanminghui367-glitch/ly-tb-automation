import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fillPriceWithBlankRecovery} from '../taobao-publisher.mjs';
const require=createRequire(new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');let browser,page;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();await page.route('**/*',r=>r.abort());});
after(async()=>{await browser?.close();});
async function fixture(blur='',value=''){
 await page.setContent(`<section id="sell-field-price"><input value="${value}" oninput="window.fills++" onblur="${blur}"></section><input id="stock" value="1">`);
 await page.evaluate(()=>window.fills=0);
}
const count=()=>page.evaluate(()=>window.fills),opts={timeout:150};
test('first blur clears price, one bounded refill preserves original price and other fields',async()=>{
 await fixture("if(window.fills===1)this.value=''");const events=[];
 assert.deepEqual(await fillPriceWithBlankRecovery(page,'20',async()=>{}, {...opts,onEvent:async e=>events.push(e)}),{fills:2,value:'20'});
 assert.equal(await count(),2);assert.equal(await page.locator('#stock').inputValue(),'1');
 assert.deepEqual(events.map(e=>e.kind),['PRICE_FILL_INTENT','PRICE_EMPTY_AFTER_FILL','PRICE_BLANK_REFILL_INTENT','PRICE_VALUE_OBSERVED']);
});
test('persistent blank stops after two fills',async()=>{
 await fixture("this.value=''");await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{},opts),/FORM_PRICE_EMPTY/);assert.equal(await count(),2);
});
test('existing frozen price is checked without writing',async()=>{
 await fixture('','20');let guards=0;assert.deepEqual(await fillPriceWithBlankRecovery(page,20,async()=>{guards++;},opts),{fills:0,value:'20'});assert.equal(await count(),0);assert(guards>=2);
});
test('initial and blur nonempty conflicts never get overwritten',async()=>{
 for(const wrong of ['19','20.00']){
  await fixture('',wrong);await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{},opts),/FORM_PRICE_CONFLICT/);assert.equal(await count(),0);
  await fixture(`this.value='${wrong}'`);await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{},opts),/FORM_PRICE_CONFLICT/);assert.equal(await count(),1);
 }
});
test('guard failure before first or second fill does not add a fill',async()=>{
 for(const reason of ['PAUSED_CAPTCHA','ANOTHER_TASK_FORM','操作者暂停']){
  await fixture();await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{throw Error(reason);},opts),e=>e.message===reason);assert.equal(await count(),0);
  await fixture("this.value=''");let retry=false;
  await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{if(retry)throw Error(reason);},{...opts,onEvent:async e=>{if(e.kind==='PRICE_BLANK_REFILL_INTENT')retry=true;}}),e=>e.message===reason);assert.equal(await count(),1);
 }
});
test('final guard value, control, or navigation change refuses success',async()=>{
 for(const action of ['empty','wrong','disabled','duplicate','navigate']){
  await fixture();let final=false;
  await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{
   if(final){final=false;await page.evaluate(action=>{const e=document.querySelector('#sell-field-price input');if(action==='empty')e.value='';if(action==='wrong')e.value='19';if(action==='disabled')e.disabled=true;if(action==='duplicate')e.after(e.cloneNode());if(action==='navigate')location.hash='changed';},action);}
  },{...opts,onEvent:async e=>{if(e.kind==='PRICE_VALUE_OBSERVED')final=true;}}),/FORM_PRICE/);
  assert.equal(await count(),1);
 }
});
test('ambiguous, hidden, readonly input never gets written',async()=>{
 for(const action of ['duplicate','hidden','readonly']){
  await fixture();await page.locator('#sell-field-price input').evaluate((e,a)=>{if(a==='duplicate')e.after(e.cloneNode());if(a==='hidden')e.style.display='none';if(a==='readonly')e.readOnly=true;},action);
  await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{},opts),/FORM_PRICE_CONTROL/);assert.equal(await count(),0);
 }
});
test('evidence write failure prevents initial/recovery writes or successful return',async()=>{
 for(const kind of ['PRICE_FILL_INTENT','PRICE_BLANK_REFILL_INTENT','PRICE_VALUE_OBSERVED']){
  await fixture(kind==='PRICE_BLANK_REFILL_INTENT'?"this.value=''":"");
  await assert.rejects(fillPriceWithBlankRecovery(page,'20',async()=>{},{...opts,onEvent:async e=>{if(e.kind===kind)throw Error('DISK_FULL');}}),/DISK_FULL/);
  assert.equal(await count(),kind==='PRICE_FILL_INTENT'?0:1);
 }
});
