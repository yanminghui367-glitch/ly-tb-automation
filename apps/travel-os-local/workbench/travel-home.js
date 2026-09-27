const $=id=>document.getElementById(id);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<img src="assets/travel-os/icons/${name}.svg" alt="">`;
const date=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'未记录';
const badStates=new Set(['RESULT_UNKNOWN','SUBMITTING','PAUSED_CAPTCHA','WAITING_HUMAN','FAILED','NEEDS_DATA','PAUSED']);
// A reproducible local visual state: real data, Tokyo selected, no default WebGL motion.
// It only affects presentation; normal navigation and all globe input remain available.
const visualTest=['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('visual')==='reference';
if(visualTest)document.documentElement.dataset.visualTest='reference';
let catalog=null,state=null,selected=null,online=false,lastReceived=0,stream=null,searchTimer,searchController,catalogPromise,observedVersion='';
let storedKey='';try{if(!visualTest)storedKey=localStorage.getItem('travel-os:selected')||'';}catch{}
let globeController=null,selectionRequest=0,pendingFocus=null;
import('./travel-globe.js').then(async({mountGlobe})=>{globeController=await mountGlobe({host:$('interactiveGlobe'),labels:$('globeMarkers'),onSelect:key=>select(key),presentation:'home',visualTest});if(pendingFocus)globeController.focus(pendingFocus);else if(selected)globeController.highlight?.(selected.key);}).catch(()=>{$('globeStatus').textContent='3D 组件暂未载入，请刷新；右侧搜索仍可使用。';$('interactiveGlobe').dataset.state='unavailable';for(const id of ['rotateGlobe','zoomInGlobe','zoomOutGlobe','resetGlobe','expandGlobe','toggleMapDensity'])$(id).disabled=true;});
const known=new Map();
let mapChoices=[];
get('globe').then(g=>{mapChoices=g.items.filter(x=>x.type==='city').map(x=>({...x,city:x.destination}));renderChoices();}).catch(()=>{});
function html(id,value){if($(id).innerHTML!==value)$(id).innerHTML=value;}
async function get(path,signal){const r=await fetch('/api/v1/'+path,{signal:signal||AbortSignal.timeout(15000)});if(!r.ok){let error;try{error=(await r.json()).error;}catch{}throw Error(error||'暂时无法读取本地资料');}return r.json();}
function pill(item){return `<span class="pill ${item.state==='VERIFIED'?'good':badStates.has(item.state)?'warning':''}">${escape(item.stateLabel)}</span>`;}
function markOffline(){online=false;$('connectionNotice').hidden=false;$('loginStatus').textContent='登录状态待检查';$('serviceState').textContent='连接中断 · 状态待检查';$('updatedAt').textContent='显示上次读取的数据';}
function renderStatus(){
 if(!state)return;
 $('testBanner').hidden=!state.testMode;
 $('loginStatus').textContent=online?'执行 Chrome · '+state.browser.label:'登录状态待检查';
 $('serviceState').textContent=online?'本地服务正常 · '+(state.settings.executionEnabled?'执行已允许':'新任务执行关闭'):'连接中断 · 状态待检查';
 $('updatedAt').textContent=online?'状态更新 '+new Date(state.at).toLocaleTimeString('zh-CN',{hour12:false}):'显示上次读取的数据';
 const batch=state.batch,counts=batch?.counts||{},human=state.exceptions.find(x=>x.captcha||x.unknown),pending=state.execution?.state;
 const attention=!!human||['PAUSING','VERIFY_REQUIRED','CHECK_REQUIRED'].includes(pending);
 const batchTitle=human?(human.destination+' · '+(human.captcha?'等待人工验证':'提交结果待核验')):pending==='PAUSING'?'正在暂停，等待断点保存':state.active?(state.currentTask?.city||state.currentTask?.country||'当前批次')+' · 执行中':batch?'最近批次 · '+(batch.state==='COMPLETED'?'已结束':({READY:'待开始',PAUSED:'已暂停',WAITING_HUMAN:'等待人工'}[batch.state]||'查看任务状态')):'还没有任务批次';
 const batchDescription=human?(human.captcha?'请在专用 Chrome 完成人工验证，保留页面，再检查并继续。':'先核验平台结果，不重新提交商品。'):pending==='PAUSING'?'当前步骤仍在结束或保存中，请保留执行浏览器。':batch?`本批 ${batch.total} 条，成功 ${counts.SUCCEEDED||0} 条，失败 ${counts.FAILED||0} 条。`:'导入商品 Excel 和图片，预览后确认任务范围。';
 // Operational tables live in the workspace. Keep urgent intervention visible without a second page section.
 $('homeAttention').hidden=!attention;
 html('homeAttention',`<strong>${escape(batchTitle)}</strong><span>${escape(batchDescription)}</span><b>进入工作台处理 →</b>`);
}
function renderChoices(){
 const cities=['东京','巴黎','纽约','新加坡','曼谷'].map(name=>catalog?.items.find(x=>x.city===name)||mapChoices.find(x=>x.city===name)).filter(Boolean);
 html('quickCities',cities.map(x=>`<button data-select="${x.key}" aria-pressed="${selected?.key===x.key}">${escape(x.destination)}</button>`).join('')||'<span>导入资料后显示</span>');
 renderRecent();
}
function renderRecent(){let keys=[];try{keys=JSON.parse(localStorage.getItem('travel-os:recent')||'[]');}catch{}const rows=Array.isArray(keys)?keys.map(k=>known.get(k)).filter(Boolean).slice(0,5):[];$('recentDestinations').hidden=!rows.length;html('recentDestinations','<span>最近查看</span>'+rows.map(x=>`<button data-select="${x.key}">${escape(x.destination)}</button>`).join(''));}
function remember(item){try{const raw=JSON.parse(localStorage.getItem('travel-os:recent')||'[]'),old=Array.isArray(raw)?raw:[];localStorage.setItem('travel-os:selected',item.key);localStorage.setItem('travel-os:recent',JSON.stringify([item.key,...old.filter(k=>k!==item.key)].slice(0,5)));}catch{}}
function renderCard(){
 if(!selected)return;
 const x=selected,tokyo=x.city==='东京'&&x.country==='日本';
 $('destinationCard').classList.toggle('tokyo',tokyo);
 // Display art is separate from listing media. Other destinations use the same
 // quiet information surface; their original product images stay in materials().
 const image=tokyo?'assets/travel-os/tokyo-atmosphere.png':null;
 html('destinationCard',`${image?`<img class="city-backdrop" src="${escape(image)}" alt="" onerror="this.hidden=true">`:''}<div class="city-content"><div><h2 class="city-name">${escape(x.destination)}</h2><p class="country">${escape(x.country)} · ${x.type==='city'?'城市目的地':'国家目的地'}</p><div class="city-badges">${pill(x)}<span class="pill ${x.issues.length?'warning':''}">${x.issues.length?'资料需复核':'已导入资料'}</span></div><p class="city-title">从目的地资料，走向下一次出发。<br>查看素材、任务与真实上架记录。</p></div><div class="city-side"><div class="fact">${icon('images')}<span>主图 ${x.counts.main} · 副图 ${x.counts.secondary}</span></div><div class="fact">${icon('list-checks')}<span>详情图 ${x.counts.details} 张</span></div><button class="text-button" data-material="${x.key}">查看资料与素材 ${icon('arrow-right')}</button><a class="card-next" href="${escape(x.next.href)}">${escape(x.next.label)} ${icon('arrow-square-out')}</a></div></div>${image?`<small class="art-label">${tokyo?'AI 城市氛围图 · 不用于商品发布':'已导入商品主图'}</small>`:''}`);
}
async function select(key,rememberChoice=true,keepResults=false){
 const request=++selectionRequest;globeController?.cancelFocus?.();
 if(!keepResults){clearTimeout(searchTimer);searchController?.abort();}
 try{const fresh=await get('destinations?key='+encodeURIComponent(key));if(request!==selectionRequest)return;selected=fresh.item;known.set(key,selected);if(rememberChoice)remember(selected);renderCard();renderChoices();pendingFocus=key;globeController?.focus(key);if(!keepResults)$('searchResults').hidden=true;}catch(e){if(request===selectionRequest)showSearchMessage(e.message);}
}
async function loadCatalog(){
 if(catalogPromise)return catalogPromise;
 catalogPromise=(async()=>{
  const selectionVersion=selectionRequest;
  catalog=await get('destinations?limit=100');catalog.items.forEach(x=>known.set(x.key,x));
  $('catalogSource').textContent=catalog.total?'来源：'+catalog.sources.map(x=>x.name).join('、')+' · 资料状态以最近导入为准':'还没有导入资料，先选择商品 Excel 与图片目录。';
  const preferred=selected?.key||storedKey||catalog.items.find(x=>x.city==='东京')?.key||catalog.items[0]?.key;
  if(preferred){try{const {item}=await get('destinations?key='+encodeURIComponent(preferred));if(selectionVersion===selectionRequest){selected=item;known.set(item.key,item);}}catch{if(selectionVersion===selectionRequest)selected=catalog.items[0]||null;}}
  if(selected)renderCard();else html('destinationCard','<div class="card-empty"><strong>从你的第一个目的地开始</strong><p>导入商品 Excel 和图片后，在这里查找资料与任务。</p><a class="button secondary" href="/index.html?portal=import#tasks">导入商品资料</a></div>');
  renderChoices();renderStatus();globeController?.highlight?.(selected?.key);
 })().finally(()=>catalogPromise=null);return catalogPromise;
}
function showSearchMessage(message){$('searchResults').hidden=false;html('searchResults',`<p class="result-summary" role="status">${escape(message)}</p>`);}
async function search(filter='',showAll=false,navigate=false){
 clearTimeout(searchTimer);searchController?.abort();const controller=new AbortController();searchController=controller;
 $('clearSearch').hidden=!$('citySearch').value;
 const q=$('citySearch').value.trim();if(!q&&!filter&&!showAll){$('searchResults').hidden=true;return;}
 showSearchMessage('正在查找目的地…');
 try{
  const data=await get('destinations?q='+encodeURIComponent(q)+'&limit=60&filter='+encodeURIComponent(filter),AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));if(controller!==searchController)return;
  data.items.forEach(x=>known.set(x.key,x));
  html('searchResults',`<div class="result-summary" role="status">${data.matched?`找到 ${data.matched} 个${filter?'资料需补充的':''}目的地${data.matched>60?'，显示前 60 个，请缩小关键词':''}`:'没有匹配的目的地，请换一个关键词或导入资料。'}</div>`+data.items.map(x=>`<button class="result-row" data-select="${x.key}"><span><strong>${escape(x.destination)}</strong> <small>${escape(x.country)}</small></span>${pill(x)}<small class="result-title">${escape(filter?x.issues.join('；'):x.title)}</small></button>`).join(''));$('searchResults').hidden=false;
  if(navigate&&!filter&&q){const normalize=v=>String(v||'').toLocaleLowerCase().replace(/[\s·•,，/\\-]/g,'');const query=normalize(q);const exact=data.items.filter(x=>[x.destination,x.city,x.country+' '+x.destination].some(v=>normalize(v)===query));const match=exact.length===1?exact[0]:data.matched===1?data.items[0]:null;if(match){await select(match.key,true,true);if(controller===searchController&&!controller.signal.aborted&&selected?.key===match.key)$('searchResults').hidden=true;}}
 }catch(e){if(controller.signal.aborted)return;showSearchMessage('查询失败，请检查本地服务后重试。');}
}
async function materials(key){
 $('materialTitle').textContent='正在读取资料…';html('materialBody','<p class="material-meta">请稍候</p>');$('materialDialog').showModal();
 try{const {item:x}=await get('destinations?key='+encodeURIComponent(key));$('materialTitle').textContent=x.destination+' · 商品资料';
  html('materialBody',`<p class="material-meta">${escape(x.title)}</p><p>${pill(x)} <span class="pill">${escape(x.completeness)}</span></p>${x.issues.length?`<div class="material-issues"><strong>需要处理</strong><ul>${x.issues.map(v=>'<li>'+escape(v)+'</li>').join('')}</ul><p>请修正自己的商品资料后重新导入核对，系统不会修改原文件。</p></div>`:''}<p class="material-meta">来源：${escape(x.source.name)} · ${escape(x.source.sheet)} · 第 ${escape(x.source.row||'—')} 行<br>导入时间：${escape(date(x.source.importedAt))}<br>源表价格：${escape(x.price??'未提供')} 元 · 库存：${escape(x.inventory??'未提供')}<br>${x.itemId?'平台商品 ID：'+escape(x.itemId):'尚无已核验的商品 ID'}</p><p class="material-meta">下方为导入的原始素材；完整度是导入时的检查结果，执行前仍需核对。</p><div class="materials-grid">${x.materials.map(m=>`<figure><img loading="lazy" src="${escape(m.url)}" alt="${m.group==='main'?'主图':m.group==='secondary'?'副图':'详情图'} ${m.index+1}"><figcaption>${m.group==='main'?'主图':m.group==='secondary'?'副图':'详情图'} ${m.index+1} · ${escape(m.name)}</figcaption></figure>`).join('')}</div><div class="material-actions"><a class="button primary" href="${escape(x.next.href)}">${escape(x.next.label)} ${icon('arrow-right')}</a><p>${x.duplicateBlocked?'已有任务或成功记录，沿用原任务处理。':'任务中心按热度规则生成批次，选择城市不会自动入队。'}</p></div>`);
  $('materialBody').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{const fallback=document.createElement('div');fallback.className='image-error';fallback.textContent='素材无法读取，请重新导入核对';img.replaceWith(fallback);},{once:true}));
 }catch(e){html('materialBody',`<p class="material-issues">${escape(e.message)}</p>`);}
}
function acceptState(data){
 state=data;online=true;lastReceived=Date.now();$('connectionNotice').hidden=true;renderStatus();
 const version=JSON.stringify([state.latestImport,state.overview,state.batch?.state,state.batch?.counts,state.execution?.state]);
 if(observedVersion&&version!==observedVersion)loadCatalog().catch(()=>{$('catalogSource').textContent='资料更新失败，当前显示上次读取的资料；请重新连接后再核对。';});observedVersion=version;
}
function subscribe(){stream?.close();stream=new EventSource('/api/v1/events');stream.addEventListener('state',e=>{try{acceptState(JSON.parse(e.data));}catch{markOffline();}});stream.addEventListener('problem',markOffline);stream.onerror=markOffline;}
async function connect(){try{const data=await get('state');acceptState(data);await loadCatalog();}catch(e){markOffline();if(!catalog)html('destinationCard','<div class="card-empty"><strong>暂时无法读取本地资料</strong><p>请检查工作台是否已启动，再点击上方“重新连接”。</p></div>');}finally{subscribe();}}
$('searchForm').addEventListener('submit',e=>{e.preventDefault();search('',false,true);});
$('citySearch').addEventListener('input',()=>{++selectionRequest;clearTimeout(searchTimer);searchController?.abort();$('clearSearch').hidden=!$('citySearch').value;searchTimer=setTimeout(search,180);});
$('clearSearch').addEventListener('click',()=>{++selectionRequest;clearTimeout(searchTimer);searchController?.abort();$('citySearch').value='';$('clearSearch').hidden=true;$('searchResults').hidden=true;$('citySearch').focus();});
$('citySearch').addEventListener('keydown',e=>{if(e.key==='Escape')$('searchResults').hidden=true;if(e.key==='ArrowDown'&&!$('searchResults').hidden){e.preventDefault();$('searchResults').querySelector('button')?.focus();}});
$('searchResults').addEventListener('keydown',e=>{const buttons=[...$('searchResults').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Escape'){$('searchResults').hidden=true;$('citySearch').focus();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-select],[data-material],[data-close]');if(b?.dataset.select){if(b.closest('#helpDialog'))$('helpDialog').close();select(b.dataset.select);return;}if(b?.dataset.material){materials(b.dataset.material);return;}if(b?.dataset.close){$(b.dataset.close).close();return;}if(!e.target.closest('#searchForm'))$('searchResults').hidden=true;});
// Aceternity Navbar Menu interaction, adapted to native disclosure buttons.
const homeNav=document.querySelector('.home-navbar');
let navCloseTimer;
function closeNav(){clearTimeout(navCloseTimer);for(const trigger of homeNav.querySelectorAll('.nav-trigger')){trigger.setAttribute('aria-expanded','false');$(trigger.getAttribute('aria-controls')).hidden=true;}}
function openNav(trigger){closeNav();trigger.setAttribute('aria-expanded','true');$(trigger.getAttribute('aria-controls')).hidden=false;}
for(const item of homeNav.querySelectorAll('.nav-item')){
 const trigger=item.querySelector('.nav-trigger');
 item.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')openNav(trigger);});
 trigger.addEventListener('click',()=>trigger.getAttribute('aria-expanded')==='true'?closeNav():openNav(trigger));
 trigger.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();openNav(trigger);$(trigger.getAttribute('aria-controls')).querySelector('a,button')?.focus();}});
}
homeNav.addEventListener('pointerenter',()=>clearTimeout(navCloseTimer));
homeNav.addEventListener('pointerleave',()=>{if(!homeNav.contains(document.activeElement))navCloseTimer=setTimeout(closeNav,180);});
homeNav.addEventListener('focusout',e=>{if(!homeNav.contains(e.relatedTarget))closeNav();});
homeNav.addEventListener('keydown',e=>{if(e.key==='Escape'){const trigger=homeNav.querySelector('.nav-trigger[aria-expanded=true]');closeNav();trigger?.focus();}});
homeNav.querySelector('a[aria-current]').addEventListener('pointerenter',closeNav);
document.addEventListener('pointerdown',e=>{if(!homeNav.contains(e.target))closeNav();});
$('helpButton').addEventListener('click',()=>{closeNav();$('helpDialog').showModal();});
$('reconnect').addEventListener('click',async()=>{$('reconnect').disabled=true;try{await connect();}finally{$('reconnect').disabled=false;}});
setInterval(()=>{if(online&&Date.now()-lastReceived>12000)markOffline();},3000);
window.addEventListener('pagehide',e=>{stream?.close();if(!e.persisted)globeController?.dispose();});
window.addEventListener('pageshow',e=>{if(e.persisted)connect();});
connect();
