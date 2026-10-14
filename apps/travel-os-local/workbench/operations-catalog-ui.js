import {requestId} from './task-view-model.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses = [['ALL','全部'],['AVAILABLE','待创建'],['WAITING','等待执行'],['RUNNING','执行中'],['VERIFIED','已发布并核验'],['RETRYABLE','异常待处理'],['HUMAN','待人工处理'],['VERIFY','结果待核验'],['NEEDS_DATA','资料待补'],['SKIPPED','已跳过']];
const label = status => statuses.find(x => x[0] === status)?.[1] || '状态待检查';
const date = value => value ? new Date(value).toLocaleString('zh-CN', {hour12:false}) : '—';
const button = (action, text, attrs='') => `<button type="button" data-ops="${action}" ${attrs}>${text}</button>`;
const safeItemUrl = value => {try {const u=new URL(value);return u.protocol==='https:' && ['item.taobao.com','item.tmall.com','detail.tmall.com'].includes(u.hostname) ? u.href : null;} catch {return null;}};

// This view owns selection and presentation only. The server owns execution,
// eligibility, request receipts and the original frozen tasks.
export function mountOperationsCatalog(root, {shops=[],initialShop='',onDetail=()=>{},onTask=()=>{},onMaterials=()=>{},isConnected=()=>true,request=fetch}={}) {
 let alive=true,active=true,loading=false,writing=false,generation=0,timer=null,abort=null;
 let shopId=initialShop||shops[0]?.id||'',importId='',snapshot=null,error='',notice='',filter='ALL',search='',country='',page=1;
 let selected=new Set(),preview=null,receipt=null,pending=null;
 const storageKey='travel-os:catalog-pending-selection:v1';
 try {const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved?.requestId&&saved?.id&&saved?.selectionHash&&Array.isArray(saved?.keys)){pending=saved;shopId=saved.shopId||shopId;importId=saved.importId||'';}} catch {}
 const currentRows=()=>snapshot?.items||[];
 const scopedRows=()=>currentRows().filter(row=>(filter==='ALL'||row.status===filter)&&(!country||row.country===country)&&(!search||[row.destination,row.country,row.title,row.result?.itemId].some(value=>String(value||'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))));
 const canSelect=row=>!['VERIFIED','RUNNING','VERIFY','HUMAN','SKIPPED'].includes(row.status);
 const round=()=>snapshot?.selectedPackage?.executionSupported?snapshot.selectedPackage.roundId:null;
 const selectionLocked=()=>writing||!!pending;
 function persist(){try {if(pending)localStorage.setItem(storageKey,JSON.stringify(pending));else localStorage.removeItem(storageKey);} catch {}}
 async function json(url,options={}) {
  const response=await request(url,{cache:'no-store',...options});let value;
  try {value=await response.json();} catch {throw Error('服务响应无法读取；请刷新状态或核对原操作结果。');}
  if(!response.ok)throw Object.assign(Error(value.error||value.message||'操作未完成'),{status:response.status,code:value.code,details:value});
  return value;
 }
 function invalidate(){preview=null;receipt=null;notice='';}
 function draw(){
  if(!alive)return;
  const rows=scopedRows(),pages=Math.max(1,Math.ceil(rows.length/20));page=Math.min(page,pages);
  const visible=rows.slice((page-1)*20,page*20),countries=[...new Set(currentRows().map(x=>x.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const locked=selectionLocked(),disabled=locked||loading||!isConnected(),pkg=snapshot?.selectedPackage;
  const retainedFocus=root.contains(document.activeElement)?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  root.innerHTML=`<section class="ops-catalog" aria-busy="${loading||writing}">
   <div class="ops-scope"><label>店铺<select id="opsShop" ${locked?'disabled':''}>${shops.map(s=>`<option value="${escape(s.id)}" ${shopId===s.id?'selected':''}>${escape(s.name)}</option>`).join('')}</select></label><label class="ops-package">资料包<select id="opsPackage" ${locked?'disabled':''}>${(snapshot?.packages||[]).map(p=>`<option value="${escape(p.id)}" ${importId===p.id?'selected':''}>${escape(p.name||p.id)} · ${p.total??p.count??0} 条 · ${escape(date(p.at))}</option>`).join('')||'<option value="">尚未导入资料</option>'}</select></label>${button('refresh',loading?'读取中…':'刷新状态',loading||writing?'disabled':'')}${button('materials','图片与资料')}</div>
   <p class="ops-caption">按所选店铺和资料包统计商品；每个商品只计一次。资料修改请回原 Excel 或图片文件夹，再重新导入核对。</p>
   ${error?`<p class="notice danger" role="alert">${escape(error)}</p>`:''}${notice?`<p class="notice" role="status">${escape(notice)}</p>`:''}
   ${pending?`<div class="notice" role="alert"><strong>上次创建结果需要核对</strong><p>保留原操作编号，核对前不会创建新的执行范围。</p>${button('reconcile','核对原创建结果',writing?'disabled':'')}</div>`:''}
   <div class="ops-statuses" aria-label="商品状态筛选">${statuses.map(([key,text])=>button('filter',`${text} <strong>${key==='ALL'?currentRows().length:snapshot?.counts?.[key]||0}</strong>`,`data-value="${key}" aria-pressed="${filter===key}" ${locked?'disabled':''}`)).join('')}</div>
   <div class="ops-tools"><label class="ops-search"><span class="sr-only">搜索目的地、商品标题或商品ID</span><input id="opsSearch" type="search" value="${escape(search)}" placeholder="搜索目的地、商品标题或商品 ID" ${locked?'disabled':''}></label><label><span class="sr-only">筛选国家</span><select id="opsCountry" ${locked?'disabled':''}><option value="">全部国家</option>${countries.map(c=>`<option ${country===c?'selected':''}>${escape(c)}</option>`).join('')}</select></label><span class="ops-count" role="status">${rows.length} 条 · 已选 ${selected.size} 条</span></div>
   <div class="ops-bulk"><div>${button('select-filter','选择筛选结果中的待处理项',disabled?'disabled':'')}${button('clear','清空选择',disabled||!selected.size?'disabled':'')}</div><div>${button('preview-start','检查所选待执行商品',`class="primary" ${disabled||!selected.size||!round()?'disabled':''}`)}${button('preview-retry','检查并重试所选异常',disabled||!selected.size||!round()?'disabled':'')}</div></div>
   ${pkg&&!round()?`<p class="notice">${escape(pkg.reason||'此资料包尚未建立已审核的执行清单。请先在自动化任务中核对资料和发布范围。')} ${button('tasks','前往自动化任务')}</p>`:''}
   <div class="ops-table-scroll" tabindex="0" aria-label="资料包商品总表，可横向滚动"><table class="ops-table"><thead><tr><th><span class="sr-only">选择</span></th><th>目的地 / 商品</th><th>资料状态</th><th>发布状态</th><th>当前问题 / 执行步骤</th><th>结果 / 最近处理</th><th>操作</th></tr></thead><tbody>${visible.map(row=>{
    const issues=row.issues||[],needsData=row.dataStatus==='NEEDS_DATA'||issues.length>0,url=safeItemUrl(row.result?.url||row.url),itemId=row.result?.itemId||row.itemId;
    return `<tr data-ops-row="${escape(row.key)}"><td><input type="checkbox" data-ops-key="${escape(row.key)}" aria-label="选择${escape(row.destination)}" ${selected.has(row.key)?'checked':''} ${disabled||!canSelect(row)?'disabled':''}></td><td><strong>${escape(row.destination)}</strong><small>${escape(row.country)} · 序号 ${escape(row.position??'—')}</small><span class="ops-title" title="${escape(row.title)}">${escape(row.title)}</span></td><td><span class="ops-data ${needsData?'is-issue':''}">${needsData?(issues.length?'有 '+issues.length+' 项问题':'资料待核对'):'导入校验通过'}</span><small>${row.usesPriorSnapshot?'原任务仍使用此前导入的固定资料':'以执行前检查为准'}</small></td><td><span class="ops-badge status-${escape(row.status)}">${label(row.status)}</span>${row.attempts?`<small>已尝试 ${row.attempts} / ${row.maxAttempts??'—'} 次</small>`:''}</td><td><span class="ops-reason">${escape(row.reason||issues.join('；')||'—')}</span>${row.retryReason?`<small>${escape(row.retryReason)}</small>`:''}${row.stage?`<small>${escape(row.stageLabel||'查看详情定位当前步骤')}</small>`:''}</td><td>${itemId?url?`<a href="${escape(url)}" target="_blank" rel="noopener">商品 ${escape(itemId)}</a>`:`<span>商品 ${escape(itemId)}</span>`:'<span class="ops-muted">尚无已核验商品</span>'}<small>${escape(date(row.updated||row.finished||row.result?.verifiedAt))}</small>${row.result?.status?`<small>${escape(row.result.status)}</small>`:''}</td><td>${button('detail','查看详情',`data-key="${escape(row.key)}" class="text-button"`)}</td></tr>`;
   }).join('')||`<tr><td colspan="7"><div class="ops-empty"><strong>${loading?'正在读取资料包…':currentRows().length?'没有匹配的商品':'尚无商品资料'}</strong><p>${loading?'请稍候。':currentRows().length?'可切换状态、清空关键词或国家筛选。':'先在资料设置中导入固定模板和图片。'}</p>${!loading?(currentRows().length?button('reset','清除筛选'):'<a class="button" href="#settings">导入资料</a>'):''}</div></td></tr>`}</tbody></table></div>
   <div class="ops-pagination"><span>第 ${page} / ${pages} 页 · 每页20条</span><div>${button('previous','上一页',page===1?'disabled':'')}${button('next','下一页',page===pages?'disabled':'')}</div></div>
   <div id="opsPreview" aria-live="polite">${previewHtml()}</div>
   ${receipt?`<section class="ops-receipt notice"><strong>所选范围已保存，尚未启动发布</strong><p>执行范围已绑定原资料与任务。前往自动化任务检查并开始；每轮最多100条，只处理这次确认的商品。</p>${button('tasks','前往任务页开始','class="primary"')}</section>`:''}
  </section>`;
  if(retainedFocus?.id){const input=root.querySelector('#'+retainedFocus.id);input?.focus({preventScroll:true});if(input&&typeof retainedFocus.start==='number'&&['search','text'].includes(input.type))input.setSelectionRange(retainedFocus.start,retainedFocus.end);}
 }
 function previewHtml(){
  if(!preview)return '';
  const blockers=preview.blockers||[],eligible=preview.items||preview.eligible||[],excluded=preview.excluded||[];
  return `<section class="ops-preview"><h2>检查结果 · ${preview.mode==='retry'?'异常重试':'待执行商品'}</h2><p><strong>${eligible.length}</strong> 条可纳入 · <strong>${excluded.length}</strong> 条未纳入；每轮最多100条，自动衔接本次确认的范围。</p>${blockers.length?`<div class="notice danger" role="alert">${blockers.map(x=>escape(typeof x==='string'?x:x.reason||x.message)).join('<br>')}</div>`:''}<details ${excluded.length?'open':''}><summary>查看可执行商品与未纳入原因</summary><ul>${eligible.map(x=>`<li>${escape(x.destination||x.key)} <span>可纳入执行范围</span></li>`).join('')}${excluded.map(x=>`<li>${escape(x.destination||x.key)} <strong>${escape(x.reason||x.message||'需先处理原任务')}</strong></li>`).join('')}</ul></details><p class="form-note">成功商品不会重复发布；结果不明先核验；原图片、属性、断点和尝试记录继续保留。单条资料问题且确认未提交时记录该条，继续其余合格商品。</p>${button('confirm','确认范围，前往执行',`class="primary" ${writing||pending||!isConnected()||!eligible.length||blockers.length?'disabled':''}`)} ${button('cancel-preview','取消',writing?'disabled':'')}</section>`;
 }
 async function load({quiet=false}={}){
  if(!alive||loading||writing)return;loading=true;const ticket=++generation;abort?.abort();abort=new AbortController();if(!quiet)draw();
  try {
   const next=await json('/api/os/operations?'+new URLSearchParams({shopId,...(importId?{importId}:{})}),{signal:abort.signal});
   if(!alive||ticket!==generation)return;
   snapshot=next;importId=next.selectedPackage?.id||'';error='';
   const byKey=new Map(currentRows().map(x=>[x.key,x]));let removed=0;
   if(!pending)for(const key of selected){if(!byKey.has(key)||!canSelect(byKey.get(key))){selected.delete(key);removed++;}}
   if(removed){invalidate();notice=`${removed} 条已完成或状态变化的商品已退出选择，其他选择保留。`;}
  }catch(e){if(e.name!=='AbortError'&&alive&&ticket===generation)error=e.message;}finally{if(alive&&ticket===generation){loading=false;draw();}}
 }
 async function check(mode){
  if(selectionLocked()||!isConnected()||!round()||!selected.size)return;
  writing=true;error='';preview=null;receipt=null;draw();
  try {const input={id:round(),manifestHash:snapshot.selectedPackage.manifestHash,keys:[...selected],mode,limit:100,autoContinue:true,requestId:requestId()};
   const result=await json('/api/v1/rounds/selection-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
   preview={...result,_input:input};
  }catch(e){error=e.message;}finally{writing=false;draw();root.querySelector('#opsPreview')?.scrollIntoView({block:'nearest'});}
 }
 async function create(){
  if(writing||!isConnected()||(!pending&&!preview))return;
  if(!pending){pending={...preview._input,selectionHash:preview.selectionHash,expectedRevision:preview.expectedRevision,requestId:requestId(),shopId,importId};persist();}
  writing=true;error='';draw();
  try {
   const {shopId:storedShop,importId:storedImport,...input}=pending;
   const result=await json('/api/v1/rounds/selection-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
   if(result.accepted!==true||result.roundId!==input.id||!result.selectionId||!result.windowId||result.selection?.roundId!==input.id||result.window?.roundId!==input.id)throw Error('创建回执不完整，请核对原创建结果。');
   receipt=result;pending=null;persist();preview=null;selected.clear();
  }catch(e){error=e.message;if(e.status>=400&&e.status<500&&e.details?.retainRequest!==true){pending=null;persist();preview=null;}}
  finally{writing=false;draw();}
 }
 async function click(event){const target=event.target.closest('[data-ops]');if(!target||target.disabled)return;const action=target.dataset.ops;
  if(action==='refresh')return load();if(action==='materials')return onMaterials(shopId);if(action==='tasks')return onTask(receipt);
  if(action==='detail'){const row=currentRows().find(x=>x.key===target.dataset.key);if(row)onDetail(row);return;}
  if(action==='reconcile')return create();if(selectionLocked())return;
  if(action==='filter'){filter=target.dataset.value;page=1;}
  if(action==='select-filter'){for(const row of scopedRows())if(canSelect(row))selected.add(row.key);invalidate();}
  if(action==='clear'){selected.clear();invalidate();}
  if(action==='reset'){filter='ALL';country='';search='';page=1;}
  if(action==='previous')page--;if(action==='next')page++;
  if(action==='preview-start')return check('start');if(action==='preview-retry')return check('retry');
  if(action==='confirm')return create();if(action==='cancel-preview')preview=null;draw();
 }
 function change(event){const input=event.target;if(selectionLocked())return;
  if(input.matches('[data-ops-key]')){input.checked?selected.add(input.dataset.opsKey):selected.delete(input.dataset.opsKey);invalidate();draw();}
  if(input.id==='opsShop'||input.id==='opsPackage'){abort?.abort();generation++;loading=false;if(input.id==='opsShop'){shopId=input.value;importId='';snapshot=null;}else importId=input.value;selected.clear();invalidate();page=1;filter='ALL';load();}
  if(input.id==='opsCountry'){country=input.value;page=1;draw();}
 }
 function input(event){if(event.target.id==='opsSearch'&&!event.isComposing){search=event.target.value;page=1;draw();}}
 root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);
 root.addEventListener('compositionend',input);
 timer=setInterval(()=>{if(active&&!document.hidden&&!pending&&!writing&&!loading)load({quiet:true});},12000);
 draw();const ready=load();
 return {ready,refresh:load,setActive(value){active=value;},connectionChanged(){draw();},dispose(){alive=false;generation++;abort?.abort();clearInterval(timer);root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('input',input);root.removeEventListener('compositionend',input);}};
}
