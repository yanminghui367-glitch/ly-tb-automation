import {expect} from 'playwright/test';
import assert from 'node:assert/strict';

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
export async function openMaterialUpload(page,guard,{timeout=8000}={}){
  // The same official panel changes its accessible title to 上传结果 after
  // the native upload finishes. Keep its file-panel identity across both states.
  const dialog=page.getByRole('dialog',{name:/^(上传素材|上传结果)$/}).filter({has:page.locator('#sucai-tu-upload-pannel')});
  for(let attempt=0;attempt<2;attempt++){
    await guard();
    if(await dialog.isVisible().catch(()=>false))break;
    assert.equal(await page.locator('[role=dialog]:visible').count(),0,'MATERIAL_UPLOAD_BLOCKED：存在其他弹窗，请人工处理');
    const button=page.getByRole('button',{name:'上传文件',exact:true});
    await expect(button).toHaveCount(1);await expect(button).toBeEnabled();await button.click();
    // One bounded reopen is safe only before any file has been selected. It
    // handles a first click lost while the material-center UI is initializing.
    if(await dialog.waitFor({state:'visible',timeout}).then(()=>true).catch(()=>false))break;
    await guard();
    if(attempt===1)throw Error('MATERIAL_UPLOAD_NOT_READY：素材库上传弹窗未打开，整批暂停，请保留页面检查');
  }
  await guard();await expect(dialog).toHaveCount(1);await expect(dialog).toBeVisible();
  const input=dialog.locator('input[type=file]');
  await expect(input,{message:'MATERIAL_UPLOAD_INPUT：无法唯一识别当前上传控件'}).toHaveCount(1,{timeout});
  await expect(input).toBeEnabled();
  assert.equal(await input.evaluate(el=>el.files.length),0,'MATERIAL_UPLOAD_BUSY：已有待上传文件，请先人工核对');
  const text=await dialog.innerText();
  const oldRows=await dialog.locator('[class*="UploadPanel_uploadFileList"] > *').count();
  assert(!oldRows&&!/(?:^|\s)[1-9]\d*\s*个文件/.test(text),'MATERIAL_UPLOAD_BUSY：上传弹窗有旧文件或旧回执，请先人工核对并关闭');
  // Do not silently alter persisted watermark/original-size preferences.
  await verifyUploadPreferences(dialog);
  return {dialog,input};
}

export async function uploadMaterial(page,path,guard){
  const {dialog,input}=await openMaterialUpload(page,guard);
  await guard();await input.setInputFiles(path);
  await expect.poll(async()=>{await guard();const text=await dialog.innerText();return /(?:^|\s)1\s*个文件上传成功/.test(text)&&!/(?:^|\s)[1-9]\d*\s*个文件(?:上传中|上传失败)/.test(text);},{timeout:60000,message:'MATERIAL_UPLOAD_RESULT：未取得单张上传成功回执，整批暂停'}).toBe(true);
  await guard();return dialog;
}
