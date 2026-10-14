// Only confirmed, frozen selections are applied. Discovery never selects an option.
import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {visibleChallenge} from './browser-environment.mjs';
import {setTimeout as delay} from 'node:timers/promises';
export const ATTRIBUTE_FIELDS = Object.freeze({pattern:'图案',size:'尺寸',style:'款式',subject:'科目',people:'适用人数'});
export const NO_BRAND = '无品牌/无注册商标';

export function validateSelections(task) {
  if (!task.publishVariant) return;
  const v=task.publishVariant;
  assert.equal(v.version,1,'RANDOM_RULE_VERSION');
  assert.equal(task.business.brand,NO_BRAND,'RANDOM_BRAND_MISMATCH');
  assert.equal(v.attributes?.length,5,'RANDOM_ATTRIBUTES_INCOMPLETE');
  assert.equal(new Set(v.attributes.map(a=>a.key)).size,5,'RANDOM_ATTRIBUTES_DUPLICATE');
  for(const a of v.attributes){
    assert(ATTRIBUTE_FIELDS[a.key]===a.label && /^struct-p-\d+$/.test(a.containerId),'RANDOM_ATTRIBUTE_MAPPING');
    assert(['native','custom'].includes(a.kind)&&typeof a.value==='string'&&a.value.length>0&&typeof a.text==='string'&&a.text.length>0,'RANDOM_ATTRIBUTE_VALUE');
  }
}

export async function discoverFields(page) {
  const fields=await page.evaluate(names=>{
    const out=[];
    for(const [key,label] of Object.entries(names)){
      const ids=new Set();
      for(const el of document.querySelectorAll('label,span,div')){
        if(el.children.length || el.textContent.trim().replace(/^[*＊]\s*/,'')!==label)continue;
        let scope=el;
        for(let depth=0;scope&&depth<5;depth++,scope=scope.parentElement){
          const controls=[...(scope.matches('[id^="struct-p-"]')?[scope]:[]),...scope.querySelectorAll('[id^="struct-p-"]')]
            .filter(n=>/^struct-p-\d+$/.test(n.id)&&n.querySelector('input,select,[role="combobox"]'));
          if(controls.length===1){ids.add(controls[0].id);break;}
          if(controls.length>1)break;
        }
      }
      if(ids.size!==1)throw Error('无法唯一识别属性：'+label+'；请保留发布页并人工检查');
      const containerId=[...ids][0],el=document.getElementById(containerId);
      out.push({key,label,containerId,kind:el.querySelector('select')?'native':'custom'});
    }
    return out;
  },ATTRIBUTE_FIELDS);
  return fields;
}

function control(page,field){return page.locator('#'+field.containerId).locator(field.kind==='native'?'select':'input:not([type="hidden"]),[role="combobox"]').first();}
function options(page){
  // Taobao's fixed section navigation also uses listbox/option roles. It is not
  // an attribute popup; keep rejecting all other visible option lists.
  return page.locator(':is(.options-item,[role="option"]):visible:not(#struct-nav *):not(.sell-component-navigation-bar *)');
}
async function openOptions(page,field,guard){
  await guard();const input=control(page,field);await expect(input).toBeVisible();await expect(input).toBeEnabled();
  assert.equal(await options(page).count(),0,'页面已有其他候选列表，请人工关闭后重新读取');
  await input.click();
  await expect.poll(()=>options(page).count(),{timeout:8000}).toBeGreaterThan(0);await guard();
  const owned=await input.getAttribute('aria-controls')||await input.getAttribute('aria-owns');
  await options(page).evaluateAll((nodes,owned)=>{
    const roots=new Set(nodes.map(n=>n.closest('[role="listbox"],.next-menu,.options-list')||n.parentElement));
    if(roots.size!==1)throw Error('无法唯一识别当前属性候选列表，请人工确认');
    if(owned){const root=document.getElementById(owned);if(!root||nodes.some(n=>!root.contains(n)))throw Error('属性候选列表归属不匹配，请人工确认');}
    const root=[...roots][0];
    if(root.querySelector('[aria-setsize]')||nodes.some(n=>Number(n.getAttribute('aria-setsize'))>nodes.length)||root.scrollHeight>root.clientHeight+4)throw Error('属性列表需要滚动，当前版本无法确认全部候选，请人工检查');
  },owned);
  return input;
}
async function closeOptions(page,input,guard){
  await guard();
  if(await options(page).count()){
    // The live Taobao select exposes its open state but does not handle Escape.
    // Its own trigger closes it without choosing a value. Other controls keep
    // the existing keyboard path; never click an arbitrary blank coordinate.
    if(await input.getAttribute('aria-expanded')==='true')await input.click();
    else await input.press('Escape');
    await guard();await expect(options(page)).toHaveCount(0);
  }
}
// Fusion Select renders the selection in a sibling <em>; its readonly search
// input stays empty. Read only the owning control, never popup/placeholder text.
export function selectedCustomState(el){
  const select=el.closest('.next-select-single');
  const visible=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
  const labels=select?[...select.querySelectorAll('.next-select-values > em')].filter(visible):[];
  const text=select?(labels.length===1?labels[0].textContent.trim():''):(el.tagName==='INPUT'?el.value:el.textContent.trim());
  const values=[el,...labels].map(n=>n.getAttribute('data-value')).filter(v=>v!==null);
  const announced=el.getAttribute('aria-valuetext');
  const committed=select?labels.length===1:el.tagName==='INPUT'&&el.readOnly&&el.getAttribute('role')==='combobox'&&el.hasAttribute('data-value');
  return {text,values,ambiguous:labels.length>1,conflicting:!!announced&&!!text&&announced.trim()!==text,committed};
}

