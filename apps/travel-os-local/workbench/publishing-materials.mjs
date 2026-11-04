import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {basename,extname} from 'node:path';
import {inspectNativeMaterialFiles,nativeUploadPath} from './material-native-files.mjs';

// Detail-only readiness budgets. Main-image callers retain their existing path.
export const DETAIL_MATERIAL_BUDGETS=Object.freeze({entry:20000,panel:8000,receipt:60000,thumbnail:30000,poll:150});
// Guard work is measured, never cached or raced. This bounded allowance is a
// candidate safety margin, not a measured platform latency percentile.
export const MATERIAL_GUARD_ALLOWANCE_MS=20000;
export function createMaterialReadinessBudget(timeout){
 assert(Number.isFinite(timeout)&&timeout>0&&timeout<=60000,'素材等待预算无效');
 const start=performance.now(),overallTimeoutMs=timeout+MATERIAL_GUARD_ALLOWANCE_MS;let guardMs=0;
 const snapshot=()=>{const elapsedMs=Math.max(0,performance.now()-start),observeMs=Math.max(0,elapsedMs-guardMs),round=x=>Math.round(x*1000)/1000;return {timeoutMs:timeout,observationTimeoutMs:timeout,overallTimeoutMs,guardAllowanceMs:MATERIAL_GUARD_ALLOWANCE_MS,observeMs:round(observeMs),guardMs:round(guardMs),elapsedMs:round(elapsedMs),durationMs:round(elapsedMs),exceededByMs:round(Math.max(0,observeMs-timeout,elapsedMs-overallTimeoutMs))};};
 return {snapshot,guard:async fn=>{const began=performance.now();try{return await fn();}finally{guardMs+=Math.max(0,performance.now()-began);}},reason:()=>{const s=snapshot();return s.elapsedMs>=overallTimeoutMs?'OVERALL_GUARD_TIMEOUT':s.observeMs>=timeout?'OBSERVATION_TIMEOUT':null;},remaining:()=>{const s=snapshot();return Math.max(0,Math.min(timeout-s.observeMs,overallTimeoutMs-s.elapsedMs));}};
}
const detailTimeoutCodes=Object.freeze({'upload-entry':'SAFE_RETRY_DETAIL_UPLOAD_ENTRY','upload-panel':'SAFE_RETRY_DETAIL_UPLOAD_PANEL','upload-receipt':'SAFE_RETRY_DETAIL_UPLOAD_RECEIPT',thumbnail:'SAFE_RETRY_DETAIL_MATERIAL'});
// A structural clone of actual DOM, excluding text, URLs and all form values.
export async function materialDomSnippet(locator){
  return locator.evaluateAll(elements=>{
    const allowed=new Set(['class','role','type','disabled','hidden']);
    const copy=(element,depth)=>{const clone=element.cloneNode(false);for(const a of [...clone.attributes])if(!allowed.has(a.name))clone.removeAttribute(a.name);if(depth)for(const child of [...element.children].slice(0,6))clone.appendChild(copy(child,depth-1));return clone;};
    return elements.slice(0,2).map(el=>copy(el,2).outerHTML).join('\n').slice(0,1600)||null;
  }).catch(()=>null);
}
export async function waitMaterialReadiness(stage,inspect,guard,{timeout,selector,expected,onDiagnostic=async()=>{}}){
  const budget=createMaterialReadinessBudget(timeout);let actual=null,dom_snippet=null,status='failed',failure=null,timeoutReason=null;
  const diagnostic=()=>({stage,selector,expected,actual,count:actual?.matches??actual?.cards??actual?.hosts??null,visible:actual?.visible??null,decoded:actual?.decoded??null,dom_snippet,screenshot:null,status,...budget.snapshot(),timeoutReason});
  const checkDeadline=()=>{timeoutReason=budget.reason();if(timeoutReason){const d=diagnostic(),label=stage==='prepared-material-card'?'已准备图片':stage.startsWith('main')?'主图素材':Object.hasOwn(detailTimeoutCodes,stage)?'详情素材':'素材',reason=timeoutReason==='OBSERVATION_TIMEOUT'?'观察预算已用完':'包含安全检查的总等待预算已用完';const error=new Error(`${label}等待超时：${reason}；stage=${stage}；observeMs=${d.observeMs}；guardMs=${d.guardMs}；elapsedMs=${d.elapsedMs}；expected=${expected}；actual=${JSON.stringify(actual)}`);if(timeoutReason==='OVERALL_GUARD_TIMEOUT')error.code='MATERIAL_GUARD_BUDGET_EXHAUSTED';else if(Object.hasOwn(detailTimeoutCodes,stage))error.code=detailTimeoutCodes[stage];else if(stage==='prepared-material-card')error.code='MATERIAL_PREPARED_CARD_TIMEOUT';error.materialReadiness={...d,timedOut:true};throw error;}return budget.remaining();};
  try{
    for(;;){
      // Guard errors propagate unchanged: never turn CAPTCHA/identity failures
      // into a timeout, and never retry a click or an upload in this observer.
      await budget.guard(guard);
      if(budget.reason()==='OVERALL_GUARD_TIMEOUT')checkDeadline();
      const sample=await inspect();actual=sample.actual;dom_snippet=sample.dom_snippet||null;
      // Run the final fresh safety check before declaring either readiness or
      // timeout. Its original error wins even when the wall clock has expired.
      if(sample.ready||budget.reason()){await budget.guard(guard);checkDeadline();if(sample.ready){status='ready';return actual;}}
      const remaining=checkDeadline();
      await delay(Math.min(DETAIL_MATERIAL_BUDGETS.poll,remaining));
    }
  }catch(error){status='failed';failure=error;error.materialReadiness??=diagnostic();throw error;}
  finally{try{const d=failure?.materialReadiness||diagnostic();const evidence=await onDiagnostic(d);if(evidence)Object.assign(d,evidence);}catch{/* Evidence failure cannot replace the original readiness/guard result. */}}
}

