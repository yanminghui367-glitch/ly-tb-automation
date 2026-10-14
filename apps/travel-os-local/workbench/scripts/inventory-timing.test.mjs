import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {fillStableInventory} from '../taobao-publisher.mjs';
const require=createRequire(new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
let browser,page;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();await page.route('**/*',r=>r.abort());});
after(async()=>{await browser?.close();});
async function fixture(blur='') {await page.setContent(`<section id="sell-field-batchInventory-card"><input value="1" oninput="window.fills=(window.fills||0)+1" onblur="${blur}"></section>`);await page.evaluate(()=>window.fills=0);}
const options={timeout:200,settleMs:50};
test('slow guard gets a second matching sample, preserves one fill and each guarded read',async()=>{
 await fixture();let checks=0;const result=await fillStableInventory(page,'999999',async()=>{checks++;await delay(300);},options);
 assert.equal(result.attempts,1);assert(checks>=4);assert.equal(await page.evaluate(()=>window.fills),1);
});
test('delayed rollback during slow second guard never passes',async()=>{
 await fixture();let checks=0;
 await assert.rejects(fillStableInventory(page,'999999',async()=>{await delay(300);if(++checks%4===0)await page.locator('input').evaluate(e=>e.value='1');},options),/FORM_INVENTORY_UNSTABLE/);
 assert.equal(await page.evaluate(()=>window.fills),2);
});
test('risk or original-form identity failure in last guard stops without retry',async()=>{
 for(const reason of ['PAUSED_CAPTCHA','ANOTHER_TASK_FORM','操作者暂停']){await fixture();let checks=0;await assert.rejects(fillStableInventory(page,'999999',async()=>{await delay(300);if(++checks===4)throw Error(reason);},options),e=>e.message===reason);assert.equal(await page.evaluate(()=>window.fills),1);}
});
test('correct value still requires full settle duration with fast guard',async()=>{
 await fixture();const start=Date.now();await fillStableInventory(page,'999999',async()=>{}, {timeout:700,settleMs:500});assert(Date.now()-start>=500);assert.equal(await page.evaluate(()=>window.fills),1);
});
test('wrong value remains bounded to two fills',async()=>{
 await fixture("this.value='1'");await assert.rejects(fillStableInventory(page,'999999',()=>delay(300),options),/FORM_INVENTORY_UNSTABLE/);assert.equal(await page.evaluate(()=>window.fills),2);
});
test('last guarded sample refuses a disabled or readonly control even with the right value',async()=>{
 for(const property of ['disabled','readOnly']){await fixture();let checks=0;
  await assert.rejects(fillStableInventory(page,'999999',async()=>{await delay(300);if(++checks===4)await page.locator('input').evaluate((e,p)=>e[p]=true,property);},options),/FORM_INVENTORY_CONTROL_NOT_EDITABLE/);
  assert.equal(await page.evaluate(()=>window.fills),1);
 }
});
test('last guarded sample refuses duplicated controls',async()=>{
 await fixture();let checks=0;await assert.rejects(fillStableInventory(page,'999999',async()=>{await delay(300);if(++checks===4)await page.locator('input').evaluate(e=>e.after(e.cloneNode(true)));},options),/FORM_INVENTORY_CONTROL_CHANGED/);assert.equal(await page.evaluate(()=>window.fills),1);
});
