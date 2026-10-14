// Isolated browser fixtures reproduce the inspected 2026-10-07 DOM structure.
// No production Chrome, credentials, network requests, or seller uploads.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {ATTRIBUTE_FIELDS,NO_BRAND,captureAttributes,fillAttributes,verifyAttributes,selectedCustomState} from '../publishing-attributes.mjs';
import {openMaterialUpload,uploadMaterial,verifyUploadPreferences} from '../publishing-materials.mjs';
import {fillStableInventory} from '../taobao-publisher.mjs';
let browser,context,page;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext();await context.route('**/*',r=>r.abort());page=await context.newPage();});
after(async()=>{await context?.close();await browser?.close();});
const fieldFixture=()=>Object.entries(ATTRIBUTE_FIELDS).map(([key,label],i)=>`<section><label>${label}</label><div id="struct-p-${101+i}"><span class="next-select next-select-single"><span class="next-select-values"><span class="next-select-trigger-search"><input role="combobox" readonly aria-expanded="false" aria-controls="opts-${i}" onclick="const list=document.getElementById('opts-${i}');list.hidden=!list.hidden;this.setAttribute('aria-expanded',String(!list.hidden));"><span aria-hidden="true">请选择</span></span></span></span><div role="listbox" id="opts-${i}" hidden>${['a','b'].map(v=>`<div role="option" data-value="${v}" onclick="const c=this.closest('[id^=struct-p-]'),vs=c.querySelector('.next-select-values');vs.querySelector('em')?.remove();vs.insertAdjacentHTML('afterbegin','<em title=&quot;${key} ${v}&quot;>${key} ${v}</em>');c.querySelector('input').setAttribute('aria-expanded','false');this.parentElement.hidden=true;">${key} ${v}</div>`).join('')}</div></div></section>`).join('');
const prepare=async()=>{await page.setContent(fieldFixture());const fields=await captureAttributes(page,async()=>{});return {business:{brand:NO_BRAND},publishVariant:{version:1,attributes:fields.map(f=>({...f,...f.options[0]}))}};};
const fill=task=>fillAttributes(page,task,{guard:async()=>{},step:async(_,fn)=>fn()});

test('real-style selected sibling text verifies all five attributes with empty inputs',async()=>{
 const task=await prepare();await fill(task);await verifyAttributes(page,task);
 assert.deepEqual(await page.locator('input').evaluateAll(es=>es.map(e=>e.value)),['','','','','']);
 assert.deepEqual(await page.locator('em').allTextContents(),Object.keys(ATTRIBUTE_FIELDS).map(k=>k+' a'));
 // An already-correct value must not be rerandomized or require opening a list.
 await page.locator('input').evaluateAll(es=>es.forEach(e=>e.onclick=()=>{throw Error('must not reopen');}));await fill(task);
});
test('placeholder, matching popup option, and search input cannot masquerade as selected value',async()=>{
 const task=await prepare();const f=task.publishVariant.attributes[0];
 await page.locator('#struct-p-101 input').evaluate(el=>{el.value='pattern a';});
 assert.equal((await page.locator('#struct-p-101 input').evaluate(selectedCustomState)).text,'');
 await assert.rejects(verifyAttributes(page,task),/ATTRIBUTE_SELECTION_MISMATCH/);
});
test('wrong selected ID or contradictory aria value fails even when selected label matches',async()=>{
 const task=await prepare();await fill(task);
 await page.locator('#struct-p-101 em').evaluate(e=>e.dataset.value='wrong');await assert.rejects(verifyAttributes(page,task),/ATTRIBUTE_SELECTION_MISMATCH/);
 await page.locator('#struct-p-101 em').evaluate(e=>e.removeAttribute('data-value'));
 await page.locator('#struct-p-101 input').evaluate(e=>e.setAttribute('aria-valuetext','pattern b'));await assert.rejects(verifyAttributes(page,task),/ATTRIBUTE_SELECTION_MISMATCH/);
});
test('ambiguous selected labels or lost original option do not silently pass',async()=>{
 const task=await prepare();await fill(task);await page.locator('#struct-p-101 em').evaluate(e=>e.after(e.cloneNode(true)));
 await assert.rejects(verifyAttributes(page,task),/ATTRIBUTE_SELECTION_MISMATCH/);
 const fresh=await prepare();fresh.publishVariant.attributes[0].value='obsolete';await assert.rejects(fill(fresh),/选项标识已变化/);
});