export async function waitDetailThumbnail(card,guard,{timeout=DETAIL_MATERIAL_BUDGETS.thumbnail,onDiagnostic}={}){
  const image=card.locator('.PicList_pic_imgBox__c0HXw img, [class*="PicturesShow_pic_imgBox__"] img');
  return waitMaterialReadiness('thumbnail',async()=>{
    const cards=await card.count(),images=await image.count();
    const visible=cards===1&&await card.isVisible()&&images===1&&await image.isVisible();
    const state=images===1?await image.evaluateAll(es=>es.length===1?{complete:es[0].complete,naturalWidth:es[0].naturalWidth,naturalHeight:es[0].naturalHeight,hasSource:!!(es[0].currentSrc||es[0].getAttribute('src'))}:null):null;
    const actual={cards,images,visible,decoded:!!(state?.complete&&state.naturalWidth>0&&state.naturalHeight>0),...state};
    return {ready:visible&&state?.hasSource&&state.complete&&state.naturalWidth>0&&state.naturalHeight>0,actual,dom_snippet:await materialDomSnippet(card)};
  },guard,{timeout,selector:'.PicList_pic_imgBox__c0HXw img',expected:'唯一可见缩略图，complete=true 且 naturalWidth/naturalHeight>0',onDiagnostic});
}

export async function verifyUploadPreferences(dialog,{timeout=5000}={}){
  // Taobao's icon ::before also enters the accessible name. DOM label text
  // excludes generated glyphs; still require one visible label/native input.
  for(const [label,name,checked] of [
    ['添加水印',/^添加水印(?:\s*设置)?$/,false],
    ['原图上传','原图上传',true],
    ['上传后自动关闭','上传后自动关闭',false]
  ]){
    const text=typeof name==='string'?new RegExp('^'+name+'$'):name;
    const labels=dialog.locator('label:visible').filter({hasText:text});
    const checkbox=labels.locator('input[type=checkbox]');
    let diagnostic={label,expected:checked,stage:'locate-label'};
    try{
      diagnostic.labels=await labels.count();
      await expect(labels).toHaveCount(1,{timeout});
      diagnostic.stage='locate-checkbox';diagnostic.inputs=await checkbox.count();
      await expect(checkbox).toHaveCount(1,{timeout});
      diagnostic.stage='native-state';
      await expect(checkbox).toHaveAttribute('type','checkbox',{timeout});
      if(checked)await expect(checkbox).toBeChecked({timeout});
      else await expect(checkbox).not.toBeChecked({timeout});
      const state=await checkbox.evaluate(el=>({native:el.tagName==='INPUT'&&el.type==='checkbox',checked:el.checked,indeterminate:el.indeterminate,aria:el.getAttribute('aria-checked')}));
      diagnostic.state=state;
      assert(state.native&&state.checked===checked&&state.indeterminate===false,'CHECKBOX_NATIVE_STATE_REQUIRED');
      assert(state.aria===null||state.aria===String(checked),'CHECKBOX_STATE_CONFLICT');
    }catch(cause){
      diagnostic.inputs=await checkbox.count().catch(()=>null);
      if(diagnostic.inputs===1)diagnostic.state=await checkbox.evaluate(el=>({checked:el.checked,indeterminate:el.indeterminate,aria:el.getAttribute('aria-checked')})).catch(()=>null);
      const error=new Error(`MATERIAL_UPLOAD_PREFERENCES：${label}检查失败（${diagnostic.stage}，标签${diagnostic.labels}个、原生控件${diagnostic.inputs}个，应${checked?'勾选':'不勾选'}）；请保留上传弹窗核对，不要替换商品资料`,{cause});
      error.uploadDiagnostic=diagnostic;throw error;
    }
  }
}

