const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountMaterialEditor(host,{shopId,assetId,get,post,makeRequestId,onSaved,onCancel,onSaveError}){
 let disposed=false,info,selection=null,objectUrl=null,sequence=0,saving=false;
 host.innerHTML='<p role="status">正在读取当前图片…</p>';
 const release=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;};
 const start=async()=>{
  try{
   info=await get('/api/os/material-edit?'+new URLSearchParams({shopId,assetId}));if(disposed)return;
   host.innerHTML=`<form class="material-image-editor"><p class="material-editor-name">${esc(info.name)}</p><p class="form-note">新图片用于素材库和后续新建任务；已有任务和已发布记录保留原图。</p><div class="material-editor-previews"><figure><figcaption>当前图片</figcaption><img src="${esc(info.url)}" alt="当前图片"></figure><figure><figcaption>新图片预览</figcaption><div class="material-editor-placeholder">选择图片后显示预览</div><img data-new-preview alt="新图片预览" hidden></figure></div><label class="material-editor-file">选择一张新图片<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" required></label><p class="form-note">支持 PNG、JPG、WebP，单张不超过 16MB。请核对新图内容后保存。</p><p class="notice danger" data-error role="alert" hidden></p><div class="material-editor-actions"><button type="button" data-cancel>取消</button><button type="submit" class="primary" disabled>保存修改</button></div></form>`;
   const form=host.querySelector('form'),file=form.querySelector('input'),save=form.querySelector('[type=submit]'),error=form.querySelector('[data-error]'),preview=form.querySelector('[data-new-preview]'),placeholder=form.querySelector('.material-editor-placeholder');
   const showError=message=>{error.textContent=message;error.hidden=false;};
   form.querySelector('[data-cancel]').onclick=()=>{if(!saving)onCancel();};
   file.onchange=async()=>{
    const token=++sequence,chosen=file.files?.[0];selection=null;save.disabled=true;error.hidden=true;release();preview.hidden=true;preview.removeAttribute('src');placeholder.hidden=false;
    if(!chosen)return;
    if(!chosen.size||chosen.size>16*1024*1024||! /\.(png|jpe?g|webp)$/i.test(chosen.name)){showError('请选择 PNG、JPG 或 WebP 图片，单张不超过16MB。');return;}
    try{
     objectUrl=URL.createObjectURL(chosen);const probe=new Image();probe.src=objectUrl;await probe.decode();
     const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('图片无法读取，请重新选择'));reader.readAsDataURL(chosen);});
     if(disposed||token!==sequence)return;
     selection={name:chosen.name,data,requestId:makeRequestId()};preview.src=objectUrl;preview.hidden=false;placeholder.hidden=true;save.disabled=false;
    }catch{if(!disposed&&token===sequence)showError('这张图片无法打开，请选择有效图片。');}
   };
   form.onsubmit=async event=>{
    event.preventDefault();if(saving||!selection)return;
    saving=true;file.disabled=true;save.disabled=true;save.textContent='正在保存…';error.hidden=true;
    try{
     const result=await post('/api/os/material-replace',{shopId,assetId,expectedRevision:info.revision,expectedHash:info.sha256,...selection});
     await onSaved(result);
    }catch(e){const message=/Failed to fetch|NetworkError|Load failed|JSON|body stream/i.test(e.message||'')?'连接中断，未能确认保存结果。请重试以核对本次修改。':e.message||'保存未完成，请重试；本次选择会保留。';if(disposed)onSaveError?.(message);else showError(message);}
    finally{saving=false;if(!disposed){file.disabled=false;save.disabled=!selection;save.textContent='保存修改';}}
   };
  }catch(e){if(!disposed)host.innerHTML='<p class="notice danger" role="alert">'+esc(e.message||'图片读取失败，请关闭后重新打开。')+'</p>';}
 };
 start();return {dispose(){disposed=true;sequence++;release();}};
}