function materialFixture({ignoreFirst=false,neverOpen=false,duplicate=false,watermark=false,autoClose=false,missing=false}={}){
 return `<input type="file" id="outside"><button onclick="window.opens=(window.opens||0)+1;if(${neverOpen}||(${ignoreFirst}&&window.opens===1))return;document.querySelector('[role=dialog]').hidden=false">上传文件</button><section role="dialog" aria-label="上传素材" hidden><h2>上传素材</h2><label><input type="checkbox" ${watermark?'checked':''}>添加水印</label><label><input type="checkbox" checked>原图上传</label><label><input type="checkbox" ${autoClose?'checked':''}>上传后自动关闭</label><div id="sucai-tu-upload-pannel">${missing?'':`<input type="file" id="native-new-id" accept="image/png" onchange="window.uploads=(window.uploads||0)+1;document.querySelector('#receipt').textContent='1 个文件上传成功'">`}${duplicate?'<input type="file">':''}</div><p id="receipt">0 个文件上传中...</p><button>完成</button></section>`;
}
const file={name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')};
test('upload uses unique native file input inside verified dialog without legacy button ID',async()=>{
 await page.setContent(materialFixture());await page.evaluate(()=>{window.opens=0;window.uploads=0;});
 await uploadMaterial(page,file,async()=>{});
 assert.equal(await page.locator('#outside').evaluate(e=>e.files.length),0);
 assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files[0].name),'fixture.png');
 assert.equal(await page.evaluate(()=>window.uploads),1);
});

test('official upload dialog can change its labelled title to upload result after native success',async()=>{
 await page.setContent(materialFixture());await page.evaluate(()=>{
  window.uploads=0;const d=document.querySelector('[role=dialog]');d.removeAttribute('aria-label');d.setAttribute('aria-labelledby','upload-title');d.querySelector('h2').id='upload-title';
  document.querySelector('#native-new-id').addEventListener('change',()=>{d.querySelector('h2').textContent='上传结果';document.querySelector('#native-new-id').value='';});
  d.querySelector('button').onclick=()=>d.hidden=true;
 });
 const result=await uploadMaterial(page,file,async()=>{});assert.equal(await page.evaluate(()=>window.uploads),1);
 assert.equal(await result.getAttribute('aria-labelledby'),'upload-title');assert.match(await result.innerText(),/1 个文件上传成功/);
 await result.getByRole('button',{name:'完成',exact:true}).click();assert.equal(await result.isVisible(),false);
});

test('an old upload-result receipt is not treated as a new native upload',async()=>{
 await page.setContent(materialFixture());await page.evaluate(()=>{window.uploads=0;const d=document.querySelector('[role=dialog]');d.hidden=false;d.setAttribute('aria-label','上传结果');document.querySelector('#receipt').textContent='1 个文件上传成功';});
 await assert.rejects(uploadMaterial(page,file,async()=>{}),/MATERIAL_UPLOAD_BUSY/);assert.equal(await page.evaluate(()=>window.uploads),0);
});
test('initial lost click retries opening once, not the upload',async()=>{
 await page.setContent(materialFixture({ignoreFirst:true}));await page.evaluate(()=>{window.opens=0;window.uploads=0;});
 const {input}=await openMaterialUpload(page,async()=>{},{timeout:100});assert.equal(await page.evaluate(()=>window.opens),2);assert.equal(await input.evaluate(e=>e.files.length),0);
});
test('persistently missing dialog stops after two open attempts',async()=>{
 await page.setContent(materialFixture({neverOpen:true}));await page.evaluate(()=>window.opens=0);
 await assert.rejects(openMaterialUpload(page,async()=>{},{timeout:100}),/MATERIAL_UPLOAD_NOT_READY/);assert.equal(await page.evaluate(()=>window.opens),2);
});
test('wrong popup, ambiguous native input, and missing input block uploading',async()=>{
 await page.setContent(materialFixture()+'<section role="dialog">Another popup</section>');await assert.rejects(openMaterialUpload(page,async()=>{},{timeout:100}),/MATERIAL_UPLOAD_BLOCKED/);
 for(const settings of [{duplicate:true},{missing:true}]){await page.setContent(materialFixture(settings));await assert.rejects(openMaterialUpload(page,async()=>{},{timeout:100}),/MATERIAL_UPLOAD_INPUT/);}
});
test('watermark or auto-close setting cannot be silently changed or bypassed',async()=>{
 for(const settings of [{watermark:true},{autoClose:true}]){await page.setContent(materialFixture(settings));await assert.rejects(openMaterialUpload(page,async()=>{},{timeout:100}),/MATERIAL_UPLOAD_PREFERENCES/);assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),0);}
});