// Match the official upload dialog before using its native file input. Never
// search the whole page for a historical button ID or assume a click opened it.
export async function openMaterialUpload(page,guard,{timeout=8000,readiness=null}={}){
  // The same official panel changes its accessible title to 上传结果 after
  // the native upload finishes. Keep its file-panel identity across both states.
  const dialog=page.getByRole('dialog',{name:/^(上传素材|上传结果)$/}).filter({has:page.locator('#sucai-tu-upload-pannel')});
  for(let attempt=0;attempt<2;attempt++){
    await guard();
    if(await dialog.isVisible().catch(()=>false))break;
    assert.equal(await page.locator('[role=dialog]:visible').count(),0,'MATERIAL_UPLOAD_BLOCKED：存在其他弹窗，请人工处理');
    const button=page.getByRole('button',{name:'上传文件',exact:true});
    if(readiness)await waitMaterialReadiness('upload-entry',async()=>{
      const count=await button.count(),visible=count===1&&await button.isVisible(),enabled=visible&&await button.isEnabled();
      return {ready:enabled,actual:{count,visible,enabled},dom_snippet:await materialDomSnippet(button)};
    },guard,{timeout:readiness.entryTimeout??DETAIL_MATERIAL_BUDGETS.entry,selector:'button[name="上传文件"]',expected:'唯一、可见且可用的上传文件按钮',onDiagnostic:readiness.onDiagnostic});
    else{await expect(button).toHaveCount(1);await expect(button).toBeEnabled();}
    if(readiness)await guard();await button.click();
    // One bounded reopen is safe only before any file has been selected. It
    // handles a first click lost while the material-center UI is initializing.
    if(readiness){
      try{
        await waitMaterialReadiness('upload-panel',async()=>{const count=await dialog.count(),visible=count===1&&await dialog.isVisible();return {ready:visible,actual:{dialogs:count,visible},dom_snippet:await materialDomSnippet(dialog)};},guard,{timeout,selector:'[role=dialog] #sucai-tu-upload-pannel',expected:'点击后出现唯一官方上传弹窗',onDiagnostic:readiness.onDiagnostic});
        break;
      }catch(error){if(error.code!=='SAFE_RETRY_DETAIL_UPLOAD_PANEL'||error.materialReadiness?.timeoutReason!=='OBSERVATION_TIMEOUT'||!error.materialReadiness.timedOut||error.materialReadiness.actual?.visible||attempt===1)throw error;}
    }else if(await dialog.waitFor({state:'visible',timeout}).then(()=>true).catch(()=>false))break;
    await guard();
    if(attempt===1)throw Error('MATERIAL_UPLOAD_NOT_READY：素材库上传弹窗未打开，整批暂停，请保留页面检查');
  }
  await guard();
  if(!readiness){await expect(dialog).toHaveCount(1);await expect(dialog).toBeVisible();}
  const input=dialog.locator('input[type=file]');
  if(readiness)await waitMaterialReadiness('upload-panel',async()=>{
    const dialogs=await dialog.count(),inputs=await input.count(),visible=dialogs===1&&await dialog.isVisible(),enabled=inputs===1&&await input.isEnabled();
    return {ready:visible&&enabled,actual:{dialogs,inputs,visible,enabled},dom_snippet:await materialDomSnippet(dialog)};
  },guard,{timeout,selector:'[role=dialog] #sucai-tu-upload-pannel input[type=file]',expected:'唯一官方上传弹窗及可用原生文件控件',onDiagnostic:readiness.onDiagnostic});
  else{await expect(input,{message:'MATERIAL_UPLOAD_INPUT：无法唯一识别当前上传控件'}).toHaveCount(1,{timeout});await expect(input).toBeEnabled();}
  assert.equal(await input.evaluate(el=>el.files.length),0,'MATERIAL_UPLOAD_BUSY：已有待上传文件，请先人工核对');
  const text=await dialog.innerText();
  const oldRows=await dialog.locator('[class*="UploadPanel_uploadFileList"] > *').count();
  assert(!oldRows&&!/(?:^|\s)[1-9]\d*\s*个文件/.test(text),'MATERIAL_UPLOAD_BUSY：上传弹窗有旧文件或旧回执，请先人工核对并关闭');
  // Do not silently alter persisted watermark/original-size preferences.
  await verifyUploadPreferences(dialog);
  return {dialog,input};
}

