import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fillBrand} from '../taobao-publisher.mjs';
let browser,context,page;
const value='无品牌/无注册商标',guard=async()=>{};
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await context?.close();await browser?.close();});
beforeEach(async()=>{await context?.close();context=await browser.newContext();await context.route('**/*',r=>r.abort());page=await context.newPage();});
async function fixture({selected='',direct=false,missing=false,disabled=false,ambiguous=false,delay=0}={}){
 await page.setContent('<div id="struct-nav"><div role="option">基础信息</div></div><div id="struct-p-20000"><input readonly role="combobox" aria-expanded="false"></div><div id="brandPopup" hidden><input id="brandSearch"><div class="options-list"></div></div>');
 await page.evaluate(({value,selected,direct,missing,disabled,ambiguous,delay})=>{
  window.selectionClicks=0;window.openClicks=0;
  const brand=document.querySelector('#struct-p-20000 input'),popup=document.querySelector('#brandPopup'),search=document.querySelector('#brandSearch'),list=popup.querySelector('.options-list');
  brand.value=selected;
  const render=text=>{
   list.replaceChildren();
   const option=document.createElement('div');option.className='options-item';option.setAttribute('role','option');option.textContent=text;
   if(disabled)option.setAttribute('aria-disabled','true');
   option.onclick=()=>{window.selectionClicks++;brand.value=text;brand.setAttribute('aria-expanded','false');popup.hidden=true;};
   list.append(option);
  };
  brand.onclick=()=>{window.openClicks++;popup.hidden=false;brand.setAttribute('aria-expanded','true');render(direct?value:'0001');};
  search.oninput=()=>setTimeout(()=>render(missing?'其他品牌':value),delay);
  if(ambiguous)search.after(search.cloneNode());
 },{value,selected,direct,missing,disabled,ambiguous,delay});
}

test('searches the brand menu then selects exact source brand; navigation options are ignored',async()=>{
 await fixture({delay:150});await fillBrand(page,value,guard);
 assert.equal(await page.locator('#brandSearch').inputValue(),value);
 assert.equal(await page.locator('#struct-p-20000 input').inputValue(),value);
 assert.equal(await page.evaluate(()=>window.selectionClicks),1);assert.equal(await page.evaluate(()=>window.openClicks),1);
});
test('correct committed brand needs no menu or search',async()=>{
 await fixture({selected:value});await fillBrand(page,value,guard);assert.equal(await page.evaluate(()=>window.openClicks),0);assert.equal(await page.evaluate(()=>window.selectionClicks),0);
});
test('visible exact candidate is reused without searching',async()=>{
 await fixture({direct:true});await fillBrand(page,value,guard);assert.equal(await page.locator('#brandSearch').inputValue(),'');assert.equal(await page.evaluate(()=>window.selectionClicks),1);
});
test('same open brand menu resumes without a second opening click',async()=>{
 await fixture();await page.locator('#struct-p-20000 input').click();await fillBrand(page,value,guard);assert.equal(await page.evaluate(()=>window.openClicks),1);assert.equal(await page.evaluate(()=>window.selectionClicks),1);
});
test('typed search text is not a selected brand when no exact candidate exists',async()=>{
 await fixture({missing:true});await assert.rejects(fillBrand(page,value,guard,{timeout:250}),/FORM_BRAND_OPTION_MISSING/);
 assert.equal(await page.locator('#struct-p-20000 input').inputValue(),'');assert.equal(await page.evaluate(()=>window.selectionClicks),0);
});
test('ambiguous search inputs fail without selecting a brand',async()=>{
 await fixture({ambiguous:true});await assert.rejects(fillBrand(page,value,guard),/FORM_BRAND_SEARCH_AMBIGUOUS/);assert.equal(await page.evaluate(()=>window.selectionClicks),0);
});
test('disabled target is not selected',async()=>{
 await fixture({direct:true,disabled:true});await assert.rejects(fillBrand(page,value,guard,{timeout:200}));assert.equal(await page.evaluate(()=>window.selectionClicks),0);
});
test('pause while locating search stops before input or option action',async()=>{
 await fixture();let calls=0;await assert.rejects(fillBrand(page,value,async()=>{if(++calls===2)throw Error('操作者暂停');}),/操作者暂停/);assert.equal(await page.locator('#brandSearch').inputValue(),'');assert.equal(await page.evaluate(()=>window.selectionClicks),0);
});