test('observed nested watermark Settings button is part of name; upload is still exact and scoped',async()=>{
 await page.setContent(materialFixture());await page.locator('label').first().evaluate(el=>{el.innerHTML='<span class="next-checkbox"><input id="watermark" type="checkbox" aria-checked="false" class="next-checkbox-input"></span><span class="next-checkbox-label"><div><span>添加水印</span><button type="button"><span>设置</span></button></div></span>';});
 await page.locator('body').evaluate(el=>el.insertAdjacentHTML('beforeend','<label><input type="checkbox" checked>添加水印</label>'));
 await page.getByRole('button',{name:'上传文件',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'上传素材',exact:true});
 assert.equal(await dialog.getByLabel('添加水印',{exact:true}).count(),0);
 await uploadMaterial(page,file,async()=>{});
 assert.equal(await page.locator('#watermark').isChecked(),false);assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),1);
});

test('real CSS-generated icon prefixes break accessible names but do not hide native checkbox state',async()=>{
 await page.setContent(materialFixture()+`<style>.next-icon:before{content:'\\e632'}.next-checkbox-input{opacity:0;width:18px;height:18px}</style>`);
 await page.locator('label').evaluateAll(es=>es.forEach((el,i)=>{
  const input=el.querySelector('input');input.className='next-checkbox-input';input.setAttribute('aria-checked',String(input.checked));
  el.prepend(Object.assign(document.createElement('i'),{className:'next-icon'}));
  if(i===0)el.insertAdjacentHTML('beforeend','<button type="button">设置</button>');
 }));
 await page.getByRole('button',{name:'上传文件',exact:true}).click();const d=page.getByRole('dialog',{name:'上传素材',exact:true});
 for(const name of [/^添加水印(?:\s*设置)?$/,'原图上传','上传后自动关闭'])assert.equal(await d.getByRole('checkbox',{name,exact:true}).count(),0);
 assert.match(await d.ariaSnapshot(),/ 添加水印 设置/);
 await verifyUploadPreferences(d);await uploadMaterial(page,file,async()=>{});
 assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),1);
});

test('preference verifier rejects ambiguous, absent, fake and contradictory controls without changing them',async()=>{
 for(const mutation of [
  d=>d.insertAdjacentHTML('beforeend','<label><input type="checkbox">添加水印</label>'),
  d=>d.querySelector('label').remove(),
  d=>{d.querySelector('label').remove();d.insertAdjacentHTML('beforeend','<span role="checkbox" type="checkbox" aria-label="添加水印" aria-checked="false"></span>');},
  d=>d.querySelector('input[type=checkbox]').setAttribute('aria-checked','true'),
  d=>{d.querySelector('input[type=checkbox]').indeterminate=true;},
  d=>{d.querySelectorAll('input[type=checkbox]')[1].checked=false;}
  ,d=>d.querySelector('label').insertAdjacentHTML('beforeend','<input type="checkbox">')
  ,d=>{d.querySelector('label').style.display='none';}
 ]){
  await page.setContent(materialFixture());await page.evaluate(()=>window.uploads=0);await page.getByRole('button',{name:'上传文件',exact:true}).click();const d=page.getByRole('dialog',{name:'上传素材',exact:true});await d.evaluate(mutation);
  const before=await d.locator('input[type=checkbox]').evaluateAll(es=>es.map(e=>e.checked));
  await assert.rejects(verifyUploadPreferences(d,{timeout:100}),/MATERIAL_UPLOAD_PREFERENCES/);
  assert.deepEqual(await d.locator('input[type=checkbox]').evaluateAll(es=>es.map(e=>e.checked)),before);assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),0);assert.equal(await page.evaluate(()=>window.uploads||0),0);
 }
});