export async function uploadMaterial(page,path,guard,{readiness=null}={}){
  const {dialog,input}=await openMaterialUpload(page,guard,{readiness});
  await guard();await input.setInputFiles(path);
  if(readiness)await waitMaterialReadiness('upload-receipt',async()=>{
    const count=await dialog.count(),visible=count===1&&await dialog.isVisible();
    const text=visible?await dialog.innerText():'';
    const success=/(?:^|\s)1\s*个文件上传成功/.test(text),busyOrFailed=/(?:^|\s)[1-9]\d*\s*个文件(?:上传中|上传失败)/.test(text);
    return {ready:visible&&success&&!busyOrFailed,actual:{dialogs:count,visible,singleSuccess:success,busyOrFailed},dom_snippet:await materialDomSnippet(dialog)};
  },guard,{timeout:readiness.receiptTimeout??DETAIL_MATERIAL_BUDGETS.receipt,selector:'官方上传弹窗单张成功回执',expected:'1 个文件上传成功且无上传中或失败',onDiagnostic:readiness.onDiagnostic});
  else await expect.poll(async()=>{await guard();const text=await dialog.innerText();return /(?:^|\s)1\s*个文件上传成功/.test(text)&&!/(?:^|\s)[1-9]\d*\s*个文件(?:上传中|上传失败)/.test(text);},{timeout:60000,message:'MATERIAL_UPLOAD_RESULT：未取得单张上传成功回执，整批暂停'}).toBe(true);
  await guard();return dialog;
}