// A custom option may take effect even if Playwright's single click times out.
// Only the original control's committed value and naturally closed menu count;
// a search string, popup label, closed-by-us menu or timeout is never success.
export async function clickCustomAttributeAndVerify(page,target,field,guard,{onEvent=async()=>{},timeout=5000}={}){
  assert(field.kind==='custom'&&ATTRIBUTE_FIELDS[field.key]===field.label&&/^struct-p-\d+$/.test(field.containerId),'ATTRIBUTE_MAPPING_INVALID');
  assert(typeof field.text==='string'&&field.text&&typeof field.value==='string'&&field.value,'ATTRIBUTE_VALUE_INVALID');
  assert(Number.isFinite(timeout)&&timeout>0&&timeout<=5000,'ATTRIBUTE_READ_TIMEOUT_INVALID');
  const formUrl=page.url();
  const check=async()=>{await guard();if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');assert.equal(page.url(),formUrl,'ATTRIBUTE_FORM_CHANGED');};
  const fieldInput=async()=>{
    const actual=await discoverFields(page);
    assert(actual.some(a=>a.key===field.key&&a.containerId===field.containerId&&a.kind===field.kind),'ATTRIBUTE_MAPPING_CHANGED');
    const container=page.locator('#'+field.containerId);
    assert.equal(await container.count(),1,'ATTRIBUTE_CONTAINER_NOT_UNIQUE');
    const inputs=container.locator('input:not([type="hidden"]),[role="combobox"]');
    assert.equal(await inputs.count(),1,'ATTRIBUTE_CONTROL_NOT_UNIQUE');
    assert(await inputs.isVisible()&&await inputs.isEnabled(),'ATTRIBUTE_CONTROL_UNAVAILABLE');
    assert(await inputs.evaluate((el,id)=>{const owner=el.closest('[id^="struct-p-"]'),select=el.closest('.next-select-single');return owner?.id===id&&(!select||owner.contains(select));},field.containerId),'ATTRIBUTE_SELECTION_OWNER_CHANGED');
    return inputs;
  };
  const read=async()=>{
    const input=await fieldInput(),state=await input.evaluate(selectedCustomState);
    const expanded=await input.evaluate(el=>el.getAttribute('aria-expanded')==='true'||el.closest('.next-select-single')?.getAttribute('aria-expanded')==='true');
    const menuClosed=!expanded&&await options(page).count()===0;
    assert.equal(page.url(),formUrl,'ATTRIBUTE_FORM_CHANGED');
    return {state,menuClosed,matches:state.committed&&!state.ambiguous&&!state.conflicting&&state.text===field.text&&state.values.every(v=>v===field.value)};
  };
  await check();await fieldInput();
  let clickTimeout=null;
  if(target){
    assert.equal(await target.count(),1,'ATTRIBUTE_OPTION_NOT_UNIQUE');
    assert((await target.innerText()).trim()===field.text,'ATTRIBUTE_OPTION_CHANGED');
    assert.equal(await target.getAttribute('data-value')||field.text,field.value,'ATTRIBUTE_OPTION_CHANGED');
    assert(await target.getAttribute('aria-disabled')!=='true'&&!await target.evaluate(e=>e.classList.contains('disabled')),'ATTRIBUTE_OPTION_DISABLED');
    await check();
    try{await target.click();}catch(error){if(error.name!=='TimeoutError')throw error;clickTimeout=error;}
  }
  let final;
  try{
    const deadline=Date.now()+timeout;
    do{
      await check();const result=await read();
      if(result.matches&&result.menuClosed){
        await check();final=await read();
        assert(final.matches&&final.menuClosed,'ATTRIBUTE_SELECTION_CHANGED');
        break;
      }
      if(Date.now()>=deadline)throw Error('ATTRIBUTE_SELECTION_MISMATCH：已选属性或菜单状态未确认：'+field.label);
      await delay(Math.min(100,deadline-Date.now()));
    }while(true);
  }catch(error){if(clickTimeout)error.attributeClickTimeout=clickTimeout.message;throw error;}
  if(clickTimeout)await onEvent({kind:'ATTRIBUTE_CLICK_TIMEOUT_RECONCILED',field:{key:field.key,label:field.label,containerId:field.containerId,kind:field.kind,value:field.value,text:field.text},actual:final.state,menuClosed:final.menuClosed,clickCount:1,clickRepeated:false,originalError:clickTimeout.message});
}
async function readCustom(input,field){
  await expect.poll(async()=>{
    const s=await input.evaluate(selectedCustomState);
    return !s.ambiguous&&!s.conflicting&&s.text===field.text&&s.values.every(v=>v===field.value);
  },{timeout:5000,message:'ATTRIBUTE_SELECTION_MISMATCH：已选属性回读不一致：'+field.label}).toBe(true);
}

export async function captureAttributes(page,guard){
  await guard();const fields=await discoverFields(page);
  for(const f of fields){
    await guard();const input=control(page,f);await expect(input).toBeVisible();await expect(input).toBeEnabled();
    if(f.kind==='native'){
      f.options=await input.locator('option').evaluateAll(es=>es.filter(e=>!e.disabled&&e.value).map(e=>({value:e.value,text:e.textContent.trim()})));
    }else{
      await openOptions(page,f,guard);
      f.options=await options(page).evaluateAll(es=>es.filter(e=>e.getAttribute('aria-disabled')!=='true'&&!e.classList.contains('disabled')).map(e=>({value:e.getAttribute('data-value')||e.textContent.trim(),text:e.textContent.trim()})));
      await closeOptions(page,input,guard);
    }
    // A comma-separated option is one option; never split a label into invented values.
    f.options=f.options.filter(o=>o.text&&o.text!=='请选择');
    assert(f.options.length>0,'属性没有可用选项：'+f.label);
    assert(new Set(f.options.map(o=>o.text)).size===f.options.length,'属性选项重名，请人工确认：'+f.label);
  }
  await guard();return fields;
}

export async function verifyAttributes(page,task,guard=async()=>{}){
  if(!task.publishVariant)return;
  validateSelections(task);await guard();const actual=await discoverFields(page);
  for(const f of task.publishVariant.attributes){
    assert(actual.some(a=>a.key===f.key&&a.containerId===f.containerId&&a.kind===f.kind),'属性页面已变化：'+f.label);
    const input=control(page,f);await expect(input).toBeVisible();
    if(f.kind==='native') {await expect(input).toHaveValue(f.value);await expect(input.locator('option:checked')).toHaveText(f.text);}
    else await readCustom(input,f);
  }
  await guard();
}

export async function fillAttributes(page,task,{guard,step,onEvent=async()=>{}}){
  if(!task.publishVariant)return;
  validateSelections(task);await guard();const actual=await discoverFields(page);
  for(const f of task.publishVariant.attributes){
    assert(actual.some(a=>a.key===f.key&&a.containerId===f.containerId&&a.kind===f.kind),'属性页面已变化：'+f.label);
    await step('attribute-'+f.key,async()=>{
      await guard();const input=control(page,f);
      if(f.kind==='native'){
        const available=await input.locator('option').evaluateAll(es=>es.filter(e=>!e.disabled).map(e=>({value:e.value,text:e.textContent.trim()})));
        assert(available.some(o=>o.value===f.value&&o.text===f.text),'原属性选项已失效：'+f.label);
        await input.selectOption({value:f.value});await expect(input).toHaveValue(f.value);
        await expect(input.locator('option:checked')).toHaveText(f.text);
      }else{
        const current=await input.evaluate(selectedCustomState);
        if(current.text===f.text){await clickCustomAttributeAndVerify(page,null,f,guard,{onEvent});return;}
          await openOptions(page,f,guard);
          // Some option nodes carry the text themselves rather than a child span.
          const choices=await options(page).all();let target;
          for(const choice of choices)if((await choice.innerText()).trim()===f.text){assert(!target,'原属性选项不唯一：'+f.label);target=choice;}
          assert(target,'原属性选项已失效：'+f.label);assert(await target.getAttribute('aria-disabled')!=='true'&&!await target.evaluate(e=>e.classList.contains('disabled')),'原属性选项已禁用：'+f.label);
          assert.equal(await target.getAttribute('data-value')||f.text,f.value,'原属性选项标识已变化：'+f.label);
          await clickCustomAttributeAndVerify(page,target,f,guard,{onEvent});
      }
      await guard();
    });
  }
  await verifyAttributes(page,task,guard);
}
