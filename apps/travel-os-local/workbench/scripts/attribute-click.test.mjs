import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {ATTRIBUTE_FIELDS,NO_BRAND,clickCustomAttributeAndVerify,fillAttributes,selectedCustomState} from '../publishing-attributes.mjs';
let browser,context,page,events,clicks;
const fields=Object.entries(ATTRIBUTE_FIELDS).map(([key,label],i)=>({key,label,containerId:'struct-p-'+(101+i),kind:'custom',text:key==='style'?'加流苏地毯':key+' a',value:key==='style'?'加流苏地毯':key+' a'}));
const f=fields[2];
const fixture=()=>fields.map(x=>`<section><label>${x.label}</label><div id="${x.containerId}"><span class="next-select next-select-single" aria-expanded="false"><span class="next-input"><span class="next-select-values"><span class="next-select-trigger-search"><input readonly role="combobox" aria-expanded="false" aria-controls="opts-${x.key}" onclick="const list=document.getElementById('opts-${x.key}');list.hidden=!list.hidden;this.setAttribute('aria-expanded',String(!list.hidden));this.closest('.next-select-single').setAttribute('aria-expanded',String(!list.hidden));"><span aria-hidden="true">请选择</span></span></span></span></span><div role="listbox" id="opts-${x.key}" hidden><div class="options-item" data-value="${x.value}" onclick="window.nativeClicks++;const container=this.closest('[id^=struct-p-]'),em=document.createElement('em');em.textContent=this.textContent;em.title=this.textContent;container.querySelector('em')?.remove();container.querySelector('.next-select-values').prepend(em);container.querySelector('input').setAttribute('aria-expanded','false');container.querySelector('.next-select-single').setAttribute('aria-expanded','false');this.parentElement.hidden=true;">${x.text}</div></div></div></section>`).join('');
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await context?.close();await browser?.close();});
beforeEach(async()=>{await context?.close();context=await browser.newContext();await context.route('**/*',r=>r.abort());page=await context.newPage();await page.setContent(fixture());await page.evaluate(()=>window.nativeClicks=0);events=[];clicks=0;});
const guard=async()=>{};
const opts=()=>({timeout:350,onEvent:async e=>events.push(e)});
const timeout=()=>Object.assign(Error('locator.click: Timeout 8000ms exceeded; performing click action'),{name:'TimeoutError'});
const open=async(field=f)=>{await page.locator('#'+field.containerId+' input').click();return page.locator('#opts-'+field.key+' .options-item');};
const applied=async({field=f,text=field.text,value=null,close=true}={})=>page.locator('#'+field.containerId).evaluate((el,{text,value,close})=>{
 let em=el.querySelector('em');if(!em){em=document.createElement('em');el.querySelector('.next-select-values').prepend(em);}em.textContent=text;em.title=text;if(value!==null)em.dataset.value=value;
 if(close){el.querySelector('[role=listbox]').hidden=true;el.querySelector('input').setAttribute('aria-expanded','false');el.querySelector('.next-select-single').setAttribute('aria-expanded','false');}
},{text,value,close});
const intercepted=(target,fn)=>new Proxy(target,{get(obj,key){if(key==='click')return async()=>{clicks++;await fn();};const v=obj[key];return typeof v==='function'?v.bind(obj):v;}});