// Dedicated preparation adapter. The observed single-file route above remains
// unchanged. Bulk mode requires both native multiple support and per-file rows;
// no aggregate success counter can authorize a prepared-image receipt.
export function materialLookupNames(file){
 const full=file.name,ext=extname(full),cut=full.slice(0,50)+ext,index=full.lastIndexOf('--')+2,prefix=index>=2?full.slice(index,50):'';
 return {names:full.length>50&&full.endsWith('--'+file.sha256+ext)&&prefix.length>=20&&file.sha256.startsWith(prefix)?[full,cut]:[full],prefix,rule:'FIRST_50_PLUS_EXTENSION'};
}
export function createNativeMaterialUploadAdapter(page,baseGuard,{shopName,nativeProbe=inspectNativeMaterialFiles,lookupTimeout=8000,receiptTimeout=60000}={}){
 const check=async guard=>{await baseGuard();await guard();const u=new URL(page.url());assert(u.origin==='https://qn.taobao.com'&&u.pathname.replace(/\/$/,'')==='/home.htm/material-center/mine-material/sucai-tu','MATERIAL_PREPARATION_PAGE_MISMATCH');await expect(page.locator('div.shopName--x6nyUylx')).toHaveText(shopName,{useInnerText:true,timeout:8000});};
 const titleSelector='.PicList_tip_title__aQfti, [class*="PicturesShow_tooltipText__"]',imageSelector='.PicList_pic_imgBox__c0HXw img, [class*="PicturesShow_pic_imgBox__"] img',cardSelector='.PicList_pic_background__pGTdV, [class*="PicturesShow_PicturesShow_main-document-show__"]';
 const lookup=async(files,guard,{onReceipt=async()=>{},context,legacy=false}={})=>{
  const result=[],empty=new Map();let probe=null;const originals=context?.originalFiles||[];
  if(legacy&&process.platform==='win32'&&files.some(f=>f.path.length>=260)&&context?.batchIntents?.length===1&&!Object.hasOwn(context.batchIntents[0],'nativePathMode')&&!context.batchIntents[0].cancelledBeforeSelection&&originals.length===context.batchIntents[0].files.length&&new Set(originals.map(f=>f.name)).size===originals.length&&originals.every(f=>context.batchIntents[0].files.includes(f.name))){
   probe=await nativeProbe(page,originals,{guard:()=>check(guard),legacy:true});const raw=probe.trials.find(t=>t.mode==='original'),extended=probe.trials.find(t=>t.mode==='extended');
   for(const file of files){const a=raw.files.find(f=>f.name===file.name),b=extended.files.find(f=>f.name===file.name),disk=probe.disk.find(f=>f.name===file.name);
    if(file.path.length>=260&&a?.size===0&&['NotFoundError','NotReadableError'].includes(a.readError)&&b?.size===disk?.size&&b?.readBytes===disk?.size&&b?.sha256===file.sha256&&raw.sdkFiles.every(f=>f.name!==file.name)&&extended.sdkFiles.some(f=>f.name===file.name&&f.size===disk.size))empty.set(file.name,{raw:a,extended:b,disk});}
  }
  for(const file of files.filter(f=>!empty.has(f.name))){
   await check(guard);const names=materialLookupNames(file),materialName=names.names.at(-1),search=page.getByPlaceholder(/^(搜索图片名称|搜索图片\/文件夹)$/);await expect(search).toHaveCount(1);await search.fill(materialName);await search.press('Enter');
   let title=page.getByText(names.names[0],{exact:true});for(const name of names.names.slice(1))title=title.or(page.getByText(name,{exact:true}));
   const cards=page.locator(cardSelector).filter({has:title});let matched=false;
   try{await waitMaterialReadiness('bulk-material-card',async()=>{const count=await cards.count();assert(count<=1,'MATERIAL_PREPARATION_CARD_AMBIGUOUS：同名图片不唯一');return {ready:count===1,actual:{matches:count}};},()=>check(guard),{timeout:lookupTimeout,selector:'精确上传名图片卡片',expected:'唯一匹配图片'});matched=true;}catch(error){if(!legacy||!error.materialReadiness?.timedOut)throw error;}
   if(!matched){result.push({name:file.name,status:'NOT_FOUND'});continue;}
   const card=cards.first(),actualName=(await card.locator(titleSelector).innerText()).trim();assert(names.names.includes(actualName),'MATERIAL_PREPARATION_CARD_NAME_MISMATCH');await waitDetailThumbnail(card,()=>check(guard));const rawUrl=await card.locator(imageSelector).getAttribute('src'),u=new URL(rawUrl,page.url()),url=u.href;assert(u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(alicdn|taobaocdn)\.com$/.test(u.hostname),'MATERIAL_PREPARATION_PLATFORM_URL_MISSING');
   const platformId=await card.getAttribute('id'),intent=[...(context?.batchIntents||[])].reverse().find(b=>!b.cancelledBeforeSelection&&b.files.includes(file.name)),evidence=actualName===file.name?{kind:'EXACT_MATERIAL_CARD',name:file.name,url}:{kind:'TRUNCATED_SHA256_MATERIAL_CARD',expectedFullName:file.name,materialName:actualName,platformId,sha256:file.sha256,hashPrefix:names.prefix,rule:names.rule,visible:true,decoded:true,nameUnique:true,shopId:context?.shopId,jobId:context?.jobId,batchIntentAt:intent?.at,url};
   if(actualName!==file.name)assert(platformId&&intent&&context?.jobId,'截名图片缺少原分派与平台身份');await check(guard);const receipt={name:file.name,status:'SUCCEEDED',materialName:actualName,platformId,url,evidence};await onReceipt(receipt);result.push(receipt);
  }
  for(const file of files.filter(f=>empty.has(f.name))){await check(guard);const sample=empty.get(file.name),raw=probe.trials.find(t=>t.mode==='original'),extended=probe.trials.find(t=>t.mode==='extended'),evidence={kind:'EMPTY_NATIVE_FILE',shopId:context.shopId,jobId:context.jobId,name:file.name,stagedPath:file.path,sha256:file.sha256,batchIntentAt:context.batchIntents[0].at,offline:true,networkBlocked:true,sdkSkipsZero:true,sdkRejected:true,diskSize:sample.disk.size,rawNativeSize:0,rawReadError:sample.raw.readError,extendedNativeSize:sample.extended.size,extendedSha256:sample.extended.sha256,probeAt:probe.at,nativeFileCount:raw.files.length,sdkFileCount:raw.sdkFiles.length,nativeNames:raw.files.map(f=>f.name),sdkNames:raw.sdkFiles.map(f=>f.name),sdkExtendedNames:extended.sdkFiles.map(f=>f.name),nativeFiles:raw.files,extendedFiles:extended.files,sdkSourceSha256:probe.sdk.sha256,browserVersion:probe.chrome.version,browserExecutableSha256:probe.chrome.sha256,probe};const receipt={name:file.name,status:'NOT_TRANSMITTED',evidence};await onReceipt(receipt);result.push(receipt);}
  return result;
 };
 return {
  lookupBatch:async({files,guard,onReceipt,context})=>lookup(files,guard,{onReceipt,context,legacy:true}),
  uploadBatch:async({files,guard,onReceipt,onDispatch})=>{
   assert(Array.isArray(files)&&files.length>0&&files.length<=20&&new Set(files.map(f=>f.name)).size===files.length,'MATERIAL_PREPARATION_BATCH_INVALID');assert(files.every(f=>basename(f.path)===f.name),'MATERIAL_PREPARATION_FILENAME_MISMATCH');
   await nativeProbe(page,files,{guard:()=>check(guard)});await check(guard);const {dialog,input}=await openMaterialUpload(page,()=>check(guard));assert(await input.evaluate(el=>el.multiple===true),'MATERIAL_PREPARATION_MULTIPLE_UNSUPPORTED：当前官方控件不支持批量上传，尚未选择文件');
   await check(guard);const context=await onDispatch({nativePathMode:process.platform==='win32'?'WINDOWS_EXTENDED':'NATIVE'});await input.setInputFiles(files.map(f=>nativeUploadPath(f.path)));const rows=dialog.locator('[class*="UploadPanel_uploadFileList"] > *');let results=[];
   await waitMaterialReadiness('bulk-upload-receipt',async()=>{
    results=[];const count=await rows.count();assert(count<=files.length,'MATERIAL_PREPARATION_RESULT_AMBIGUOUS：上传结果行超出原范围');if(count!==files.length)return {ready:false,actual:{rows:count,expected:files.length}};
    for(const file of files){const matched=[];for(let i=0;i<count;i++){const row=rows.nth(i),text=await row.innerText();if(text.includes(file.name))matched.push(row);}if(matched.length!==1)return {ready:false,actual:{name:file.name,matches:matched.length}};const row=matched[0],text=await row.innerText(),state=row.locator('[class*="UploadPanel_fileState"]'),success=/上传成功/.test(text)||await state.locator('.next-icon-success').count()===1,failed=/上传失败/.test(text)||await state.locator('.next-icon-error').count()===1;if(success===failed||/上传中|等待上传/.test(text)||await state.locator('.next-icon-loading').count())return {ready:false,actual:{name:file.name,terminal:false}};results.push({name:file.name,status:success?'SUCCEEDED':'FAILED',reason:failed?'该图片上传失败':null});}return {ready:true,actual:{rows:count,terminal:results.length}};
   },()=>check(guard),{timeout:receiptTimeout,selector:'官方上传面板逐图结果行',expected:'每个精确文件名对应唯一成功或失败结果'});
   for(const r of results.filter(r=>r.status==='FAILED'))await onReceipt(r);await check(guard);await dialog.getByRole('button',{name:'完成',exact:true}).click();await expect(dialog).toBeHidden();const succeeded=await lookup(files.filter(f=>results.find(r=>r.name===f.name)?.status==='SUCCEEDED'),guard,{onReceipt,context});return [...succeeded,...results.filter(r=>r.status==='FAILED')];
  }
 };
}
