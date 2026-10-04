// Only confirmed, frozen selections are applied. Discovery never selects an option.
import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
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
function options(page){return page.locator('.options-item:visible,[role="option"]:visible');}
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
async function closeOptions(page,input,guard){await guard();if(await options(page).count()){await input.press('Escape');await guard();await expect(options(page)).toHaveCount(0);}}
async function readCustom(input,field){
  if(await input.evaluate(el=>el.tagName==='INPUT'))await expect(input).toHaveValue(field.text);else await expect(input).toHaveText(field.text);
  const value=await input.getAttribute('data-value');if(value!==null)assert.equal(value,field.value,'已选属性标识不一致：'+field.label);
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

export async function fillAttributes(page,task,{guard,step}){
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
        const current=await input.evaluate(el=>el.tagName==='INPUT'?el.value:el.textContent.trim());
        if(current===f.text){await readCustom(input,f);await guard();return;}
          await openOptions(page,f,guard);
          // Some option nodes carry the text themselves rather than a child span.
          const choices=await options(page).all();let target;
          for(const choice of choices)if((await choice.innerText()).trim()===f.text){assert(!target,'原属性选项不唯一：'+f.label);target=choice;}
          assert(target,'原属性选项已失效：'+f.label);assert(await target.getAttribute('aria-disabled')!=='true'&&!await target.evaluate(e=>e.classList.contains('disabled')),'原属性选项已禁用：'+f.label);
          assert.equal(await target.getAttribute('data-value')||f.text,f.value,'原属性选项标识已变化：'+f.label);
          await guard();await target.click();
          await guard();await readCustom(input,f);await closeOptions(page,input,guard);
      }
      await guard();
    });
  }
  await verifyAttributes(page,task,guard);
}