test('real native option click commits one frozen value and closes naturally',async()=>{
 const target=await open();await clickCustomAttributeAndVerify(page,target,f,guard,opts());
 assert.equal(await page.evaluate(()=>window.nativeClicks),1);assert.equal(await page.locator('#'+f.containerId+' input').inputValue(),'');assert.deepEqual(events,[]);
});
test('timeout after effect reconciles committed sibling label, original field and one click',async()=>{
 const target=intercepted(await open(),async()=>{await applied();throw timeout();});
 await clickCustomAttributeAndVerify(page,target,f,guard,opts());assert.equal(clicks,1);
 assert.equal(events.length,1);assert.equal(events[0].kind,'ATTRIBUTE_CLICK_TIMEOUT_RECONCILED');assert.deepEqual(events[0].field,f);assert.equal(events[0].actual.text,f.text);assert.equal(events[0].actual.committed,true);assert.equal(events[0].menuClosed,true);assert.equal(events[0].clickCount,1);assert.equal(events[0].clickRepeated,false);assert.match(events[0].originalError,/performing click action/);
});
test('delayed natural commit after timeout is observed without clicking again',async()=>{
 const target=intercepted(await open(),async()=>{await page.evaluate(text=>setTimeout(()=>{const c=document.getElementById('struct-p-103'),em=document.createElement('em');em.textContent=text;c.querySelector('.next-select-values').prepend(em);c.querySelector('[role=listbox]').hidden=true;c.querySelector('input').setAttribute('aria-expanded','false');c.querySelector('.next-select-single').setAttribute('aria-expanded','false');},90),f.text);throw timeout();});
 await clickCustomAttributeAndVerify(page,target,f,guard,opts());assert.equal(clicks,1);assert.equal(events.length,1);
});
test('timeout without effect is not retried and original diagnostic remains attached',async()=>{
 const target=intercepted(await open(),async()=>{throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),e=>/ATTRIBUTE_SELECTION_MISMATCH/.test(e.message)&&/performing click action/.test(e.attributeClickTimeout));assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('menu remaining open is never closed by reconciliation even when value matches',async()=>{
 const target=intercepted(await open(),async()=>{await applied({close:false});throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.equal(clicks,1);assert(await page.locator('#opts-style').isVisible());assert.equal(await page.locator('#'+f.containerId+' input').getAttribute('aria-expanded'),'true');assert.deepEqual(events,[]);
});
test('an empty popup with aria-expanded true is not a closed menu',async()=>{
 const target=intercepted(await open(),async()=>{await applied();await page.locator('#'+f.containerId+' .next-select-single').evaluate(el=>el.setAttribute('aria-expanded','true'));throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.equal(clicks,1);
});
test('other attribute menu appearing after effect prevents continuing',async()=>{
 const target=intercepted(await open(),async()=>{await applied();await page.locator('#opts-subject').evaluate(el=>el.hidden=false);throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('matching popup or search input text cannot stand in for Fusion selected em',async()=>{
 const target=intercepted(await open(),async()=>{await page.locator('#'+f.containerId).evaluate((el,text)=>{el.querySelector('input').value=text;el.querySelector('input').dataset.value=text;el.querySelector('input').setAttribute('aria-expanded','false');el.querySelector('.next-select-single').setAttribute('aria-expanded','false');el.querySelector('[role=listbox]').hidden=true;},f.text);throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('editable generic search input with matching text and data-value is not committed',async()=>{
 await page.locator('#'+f.containerId).evaluate(el=>{el.innerHTML='<input role="combobox" value="加流苏地毯" data-value="加流苏地毯" aria-expanded="false">';});
 await assert.rejects(clickCustomAttributeAndVerify(page,null,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.deepEqual(events,[]);
});
test('generic readonly combobox with real data-value remains supported',async()=>{
 await page.locator('#'+f.containerId).evaluate(el=>{el.innerHTML='<input readonly role="combobox" value="加流苏地毯" data-value="加流苏地毯" aria-expanded="false">';});
 await clickCustomAttributeAndVerify(page,null,f,guard,opts());assert.deepEqual(events,[]);
});
test('selected label outside the original field container cannot prove its value',async()=>{
 await page.locator('#'+f.containerId).evaluate((el,text)=>{el.innerHTML='<input readonly role="combobox" aria-expanded="false">';const wrapper=document.createElement('span');wrapper.className='next-select-single';wrapper.innerHTML='<span class="next-select-values"><em>'+text+'</em></span>';el.before(wrapper);wrapper.append(el);},f.text);
 await assert.rejects(clickCustomAttributeAndVerify(page,null,f,guard,opts()),/ATTRIBUTE_SELECTION_OWNER_CHANGED/);assert.equal(clicks,0);assert.deepEqual(events,[]);
});
test('wrong label, prefix match, wrong value or contradictory aria text cannot pass',async()=>{
 for(const mutation of [async()=>applied({text:f.text+'加长'}),async()=>applied({text:'无流苏地毯'}),async()=>applied({value:'WRONG'}),async()=>{await applied();await page.locator('#'+f.containerId+' input').evaluate(el=>el.setAttribute('aria-valuetext','WRONG'));}]){
  await page.setContent(fixture());const target=intercepted(await open(),async()=>{await mutation();throw timeout();});await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);
 }assert.equal(clicks,4);assert.deepEqual(events,[]);
});
test('hidden or multiple selected em labels cannot pass',async()=>{
 for(const duplicate of [false,true]){
  await page.setContent(fixture());const target=intercepted(await open(),async()=>{await applied();await page.locator('#'+f.containerId+' em').evaluate((el,duplicate)=>{if(duplicate)el.after(el.cloneNode(true));else el.style.visibility='hidden';},duplicate);throw timeout();});await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);
 }assert.equal(clicks,2);assert.deepEqual(events,[]);
});
test('same text committed in another field does not satisfy original field',async()=>{
 const target=intercepted(await open(),async()=>{await applied({field:fields[3],text:f.text});await page.locator('#opts-style').evaluate(el=>el.hidden=true);await page.locator('#'+f.containerId+' input').evaluate(el=>el.setAttribute('aria-expanded','false'));await page.locator('#'+f.containerId+' .next-select-single').evaluate(el=>el.setAttribute('aria-expanded','false'));throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert.equal(clicks,1);
});
test('changed field kind, duplicate control or duplicate container fails closed',async()=>{
 for(const [mutation,expected] of [[async()=>page.locator('#'+f.containerId).evaluate(el=>el.append(document.createElement('select'))),/ATTRIBUTE_MAPPING_CHANGED/],[async()=>page.locator('#'+f.containerId+' input').evaluate(el=>el.after(el.cloneNode(true))),/ATTRIBUTE_CONTROL_NOT_UNIQUE/],[async()=>page.locator('#'+f.containerId).evaluate(el=>el.after(el.cloneNode(true))),/无法唯一识别属性：款式/]]){
  await page.setContent(fixture());const target=intercepted(await open(),async()=>{await applied();await mutation();throw timeout();});await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),expected);
 }assert.equal(clicks,3);assert.deepEqual(events,[]);
});
test('changed original field label fails despite correct-looking value',async()=>{
 const target=intercepted(await open(),async()=>{await applied();await page.locator('#'+f.containerId).evaluate(el=>el.parentElement.querySelector('label').textContent='其他属性');throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/无法唯一识别属性/);assert.equal(clicks,1);
});
test('page URL change after click stops result reconciliation',async()=>{
 const target=intercepted(await open(),async()=>{await applied();await page.evaluate(()=>location.hash='different-form');throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/ATTRIBUTE_FORM_CHANGED/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('CAPTCHA visible after applied click stops without treating effect as success',async()=>{
 const target=intercepted(await open(),async()=>{await applied();await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<aside>请拖动滑块</aside>'));throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/PAUSED_CAPTCHA/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('explicit guard failure after effect is preserved and prevents event',async()=>{
 let stopped=false;const target=intercepted(await open(),async()=>{await applied();stopped=true;throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,async()=>{if(stopped)throw Error('USER_PAUSE');},opts()),/USER_PAUSE/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('final repeated read detects field mutation during last guard',async()=>{
 let n=0;const target=intercepted(await open(),async()=>{await applied();throw timeout();});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,async()=>{if(++n===4)await applied({text:'changed'});},opts()),/ATTRIBUTE_SELECTION_CHANGED/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('non-timeout errors are not swallowed even if selected value is correct',async()=>{
 const target=intercepted(await open(),async()=>{await applied();throw Error('TARGET_CLOSED');});
 await assert.rejects(clickCustomAttributeAndVerify(page,target,f,guard,opts()),/TARGET_CLOSED/);assert.equal(clicks,1);assert.deepEqual(events,[]);
});
test('all five frozen custom attributes fill then already-correct values do not reopen',async()=>{
 const task={business:{brand:NO_BRAND},publishVariant:{version:1,attributes:fields}};const before=JSON.stringify(task);const steps=[];
 await fillAttributes(page,task,{guard,step:async(name,fn)=>{steps.push(name);await fn();},onEvent:async e=>events.push(e)});
 assert.equal(await page.evaluate(()=>window.nativeClicks),5);assert.equal(steps.length,5);assert.equal(JSON.stringify(task),before);
 await page.locator('input').evaluateAll(inputs=>inputs.forEach(input=>input.onclick=()=>{window.unexpectedOpen=true;}));
 await fillAttributes(page,task,{guard,step:async(_,fn)=>fn()});assert.equal(await page.evaluate(()=>!!window.unexpectedOpen),false);assert.equal(await page.evaluate(()=>window.nativeClicks),5);assert.deepEqual(events,[]);
});
test('already selected value with open menu cannot bypass natural-close requirement',async()=>{
 await open();await applied({close:false});await assert.rejects(clickCustomAttributeAndVerify(page,null,f,guard,opts()),/ATTRIBUTE_SELECTION_MISMATCH/);assert(await page.locator('#opts-style').isVisible());assert.deepEqual(events,[]);
});
