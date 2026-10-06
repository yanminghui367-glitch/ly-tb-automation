const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pattern:'图案',size:'尺寸',style:'款式',subject:'科目',people:'适用人数'};
async function api(action,input){const res=await fetch('/api/v1/'+action,{method:input?'POST':'GET',headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined,cache:'no-store'});const data=await res.json();if(!res.ok)throw Error(data.error||'操作未完成');return data;}
export function variantSummary(task){const v=task.publishVariant;return v?`<div class="publishing-summary"><strong>已固定：副图 ${esc(v.secondaryGroup)} 套 · 详情首页 ${v.coverIndex+1}</strong><p>品牌：无品牌/无注册商标</p><p>${v.attributes.map(a=>`${esc(a.label)}：${esc(a.text)}`).join(' · ')}</p><small>规则第 ${v.revision} 版 · 重试沿用本次选择</small></div>`:'';}
export function previewImage(preview,task,group,index){return preview.draftId?`/api/v1/publishing-image?draftId=${encodeURIComponent(preview.draftId)}&order=${task.priority}&group=${group}&index=${index}`:`/api/source/asset?batch=${encodeURIComponent(preview.importId)}&order=${task.priority}&group=${group}&index=${index}`;}
export function variantImages(preview,task){return preview.draftId?`<details class="publishing-image-review"><summary>核对本次图片（主图 ${task.assets.main.length} · 副图 ${task.assets.secondary.length} · 详情 ${task.assets.details.length}）</summary><div class="publishing-slots">${['main','secondary','details'].flatMap(group=>task.assets[group].map((a,index)=>`<a href="${previewImage(preview,task,group,index)}" target="_blank" rel="noopener"><img style="width:100%;height:100px;object-fit:contain" src="${previewImage(preview,task,group,index)}" alt="${group==='main'?'主图':group==='secondary'?'副图':'详情'}第 ${index+1} 张"><span>${group==='main'?'主图':group==='secondary'?'副图':'详情'} ${index+1}</span></a>`)).join('')}</div></details>`:'';}
export function rulesCard(state={}){return `<section class="settings-card publishing-card"><div class="settings-card-heading"><div><h2>发布随机规则</h2><p>副图、详情首页与属性按店铺配置，仅用于以后新建的任务。</p></div></div><div class="publishing-card-body"><p>${state.enabled?"已启用 · 规则第 "+state.revision+" 版":"尚未启用"} · 当前执行店铺</p>${state.checkpoint?`<p class="notice danger" role="alert">属性读取已暂停：${esc(state.checkpoint.reason)}。人工处理后打开配置重新读取。</p>`:""}<p>两套副图整套随机；两张首页随机替换首张。预览确认后固定，已有任务保持原样。</p><button type="button" id="publishingConfigure">配置图片与属性</button></div></section>`;}
let editor=null,picker=null;
function dialogs(){
  if(editor)return;
  editor=document.createElement('dialog');editor.className='publishing-editor';editor.setAttribute('aria-labelledby','publishingTitle');document.body.append(editor);
  picker=document.createElement('dialog');picker.className='publishing-picker';picker.setAttribute('aria-labelledby','publishingPickerTitle');document.body.append(picker);
}
export async function openPublishingRules(onSaved=()=>{}){
  dialogs();if(editor.open)return;
  const returnFocus=document.activeElement;
  editor.innerHTML='<p role="status">正在读取店铺规则…</p><button type="button" id="publishingLoadingClose">关闭</button>';editor.showModal();editor.querySelector('button').onclick=()=>editor.close();
  let preset,fields,items,shop,selected,captureId,busy=false,confirmed=false,revision;
  const error=message=>{const el=editor.querySelector('#publishingError');if(el){el.textContent=message;el.hidden=!message;}};
  const run=async fn=>{if(busy)return;busy=true;editor.querySelectorAll('button,input').forEach(e=>e.disabled=true);error('');try{await fn();}catch(e){error(e.message);}finally{busy=false;editor.querySelectorAll('button,input').forEach(e=>e.disabled=false);const capture=editor.querySelector('#publishingCapture');if(capture)capture.textContent=fields.length?'重新读取属性选项':'读取页面属性选项';}};
  function slots(group,count){return `<fieldset><legend>${group==='covers'?'详情首页候选（替换第 1 张）':'副图 '+group+' 套'}</legend><p>${group==='covers'?'两张任选其一，不增加详情总张数。':'整套使用，共 4 张，按下方顺序上传。'}</p><div class="publishing-slots">${Array.from({length:count},(_,i)=>{const a=items.find(a=>a.id===selected[group][i]);return `<div class="publishing-slot"><button type="button" data-pick="${group}" data-index="${i}" aria-label="选择${group==='covers'?'详情首页':'副图 '+group}第 ${i+1} 张">${a?`<img src="${esc(a.url)}" alt="${esc(a.name)}"><span>${esc(a.name)}</span>`:'<span class="publishing-add">＋</span><span>选择图片</span>'}</button><div class="publishing-order"><b>${i+1}</b>${group!=='covers'&&i>0?`<button type="button" data-up="${group}" data-index="${i}" aria-label="将第 ${i+1} 张向前移动">上移</button>`:''}</div></div>`;}).join('')}</div></fieldset>`;}
  function fieldOptions(){return Object.entries(labels).map(([key,label])=>{const f=fields.find(f=>f.key===key),allowed=new Set(preset.allowed?.[key]||[]);return `<fieldset class="publishing-field"><legend>${label}</legend>${f?`<div class="publishing-options">${f.options.map(o=>`<label><input type="checkbox" data-attribute="${key}" value="${esc(o.value)}" ${allowed.has(o.value)?'checked':''}><span>${esc(o.text)}</span></label>`).join('')}</div>`:'<p class="muted">尚未读取页面选项</p>'}</fieldset>`;}).join('');}
  function render(){
    editor.innerHTML=`<header class="publishing-heading"><div><h2 id="publishingTitle">发布随机规则</h2><p>${esc(shop.name)} · ${preset.enabled?'已启用，第 '+revision+' 版':'尚未启用'} · 仅新任务生效</p></div><button type="button" id="publishingClose" aria-label="关闭规则配置">关闭</button></header><div class="publishing-scroll"><section><h3>1. 指定两套副图</h3><p class="muted">从资料设置的图片目录选择。图片保留在原目录，不重新上传到 C 盘。</p>${slots('A',4)}${slots('B',4)}</section><section><h3>2. 指定两张详情首页</h3>${slots('covers',2)}</section><section><div class="publishing-section-heading"><div><h3>3. 选择允许随机的属性</h3><p class="muted">品牌固定为“无品牌/无注册商标”。其余字段分别随机，允许连续抽到相同值。</p></div><button type="button" id="publishingCapture">${fields.length?'重新读取属性选项':'读取页面属性选项'}</button></div><p class="publishing-help">先在执行 Chrome 中保留一个新增商品发布页，让类目属性区域可见；各下拉菜单保持关闭。点击读取后程序会逐项展开候选，期间请勿操作执行 Chrome；验证码由你手动处理。</p>${fieldOptions()}</section><label class="publishing-confirm"><input type="checkbox" id="publishingConfirmed" ${confirmed?'checked':''}>我已核对图片顺序，并确认勾选的属性适用于本店商品。</label></div><footer class="publishing-footer"><p id="publishingError" role="alert" hidden></p><div><span>新任务预览后固定；旧任务不变。</span><div>${preset.enabled?'<button type="button" id="publishingDisable">停用新任务随机</button>':''}<button type="button" id="publishingSave" class="primary">保存并用于新任务</button></div></div></footer>`;
    editor.querySelector('#publishingClose').onclick=()=>{if(!busy)editor.close();};
    editor.querySelector('#publishingConfirmed').onchange=e=>confirmed=e.target.checked;
    editor.querySelectorAll('[data-attribute]').forEach(e=>e.onchange=()=>{preset.allowed={};for(const key of Object.keys(labels))preset.allowed[key]=[...editor.querySelectorAll(`[data-attribute="${key}"]:checked`)].map(e=>e.value);confirmed=false;editor.querySelector('#publishingConfirmed').checked=false;});
    editor.querySelectorAll('[data-pick]').forEach(e=>e.onclick=()=>choose(e.dataset.pick,Number(e.dataset.index),e));
    editor.querySelectorAll('[data-up]').forEach(e=>e.onclick=()=>{const a=selected[e.dataset.up],i=Number(e.dataset.index);[a[i-1],a[i]]=[a[i],a[i-1]];confirmed=false;render();});
    editor.querySelector('#publishingCapture').onclick=()=>run(async()=>{editor.querySelector('#publishingCapture').textContent='正在读取，请保留执行 Chrome…';const capture=await api('publishing-capture',{});fields=capture.fields;captureId=capture.id;preset.allowed={};confirmed=false;render();});
    editor.querySelector('#publishingSave').onclick=()=>run(async()=>{
      if(!confirmed)throw Error('请先核对图片及属性，并勾选确认。');
      const input={revision,confirmed:true,captureId,secondary:{A:selected.A,B:selected.B},covers:selected.covers,allowed:preset.allowed};
      await api('publishing-save',input);editor.close();await onSaved();
    });
    const disable=editor.querySelector('#publishingDisable');if(disable)disable.onclick=()=>run(async()=>{await api('publishing-save',{revision,disable:true});editor.close();await onSaved();});
  }
  function choose(group,index,trigger){
    picker.innerHTML=`<header class="publishing-heading"><h2 id="publishingPickerTitle">选择${group==='covers'?'详情首页':'副图 '+group} · 第 ${index+1} 张</h2><button type="button" id="publishingPickerClose">关闭</button></header><label class="publishing-search">按文件名或目录筛选<input type="search" id="publishingSearch" placeholder="例如：副图、首页"></label><p id="publishingImageCount" role="status"></p><div class="publishing-gallery" id="publishingGallery"></div>`;
    const gallery=picker.querySelector('#publishingGallery');
    const draw=()=>{const q=picker.querySelector('input').value.trim().toLowerCase(),matches=items.filter(a=>a.relative.toLowerCase().includes(q));picker.querySelector('#publishingImageCount').textContent=`找到 ${matches.length} 张，显示前 100 张；可输入更具体的名称。`;gallery.innerHTML=matches.slice(0,100).map(a=>`<button type="button" data-image="${a.id}" ${selected[group].includes(a.id)&&selected[group][index]!==a.id?'disabled':''}><img src="${esc(a.url)}" loading="lazy" alt=""><span>${esc(a.relative)}</span></button>`).join('')||'<p>未找到图片，请检查图片目录或更换关键词。</p>';gallery.querySelectorAll('button').forEach(b=>b.onclick=()=>{selected[group][index]=b.dataset.image;confirmed=false;picker.close();render();editor.querySelector(`[data-pick="${group}"][data-index="${index}"]`).focus();});};
    picker.querySelector('#publishingPickerClose').onclick=()=>{picker.close();trigger.focus();};picker.querySelector('input').oninput=draw;
    picker.showModal();picker.querySelector('input').value=group==='covers'?'首页':'副图';draw();picker.querySelector('input').focus();
  }
  editor.oncancel=e=>{if(busy)e.preventDefault();};editor.onclose=()=>returnFocus?.isConnected&&returnFocus.focus();
  try{
    const [config,library]=await Promise.all([api('publishing-rules'),api('publishing-materials')]);
    if(!editor.open)return;
    ({shop,preset}=config);revision=preset.revision;captureId=preset.captureId;items=library.items;
    selected={A:preset.secondary.A.map(a=>a.id),B:preset.secondary.B.map(a=>a.id),covers:preset.covers.map(a=>a.id)};
    // Saved selection remains available even if a file is missing; save will refuse it.
    for(const a of [...preset.secondary.A,...preset.secondary.B,...preset.covers])if(!items.some(x=>x.id===a.id))items.push({...a,relative:'文件待检查 / '+a.name});
    fields=config.fields||preset.fields;preset.allowed=Object.fromEntries(preset.fields.map(f=>[f.key,f.options.map(o=>o.value)]));render();
    if(config.checkpoint?.state==='WAITING_HUMAN')error(config.checkpoint.reason+'；处理后点击“重新读取属性选项”。');
  }catch(e){editor.innerHTML=`<h2 id="publishingTitle">暂时无法读取随机规则</h2><p role="alert">${esc(e.message)}</p><button type="button">关闭</button>`;editor.querySelector('button').onclick=()=>editor.close();}
}