test('upload failure diagnostics distinguish locator mismatch from checked state without writing controls',async()=>{
 await page.setContent(materialFixture({watermark:true}));await page.getByRole('button',{name:'上传文件',exact:true}).click();
 await assert.rejects(verifyUploadPreferences(page.getByRole('dialog'),{timeout:100}),e=>e.uploadDiagnostic?.stage==='native-state'&&e.uploadDiagnostic.state.checked===true);
});

function stockFixture(behavior='none'){
 return `<section id="sell-field-batchInventory-card"><input value="1" oninput="window.stockInputs=(window.stockInputs||0)+1" onblur="if('${behavior}'==='always'||('${behavior}'==='once'&&window.stockInputs===1))this.value='1';if('${behavior}'==='delayed')setTimeout(()=>this.value='1',120);if('${behavior}'==='replace'&&window.stockInputs===1)this.replaceWith(this.cloneNode(true));"></section>`;
}
test('stock value must survive blur and a stable read window; one same-value refill is bounded',async()=>{
 for(const behavior of ['none','once','replace']){
  await page.setContent(stockFixture(behavior));await page.evaluate(()=>window.stockInputs=0);
  const result=await fillStableInventory(page,'999999',async()=>{},{settleMs:200,timeout:600});
  assert.equal(result.attempts,behavior==='once'?2:1);assert.equal(await page.locator('input').inputValue(),'999999');
 }
});
test('stock rollback on blur or after delay fails without weakening expected value',async()=>{
 for(const behavior of ['always','delayed']){
  await page.setContent(stockFixture(behavior));await page.evaluate(()=>window.stockInputs=0);
  await assert.rejects(fillStableInventory(page,'999999',async()=>{},{settleMs:200,timeout:500}),/FORM_INVENTORY_UNSTABLE/);
  assert.equal(await page.evaluate(()=>window.stockInputs),2);assert.equal(await page.locator('input').inputValue(),'1');
 }
});
test('stock recovery stops on guard failure before a second write',async()=>{
 await page.setContent(stockFixture('always'));await page.evaluate(()=>window.stockInputs=0);
 let reads=0;
 await assert.rejects(fillStableInventory(page,'999999',async()=>{if(++reads===4)throw Error('PAUSED_CAPTCHA');},{settleMs:200,timeout:500}),/PAUSED_CAPTCHA/);
 assert.equal(await page.evaluate(()=>window.stockInputs),1);
});
test('duplicate or disabled stock controls and invalid frozen values stop before filling',async()=>{
 for(const html of ['<input value="1"><input value="1">','<input value="1" disabled>']){
  await page.setContent('<section id="sell-field-batchInventory-card">'+html+'</section>');
  await assert.rejects(fillStableInventory(page,'999999',async()=>{}));
  assert.deepEqual(await page.locator('input').evaluateAll(es=>es.map(e=>e.value)),html.includes('disabled')?['1']:['1','1']);
 }
 await assert.rejects(fillStableInventory(page,'',async()=>{}),/INVALID_FROZEN_INVENTORY/);
});
test('CAPTCHA guard prevents upload and existing pending file is not replaced',async()=>{
 await page.setContent(materialFixture());await assert.rejects(uploadMaterial(page,file,async()=>{throw Error('PAUSED_CAPTCHA');}),/PAUSED_CAPTCHA/);assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),0);
 const {input}=await openMaterialUpload(page,async()=>{});await input.setInputFiles(file);
 await assert.rejects(uploadMaterial(page,{...file,name:'replacement.png'},async()=>{}),/MATERIAL_UPLOAD_BUSY/);assert.equal(await input.evaluate(e=>e.files[0].name),'fixture.png');
});
test('stale success receipt or leftover file row cannot verify a new upload',async()=>{
 for(const old of ['1 个文件上传成功','1 个文件上传中...','1 个文件上传失败']){
  await page.setContent(materialFixture());await page.locator('#receipt').evaluate((el,text)=>el.textContent=text,old);
  await assert.rejects(uploadMaterial(page,file,async()=>{}),/MATERIAL_UPLOAD_BUSY/);assert.equal(await page.locator('#native-new-id').evaluate(e=>e.files.length),0);
 }
 await page.setContent(materialFixture());await page.locator('[role=dialog]').evaluate(e=>e.insertAdjacentHTML('beforeend','<div class="UploadPanel_uploadFileList__observed"><span>old-file.png</span></div>'));
 await assert.rejects(uploadMaterial(page,file,async()=>{}),/MATERIAL_UPLOAD_BUSY/);
});
