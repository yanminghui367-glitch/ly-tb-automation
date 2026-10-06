import {createSetupUI} from './setup-ui.js';
import {openPublishingRules,variantSummary,previewImage,variantImages} from './publishing-rules-ui.js';
import {taskListView,taskGroup,materialCount,retryPlan,failureSummary,requestId} from './task-view-model.mjs';
let setupUI;
function paintSettingsStatus(){if(page==='settings')setupUI?.paint();}
let taskSearch='',taskTablePage=1;
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modules=[['overview','总览','globe-hemisphere-east'],['tasks','自动化任务','list-checks'],['shops','店铺管理','compass'],['products','产品库','images'],['destinations','目的地中心','map-pin'],['quotes','报价库','list-checks'],['records','上架记录','check-circle'],['settings','资料设置','upload-simple']];
const labels={PREPARING:'产品准备中',CANCELLED:'准备单已取消',PENDING:'等待执行',READY:'等待开始',RUNNING:'执行中',WAITING_HUMAN:'等待人工',PAUSED_CAPTCHA:'等待人工验证',PAUSED:'已暂停',SUBMITTING:'正在提交',RESULT_UNKNOWN:'待核验',FAILED:'异常',VERIFIED:'已核验上架',SUCCEEDED:'已核验上架',COMPLETED:'已结束',RETRY:'等待重试',SKIPPED:'已跳过',QUEUED:'等待执行',DRY_RUN_COMPLETE:'填写完成，未提交',AVAILABLE:'未创建任务',NEEDS_DATA:'资料待补充'};
let productCountry='',productPageSize=20;
let productShop='',recordShop='',taskShop='',destinationCountry='',materialGroup='main';
let shopSearch='',shopFilter='all',shopSort='checked',shopPage=1,shopSize=10,shopStateSignature='';
let data=null,globe=null,selectedKey=null,page='overview',connected=false,busy=false,stream=null,lastEvent=0,selectedBatch=null,selectedTask=null,taskDetail=null,queueFilter='all',tablePage=1,query='',quoteKind='ALL',quoteGeo='',recordQuery='',browseFilter='',preview=null,searchTimer=null,productGeo='',shopGeo='',recordGeo='',refreshingRelations=false,booting=false;
const icon=name=>`<img src="assets/travel-os/icons/${name}.svg" alt="">`;
const badge=(state,text)=>`<span class="badge ${['SUCCEEDED','VERIFIED','COMPLETED'].includes(state)?'good':['WAITING_HUMAN','PAUSED_CAPTCHA','PAUSED','RESULT_UNKNOWN','PREPARING'].includes(state)?'warn':['FAILED','NEEDS_DATA'].includes(state)?'bad':''}">${esc(text||labels[state]||state||'待检查')}</span>`;
const time=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
const shortTime=v=>v?new Date(v).toLocaleTimeString('zh-CN',{hour12:false}):'—';
const empty=(title,description,action='')=>`<div class="empty"><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</div>`;
const heading=(title,sub,action='')=>`<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`;
const btn=(action,label,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`;
const matching=(d,q)=>!q||[d.destination,d.country,d.city,d.title].some(v=>String(v||'').toLocaleLowerCase().includes(q.toLocaleLowerCase().trim()));
const shopName=id=>data?.shops.find(s=>s.id===id)?.name||data?.products.find(d=>d.shopId===id)?.shopName||'已移除店铺';
const selected=()=>data?.products.find(d=>d.key===selectedKey);
const money=q=>`${q.currency} ${Number(q.amount).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})} / ${q.unit}`;
const linkButton=(href,label)=>`<a class="button" href="${esc(href)}">${label}</a>`;
async function get(url){const res=await fetch(url,{cache:'no-store'});const body=await res.json();if(!res.ok)throw Error(body.error||'读取失败');return body;}
async function post(url,input={}){if(!connected)throw Error('服务连接中断，请重新连接');const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const body=await res.json();if(!res.ok)throw Error(body.error||'操作未完成');return body;}
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function status(ok){const changed=connected!==ok;connected=ok;$('connectionNotice').hidden=ok;$('connectionNoticeText').textContent=data?'连接中断 · 显示的是上次读取的数据。执行与修改操作已禁用。':'连接中断 · 尚未读取到数据，请重新连接。执行与修改操作已禁用。';$('connectionState').textContent=ok?'本地服务已连接':'连接中断';$('sidebarStatus').textContent=ok?`执行 Chrome · ${data?.engine.browser.label||'待检查'}`:'本地服务连接中断';document.querySelectorAll('[data-write]').forEach(b=>b.disabled=!ok||busy||b.dataset.locked==='true');paintSettingsStatus();document.body.dataset.connected=String(ok);$('checkBrowser').disabled=!ok||busy;if(changed&&data&&page==='overview')renderOverview();if(changed&&data&&page==='tasks')renderTasks();}
async function refresh({background=false}={}){const next=await get('/api/os/state');overviewEngine=next.engine;if(selectedBatch&&next.engine.batch?.id!==selectedBatch)next.engine=await get('/api/v1/state?batch='+encodeURIComponent(selectedBatch));data=next;$('testBanner').hidden=next.testMode!==true;status(true);$('updatedAt').textContent='数据更新 '+time(next.at);if(!selectedKey)selectedKey=next.products.find(d=>d.destination==='东京')?.key||next.products[0]?.key;if(background&&page==='settings')renderOverview();else render();}
const engineRelations=e=>JSON.stringify([e.batch?.id,e.batch?.state,e.batch?.items.map(x=>[x.id,x.displayState,x.runId,x.reason]),e.records.map(x=>[x.itemId,x.status,x.verified]),e.active,e.exceptions.map(x=>[x.id,x.state])]);
function connect(){stream?.close();stream=new EventSource('/api/v1/events'+(selectedBatch?'?batch='+encodeURIComponent(selectedBatch):''));stream.addEventListener('state',event=>{lastEvent=Date.now();if(!data)return;const nextEngine=JSON.parse(event.data),changed=engineRelations(data.engine)!==engineRelations(nextEngine);data.engine=nextEngine;if(!selectedBatch)overviewEngine=nextEngine;const engineShop=data.shops.find(s=>s.id===data.engine.shop.id);if(engineShop)engineShop.browser=data.engine.browser;status(true);$('updatedAt').textContent='状态更新 '+time(data.engine.at);if(page==='tasks'){renderTasks();syncTaskDetail().catch(e=>toast(e.message,true));}if(page==='overview')renderOverview();if(changed&&!busy&&!refreshingRelations){refreshingRelations=true;refresh({background:true}).catch(()=>status(false)).finally(()=>refreshingRelations=false);}});stream.onerror=()=>status(false);stream.addEventListener('problem',()=>status(false));}
setInterval(()=>{if(lastEvent&&Date.now()-lastEvent>14000)status(false);if(data&&page==='overview')renderOverview();},3000);
async function operate(fn){if(busy)return;busy=true;status(connected);$('editorError').textContent='';try{await fn();await refresh();}catch(e){toast(e.message,true);if($('editor').open)$('editorError').textContent=e.message;}finally{busy=false;status(connected);}}
function dialog(title,html){$('editor').classList.remove('side-editor');$('editorTitle').textContent=title;$('editorBody').innerHTML=html;$('editorError').textContent='';if(!$('editor').open)$('editor').showModal();}
function render(){if(!data)return;renderOverview();if(page!=='overview')({tasks:renderTasks,shops:renderShops,products:renderProducts,destinations:renderDestinations,quotes:renderQuotes,records:renderRecords,settings:renderSettings}[page])();status(connected);}
function route(){page=location.hash.slice(1).split('?')[0]||'overview';if(!modules.some(m=>m[0]===page))page='overview';tablePage=1;query='';document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!=='page-'+page);document.querySelectorAll('.nav-item').forEach(el=>el.setAttribute('aria-current',el.hash==='#'+page?'page':'false'));$('breadcrumb').textContent='工作空间 / '+modules.find(m=>m[0]===page)[1];document.title='星途 Travel OS';$('checkBrowser').hidden=page==='settings';document.body.classList.toggle('is-overview',page==='overview');document.querySelectorAll('#navigation .nav-item').forEach((a,i)=>{const img=a.querySelector('img');img.dataset.originalSrc ||= img.getAttribute('src');img.src=page==='overview'?overviewIconSources[['house','lightning','storefront','cube','map-pin','file-text','upload-simple','gear'][i]]:img.dataset.originalSrc;});document.querySelector('.topbar').insertBefore($('destinationSearch'),document.querySelector('.status-group'));render();if(page==='overview'&&selectedBatch){selectedBatch=null;selectedTask=null;taskDetail=null;connect();refresh({background:true}).catch(()=>status(false));}if(page==='tasks'&&data)syncTaskDetail().catch(e=>toast(e.message,true));}
$('navigation').innerHTML=modules.map(([key,label,i])=>`<a class="nav-item" href="#${key}" aria-label="${label}" title="${label}">${icon(i)}<span>${label}</span></a>`).join('');
// Explicit click-only sidebar state; hover and navigation do not resize the desktop rail.
const sidebar=$('workspaceSidebar'),shell=document.querySelector('.os-shell'),sidebarToggle=$('sidebarToggle');
const compactScreen=matchMedia('(max-width:850px)');
let sidebarPinned=!location.hash||location.hash==='#overview';
try{const saved=localStorage.getItem('travel-os:sidebar-expanded');if(saved!==null)sidebarPinned=saved==='true';}catch{}
function paintSidebar(){
 const expanded=sidebarPinned;
 shell.classList.toggle('sidebar-expanded',expanded);
 document.querySelector('.main-shell').inert=compactScreen.matches&&expanded;
 sidebarToggle.setAttribute('aria-expanded',String(expanded));
 sidebarToggle.setAttribute('aria-label',expanded?'折叠侧栏':'展开侧栏');
 sidebarToggle.title=expanded?'折叠侧栏':'展开侧栏';
 sidebarToggle.querySelector('span').textContent=expanded?'折叠侧栏':'展开侧栏';
 if(compactScreen.matches){$('navigation').inert=!expanded;sidebar.querySelector('.sidebar-bottom').inert=!expanded;}else{$('navigation').inert=false;sidebar.querySelector('.sidebar-bottom').inert=false;}
}
function setSidebar(expanded){sidebarPinned=expanded;try{localStorage.setItem('travel-os:sidebar-expanded',String(expanded));}catch{}paintSidebar();}
sidebarToggle.addEventListener('click',()=>setSidebar(!sidebarPinned));
sidebar.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&compactScreen.matches){setSidebar(false);sidebarToggle.focus();}
 if(e.key==='Tab'&&compactScreen.matches&&shell.classList.contains('sidebar-expanded')){
  const focusable=[...sidebar.querySelectorAll('a,button')].filter(el=>el.getClientRects().length);
  const first=focusable[0],last=focusable.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
$('navigation').addEventListener('click',e=>{if(compactScreen.matches&&e.target.closest('a')){setSidebar(false);sidebarToggle.focus();}});
compactScreen.addEventListener('change',()=>{if(compactScreen.matches)sidebarPinned=false;paintSidebar();});
if(compactScreen.matches)sidebarPinned=false;
paintSidebar();
function chooseDestination(key){clearTimeout(searchTimer);selectedKey=key;const d=selected();if(!d)return;$('citySearch').value=d.destination;$('searchResults').hidden=true;globe?.focus(key);renderOverview();$('overviewSelection').hidden=false;$('overviewSelection').open=true;$('overviewSelection').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'nearest'});}
function search(submitted=false){if(!data)return;const q=$('citySearch').value.trim(),matches=data.products.filter(d=>matching(d,q));const exact=matches.filter(d=>d.destination===q);if(submitted&&q&&(exact.length===1||matches.length===1)){chooseDestination((exact[0]||matches[0]).key);return;}$('searchResults').hidden=false;$('searchResults').innerHTML=matches.length?matches.slice(0,20).map(d=>btn('select-destination',`<span>${esc(d.destination)} <small>${esc(d.country)}</small></span>${badge(d.state,d.stateLabel)}`,`data-key="${d.key}"`)).join(''):empty('没有匹配的目的地','请换一个国家或城市名称，资料库只展示真实导入的数据。');}
$('topSearchForm').replaceWith($('destinationSearch'));
$('destinationSearch').addEventListener('submit',e=>{e.preventDefault();location.hash='overview';search(true);});$('citySearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(),120);});$('citySearch').addEventListener('keydown',e=>{if(e.key==='Escape')$('searchResults').hidden=true;});
function destinationContent(d){
 const products=data.products.filter(x=>x.geoKey===d.geoKey), quotes=data.quotes.filter(x=>x.destinationKey===d.geoKey), attempts=data.attempts.filter(x=>x.geoKey===d.geoKey), coverage=new Set(products.filter(x=>x.state==='VERIFIED').map(x=>x.shopId));
 return `<div class="destination-body"><div class="destination-title">${icon('map-pin')}<div><h2>${esc(d.destination)}</h2><p>${esc(d.country)} / ${d.type==='city'?'城市目的地':'国家目的地'}</p></div></div><div class="destination-facts">${[['destination-products',products.length,'产品',`查看${d.destination}的产品`],['destination-quotes',quotes.length,'历史报价',`查看${d.destination}的历史报价`],['destination-shops',coverage.size,'已覆盖店铺',`查看${d.destination}已上架店铺`]].map(([action,n,label,aria])=>btn(action,`<span>${label}</span><strong>${n}</strong>`,`data-key="${d.key}" aria-label="${esc(aria)}"`)).join('')}</div><div class="section-title"><h3>最近报价</h3>${btn('destination-quotes','查看全部 ›',`data-key="${d.key}" class="text-button"`)}</div><div class="inline-list">${quotes.slice(0,2).map(q=>`<button class="destination-entry" data-action="quote-detail" data-id="${q.id}">${icon('list-checks')}<span><strong>${esc(q.service)}</strong><small>${q.kind==='COST'?'成本价':'销售价'} · ${esc(q.supplier||'来源未填写')}<br>有效期：${esc(q.validUntil||'未设期限')}</small></span><b>${esc(money(q))}</b></button>`).join('')||'<div class="quiet-empty">暂无历史报价<br><small>录入后自动关联此目的地</small></div>'}</div><div class="section-title"><h3>最近任务</h3>${btn('destination-records','查看全部 ›',`data-key="${d.key}" class="text-button" aria-label="查看${esc(d.destination)}执行记录"`)}</div><div class="inline-list">${attempts.slice(0,1).map(a=>`<button class="destination-entry" data-action="record-detail" data-id="${a.id}">${icon('check-circle')}<span><strong>${esc(a.destination)} · ${esc(shopName(a.shopId))}</strong><small>${time(a.at)}</small></span>${badge(a.state)}</button>`).join('')||'<div class="quiet-empty">暂无执行记录</div>'}</div><div class="actions destination-actions">${btn('prepare','创建任务',`class="primary" data-key="${d.key}"`)}${btn('destination-quotes','查看报价',`data-key="${d.key}"`)}</div></div>`;
}
// Overview is a read-only projection. No state, queue or publish policy is changed.
let overviewShopId='',overviewEngine=null;
const overviewGroups={failed:'执行失败',captcha:'人工验证',unknown:'结果待核验',paused:'暂停待检查',data:'资料待补充'};
function overviewSummary(snapshot){
 const e=snapshot.engine,products=[...new Map(snapshot.products.map(p=>[p.shopId+'|'+(p.geoKey||p.key),p])).values()];
 const byRun=new Map((e.batch?.items||[]).filter(x=>x.runId).map(x=>[x.runId,x]));
 const attention=new Map(),productFor=id=>products.find(p=>p.runId===id)||products.find(p=>{const a=snapshot.attempts.find(a=>a.id===id);return a&&a.shopId===p.shopId&&a.geoKey===p.geoKey;});
 const add=(x,group)=>{const p=productFor(x.runId||x.id);if(p?.state==='VERIFIED')return;const key=p?p.shopId+'|'+(p.geoKey||p.key):'run:'+(x.runId||x.id);attention.set(key,{...x,group,productKey:p?.key,shopId:p?.shopId||e.shop.id,destination:p?.destination||x.destination||'待确认商品'});};
 for(const x of e.exceptions||[]){
  if(x.dataOnly||x.state==='DRY_RUN_COMPLETE')continue;
  const item=byRun.get(x.id),state=item?.displayState||item?.state||x.state;
  if(['SUCCEEDED','VERIFIED','SKIPPED','CANCELLED'].includes(state))continue;
  const group=x.unknown||['RESULT_UNKNOWN','SUBMITTING'].includes(state)?'unknown':x.captcha||state==='PAUSED_CAPTCHA'||x.category==='验证码'||x.issue?.category==='验证码'?'captcha':state==='FAILED'||x.retryable||x.exhausted?'failed':'paused';
  add({...x,runId:x.id,batchId:x.batchId,taskId:item?.id},group);
 }
 for(const x of e.batch?.items||[]){
  const state=x.runState==='DRY_RUN_COMPLETE'?'DRY_RUN_COMPLETE':x.displayState||x.state;
  const group=['RESULT_UNKNOWN','SUBMITTING'].includes(state)&&!e.active?'unknown':state==='RESULT_UNKNOWN'?'unknown':state==='PAUSED_CAPTCHA'||x.issue?.category==='验证码'?'captcha':state==='FAILED'?'failed':['PAUSED','WAITING_HUMAN'].includes(state)||(state==='RUNNING'&&!e.active)?'paused':null;
  if(group)add({...x,id:x.runId||x.id,taskId:x.id,batchId:e.batch.id},group);
 }
 // Standalone failures are not always returned by the existing exceptions adapter.
 for(const p of products){
  if(p.state==='NEEDS_DATA'){const key=p.shopId+'|'+(p.geoKey||p.key);if(!attention.has(key))attention.set(key,{group:'data',productKey:p.key,shopId:p.shopId,destination:p.destination,reason:(p.issues||[]).join('；')||'资料未齐备，请到产品库核对'});}
  else if(['FAILED','RESULT_UNKNOWN','PAUSED_CAPTCHA'].includes(p.state)){const a=snapshot.attempts.find(a=>a.id===p.runId);if(a)add({...a,runId:a.id},p.state==='FAILED'?'failed':p.state==='RESULT_UNKNOWN'?'unknown':'captcha');}
 }
 const groups=Object.fromEntries(Object.keys(overviewGroups).map(k=>[k,[...attention.values()].filter(x=>x.group===k)]));
 const batch=e.batch,items=batch?.items||[],counts=batch?.counts||{};
 const progress={total:batch?.total||0,success:items.filter(x=>x.state==='SUCCEEDED'&&x.runState!=='DRY_RUN_COMPLETE'&&batch.mode!=='DRY_RUN').length,dry:items.filter(x=>x.runState==='DRY_RUN_COMPLETE'||(batch.mode==='DRY_RUN'&&x.state==='SUCCEEDED')).length,failed:items.filter(x=>x.state==='FAILED'&&x.displayState!=='RESULT_UNKNOWN'&&x.runState!=='RESULT_UNKNOWN').length,skipped:counts.SKIPPED||0};
 progress.processed=progress.success+progress.dry+progress.failed+progress.skipped;
 const waitingBatches=(e.batches||[]).filter(b=>['READY','PENDING','QUEUED','RETRY'].includes(b.state));if(batch?.state==='PAUSED'&&items.some(x=>['PENDING','QUEUED','RETRY'].includes(x.state))&&!waitingBatches.some(b=>b.id===batch.id))waitingBatches.push({id:batch.id,state:'PAUSED'});
 return {products,verified:products.filter(p=>p.state==='VERIFIED').length,attention:[...attention.values()],groups,progress,waitingBatches};
}
function overviewSnapshot(){return {...data,engine:overviewEngine||data.engine};}
function overviewDate(value){return value?new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})+' '+new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'暂无时间';}
function overviewEntries(snapshot){const byRun=new Map((snapshot.engine.batch?.items||[]).map(x=>[x.runId,x]));return recordRows(snapshot).map(r=>{const item=byRun.get(r.runId),a=snapshot.attempts.find(a=>a.id===r.runId);return {...r,state:r.success?r.state:item?.runState==='DRY_RUN_COMPLETE'?'DRY_RUN_COMPLETE':item?.displayState||r.state,at:a?.updated||r.at};}).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));}
function overviewTone(state){return ['VERIFIED','SUCCEEDED'].includes(state)?'good':state==='FAILED'?'bad':['RESULT_UNKNOWN','WAITING_HUMAN','PAUSED_CAPTCHA','PAUSED'].includes(state)?'warn':'neutral';}
function renderOverview(){
 if(!data)return;const snapshot=overviewSnapshot(),e=snapshot.engine,summary=overviewSummary(snapshot),d=selected();
 const signature=JSON.stringify([selectedKey,d,snapshot.quotes,snapshot.attempts,e.batch,e.batches,e.exceptions,e.active,e.execution?.state,snapshot.shops.map(x=>[x.id,x.name,shopState({...x,browser:x.id===e.shop.id?e.browser:x.browser})]),summary,connected,overviewShopId]);
 if(renderOverview.signature===signature)return;renderOverview.signature=signature;
 renderOverviewDashboard(snapshot,summary);
 $('destinationPanel').innerHTML=d?destinationContent(d):empty('选择一个目的地','搜索国家或城市，查看真实资料与关联记录。',linkButton('#settings','导入资料'));
 $('overviewSelectionName').textContent=d?.destination||'查看详情';
}
function renderOverviewDashboard(snapshot,s){
 const e=snapshot.engine,working=!!e.active,pausing=working&&e.execution?.state==='PAUSING';
 const operational=s.attention.filter(x=>x.group!=='data').length;
 const metrics=[['cube','产品总数',s.products.length,'已导入产品 · 按店铺去重','products','blue'],['check-circle','已核验上架',s.verified,'已通过平台核验的产品','verified','green'],['play','执行中',working?1:0,pausing?'正在暂停，等待断点保存':working?'当前占用执行器的批次':'当前无正在执行的批次','running','orange'],['warning-circle','待处理',s.attention.length,`执行事项 ${operational} · 资料待补 ${s.groups.data.length}`,'attention','red']];
 $('overviewMetrics').innerHTML=metrics.map(([i,label,n,note,action,tone])=>btn('overview-'+action,`<span class="ov-metric-icon ${tone}">${overviewIcon(i)}</span><span class="ov-metric-copy"><span>${label}</span><strong>${Number(n).toLocaleString('zh-CN')}</strong><small>${esc(note)}</small></span><span class="ov-chevron" aria-hidden="true">›</span>`,`class="overview-metric" aria-label="${label} ${n}，${esc(note)}"`)).join('');
 const today=new Date().toLocaleDateString('sv-SE'),rows=overviewEntries(snapshot),todays=rows.filter(r=>new Date(r.at).toLocaleDateString('sv-SE')===today);
 $('overviewDate').innerHTML=overviewIcon('calendar-blank')+' '+new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
 const notes=Object.entries(s.groups).filter(([,v])=>v.length).map(([k,v])=>overviewGroups[k]+' '+v.length).join(' · ');
 $('overviewToday').innerHTML=`<button class="ov-work-row" data-action="overview-pending"><span class="ov-row-icon">${overviewIcon('list-bullets')}</span><span><strong>待开始 / 继续批次</strong><small>${s.waitingBatches.length?'已确认有待执行商品，需人工开始或继续':'暂无已确认待执行的批次'}</small></span><b>${s.waitingBatches.length}</b></button><button class="ov-work-row" data-action="overview-attention"><span class="ov-row-icon orange">${overviewIcon('warning-circle')}</span><span><strong>待处理提醒</strong><small>${esc(notes||'暂无待处理事项')}</small></span><b>${s.attention.length}</b></button><div class="ov-work-row ov-today-log"><span class="ov-row-icon">${overviewIcon('file-text')}</span><div><strong>今日任务摘要</strong><ul>${todays.slice(0,3).map(r=>`<li><button data-action="${r.runId?'record-detail':'record-history'}" data-id="${esc(r.runId||String(r.index))}"><span>${esc(r.destination)} · ${esc(labels[r.state]||r.state)}</span><time>${new Date(r.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</time></button></li>`).join('')||'<li class="ov-empty-line">今天暂无执行记录</li>'}</ul></div></div>`;
 const shop=snapshot.shops.find(x=>x.id===overviewShopId)||snapshot.shops.find(x=>x.id===e.shop.id)||snapshot.shops[0];
 if(!shop){$('overviewShop').innerHTML='<div class="ov-empty"><strong>还没有店铺</strong><p>添加店铺后，可查看资料与执行状态。</p><a href="#shops">前往店铺管理 →</a></div>';}
 else{
  const isExecutor=shop.id===e.shop.id,actual={...shop,browser:isExecutor?e.browser:shop.browser},[tone,login]=shopState(actual),browserInfo=actual.browser||{},age=Date.now()-Date.parse(browserInfo.checkedAt),fresh=connected&&!browserInfo.stale&&Number.isFinite(age)&&age>=0&&age<=15000;
  const browser=!connected?'待检查':!fresh?'待检查':browserInfo.running===true?'已连接':browserInfo.running===false?'未运行':'待检查';
  const batch=isExecutor?e.batch:null,p=isExecutor?s.progress:{total:0,processed:0,success:0,failed:0,dry:0,skipped:0},pending=s.attention.filter(x=>x.shopId===shop.id).length;
  const states=working&&isExecutor?(pausing?'正在暂停 · 等待断点保存':e.execution?.state==='WAITING_HUMAN'?'等待人工处理':'正在执行'):batch?'最近批次 · '+(labels[batch.state]||batch.state):'暂无执行批次';
  $('overviewShop').innerHTML=`<div class="ov-shop-top"><span>${isExecutor?'当前执行店铺':'查看店铺 · 非当前执行店铺'}</span><label class="sr-only" for="overviewShopSelect">切换查看店铺</label><select id="overviewShopSelect" aria-label="切换查看店铺">${snapshot.shops.map(x=>`<option value="${esc(x.id)}" ${x.id===shop.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="ov-shop-name"><h3>${esc(shop.name)}</h3><span class="ov-state ${tone}"><i></i>${esc(login)}</span></div><p class="ov-shop-description">执行 Chrome：${browser}<span>·</span>${esc(states)}</p><div class="ov-shop-stats"><div><span class="ov-row-icon">${overviewIcon('bag')}</span><div><span>商品数量</span><strong>${s.products.filter(p=>p.shopId===shop.id).length}</strong></div></div><div><span class="ov-row-icon">${overviewIcon('clock')}</span><div><span>待处理商品</span><strong>${pending}</strong></div></div><div class="ov-shop-progress"><div><span class="ov-row-icon">${overviewIcon('list-bullets')}</span><div><span>最近批次处理进度</span><strong>${batch?`${p.processed} <small>/ ${p.total}</small>`:'—'}</strong></div></div><progress max="${Math.max(1,p.total)}" value="${p.processed}" aria-label="批次处理进度，不代表成功率"></progress><span class="ov-outcomes">${batch?`成功 ${p.success} · <b class="ov-failure-count">失败 ${p.failed}</b>${p.dry?' · 仅填写 '+p.dry:''}${p.skipped?' · 跳过 '+p.skipped:''}`:'尚无执行记录'}</span></div></div>`;
  $('overviewShopSelect').onchange=ev=>{overviewShopId=ev.target.value;renderOverview();};
 }
 const regions=[['北美洲',-103,40],['南美洲',-62,-20],['欧洲',20,53],['非洲',18,4],['亚洲',105,38],['大洋洲',145,-26]];
 $('overviewRegions').innerHTML=regions.filter(([name])=>s.products.some(p=>destinationContinent(p)===name)).map(([name,lng,lat])=>btn('overview-region',`<i></i><span>${name}</span>`,`class="ov-region" style="left:${(lng+180)/3.6}%;top:${(85-lat)/1.45}%" data-region="${name}" aria-label="查看${name}的已导入目的地"`)).join('');
 $('overviewCoverage').innerHTML=[[new Set(s.products.map(destinationContinent).filter(x=>x!=='待确认')).size,'资料涉及大洲'],[new Set(s.products.map(p=>p.country).filter(Boolean)).size,'国家和地区'],[new Set(s.products.map(p=>p.geoKey||p.key)).size,'去重目的地']].map(([n,label])=>`<div><strong>${n}</strong><span>${label}</span></div>`).join('');
 $('overviewActivity').innerHTML=rows.length?`<table class="ov-record-table"><thead><tr><th>目的地</th><th>状态</th><th>时间</th></tr></thead><tbody>${rows.slice(0,5).map(r=>`<tr><td><button data-action="${r.runId?'record-detail':'record-history'}" data-id="${esc(r.runId||String(r.index))}" title="${esc(shopName(r.shopId)+' · '+r.title)}">${esc(r.destination)}</button></td><td><span class="ov-record-state ${overviewTone(r.state)}"><i></i>${esc(labels[r.state]||r.state)}</span></td><td><time title="${esc(time(r.at))}">${overviewDate(r.at)}</time></td></tr>`).join('')}</tbody></table>`:'<div class="ov-empty"><strong>暂无执行记录</strong><p>执行后，在这里查看真实结果。</p></div>';
}
async function overviewTaskQueue(filter){
 const snap=overviewSnapshot(),e=snap.engine,s=overviewSummary(snap);
 const target=filter==='waiting'?s.waitingBatches[0]?.id:e.batches?.find(b=>b.id===e.active)?.id;
 selectedBatch=target||e.batch?.id||null;selectedTask=null;taskDetail=null;taskShop='';queueFilter=filter;taskTablePage=1;
 data.engine=selectedBatch&&selectedBatch!==e.batch?.id?await get('/api/v1/state?batch='+encodeURIComponent(selectedBatch)):e;
 location.hash='tasks';connect();renderTasks();
}
function overviewAttentionDialog(){
 const s=overviewSummary(overviewSnapshot());dialog('待处理商品 · 全部店铺',`<p class="form-note">共 ${s.attention.length} 项。按商品去重；资料与执行问题分别列出，不自动开始、重试或提交。</p>`+Object.entries(s.groups).filter(([,v])=>v.length).map(([kind,items])=>`<section class="ov-issue-group"><h3>${overviewGroups[kind]} <small>${items.length}</small></h3>${items.map(x=>`<details><summary>${esc(x.destination)} <small>${esc(shopName(x.shopId))}</small></summary><p>${esc(x.reason||'原因待人工确认，查看执行记录')}</p><p class="form-note">${kind==='unknown'?'先核验平台结果，禁止直接重新发布。':kind==='captcha'?'请在专用执行浏览器人工处理验证，再检查恢复条件。':kind==='data'?'核对商品资料、素材与目的地是否一致。':kind==='failed'?'查看日志与截图，在任务中心核对有限重试条件。':'核对原始记录和断点状态后再决定下一步。'}</p>${x.productKey&&kind==='data'?btn('overview-product-detail','查看商品资料',`data-key="${esc(x.productKey)}"`):x.runId?btn('record-detail','查看执行记录',`data-id="${esc(x.runId)}"`):'<a href="#tasks" data-action="overview-task-link">进入任务中心 →</a>'}</details>`).join('')}</section>`).join('')||'<p>暂无待处理事项。</p>');
}
const productsForShop=id=>data.products.filter(d=>d.shopId===id);
const pendingForShop=id=>data.attempts.filter(a=>a.shopId===id&&['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN','FAILED','QUEUED','RUNNING'].includes(a.state)).length;
const materialName=g=>({main:'主图',secondary:'副图',details:'详情页'}[g]);
function shopMaterials(id){return data.materials?.[id]||(!productsForShop(id).length?{status:'unconfigured',main:{count:0},secondary:{count:0,sets:[]},details:{count:0,sets:[]},covers:{count:0,sets:[]},warnings:[]}:null);}
function materialLibraryDialog(id){const m=shopMaterials(id);if(!m){dialog('店铺套图','<p>素材清单待读取，请刷新后重试。</p>');return;}dialog(esc(shopName(id))+' · 公共套图', '<p class="form-note">按当前已导入商品所用资料版本读取本地文件；未自动替换任何商品素材。</p>'+['secondary','details','covers'].map(g=>'<section class="inventory-group"><h3>'+({secondary:'副图',details:'详情正文',covers:'详情首页候选'}[g])+' · '+m[g].count+' 张</h3>'+(m[g].sets.map(set=>'<details open><summary>'+esc(set.name)+' · '+set.count+' 张</summary><ul>'+set.files.map(name=>'<li>'+esc(name)+'</li>').join('')+'</ul></details>').join('')||'<p>尚未关联该类素材</p>')+'</section>').join('')+(m.warnings?.length?'<p class="notice">'+m.warnings.map(esc).join('；')+'</p>':'')+'<p class="form-note">候选版本不混入计数。商品的实际采用素材仍在产品库逐条查看。</p>');}
function retryButton(){const b=data.engine.batch;if(!b?.counts.FAILED)return '';const plan=retryPlan(b,data.engine.active);return btn('retry','重试异常链接（'+plan.eligible.length+'）', 'class="task-retry-button" data-write '+(!plan.allowed?'disabled data-locked="true" ':'')+'title="'+esc(plan.reason||'核对本批异常商品后，按原模式有限重试')+'"');}
function shopProductsLink(s,g=''){return btn('shop-products',g?materialName(g)+' ›':'进入产品库 →',`data-id="${s.id}" data-group="${g}" class="${g?'text-button':'primary'}"`);}

function shopState(s){
 const b=s.browser||{},age=Date.now()-Date.parse(b.checkedAt);
 if(!connected||b.stale||!Number.isFinite(age)||age<0||age>15000)return ['unknown','待检查'];
 if(b.loggedIn===true)return ['good','已登录'];
 if(b.label==='需要登录')return ['login','需要登录'];
 return ['unknown',b.label||'待检查'];
}
function renderShops(){
 shopStateSignature=JSON.stringify(data.shops.map(s=>shopState(s)));
 const all=data.shops,good=all.filter(s=>shopState(s)[0]==='good').length,login=all.filter(s=>shopState(s)[0]==='login').length;
 const term=shopSearch.trim().toLocaleLowerCase();
 const rows=all.filter(s=>(!shopGeo||data.products.some(d=>d.geoKey===shopGeo&&d.shopId===s.id&&d.state==='VERIFIED'))&&(!term||[s.name,s.id].some(v=>String(v).toLocaleLowerCase().includes(term)))&&(shopFilter==='all'||shopState(s)[0]===shopFilter)).sort((a,b)=>shopSort==='name'?a.name.localeCompare(b.name,'zh-CN'):shopSort==='pending'?pendingForShop(b.id)-pendingForShop(a.id):(Date.parse(b.browser?.checkedAt)||0)-(Date.parse(a.browser?.checkedAt)||0));
 const pages=Math.max(1,Math.ceil(rows.length/shopSize));shopPage=Math.max(1,Math.min(shopPage,pages));
 const metric=(name,value,note,i,tone)=>`<article class="shops-metric"><span class="shops-metric-icon ${tone}">${icon(i)}</span><div><span>${name}</span><strong>${value}</strong><small>${note}</small></div></article>`;
 const options=(items,current)=>items.map(([value,label])=>`<option value="${value}" ${String(current)===value?'selected':''}>${label}</option>`).join('');
 $('page-shops').innerHTML=heading('店铺管理','统一管理店铺，查看登录状态与待处理任务。')+`<div class="shops-metrics" aria-label="全部店铺统计">${metric('店铺总数',all.length,'全部已添加店铺','compass','blue')}${metric('正常登录',good,'以最近检查结果为准','check-circle','green')}${metric('需要登录',login,`另有 ${all.length-good-login} 家待检查或处理`,'warning-circle','amber')}${metric('待处理任务',all.reduce((n,s)=>n+pendingForShop(s.id),0),'查看各店铺待处理记录','list-checks','blue')}</div>
 ${shopGeo?`<div class="shops-scope">正在筛选目的地覆盖店铺 ${btn('clear-shop-destination','查看全部店铺')}</div>`:''}
 <div class="shops-panel"><div class="shops-toolbar"><label class="shops-search">${icon('magnifying-glass')}<input id="shopSearch" type="search" aria-label="搜索店铺名称或系统编号" placeholder="搜索店铺名称或系统编号…" value="${esc(shopSearch)}"></label><div class="shops-filters"><select id="shopFilter" aria-label="店铺状态">${options([['all','全部状态'],['good','已登录'],['login','需要登录'],['unknown','待检查 / 其他']],shopFilter)}</select><select id="shopSort" aria-label="店铺排序">${options([['checked','按最后检查时间'],['name','按店铺名称'],['pending','按待处理任务']],shopSort)}</select>${btn('add-shop',icon('plus')+' 新增店铺','class="primary" data-write')}</div></div>
 <div class="shops-table-wrap"><table class="shops-table"><thead><tr>${['店铺信息','平台','系统店铺编号','浏览器状态','产品数量','待处理任务','最后检查时间','操作'].map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>${rows.slice((shopPage-1)*shopSize,shopPage*shopSize).map(s=>{const [state,label]=shopState(s),n=pendingForShop(s.id),id=esc(s.id);return `<tr><td data-label="店铺信息"><div class="shops-identity"><span class="shops-avatar">${icon('globe-hemisphere-east')}</span><div><strong>${esc(s.name)}</strong><small>${s.executionSupported?'已关联产品与执行记录':'待完成店铺适配'}</small></div></div></td><td data-label="平台"><span class="shops-platform">淘</span> 淘宝</td><td data-label="系统店铺编号"><span class="shops-id" title="${id}">${id}</span></td><td data-label="浏览器状态"><span class="shops-status ${state}"><i></i>${esc(label)}</span></td><td data-label="产品数量" class="shops-number">${s.products}</td><td data-label="待处理任务" class="shops-number ${n?'shops-attention':''}">${n}</td><td data-label="最后检查时间"><time>${esc(time(s.browser?.checkedAt))}</time></td><td data-label="操作"><div class="shops-actions">${btn('shop-products','查看产品',`data-id="${id}" class="shops-soft"`)}${btn('shop-tasks','查看任务',`data-id="${id}" class="shops-soft"`)}${btn('shop-browser','连接店铺',`data-id="${id}" class="primary" data-write title="在运行服务的主机上打开浏览器"`)}<details class="row-more"><summary aria-label="${esc(s.name)}更多操作">更多⌄</summary><div>${btn('shop-check','检查连接',`data-id="${id}" data-write`)}${btn('remove-shop','移除',`data-id="${id}" data-write class="danger-button"`)}</div></details></div></td></tr>`;}).join('')}</tbody></table></div>
 ${!rows.length?empty(all.length?'没有匹配的店铺':'添加你的第一家店铺',all.length?'试试其他关键词，或清除筛选条件。':'添加后，在服务主机的独立浏览器中人工登录。',all.length?btn('shops-reset','清除筛选'):''):''}
 <div class="shops-pagination"><span role="status">共 ${rows.length} 条记录</span><div>${btn('shops-prev','‹',`aria-label="上一页店铺" ${shopPage===1?'disabled':''}`)}<span class="shops-page">${shopPage} / ${pages}</span>${btn('shops-next','›',`aria-label="下一页店铺" ${shopPage===pages?'disabled':''}`)}<label>每页 <select id="shopSize" aria-label="每页店铺数">${options([['10','10 条'],['20','20 条'],['50','50 条']],shopSize)}</select></label></div></div></div><p class="shops-help">浏览器在运行服务的主机上打开。新店铺需完成执行适配；移除店铺保留历史记录。</p>`;
 status(connected);
}
$('page-shops').addEventListener('input',e=>{if(e.target.id!=='shopSearch'||e.isComposing)return;const start=e.target.selectionStart,end=e.target.selectionEnd;shopSearch=e.target.value;shopPage=1;renderShops();$('shopSearch').focus();$('shopSearch').setSelectionRange(start,end);});
$('page-shops').addEventListener('compositionend',e=>{if(e.target.id==='shopSearch')e.target.dispatchEvent(new Event('input',{bubbles:true}));});
$('page-shops').addEventListener('change',e=>{if(e.target.id==='shopFilter')shopFilter=e.target.value;else if(e.target.id==='shopSort')shopSort=e.target.value;else if(e.target.id==='shopSize')shopSize=Number(e.target.value);else return;shopPage=1;renderShops();$(e.target.id)?.focus();});
$('page-shops').addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(a==='shops-prev')shopPage--;else if(a==='shops-next')shopPage++;else if(a==='shops-reset'){shopSearch='';shopFilter='all';shopGeo='';shopPage=1;}else return;renderShops();});
setInterval(()=>{if(page!=='shops'||!data||shopStateSignature===JSON.stringify(data.shops.map(s=>shopState(s))))return;const focus=document.activeElement?.id;renderShops();if(focus)$(focus)?.focus();},2000);
const productRows=items=>items.map(d=>`<tr><td><strong>${esc(d.destination)}</strong><small>${esc(d.country)}</small></td><td class="product-title">${esc(d.title)}</td>${['main','secondary','details'].map(g=>`<td>${btn('material-detail',`${d.counts[g]} ${g==='details'?'张':'/ '+(g==='main'?1:4)}<small>查看 ›</small>`,`data-key="${d.key}" data-group="${g}" class="text-button ${materialGroup===g?'material-active':''}"`)}</td>`).join('')}<td>${badge(d.state,d.stateLabel)}${d.issues.length?'<small>资料待补充</small>':''}</td><td>${btn('product-detail','打开 ›',`data-key="${d.key}" class="text-button"`)}</td></tr>`).join('');
function pager(total){const pages=Math.max(1,Math.ceil(total/20));tablePage=Math.min(tablePage,pages);return `<div class="pagination"><span>${total} 条 · 第 ${tablePage} / ${pages} 页</span>${btn('previous-page','上一页',tablePage===1?'disabled':'')}${btn('next-page','下一页',tablePage===pages?'disabled':'')}</div>`;}
const productNeeds=d=>d.issues.length>0||d.counts.main!==1||d.counts.secondary!==4||d.counts.details<1;
function libraryRows(items){return items.map(d=>{const main=d.materials.find(m=>m.group==='main'),needs=productNeeds(d);return `<tr><td><div class="library-product"><span class="library-thumb">${main?`<img loading="lazy" src="${esc(main.url)}" alt="${esc(d.destination)}主图">`:'暂无主图'}</span><div><strong title="${esc(d.title)}">${esc(d.title||d.destination)}</strong><small>${d.itemId?'商品 ID：'+esc(d.itemId):'尚无平台商品 ID'}</small></div></div></td><td>${esc(d.destination)}${d.city?`<small>${esc(d.country)}</small>`:''}</td><td>${d.type==='city'?'城市级':'国家级'}</td><td class="library-counts">${['main','secondary','details'].map(g=>btn('material-detail',String(d.counts[g]),`data-key="${esc(d.key)}" data-group="${g}" class="text-button" aria-label="查看${esc(d.destination)}${materialName(g)}"`)).join('<span>/</span>')}</td><td>${badge(d.state==='VERIFIED'?'VERIFIED':d.state,d.state==='VERIFIED'?'已发布':d.state==='AVAILABLE'||d.state==='NEEDS_DATA'?'未发布':d.stateLabel)}</td><td>${badge(needs?'PAUSED':'VERIFIED',needs?'待补资料':'导入校验通过')}${d.issues.length?'<small>有 '+d.issues.length+' 项资料问题</small>':''}</td><td class="library-date">${esc(time(d.source?.importedAt))}<small>资料导入时间</small></td><td><div class="library-actions">${btn('product-detail','查看',`data-key="${esc(d.key)}" class="text-button"`)}${btn('material-detail','素材',`data-key="${esc(d.key)}" data-group="${materialGroup}" class="text-button"`)}</div></td></tr>`;}).join('');}
function sharedMaterialGallery(inventory,group){
 if(!inventory)return empty('素材清单待读取','请刷新页面后重试。');
 const groups=group==='secondary'?['secondary']:['covers','details'];
 return '<div class="shared-material-library"><p class="shared-material-note">'+(group==='secondary'?'两套副图按套展示，不按商品链接重复列出。':'详情首页展示两个版本，后续正文共用一套。')+' 点击图片查看原图。</p>'+groups.map(g=>{
  const sets=[...(inventory[g]?.sets||[])].sort((a,b)=>(/第一套/.test(a.name)?0:1)-(/第一套/.test(b.name)?0:1));
  return '<section class="shared-material-section"><h2>'+({secondary:'副图套图',covers:'详情首页',details:'共用详情正文'}[g])+'<span>'+ (inventory[g]?.count||0)+' 张</span></h2>'+sets.map(set=>'<div class="shared-material-set"><h3>'+esc(set.name)+' · '+set.count+' 张</h3><div class="shared-material-grid">'+set.files.map((name,i)=>{const asset=set.previews?.find(x=>x.name===name);return '<figure class="shared-material-card">'+(asset?.url?'<a href="'+esc(asset.url)+'" target="_blank" rel="noopener" aria-label="查看原图：'+esc(name)+'"><img loading="lazy" src="'+esc(asset.url)+'" alt="'+esc(name)+'"></a>':'<div class="shared-material-unavailable">预览待读取</div>')+'<figcaption><span>'+String(i+1).padStart(2,'0')+'</span><strong>'+esc(name)+'</strong></figcaption></figure>';}).join('')+'</div></div>').join('')+(sets.length?'':'<p class="shared-material-note">该店铺尚未关联此类素材。</p>')+'</section>';
 }).join('')+(inventory.warnings?.length?'<p class="notice">'+inventory.warnings.map(esc).join('；')+'</p>':'')+'</div>';
}
const materialAudits=new Map(),materialAuditErrors=new Map(),materialAuditLoading=new Set();
const auditLabels={MISSING:'文件空缺',UNLINKED:'未对应',CONTENT:'主图内容错误',AMBIGUOUS:'重复对应',CHANGED:'文件已变更',MANUAL:'人工复核',UNCHECKED:'未完成检查',CANDIDATE:'找到候选',RECHECK:'待重新导入核对'};
async function loadMaterialAudit(id=productShop){try{const report=await get('/api/os/material-audit?shopId='+encodeURIComponent(id));if(!materialAuditLoading.has(id)){materialAudits.set(id,report);materialAuditErrors.delete(id);}}catch(e){materialAuditErrors.set(id,e.message);}if(page==='products'&&productShop===id&&browseFilter==='needs')renderProducts();}
function materialAuditPanel(){
 const report=materialAudits.get(productShop),loading=materialAuditLoading.has(productShop),error=materialAuditErrors.get(productShop);
 const status=report?'最近检索：'+time(report.at)+' · 全店 '+report.total+' 个待补资料产品':'按已配置的商品表、热度表和素材目录，核对文件与对应关系。';
 return '<section class="material-audit"><div class="material-audit-heading"><div><h2>资料自查</h2><p>'+esc(status)+'</p></div>'+btn('rescan-materials',loading?'正在检索…':'重新检索','class="primary" data-write '+(loading?'disabled data-locked="true"':''))+'</div>'+(error?'<p class="notice danger" role="alert">'+esc(error)+'，可重新检索。</p>':'')+(loading?'<p role="status">正在读取原表与图片文件，请稍候…</p>':'')+(report?(report.stale?'<p class="notice">资料导入或目录配置已变化，下方是旧报告，请重新检索。</p>':'')+'<div class="material-audit-summary">'+Object.entries(report.summary).filter(([k,n])=>n||['MISSING','UNLINKED','CONTENT','AMBIGUOUS'].includes(k)).map(([k,n])=>'<span>'+auditLabels[k]+' <strong>'+n+'</strong></span>').join('')+'<p class="form-note">类别可重叠。文件存在不等于内容正确，新图片内容仍需人工复核；检索不自动替换素材或清除原问题。</p>'+(report.warnings.length?'<p class="notice danger">'+report.warnings.map(esc).join('；')+'</p>':'')+'<details class="material-audit-results"><summary>查看逐项结果与资料位置</summary><p class="audit-path">素材目录：'+esc(report.assetRoot)+'</p>'+report.documents.map(d=>'<p class="audit-path">'+esc(d.label)+'：'+esc(d.path)+' · '+(d.readable?'已读取':'无法读取')+'</p>').join('')+report.results.map(r=>'<details class="material-audit-item"><summary><strong>'+esc(r.destination)+'</strong><span>'+[...new Set(r.findings.map(f=>auditLabels[f.code]))].join(' / ')+'</span></summary><p>原导入问题：'+esc(r.originalIssues.join('；')||'素材数量不齐')+'</p>'+r.findings.map(f=>'<div class="audit-finding"><strong>'+auditLabels[f.code]+'</strong><p>'+esc(f.message)+'</p>'+(f.rows?'<p>源表行号 / 热度排名：'+f.rows.map(x=>x.row+' / '+x.rank+(Object.keys(x.evidence||{}).length?'（'+esc(Object.entries(x.evidence).map(([k,v])=>k+'：'+v).join('；'))+'）':'')).join('<br>')+'</p>':'')+(f.candidates?'<ul>'+f.candidates.map(p=>'<li class="audit-path">'+esc(p)+'</li>').join('')+'</ul>':'')+'</div>').join('')+'<details><summary>已关联文件检查（'+r.files.length+'）</summary>'+r.files.map(f=>'<p class="audit-path">'+(f.exists?'已找到':'不可读')+' · '+esc(f.path)+(f.snapshotMatches===false?' · 内容与导入版本不同':'')+'</p>').join('')+'</details>'+btn('product-detail','查看商品资料','data-key="'+esc(r.key)+'" class="text-button"')+'</details>').join('')+'</details>':'')+'</section>';
}
function renderProducts(){
 const shop=data.shops.find(s=>s.id===productShop)||data.shops.find(s=>!productGeo||data.products.some(d=>d.shopId===s.id&&d.geoKey===productGeo))||data.shops[0];productShop=shop?.id||'';
 const products=productsForShop(productShop),scoped=products.filter(d=>!productGeo||d.geoKey===productGeo),countries=[...new Set(scoped.map(d=>d.country))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 const shared=['secondary','details'].includes(browseFilter),inventory=shopMaterials(productShop);
 const tabs=[['','全部产品',scoped.length],...['main','secondary','details'].map(g=>[g,materialName(g),g==='details'?(inventory?inventory.details.count+inventory.covers.count:'待核对'):g==='main'&&productGeo?materialCount(scoped,g):inventory?.[g].count??'待核对']),['needs','待补资料',scoped.filter(productNeeds).length]];
 const items=scoped.filter(d=>(!productCountry||d.country===productCountry)&&(matching(d,query)||String(d.itemId||'').includes(query.trim())&&query.trim())&&(browseFilter==='needs'?productNeeds(d):browseFilter==='ready'?!productNeeds(d):!browseFilter||d.counts[browseFilter]>0));
 const pages=Math.max(1,Math.ceil(items.length/productPageSize));tablePage=Math.max(1,Math.min(tablePage,pages));
 const numbers=[...new Set([1,...[tablePage-1,tablePage,tablePage+1].filter(n=>n>1&&n<pages),pages])].sort((a,b)=>a-b);
 $('page-products').innerHTML=heading('产品库','集中管理店铺产品与素材，核对资料与发布状态。')+`<section class="library-shop"><div class="library-identity"><span class="library-platform" aria-label="淘宝平台">淘</span><div><h2>${esc(shop?.name||'还没有店铺')}</h2><div class="library-shop-meta"><span>淘宝平台</span><small>${shop?'独立店铺产品库':'添加店铺后导入产品'}</small></div></div></div><div class="library-stats">${[['',products.length,'产品总数'],['published',products.filter(d=>d.state==='VERIFIED').length,'已发布'],['needs',products.filter(productNeeds).length,'待补资料']].map(([k,n,label])=>`<div class="${k}"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div><div class="library-shop-controls"><label class="sr-only" for="libraryShop">切换店铺</label><select id="libraryShop" aria-label="切换店铺">${data.shops.map(s=>`<option value="${esc(s.id)}" ${s.id===productShop?'selected':''}>${esc(s.name)}</option>`).join('')}</select>${linkButton('#shops','店铺设置')}</div></section><section class="library-table-card"><div class="library-toolbar"><div class="library-tabs" aria-label="产品素材筛选">${tabs.map(([k,label,n])=>btn('library-tab',`${label} <span>(${n.toLocaleString('zh-CN')}${['main','secondary','details'].includes(k)?' 张':''})</span>`,`data-filter="${k}" aria-pressed="${browseFilter===k}"`)).join('')}</div><div class="library-filters">${shared?'':`<select id="libraryCountry" aria-label="筛选国家"><option value="">全部国家</option>${countries.map(c=>`<option ${productCountry===c?'selected':''}>${esc(c)}</option>`).join('')}</select><input id="productFilter" type="search" aria-label="筛选产品" placeholder="搜索产品、目的地或商品 ID" value="${esc(query)}">`}${btn('material-library','查看店铺套图',`data-id="${esc(productShop)}"`)}${linkButton('#settings','导入产品')}</div></div>${productGeo&&!shared?`<div class="library-scope">当前目的地：${esc(scoped[0]?.destination||'暂无匹配')} ${btn('clear-product-destination','查看全部目的地','class="text-button"')}</div>`:''}${browseFilter==='needs'?materialAuditPanel():''}${shared?sharedMaterialGallery(inventory,browseFilter):`<div class="table-wrap"><table class="library-table"><thead><tr><th>产品信息</th><th>目的地</th><th>商品级别</th><th>素材数量<small>主图 / 副图 / 详情页</small></th><th>发布状态</th><th>资料状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${libraryRows(items.slice((tablePage-1)*productPageSize,tablePage*productPageSize))}</tbody></table></div>${items.length?'':empty(products.length?'没有匹配的产品':'此店铺产品库为空',products.length?'请调整关键词、国家或素材筛选。':'先导入该店铺的真实产品资料。',products.length?btn('library-reset','清除筛选'):linkButton('#settings','导入资料'))}<div class="library-pagination"><span role="status">共 ${items.length} 条</span>${btn('previous-page','‹',`aria-label="上一页" ${tablePage===1?'disabled':''}`)}${numbers.map((n,i)=>(i&&n>numbers[i-1]+1?'<span>…</span>':'')+btn('library-page',String(n),`data-page="${n}" aria-label="第 ${n} 页" aria-current="${tablePage===n?'page':'false'}"`)).join('')}${btn('next-page','›',`aria-label="下一页" ${tablePage===pages?'disabled':''}`)}<select id="libraryPageSize" aria-label="每页数量">${[10,20,50].map(n=>`<option value="${n}" ${n===productPageSize?'selected':''}>${n} 条/页</option>`).join('')}</select></div>`}</section><section class="library-add"><span class="library-plus">＋</span><div><h2>新增店铺产品库</h2><p>为其他店铺建立独立的产品与素材空间</p></div>${btn('add-library','＋ 新增店铺','class="primary" data-write')}</section><p class="library-note">主图按商品资料统计；副图按两套展示；详情页包含两张首页与一套共用正文；不按商品重复累计。资料校验与实际上传顺序保持不变。</p>`;
 $('page-products').querySelectorAll('.library-thumb img').forEach(img=>img.addEventListener('error',()=>{img.parentElement.textContent='图片不可用';},{once:true}));
 status(connected);
}
// Destination directory: read-only projection of existing products and geographic records.
// Continents: mledoze/countries region/subregion, joined to the local gazetteer's ISO code,
// retrieved 2026-09-25. This is a browsing classification, not service coverage.
const destinationRegions = {
  "英国": "欧洲",
  "墨西哥": "北美洲",
  "日本": "亚洲",
  "西班牙": "欧洲",
  "德国": "欧洲",
  "美国": "北美洲",
  "法国": "欧洲",
  "俄罗斯": "欧洲",
  "土耳其": "亚洲",
  "韩国": "亚洲",
  "意大利": "欧洲",
  "印度尼西亚": "亚洲",
  "泰国": "亚洲",
  "加拿大": "北美洲",
  "印度": "亚洲",
  "越南": "亚洲",
  "新加坡": "亚洲",
  "波兰": "欧洲",
  "阿拉伯联合酋长国": "亚洲",
  "奥地利": "欧洲",
  "匈牙利": "欧洲",
  "马来西亚": "亚洲",
  "荷兰": "欧洲",
  "爱尔兰": "欧洲",
  "沙特阿拉伯": "亚洲",
  "埃及": "非洲",
  "巴西": "南美洲",
  "捷克": "欧洲",
  "澳大利亚": "大洋洲",
  "伊朗": "亚洲",
  "希腊": "欧洲",
  "南非": "非洲",
  "阿根廷": "南美洲",
  "菲律宾": "亚洲",
  "比利时": "欧洲",
  "丹麦": "欧洲",
  "葡萄牙": "欧洲",
  "罗马尼亚": "欧洲",
  "哥伦比亚": "南美洲",
  "智利": "南美洲",
  "摩洛哥": "非洲",
  "秘鲁": "南美洲",
  "哈萨克斯坦": "亚洲",
  "瑞典": "欧洲",
  "瑞士": "欧洲",
  "克罗地亚": "欧洲",
  "乌兹别克斯坦": "亚洲",
  "伊拉克": "亚洲",
  "乌克兰": "欧洲",
  "保加利亚": "欧洲",
  "巴基斯坦": "亚洲",
  "阿尔及利亚": "非洲",
  "芬兰": "欧洲",
  "科威特": "亚洲",
  "新西兰": "大洋洲",
  "突尼斯": "非洲",
  "多米尼加共和国": "北美洲",
  "以色列": "亚洲",
  "白俄罗斯": "欧洲",
  "阿曼": "亚洲",
  "拉脱维亚": "欧洲",
  "巴林": "亚洲",
  "厄瓜多尔": "南美洲",
  "肯尼亚": "非洲",
  "挪威": "欧洲",
  "卡塔尔": "亚洲",
  "约旦": "亚洲",
  "斯洛伐克": "欧洲",
  "柬埔寨": "亚洲",
  "缅甸": "亚洲",
  "阿塞拜疆": "亚洲",
  "斯里兰卡": "亚洲",
  "古巴": "北美洲",
  "巴拿马": "北美洲",
  "委内瑞拉": "南美洲",
  "乌拉圭": "南美洲",
  "孟加拉国": "亚洲",
  "波多黎各": "北美洲",
  "埃塞俄比亚": "非洲",
  "土库曼斯坦": "亚洲",
  "吉尔吉斯斯坦": "亚洲",
  "哥斯达黎加": "北美洲",
  "格鲁吉亚": "亚洲",
  "塞尔维亚": "欧洲",
  "尼日利亚": "非洲",
  "巴拉圭": "南美洲",
  "斯洛文尼亚": "欧洲",
  "也门": "亚洲",
  "立陶宛": "欧洲",
  "危地马拉": "北美洲",
  "阿富汗": "亚洲",
  "朝鲜": "亚洲",
  "黎巴嫩": "亚洲",
  "巴哈马": "北美洲",
  "科特迪瓦": "非洲",
  "阿尔巴尼亚": "欧洲",
  "老挝": "亚洲",
  "津巴布韦": "非洲",
  "直布罗陀": "欧洲",
  "爱沙尼亚": "欧洲",
  "科索沃": "欧洲",
  "刚果（金）": "非洲",
  "塞浦路斯": "欧洲",
  "坦桑尼亚": "非洲",
  "尼泊尔": "亚洲",
  "莫桑比克": "非洲",
  "玻利维亚": "南美洲",
  "叙利亚": "亚洲",
  "萨尔瓦多": "北美洲",
  "亚美尼亚": "亚洲",
  "苏丹": "非洲",
  "牙买加": "北美洲",
  "安哥拉": "非洲",
  "冰岛": "欧洲",
  "法属圭亚那": "南美洲",
  "加纳": "非洲",
  "卢旺达": "非洲",
  "卢森堡": "欧洲",
  "文莱": "亚洲",
  "马耳他": "欧洲",
  "利比亚": "非洲",
  "马恩岛": "欧洲",
  "喀麦隆": "非洲",
  "赞比亚": "非洲",
  "美属维尔京群岛": "北美洲",
  "洪都拉斯": "北美洲",
  "尼加拉瓜": "北美洲",
  "多哥": "非洲",
  "海地": "北美洲",
  "黑山": "欧洲",
  "泽西岛": "欧洲",
  "法罗群岛": "欧洲",
  "乌干达": "非洲",
  "根西岛": "欧洲",
  "北马其顿": "欧洲",
  "几内亚": "非洲",
  "蒙古": "亚洲",
  "塞内加尔": "非洲",
  "博茨瓦纳": "非洲",
  "塔吉克斯坦": "亚洲",
  "马尔代夫": "亚洲",
  "波斯尼亚和黑塞哥维那": "欧洲",
  "马里": "非洲",
  "巴布亚新几内亚": "大洋洲",
  "马达加斯加": "非洲",
  "特立尼达和多巴哥": "北美洲",
  "开曼群岛": "北美洲",
  "加蓬": "非洲",
  "摩尔多瓦": "欧洲",
  "福克兰群岛": "南美洲",
  "毛里求斯": "非洲",
  "纳米比亚": "非洲",
  "布基纳法索": "非洲",
  "巴巴多斯": "北美洲",
  "斐济": "大洋洲",
  "毛里塔尼亚": "非洲",
  "索马里": "非洲",
  "贝宁": "非洲",
  "马拉维": "非洲",
  "刚果（布）": "非洲",
  "马提尼克": "北美洲",
  "库拉索": "北美洲",
  "南苏丹": "非洲",
  "乍得": "非洲",
  "苏里南": "南美洲",
  "阿鲁巴": "北美洲",
  "尼日尔": "非洲",
  "吉布提": "非洲",
  "莱索托": "非洲",
  "留尼汪": "非洲",
  "伯利兹": "北美洲",
  "佛得角": "非洲",
  "格陵兰": "北美洲",
  "马约特": "非洲",
  "利比里亚": "非洲",
  "安提瓜和巴布达": "北美洲",
  "圣卢西亚": "北美洲",
  "塞拉利昂": "非洲",
  "关岛": "大洋洲",
  "赤道几内亚": "非洲",
  "布隆迪": "非洲",
  "荷属圣马丁": "北美洲",
  "圭亚那": "南美洲",
  "不丹": "亚洲",
  "斯威士兰": "非洲",
  "冈比亚": "非洲",
  "百慕大": "北美洲",
  "塞舌尔": "非洲",
  "法属波利尼西亚": "大洋洲",
  "圣文森特和格林纳丁斯": "北美洲",
  "瓦努阿图": "大洋洲",
  "英属维尔京群岛": "北美洲",
  "厄立特里亚": "非洲",
  "东帝汶": "亚洲",
  "新喀里多尼亚": "大洋洲",
  "圣皮埃尔和密克隆群岛": "北美洲",
  "萨摩亚": "大洋洲",
  "所罗门群岛": "大洋洲",
  "特克斯和凯科斯群岛": "北美洲",
  "汤加": "大洋洲"
};
let destinationRegion='',destinationType='',destinationState='',destinationView='list',destinationSize=10;
let directoryPositions=null,directoryPositionLoad=null,directoryPositionError=false;
const destinationContinent=d=>destinationRegions[d.country]||'待确认';
function loadDirectoryPositions(){
 if(directoryPositionLoad||directoryPositions)return;
 directoryPositionLoad=get('/api/v1/globe').then(g=>{directoryPositions=new Map(g.items.map(x=>[x.key,x.position]));directoryPositionError=false;}).catch(()=>{directoryPositionError=true;}).finally(()=>{directoryPositionLoad=null;if(page==='destinations')renderDestinations();});
}
function directoryImage(d){
 // A successful import does not prove that the image belongs to the destination.
 const m=d.materials?.find(m=>m.group==='main'&&m.name.includes(d.destination));
 return m&&!(d.issues||[]).some(x=>/主图|错配|目的地.*图/.test(x))?m:null;
}
function directoryThumb(d,large=false){
 const m=directoryImage(d);
 return m?`<img class="dc-photo ${large?'dc-cover':''}" src="${esc(m.url)}" alt="${esc(d.destination)}已导入素材" loading="lazy" data-directory-image>`:`<span class="dc-photo dc-no-photo ${large?'dc-cover':''}" title="图片缺失或名称不匹配，待核对">${icon('images')}${large?'<small>配图待核对</small>':''}</span>`;
}
function directoryStats(d){
 const products=data.products.filter(p=>p.geoKey===d.geoKey);
 return {products:products.length,quotes:data.quotes.filter(q=>q.destinationKey===d.geoKey).length,shops:new Set(products.filter(p=>p.state==='VERIFIED').map(p=>p.shopId)).size};
}
function directoryStatus(d){return `<span class="dc-state ${d.state==='VERIFIED'?'dc-verified':d.state==='NEEDS_DATA'||d.state==='FAILED'?'dc-attention':''}"><i aria-hidden="true"></i>${esc(d.stateLabel||labels[d.state]||'待检查')}</span>`;}
function directoryMap(d,p,expanded=false){
 const tag=expanded?'div':'button';
 return `<${tag} class="dc-map${expanded?' dc-map-expanded':''}" ${expanded?'':`type="button" data-action="directory-map" data-key="${d.key}"`} aria-label="${esc(d.destination)}全球位置${expanded?'示意':'，点击放大'}"><img src="assets/travel-os/earth-day.jpg" alt="全球等经纬平面图"><span class="dc-map-pin" style="left:${(p.lng+180)/3.6}%;top:${(90-p.lat)/1.8}%">${icon('map-pin')}<b>${esc(d.destination)}</b></span>${expanded?'':'<span class="dc-map-hint">点击放大</span>'}</${tag}>`;
}
function directoryDetails(d){
 const stats=directoryStats(d),p=directoryPositions?.get(d.key);
 const position=p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)?p:null;
 const facts=[['destination-products','products','产品'],['destination-quotes','quotes','历史报价'],['destination-shops','shops','已覆盖店铺']];
 return `<div class="dc-detail-heading"><div><h2>${esc(d.destination)}</h2><p>${esc(d.country)} · ${destinationContinent(d)}</p>${directoryStatus(d)}</div><div class="dc-detail-media"><button disabled title="目的地资料编辑尚未接入；原商品资料请在产品库核对">编辑</button>${btn('directory-more','···',`data-key="${d.key}" aria-label="${esc(d.destination)}更多操作"`)}${directoryThumb(d,true)}</div></div>
 <div class="dc-facts">${facts.map(([action,k,label])=>btn(action,`<span>${label}</span><strong>${stats[k]}</strong>`,`data-key="${d.key}" aria-label="查看${esc(d.destination)}${label}"`)).join('')}</div>
 <div class="dc-section-heading"><h3>地理位置</h3>${position?btn('locate',`在地球中查看 ${icon('arrow-square-out')}`,`data-key="${d.key}" class="dc-link"`):''}</div>
 ${position?`${directoryMap(d,position)}<p class="dc-map-caption">${position.precision==='country'?'国家示意点':'城市中心点'} · ${position.lat.toFixed(2)}°, ${position.lng.toFixed(2)}°${position.inferred?' · 位置待复核':''}</p>`:`<div class="dc-map-missing">${icon('globe-hemisphere-east')}<span>${directoryPositionError?'位置读取失败':directoryPositions?'位置待确认':'正在读取位置'}</span>${directoryPositionError?btn('directory-retry','重试'):''}</div>`}
 <dl class="dc-metadata"><div><dt>时区</dt><dd>待补充</dd></div><div><dt>语言</dt><dd>待补充</dd></div><div><dt>旺季</dt><dd>待人工确认</dd></div></dl>
 <h3>简介</h3><p class="dc-description">暂无目的地简介，待补充真实资料。</p>
 <h3>标签</h3><div class="dc-tags"><span>${d.type==='city'?'城市':'国家'}目的地</span><span>${destinationContinent(d)}</span></div>
 ${!directoryImage(d)?'<p class="dc-material-note">主图缺失或名称不匹配，请核对原素材。</p>':''}
 `;
}
function directoryPager(total){
 const pages=Math.max(1,Math.ceil(total/destinationSize)),visible=new Set([1,pages,tablePage-1,tablePage,tablePage+1]);
 let last=0;const numbers=[...visible].filter(n=>n>0&&n<=pages).sort((a,b)=>a-b).map(n=>{const gap=last&&n-last>1?'<span class="dc-ellipsis">…</span>':'';last=n;return gap+btn('directory-page',String(n),`data-page="${n}" aria-label="第 ${n} 页" ${n===tablePage?'aria-current="page"':''}`);}).join('');
 return `<div class="dc-pagination"><div>${btn('directory-page','‹',`data-page="${tablePage-1}" aria-label="上一页" ${tablePage===1?'disabled':''}`)}${numbers}${btn('directory-page','›',`data-page="${tablePage+1}" aria-label="下一页" ${tablePage===pages?'disabled':''}`)}</div><label>每页 <select id="directorySize" aria-label="每页数量">${[10,20,50].map(n=>`<option value="${n}" ${n===destinationSize?'selected':''}>${n} 条</option>`).join('')}</select></label></div>`;
}
function renderDestinations(){
 if(!directoryPositions&&!directoryPositionError&&!directoryPositionLoad)loadDirectoryPositions();
 const unique=[...new Map(data.products.map(d=>[d.geoKey,d])).values()];
 const regionCounts=new Map();for(const d of unique){const r=destinationContinent(d);regionCounts.set(r,(regionCounts.get(r)||0)+1);}
 const rows=unique.filter(d=>(!destinationRegion||destinationContinent(d)===destinationRegion)&&(!destinationCountry||d.country===destinationCountry)&&(!destinationType||d.type===destinationType)&&(!destinationState||d.state===destinationState)&&matching(d,query));
 tablePage=Math.max(1,Math.min(tablePage,Math.max(1,Math.ceil(rows.length/destinationSize))));
 const visible=rows.slice((tablePage-1)*destinationSize,tablePage*destinationSize),d=visible.find(d=>d.key===selectedKey)||visible[0];if(d)selectedKey=d.key;
 const states=[...new Map(unique.map(d=>[d.state,d.stateLabel||labels[d.state]||'待检查'])).entries()];
 const regionButton=(name,total)=>btn('directory-region',`<span>${name||'全部目的地'}</span><span>${total}</span>`,`data-region="${name}" aria-pressed="${destinationRegion===name}"`);
 const rowsHtml=visible.map(x=>{const s=directoryStats(x);return `<tr class="${x.key===d?.key?'dc-selected':''}" data-directory-row="${x.key}"><td><button class="dc-destination" data-action="directory-select" data-key="${x.key}" aria-label="查看${esc(x.destination)}详情" ${x.key===d?.key?'aria-current="true"':''}><span><strong>${esc(x.destination)}</strong><small>${esc(x.country)} · ${destinationContinent(x)}</small></span></button></td><td>${x.type==='city'?'城市':'国家'}</td>${[['products','destination-products'],['quotes','destination-quotes'],['shops','destination-shops']].map(([k,a])=>`<td>${btn(a,String(s[k]),`data-key="${x.key}" class="dc-count" aria-label="查看${esc(x.destination)}${{products:'产品',quotes:'报价',shops:'已覆盖店铺'}[k]}"`)}</td>`).join('')}<td>${directoryStatus(x)}</td><td>${btn('directory-more','···',`data-key="${x.key}" class="dc-more" aria-label="${esc(x.destination)}更多操作"`)}</td></tr>`;}).join('');
 const cards=visible.map(x=>`<button class="dc-card ${x.key===d?.key?'dc-selected':''}" data-action="directory-select" data-key="${x.key}" aria-label="查看${esc(x.destination)}详情">${directoryThumb(x,true)}<strong>${esc(x.destination)}</strong><small>${esc(x.country)} · ${destinationContinent(x)}</small>${directoryStatus(x)}</button>`).join('');
 $('page-destinations').innerHTML=heading('目的地中心','管理全球目的地信息，关联产品与店铺，助力业务拓展')+`
 <div class="dc-toolbar"><label class="dc-search">${icon('magnifying-glass')}<input id="destinationFilter" type="search" aria-label="搜索目的地" placeholder="搜索目的地（如：东京、巴黎、纽约）" value="${esc(query)}"></label><label class="dc-filter">目的地类型<select id="directoryType"><option value="">全部类型</option><option value="country" ${destinationType==='country'?'selected':''}>国家</option><option value="city" ${destinationType==='city'?'selected':''}>城市</option></select></label><label class="dc-filter">状态<select id="directoryState"><option value="">全部状态</option>${states.map(([v,l])=>`<option value="${v}" ${v===destinationState?'selected':''}>${esc(l)}</option>`).join('')}</select></label>${btn('directory-reset','重置')}<span class="dc-total">共 <strong>${rows.length}</strong> 个目的地</span><div class="dc-view">${btn('directory-view',`${icon('list-checks')}列表视图`,`data-view="list" aria-pressed="${destinationView==='list'}"`)}${btn('directory-view',`${icon('images')}卡片视图`,`data-view="cards" aria-pressed="${destinationView==='cards'}"`)}</div></div>
 ${destinationCountry?`<div class="dc-country-filter">国家筛选：${esc(destinationCountry)} ${btn('country-filter','清除',`data-country=""`)}</div>`:''}
 <div class="dc-layout"><aside class="dc-regions" aria-label="按洲筛选">${regionButton('',unique.length)}${['亚洲','欧洲','北美洲','南美洲','大洋洲','非洲',...(regionCounts.has('待确认')?['待确认']:[])].map(r=>regionButton(r,regionCounts.get(r)||0)).join('')}</aside>
 <div class="dc-results">${rows.length?(destinationView==='list'?`<div class="dc-table-scroll"><table><thead><tr><th>目的地</th><th>类型</th><th>产品</th><th>报价</th><th>店铺</th><th>状态</th><th>操作</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`:`<div class="dc-cards">${cards}</div>`):empty('没有匹配的目的地','试试其他关键词，或重置筛选。',btn('directory-reset','重置筛选'))}${directoryPager(rows.length)}</div>
 <aside class="dc-details" aria-label="目的地详情">${d?directoryDetails(d):empty('选择目的地','搜索或调整筛选后查看详情。')}</aside></div>`;
}
function directoryShowMobileDetails(){if(matchMedia('(max-width:1250px)').matches){const d=selected();if(d){dialog(d.destination+' · 目的地详情',`<div class="dc-details dc-mobile-details">${directoryDetails(d)}</div>`);$('editor').classList.add('side-editor');}}}
document.addEventListener('click',e=>{
 const action=e.target.closest('[data-action]');
 if(action?.dataset.action==='directory-select'){selectedKey=action.dataset.key;directoryShowMobileDetails();}
 if(action||!e.target.closest('[data-directory-row]'))return;
 selectedKey=e.target.closest('[data-directory-row]').dataset.directoryRow;renderDestinations();directoryShowMobileDetails();
});
document.addEventListener('error',e=>{if(e.target.matches?.('[data-directory-image]')){const failed=document.createElement('span');failed.className=e.target.className+' dc-no-photo';failed.textContent='图片读取失败';e.target.replaceWith(failed);}},true);

// Phosphor regular icons (MIT), embedded as image resources; see docs/UI_QUOTES_20260925.md.
const quoteIconSources={"file-text": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMTMuNjYsODIuMzRsLTU2LTU2QTgsOCwwLDAsMCwxNTIsMjRINTZBMTYsMTYsMCwwLDAsNDAsNDBWMjE2YTE2LDE2LDAsMCwwLDE2LDE2SDIwMGExNiwxNiwwLDAsMCwxNi0xNlY4OEE4LDgsMCwwLDAsMjEzLjY2LDgyLjM0Wk0xNjAsNTEuMzEsMTg4LjY5LDgwSDE2MFpNMjAwLDIxNkg1NlY0MGg4OFY4OGE4LDgsMCwwLDAsOCw4aDQ4VjIxNlptLTMyLTgwYTgsOCwwLDAsMS04LDhIOTZhOCw4LDAsMCwxLDAtMTZoNjRBOCw4LDAsMCwxLDE2OCwxMzZabTAsMzJhOCw4LDAsMCwxLTgsOEg5NmE4LDgsMCwwLDEsMC0xNmg2NEE4LDgsMCwwLDEsMTY4LDE2OFoiLz48L3N2Zz4=", "database": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRDNzQuMTcsMjQsMzIsNDguNiwzMiw4MHY5NmMwLDMxLjQsNDIuMTcsNTYsOTYsNTZzOTYtMjQuNiw5Ni01NlY4MEMyMjQsNDguNiwxODEuODMsMjQsMTI4LDI0Wm04MCwxMDRjMCw5LjYyLTcuODgsMTkuNDMtMjEuNjEsMjYuOTJDMTcwLjkzLDE2My4zNSwxNTAuMTksMTY4LDEyOCwxNjhzLTQyLjkzLTQuNjUtNTguMzktMTMuMDhDNTUuODgsMTQ3LjQzLDQ4LDEzNy42Miw0OCwxMjhWMTExLjM2YzE3LjA2LDE1LDQ2LjIzLDI0LjY0LDgwLDI0LjY0czYyLjk0LTkuNjgsODAtMjQuNjRaTTY5LjYxLDUzLjA4Qzg1LjA3LDQ0LjY1LDEwNS44MSw0MCwxMjgsNDBzNDIuOTMsNC42NSw1OC4zOSwxMy4wOEMyMDAuMTIsNjAuNTcsMjA4LDcwLjM4LDIwOCw4MHMtNy44OCwxOS40My0yMS42MSwyNi45MkMxNzAuOTMsMTE1LjM1LDE1MC4xOSwxMjAsMTI4LDEyMHMtNDIuOTMtNC42NS01OC4zOS0xMy4wOEM1NS44OCw5OS40Myw0OCw4OS42Miw0OCw4MFM1NS44OCw2MC41Nyw2OS42MSw1My4wOFpNMTg2LjM5LDIwMi45MkMxNzAuOTMsMjExLjM1LDE1MC4xOSwyMTYsMTI4LDIxNnMtNDIuOTMtNC42NS01OC4zOS0xMy4wOEM1NS44OCwxOTUuNDMsNDgsMTg1LjYyLDQ4LDE3NlYxNTkuMzZjMTcuMDYsMTUsNDYuMjMsMjQuNjQsODAsMjQuNjRzNjIuOTQtOS42OCw4MC0yNC42NFYxNzZDMjA4LDE4NS42MiwyMDAuMTIsMTk1LjQzLDE4Ni4zOSwyMDIuOTJaIi8+PC9zdmc+", "tag": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yNDMuMzEsMTM2LDE0NCwzNi42OUExNS44NiwxNS44NiwwLDAsMCwxMzIuNjksMzJINDBhOCw4LDAsMCwwLTgsOHY5Mi42OUExNS44NiwxNS44NiwwLDAsMCwzNi42OSwxNDRMMTM2LDI0My4zMWExNiwxNiwwLDAsMCwyMi42MywwbDg0LjY4LTg0LjY4YTE2LDE2LDAsMCwwLDAtMjIuNjNabS05Niw5Nkw0OCwxMzIuNjlWNDhoODQuNjlMMjMyLDE0Ny4zMVpNOTYsODRBMTIsMTIsMCwxLDEsODQsNzIsMTIsMTIsMCwwLDEsOTYsODRaIi8+PC9zdmc+", "clock": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRBMTA0LDEwNCwwLDEsMCwyMzIsMTI4LDEwNC4xMSwxMDQuMTEsMCwwLDAsMTI4LDI0Wm0wLDE5MmE4OCw4OCwwLDEsMSw4OC04OEE4OC4xLDg4LjEsMCwwLDEsMTI4LDIxNlptNjQtODhhOCw4LDAsMCwxLTgsOEgxMjhhOCw4LDAsMCwxLTgtOFY3MmE4LDgsMCwwLDEsMTYsMHY0OGg0OEE4LDgsMCwwLDEsMTkyLDEyOFoiLz48L3N2Zz4=", "plus-circle": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRBMTA0LDEwNCwwLDEsMCwyMzIsMTI4LDEwNC4xMSwxMDQuMTEsMCwwLDAsMTI4LDI0Wm0wLDE5MmE4OCw4OCwwLDEsMSw4OC04OEE4OC4xLDg4LjEsMCwwLDEsMTI4LDIxNlptNDgtODhhOCw4LDAsMCwxLTgsOEgxMzZ2MzJhOCw4LDAsMCwxLTE2LDBWMTM2SDg4YTgsOCwwLDAsMSwwLTE2aDMyVjg4YTgsOCwwLDAsMSwxNiwwdjMyaDMyQTgsOCwwLDAsMSwxNzYsMTI4WiIvPjwvc3ZnPg=="};
const quoteIcon=name=>quoteIconSources[name]?`<img src="${quoteIconSources[name]}" alt="">`:icon(name);
let quoteSort='newest';
function renderQuotes(){
 const all=data.quotes,scope=all.filter(q=>!quoteGeo||q.destinationKey===quoteGeo);
 const items=scope.filter(q=>(quoteKind==='ALL'||q.kind===quoteKind)&&matching(q,query)).sort((a,b)=>quoteSort==='oldest'?a.at.localeCompare(b.at):b.at.localeCompare(a.at));
 const pagination=pager(items.length),focused=data.products.find(d=>d.geoKey===quoteGeo);
 const recent=[...scope].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5);
 const stats=[['file-text','blue','报价总数',all.length],['database','green','成本报价条数',all.filter(q=>q.kind==='COST').length],['tag','orange','销售报价条数',all.filter(q=>q.kind==='SALE').length],['map-pin','purple','覆盖目的地',new Set(all.map(q=>q.destinationKey)).size]];
 const filtered=Boolean(query.trim()||quoteKind!=='ALL'||quoteGeo);
 const add=label=>btn('add-quote',quoteIcon('plus-circle')+label,'class="primary" data-write');
 $('page-quotes').innerHTML=`<div class="page-heading quotes-heading"><div><h1>报价库</h1><p>集中管理全球目的地产品报价，支持多供应商、多币种、历史记录查询。</p></div><div class="quotes-heading-actions"><div class="quotes-search">${icon('magnifying-glass')}<input id="quoteFilter" type="search" aria-label="搜索报价目的地" placeholder="搜索目的地（如：日本、泰国、欧洲…）" value="${esc(query)}"></div>${add('录入报价')}</div></div>
 <div class="quotes-stats" aria-label="报价统计，包含历史归档记录">${stats.map(([i,color,label,n])=>`<div class="quotes-stat"><span class="quotes-symbol ${color}">${quoteIcon(i)}</span><div><span>${label}</span><strong>${n}</strong></div></div>`).join('')}</div>
 <div class="quotes-layout"><section class="quotes-card quotes-list" aria-labelledby="quotesListHeading"><div class="quotes-card-heading"><h2 id="quotesListHeading" tabindex="-1">报价列表</h2><select id="quoteSort" aria-label="报价排序"><option value="newest" ${quoteSort==='newest'?'selected':''}>最新创建</option><option value="oldest" ${quoteSort==='oldest'?'selected':''}>最早创建</option></select></div>
 ${all.length||filtered?`<div class="quotes-filters"><div class="tabs" aria-label="报价类型">${[['ALL','全部报价'],['COST','供应商成本价'],['SALE','对客销售价']].map(([k,t])=>btn('quote-kind',t,`data-kind="${k}" aria-pressed="${quoteKind===k}"`)).join('')}</div>${focused?`<div class="quotes-scope">${esc(focused.destination)} ${btn('clear-quote-destination','查看全部目的地','class="text-button"')}</div>`:''}</div>`:''}
 ${items.length?`<div class="table-wrap quotes-table"><table><thead><tr><th>目的地 / 服务</th><th>报价 / 单位</th><th>供应商</th><th>有效期 / 状态</th><th>操作</th></tr></thead><tbody>${items.slice((tablePage-1)*20,tablePage*20).map(q=>`<tr><td><strong>${esc(q.destination)}</strong><small class="quotes-service" title="${esc(q.service)}">${esc(q.service)}</small><time>${time(q.at)}</time></td><td><span class="quotes-kind ${q.kind==='COST'?'cost':'sale'}">${q.kind==='COST'?'成本价':'销售价'}</span><strong class="quotes-money">${esc(money(q))}</strong></td><td><span class="quotes-supplier" title="${esc(q.supplier||'未填写')}">${esc(q.supplier||'未填写')}</span></td><td>${esc(q.validUntil||'未设期限')}<small>${q.archived?'已归档':q.validUntil&&q.validUntil<new Date().toLocaleDateString('sv-SE')?'已过期':'在用记录'}</small></td><td>${btn('quote-detail','详情',`data-id="${esc(q.id)}" class="text-button"`)}</td></tr>`).join('')}</tbody></table></div><div class="quotes-pagination">${pagination}</div>`:
 `<div class="quotes-empty">${quoteIcon('file-text')}<h3>${filtered?'没有匹配的报价':'还没有报价'}</h3><p>${filtered?'试试其他目的地，或清除筛选查看全部报价。':'录入报价，开始管理您的旅行产品价格'}</p>${filtered?btn('quote-reset','清除筛选','class="primary"'):add('录入第一条报价')}</div>`}
 </section><aside class="quotes-aside"><section class="quotes-card quotes-recent" aria-labelledby="quotesRecentHeading"><div class="quotes-card-heading"><h2 id="quotesRecentHeading">最近报价记录</h2>${btn('quote-show-all','查看更多 '+icon('arrow-right'),'class="text-button"')}</div>${recent.length?`<div class="quotes-recent-list">${recent.map(q=>btn('quote-detail',`<span class="quotes-recent-icon ${q.kind==='COST'?'green':'orange'}">${quoteIcon(q.kind==='COST'?'database':'tag')}</span><span class="quotes-recent-copy"><strong>${esc(q.destination)} · ${esc(q.service)}</strong><small>${q.kind==='COST'?'成本价':'销售价'}${q.archived?' · 已归档':''} · ${time(q.at)}</small></span><span class="quotes-recent-money">${esc(money(q))}</span>`,`data-id="${esc(q.id)}"`)).join('')}</div>`:`<div class="quotes-recent-empty">${quoteIcon('clock')}<strong>暂无报价记录</strong><p>录入报价后，这里将显示最近的报价记录</p></div>`}</section>
 <section class="quotes-card quotes-tips"><h2>使用提示</h2>${[['tag','blue','区分成本价与销售价','成本价是向供应商采购的价格，销售价是面向客户的报价。'],['file-text','green','保留历史记录','每次录入都会保存为独立记录，方便追溯与对比。'],['magnifying-glass','purple','快速搜索','支持按目的地查找报价，快速定位所需产品。']].map(([i,color,title,text])=>`<div class="quotes-tip"><span class="quotes-symbol ${color}">${quoteIcon(i)}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join('')}</section></aside></div>`;
 status(connected);
}

function taskItems(){const b=data.engine.batch;return [...(b?.items||[]).map(x=>({...x,shopId:data.engine.shop.id,kind:'execution',name:x.destination||x.task?.listing?.city||x.task?.listing?.country||x.title,displayState:x.displayState||x.state})),...data.preparations.filter(x=>x.state!=='QUEUED').map(x=>({...x,kind:'preparation',name:x.destination,displayState:x.state}))];}
function renderTasks(){
 const e=data.engine,b=e.batch,shop=data.shops.find(s=>s.id===taskShop)||data.shops.find(s=>s.id===e.shop.id),same=shop?.id===e.shop.id;
 const items=taskItems().filter(x=>x.shopId===shop?.id),products=productsForShop(shop?.id),batchItems=items.filter(x=>x.kind==='execution');
 if(!items.some(x=>x.id===selectedTask))selectedTask=items.find(x=>x.id===b?.current)?.id||items.find(x=>taskGroup(x)==='running')?.id||(b?.state==='COMPLETED'?items.at(-1)?.id:items[0]?.id);
 const detailOpen=document.querySelector('#taskExecutionDetails')?.open,searchFocused=document.activeElement?.id==='taskSearch',selection=document.activeElement?.selectionStart;
 const signature=JSON.stringify([items,selectedTask,taskShop,selectedBatch,queueFilter,taskSearch,taskTablePage,e.browser,e.execution,e.settings.executionEnabled,connected,taskDetail,products.map(p=>[p.key,p.counts,p.issues]),data.materials,data.shops,b?.state]);
 if(renderTasks.signature===signature&&$('taskElapsed')){$('taskElapsed').textContent=`已用时 ${Math.round((same?b?.elapsedMs||0:0)/1000)} 秒`;return;}renderTasks.signature=signature;
 const task=items.find(x=>x.id===selectedTask),active=same&&e.active,paused=['WAITING_HUMAN','PAUSED_CAPTCHA','RESULT_UNKNOWN','PAUSED'].includes(task?.displayState);
 const total=batchItems.length,handled=batchItems.filter(x=>taskGroup(x)==='done').length,done=batchItems.filter(x=>['SUCCEEDED','VERIFIED'].includes(x.displayState)).length;
 const running=batchItems.filter(x=>taskGroup(x)==='running').length,attention=batchItems.filter(x=>taskGroup(x)==='attention').length,percent=total?Math.round(handled/total*100):0;
 const product=products.find(d=>(task?.runId&&d.runId===task.runId)||d.key===task?.productKey),result=task?.result||{},view=taskListView(items,{filter:queueFilter,search:taskSearch,page:taskTablePage});taskTablePage=view.page;
 const currentLabel=!same?'待适配':e.execution.label||'待检查';
 const stateTone=!connected?'offline':paused?'attention':active?'running':'idle';
 $('page-tasks').innerHTML=heading('自动化任务','从资料核对到执行结果，让每一步清晰可查。')+`
 <div class="execution-shop panel"><label>执行店铺<select id="taskShopSelector">${data.shops.map(s=>`<option value="${s.id}" ${s.id===shop?.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><div class="task-browser-state"><span>Chrome 状态</span>${badge(shop?.browser.loggedIn?'VERIFIED':'PAUSED',shop?.browser.label||'待检查')}</div>${btn('shop-browser',icon('arrow-square-out')+' 打开浏览器',`data-id="${shop?.id}" data-write`)}<div class="task-batch-controls">${same?`<details class="batch-picker"><summary>选择批次</summary><label>执行批次<select id="batchSelector"><option value="">最近批次</option>${e.batches.map(x=>`<option value="${x.id}" ${x.id===selectedBatch?'selected':''}>${time(x.at)} · ${labels[x.state]||x.state}</option>`).join('')}</select></label></details>${btn('review-batch',icon('plus')+' 创建执行批次','class="primary" data-write')}`:linkButton('#shops','查看店铺适配')}</div></div>
 <div class="task-summary-grid">
  <section class="current-listing panel"><div class="section-title"><h2>${active?'当前执行批次':'最近执行批次'}</h2>${task?btn('task-details','查看详情 ›','class="text-button"'):''}</div><div class="task-product-summary"><span class="task-destination-icon">${icon('map-pin')}</span><div><small>${task?.kind==='preparation'?'所选准备单':'所选商品'}</small><h3>${esc(task?.name||'暂无执行任务')}</h3><p title="${esc(task?.title||product?.title||'')}">${esc(task?.title||product?.title||'先核对商品资料，再创建执行批次。')}</p></div></div>
  <div class="task-progress-heading"><strong>本批处理进度 <b>${handled} / ${total}</b></strong><span>${percent}%</span></div><progress max="100" value="${percent}" aria-label="本批处理完成比例"></progress><p class="task-progress-note">已结束含跳过、取消与仅填写完成；不等同上架成功。</p><div class="task-outcomes"><div><strong>${done}</strong><span>已核验上架</span>${icon('check-circle')}</div><div><strong>${running}</strong><span>执行中</span>${icon('arrow-clockwise')}</div><div><strong>${attention}</strong><span>异常 / 待处理</span>${icon('warning-circle')}</div></div></section>
  <aside class="task-inspector panel"><h2>当前状态</h2><div class="task-state-hero ${stateTone}"><span class="task-state-dot" aria-hidden="true"></span><div><strong>${esc(!connected?'连接中断':currentLabel)}</strong><p>${esc(!connected?'显示上次读取的数据，请重新连接。':same?e.execution.detail||'等待下一项任务。':'该店铺尚未完成自动执行适配。')}</p></div></div><div class="task-state-facts"><div><small>当前店铺</small><strong>${esc(shop?.name||'未选择')}</strong></div><div><small>所选商品状态</small><strong>${esc(task?.displayState==='DRY_RUN_COMPLETE'?'仅填写完成，未发布':labels[task?.displayState]||'暂无任务')}</strong></div></div>
  ${paused&&!(task?.issue&&task?.reason)?`<div class="task-recovery notice ${task.displayState==='RESULT_UNKNOWN'?'danger':''}"><strong>${task.displayState==='RESULT_UNKNOWN'?'先核验原商品结果':'等待人工处理'}</strong><p>${esc(task.reason||'请在原执行浏览器中检查并处理，保留当前页面。')}</p></div>`:''}${same?renderIntervention(task):linkButton('#shops','查看店铺')}
  <details id="taskExecutionDetails" ${detailOpen?'open':''}><summary>查看执行详情</summary>${result.url?`<a class="task-result-link" href="${esc(result.url)}" target="_blank" rel="noopener">查看所选商品链接 ↗</a>`:''}${renderFlow(task)}<h3>执行日志</h3>${renderLogs(task)}</details></aside>
 </div>
 <section class="material-summary panel"><div class="section-title"><h2>店铺素材库</h2>${btn('material-library','查看套图清单 ›',`data-id="${shop?.id}" class="text-button"`)}</div><div class="task-material-grid">${['main','secondary','details'].map((g,i)=>{const m=shopMaterials(shop?.id),count=m?.[g].count,note=!m?'清单待核对':m.status==='unconfigured'?'尚未关联资料':g==='main'?'商品主图，不含候选模板':g==='secondary'?m.secondary.sets.map(x=>x.count+' 张').join(' + ')+' · '+m.secondary.sets.length+' 套':m.details.sets.length+' 套正文 · 首页候选 '+m.covers.count+' 张';return `<button class="task-material-item material-${g}" data-action="${g==='main'?'shop-products':'material-library'}" data-id="${shop?.id}" data-group="${g}"><span class="task-material-icon">${icon(i===2?'list-checks':'images')}</span><span class="task-material-info"><strong>${materialName(g)}</strong><span class="task-material-count"><b>${count===undefined?'—':count.toLocaleString('zh-CN')}</b>${count===undefined?'':' 张'}</span><small>${esc(note)}</small></span>${icon('arrow-right')}</button>`;}).join('')}</div><p class="task-progress-note">按当前店铺所用资料版本统计实际文件，不按商品重复累计；详情正文与首页分开统计。${esc(shopMaterials(shop?.id)?.warnings?.join('；')||'')}</p></section>
 <section class="panel queue-panel"><div class="task-queue-toolbar"><h2>任务列表</h2>${same?retryButton():''}<div class="tabs" aria-label="任务分类">${[['all','全部'],['running','执行中'],['waiting','等待'],['done','已结束'],['attention','异常']].map(([k,t])=>btn('queue-filter',`${t} <span class="task-tab-count">${view.counts[k]}</span>`,`data-filter="${k}" aria-pressed="${queueFilter===k}"`)).join('')}</div><label class="task-search-label">${icon('magnifying-glass')}<input id="taskSearch" type="search" placeholder="搜索目的地或商品标题" aria-label="搜索任务" value="${esc(taskSearch)}"></label><span id="taskElapsed">已用时 ${Math.round((same?b?.elapsedMs||0:0)/1000)} 秒</span></div>
 <div class="table-wrap task-table"><table><thead><tr><th>序号</th><th>目的地</th><th>商品 / 任务</th><th>状态</th><th>开始时间</th><th>完成时间</th><th>操作</th></tr></thead><tbody>${view.rows.map((x,i)=>`<tr class="${x.id===selectedTask?'selected-task':''}"><td>${(view.page-1)*10+i+1}</td><td><strong>${esc(x.name)}</strong></td><td><span class="task-table-title" title="${esc(x.title||'')}">${esc(x.title|| (x.kind==='preparation'?'产品准备单':'商品上架任务'))}</span>${x.state==='FAILED'?`<small class="task-error-summary">${esc(failureSummary(x))}</small>`:''}</td><td>${badge(x.displayState,x.displayState==='DRY_RUN_COMPLETE'?'仅填写完成':labels[x.displayState])}</td><td>${x.started?time(x.started):'—'}</td><td>${x.finished?time(x.finished):'—'}</td><td><div class="task-row-actions">${btn('select-task','查看',`data-id="${x.id}" aria-label="查看${esc(x.name)}任务" class="text-button"`)}${btn('task-logs','日志',`data-id="${x.id}" aria-label="查看${esc(x.name)}日志" class="text-button"`)}</div></td></tr>`).join('')||`<tr><td colspan="7"><div class="task-table-empty">${items.length?'没有匹配任务，请调整分类或搜索词。':'还没有任务。核对资料后创建执行批次。'}</div></td></tr>`}</tbody></table></div><div class="pagination"><span>${view.total} 条 · 第 ${view.page} / ${view.pages} 页</span>${btn('task-prev','上一页',view.page===1?'disabled':'')}${btn('task-next','下一页',view.page===view.pages?'disabled':'')}</div></section>`;
 if(searchFocused){$('taskSearch').focus();if(selection!==null)try{$('taskSearch').setSelectionRange(selection,selection);}catch{}}
 status(connected);
}
function renderFlow(task){const detail=taskDetail?.id===task?.runId?taskDetail:null,events=detail?.events||[];const steps=[['资料核对','原始资料快照与图片校验',n=>/identity|asset|navigate/.test(n)],['填写商品','类目、标题、主图、属性与详情',n=>/title|image|detail|categor|attribute|business|price|stock/.test(n)],['提交前检查','核对页面与发布范围',n=>/pre-submit/.test(n)],['提交商品','只提交一次，结果不明先核验',n=>/^submit-once$/.test(n)],['平台核验','保留平台商品 ID、状态与证据',n=>/verify-platform/.test(n)]];
 if(!task)return empty('还没有执行任务','在目的地选择产品，或核对热度批次。创建后仍需人工确认开始。');if(task.kind==='preparation')return `<div class="notice">准备单已保存，还没有进入 Playwright 执行队列。</div><div class="flow-node current"><span class="node-dot">1</span><div><h3>准备 ${esc(task.destination)} 的产品</h3><p>目标店铺：${esc(shopName(task.shopId))}</p></div></div><p class="form-note">核对这条商品的原资料与素材后，可生成单商品仅填写任务。创建不会开始执行，已有成功或占用记录会被拦截。</p><div class="actions section-gap">${btn('product-detail','查看源资料',`data-key="${task.productKey}"`)}</div>`;
 return steps.map(([name,hint,test],i)=>{const passed=events.some(x=>x.kind==='STEP_VERIFIED'&&test(x.technical?.step||''));const evidence=passed||(task.state==='SUCCEEDED'&&i===4);const last=events.at(-1);const current=last?.kind==='STEP_INTENT'&&test(last.technical?.step||'');return `<div class="flow-node ${evidence?'done':current?'current':''}"><span class="node-dot">${evidence?'✓':i+1}</span><div><h3>${name}</h3><p>${evidence?'已有核验事件':hint}</p></div></div>`;}).join('')+`<p class="form-note">当前步骤：${esc(detail?.checkpoint?.step||task.step||'尚未读取步骤')}。节点只根据实际日志标记，不估算完成百分比。</p>`;
}
function renderLogs(task){const rows=taskDetail&&task?.runId&&taskDetail.id===task.runId?taskDetail.events||[]:[];return rows.length?`<ul class="log-list">${rows.slice(-35).reverse().map(x=>`<li><time>${shortTime(x.at)}</time>${esc(x.label)}${Number.isFinite(x.durationMs)?` <small>${(x.durationMs/1000).toFixed(2)} 秒</small>`:''}${x.reason?`<p>${esc(x.reason)}</p>`:''}${x.screenshotError?`<p>本次截图未保存：${esc(x.screenshotError)}</p>`:''}<details><summary>技术详情${x.screenshot?'与截图':''}</summary><p>${esc(x.technical?.step||x.kind)} ${esc(x.raw)}</p>${x.screenshot?`<a href="${esc(x.screenshot)}" target="_blank" rel="noopener">查看步骤截图</a>`:''}</details></li>`).join('')}</ul>`:'<p class="form-note section-gap">此任务尚无已读取的执行日志。选择执行任务可读取真实记录。</p>';}
function renderIntervention(task){const e=data.engine,b=e.batch,issue=task?.issue;const missing=e.records.find(r=>r.runId===task?.runId&&r.verified===false&&!r.itemId);if(task?.kind==='preparation')return `<div class="actions">${task.state==='PREPARING'?btn('review-selected','核对此商品并入队',`data-id="${task.id}" class="primary" data-write`):''}${task.state==='PREPARING'?btn('cancel-preparation','取消准备单',`data-id="${task.id}" data-write`):''}</div>`;return `${issue&&task?.reason?`<div class="notice ${task.displayState==='RESULT_UNKNOWN'?'danger':''}"><strong>${esc(issue.category)}</strong><p>${esc(task.reason)}</p><p>恢复条件：${esc(issue.condition)}</p></div>`:''}<div class="actions">${missing&&!e.active?btn('associate-result','关联原商品并核验',`data-id="${esc(missing.runId)}" class="primary" data-write`):''}${b?.state==='READY'?btn('start','核对并开始批次','class="primary" data-write'):''}${e.active?btn('pause',e.execution.state==='PAUSING'?'正在暂停…':'停止并保存断点',`data-write ${e.execution.state==='PAUSING'?'disabled data-locked="true"':''}`):''}${b&&['PAUSED','WAITING_HUMAN'].includes(b.state)?btn('continue',task?.displayState==='RESULT_UNKNOWN'?'检查并核验原商品':'已处理，检查并继续','class="primary" data-write'):''}${retryButton()}${task&&['PENDING','RETRY','FAILED','WAITING_HUMAN'].includes(task.state)&&task.displayState!=='RESULT_UNKNOWN'&&!e.active&&task.displayState!=='PAUSED_CAPTCHA'&&task.issue?.category!=='验证码'?btn('skip','永久跳过此项',`data-id="${task.id}" data-write`):''}${btn('engine-browser','打开执行 Chrome','data-write')}${linkButton('#settings','查看执行设置')}</div>`;}
// Records view: read-only projection; never changes execution or historical evidence.
let recordResult='',recordWarehouse='',recordException='',recordFrom='',recordTo='',recordAscending=false;
const recordPageSize=8;
function recordPager(total){const pages=Math.max(1,Math.ceil(total/recordPageSize));tablePage=Math.min(tablePage,pages);return `<div class="pagination"><span role="status">${total} 条 · 第 ${tablePage} / ${pages} 页</span>${btn('previous-page','上一页',tablePage===1?'disabled':'')}${btn('next-page','下一页',tablePage===pages?'disabled':'')}</div>`;}
function recordDate(value){const d=new Date(value);return value&&!Number.isNaN(+d)?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';}
function recordRows(snapshot){
 const e=snapshot.engine,known=new Set(e.records.map(r=>r.runId).filter(Boolean));
 const attempts=new Map(snapshot.attempts.map(a=>[a.id,a]));
 return [...e.records.map(r=>({...r,state:r.verified?'VERIFIED':'RESULT_UNKNOWN'})),...snapshot.attempts.filter(a=>!known.has(a.id)).map(a=>({...a,runId:a.id}))].map((r,index)=>{
  const a=attempts.get(r.runId),p=snapshot.products.find(d=>(r.key&&d.key===r.key)||(r.runId&&d.runId===r.runId))||snapshot.products.find(d=>a&&d.shopId===a.shopId&&d.geoKey===a.geoKey);
  const warehouse=/^(仓库中|已入库)$/.test(r.status||'')?'stored':r.status==='出售中'?'selling':'unknown';
  const success=['VERIFIED','SUCCEEDED'].includes(r.state),exception=['FAILED','WAITING_HUMAN','PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(r.state);
  return {...r,index,shopId:r.shopId||a?.shopId||p?.shopId||e.shop.id,geoKey:r.geoKey||a?.geoKey||p?.geoKey,title:r.title||a?.title||p?.title||r.destination,destination:r.destination||a?.destination||p?.destination||'未命名商品',itemId:r.itemId||a?.itemId,at:r.at||a?.updated||a?.at,photo:p?.materials?.find(m=>m.group==='main')?.url||'',warehouse,success,exception,reason:r.reason||a?.reason||''};
 });
}
function recordView(){
 const all=recordRows(data),dated=all.filter(r=>(!recordGeo||r.geoKey===recordGeo)&&(!recordFrom||recordDate(r.at)>=recordFrom)&&(!recordTo||(recordDate(r.at)&&recordDate(r.at)<=recordTo))),scope=dated.filter(r=>!recordShop||r.shopId===recordShop);
 const q=recordQuery.trim().toLocaleLowerCase();
 const rows=scope.filter(r=>(!q||[r.title,r.destination,r.itemId,r.key].some(v=>String(v||'').toLocaleLowerCase().includes(q)))&&(!recordResult||(recordResult==='success'?r.success:recordResult===r.state))&&(!recordWarehouse||r.warehouse===recordWarehouse)&&(!recordException||(recordException==='yes'?r.exception:!r.exception)));
 rows.sort((a,b)=>(recordAscending?1:-1)*((Date.parse(a.at)||0)-(Date.parse(b.at)||0))||a.index-b.index);
 return {all,dated,scope,rows};
}
function recordWarehouseLabel(r){return {stored:'已确认在仓库',selling:'出售中 · 非仓库',unknown:'未核验'}[r.warehouse];}
function recordResultLabel(r){return r.success?'上架成功':r.state==='FAILED'?'上架失败':labels[r.state]||r.state||'待确认';}
function recordTime(value){const date=recordDate(value);if(!date)return '暂无记录';const d=new Date(value);return date+' '+[d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');}
function recordExceptionLabel(r){return r.exception?(r.reason||labels[r.state]||'待确认'):'—';}
function recordCsv(rows){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\ufeff'+[['店铺','商品','目的地','平台 ID','执行结果','仓库核验','异常状态','时间','商品链接'],...rows.map(r=>[shopName(r.shopId),r.title,r.destination,r.itemId,recordResultLabel(r),recordWarehouseLabel(r),recordExceptionLabel(r),recordTime(r.at),r.url||''])].map(row=>row.map(cell).join(',')).join('\r\n');}
function exportRecords(){if(!connected){toast('连接中断，请重新连接后导出',true);return;}const rows=recordView().rows;if(!rows.length){toast('当前筛选没有可导出的记录');return;}const url=URL.createObjectURL(new Blob([recordCsv(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`上架记录-${recordDate(new Date())}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出当前筛选的 ${rows.length} 条记录`);}
function resetRecordFilters(){recordQuery='';recordResult='';recordWarehouse='';recordException='';recordFrom='';recordTo='';recordGeo='';recordAscending=false;tablePage=1;}
function recordOptions(items,value){return items.map(([v,label])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(label)}</option>`).join('');}
function renderRecords(){
 const {all,dated,scope,rows}=recordView(),pagination=recordPager(rows.length),shops=[...new Map([...data.shops.map(s=>[s.id,s.name]),...all.filter(r=>!data.shops.some(s=>s.id===r.shopId)).map(r=>[r.shopId,'已移除店铺'])]).entries()];
 const metrics=[['list-checks','上架记录',scope.length,'blue'],['check-circle','上架成功',scope.filter(r=>r.success).length,'green'],['arrow-clockwise','待核验',scope.filter(r=>r.state==='RESULT_UNKNOWN').length,'orange'],['warning-circle','异常记录',scope.filter(r=>r.exception).length,'red']];
 const options=[['','执行结果'],['success','上架成功'],['RESULT_UNKNOWN','待核验'],['FAILED','上架失败'],...Object.entries(labels).filter(([k])=>!['VERIFIED','SUCCEEDED','RESULT_UNKNOWN','FAILED'].includes(k)&&all.some(r=>r.state===k))];
 const shopOptions=[['','全部店铺'],...shops];
 $('page-records').innerHTML=heading((data.products.find(d=>d.geoKey===recordGeo)?.destination||'')+(recordGeo?' · 上架记录':'上架记录'),'查看商品在各店铺的上架执行情况，支持筛选、查询与导出。')+`
 <div class="records-metrics" aria-label="所选店铺与日期统计">${metrics.map(([i,label,n,color])=>`<div class="records-metric ${color}" title="按所选店铺和日期统计；待核验与异常可能重叠"><span class="records-metric-icon">${icon(i)}</span><div><span>${label}</span><strong>${n.toLocaleString('zh-CN')}</strong></div></div>`).join('')}</div>
 <div class="records-layout"><aside class="records-shops"><h2>${icon('compass')}店铺列表</h2><div class="records-shop-buttons">${shopOptions.map(([id,name])=>btn('record-shop',`${icon('compass')}<span>${esc(name)}</span><small>${dated.filter(r=>!id||r.shopId===id).length}</small>`,`data-id="${esc(id)}" aria-pressed="${recordShop===id}"`)).join('')}</div><label class="records-mobile-shop">选择店铺<select id="recordShopSelect">${recordOptions(shopOptions,recordShop)}</select></label></aside>
 <section class="records-main" aria-label="上架记录列表"><div class="records-toolbar"><label class="records-search">${icon('magnifying-glass')}<input id="recordFilter" type="search" aria-label="筛选上架记录" placeholder="搜索商品名称、编号或目的地…" value="${esc(recordQuery)}"></label>
 <select id="recordResult" aria-label="执行结果">${recordOptions(options,recordResult)}</select><select id="recordWarehouse" aria-label="仓库核验">${recordOptions([['','仓库核验'],['stored','已确认在仓库'],['selling','出售中 · 非仓库'],['unknown','未核验']],recordWarehouse)}</select><select id="recordException" aria-label="异常状态">${recordOptions([['','异常状态'],['yes','有异常'],['no','无异常']],recordException)}</select>
 <div class="records-dates" role="group" aria-label="日期范围"><input type="date" id="recordFrom" aria-label="开始日期" value="${recordFrom}" ${recordTo?`max="${recordTo}"`:''}><span>至</span><input type="date" id="recordTo" aria-label="结束日期" value="${recordTo}" ${recordFrom?`min="${recordFrom}"`:''}></div>
 ${btn('record-reset','重置')}${btn('record-export',`${icon('upload-simple')}导出记录`,`class="primary" ${rows.length?'':'disabled'}`)}</div>
 ${recordFrom&&recordTo&&recordFrom>recordTo?'<p class="records-warning" role="alert">开始日期不能晚于结束日期，请调整日期范围。</p>':''}${recordGeo?`<div class="records-context">已按目的地筛选 ${btn('clear-record-destination','查看全部目的地')}</div>`:''}
 <div class="table-wrap"><table><colgroup><col class="records-product-col"><col><col><col><col class="records-time-col"><col class="records-action-col"></colgroup><thead><tr><th scope="col">商品</th><th scope="col">执行结果</th><th scope="col">仓库核验</th><th scope="col">异常状态</th><th scope="col" aria-sort="${recordAscending?'ascending':'descending'}">${btn('record-sort',`时间 ${recordAscending?'↑':'↓'}`,'aria-label="切换时间排序"')}</th><th scope="col">操作</th></tr></thead><tbody>${rows.slice((tablePage-1)*recordPageSize,tablePage*recordPageSize).map(r=>`<tr><td><div class="records-product">${r.photo?`<img src="${esc(r.photo)}" alt="${esc(r.destination)}商品主图">`:'<span class="records-no-photo">暂无图片</span>'}<div><strong title="${esc(r.title)}">${esc(r.title)}</strong><small>${r.itemId?'平台 ID：'+esc(r.itemId):'尚无平台 ID'}</small></div></div></td><td>${badge(r.state,recordResultLabel(r))}</td><td><span class="badge ${r.warehouse==='stored'?'good':''}">${recordWarehouseLabel(r)}</span></td><td><span class="records-exception ${r.exception?'has-exception':''}" title="${esc(recordExceptionLabel(r))}">${esc(recordExceptionLabel(r))}</span></td><td class="records-time">${recordTime(r.at)}</td><td><div class="records-actions">${r.runId?btn('record-detail','查看',`data-id="${esc(r.runId)}" class="text-button"`):btn('record-history','查看',`data-id="${r.index}" class="text-button"`)}${r.itemId||r.url?`<details><summary>更多</summary><div>${r.itemId?btn('record-copy','复制平台 ID',`data-id="${esc(r.itemId)}"`):''}${/^https?:\/\//.test(r.url||'')?`<a href="${esc(r.url)}" target="_blank" rel="noopener">打开商品链接</a>`:''}</div></details>`:''}</div></td></tr>`).join('')}</tbody></table></div>
 ${rows.length?'':empty('没有匹配记录','试试调整店铺、关键词或日期范围。',btn('record-reset','清除筛选'))}${pagination}<p class="records-note">统计按店铺与日期汇总；待核验与异常可能重叠。上架成功与仓库核验分别记录。</p></section></div>`;
}
document.addEventListener('change',event=>{const bindings={recordResult:v=>recordResult=v,recordWarehouse:v=>recordWarehouse=v,recordException:v=>recordException=v,recordFrom:v=>recordFrom=v,recordTo:v=>recordTo=v,recordShopSelect:v=>recordShop=v},fn=bindings[event.target.id];if(!fn)return;const id=event.target.id;fn(event.target.value);tablePage=1;renderRecords();$(id)?.focus();});
document.addEventListener('error',event=>{if(event.target.matches?.('#page-records .records-product img')){const missing=document.createElement('span');missing.className='records-no-photo';missing.textContent='暂无图片';event.target.replaceWith(missing);}},true);
function renderSettings(){
 if(!setupUI)setupUI=createSetupUI({get,post,getData:()=>data,isConnected:()=>connected,refresh,
  openRules:()=>openPublishingRules(async()=>{await refresh();toast('发布随机规则已保存，仅新任务生效');}),
  openPermission:()=>document.dispatchEvent(new CustomEvent('setup-permission'))});
 setupUI.mount($('page-settings'));
}
document.addEventListener('setup-permission',()=>{
 if(data.engine.settings.executionEnabled){operate(()=>post('/api/v1/settings',{executionEnabled:false}));return;}
 dialog('开启任务执行许可',`<form id="permitForm" class="form-stack"><div class="notice danger">开启后可人工开始执行批次。正式模式会发布真实商品。</div><label>输入执行店铺名称「${esc(data.engine.shop.name)}」<input name="confirmShop" required autocomplete="off"></label><button class="primary" type="submit" data-write>确认开启执行许可</button></form>`);
});
function productDetail(key,group=materialGroup){const d=data.products.find(x=>x.key===key);if(!d)return;materialGroup=group;
 dialog(d.destination+' · 素材详情',`<div class="tabs">${['main','secondary','details'].map(g=>btn('material-detail',materialName(g),`data-key="${key}" data-group="${g}" aria-pressed="${group===g}"`)).join('')}</div><div class="material-files">${d.materials.filter(m=>m.group===group).map(m=>`<div class="material-file">${icon('images')}<span><strong>${esc(m.name)}</strong><small>${materialName(group)} · 第 ${m.index+1} 张 · 已导入本地</small></span><a href="${esc(m.url)}" target="_blank" rel="noopener">查看文件 ↗</a></div>`).join('')||'<p class="quiet-empty">尚未导入此类素材</p>'}</div><h3>产品资料</h3><p class="long-text">${esc(d.title)}</p><dl class="detail-list"><dt>所属店铺</dt><dd>${esc(d.shopName)}</dd><dt>资料状态</dt><dd>${esc(d.completeness)}</dd><dt>执行状态</dt><dd>${badge(d.state,d.stateLabel)}</dd><dt>原表售价</dt><dd>${esc(d.price??'未提供')}</dd><dt>原表库存</dt><dd>${esc(d.inventory??'未提供')}</dd><dt>来源</dt><dd>${esc(d.source.name)} / 第 ${esc(d.source.row||'—')} 行</dd></dl>${d.issues.length?`<div class="notice danger">${d.issues.map(esc).join('<br>')}</div>`:''}<p class="form-note section-gap">素材列表为本地导入记录，不代表平台已上传。修改原资料后请重新导入；执行中的任务保持原快照。</p><div class="actions">${btn('prepare','保存准备结果',`data-key="${key}" class="primary"`)}${btn('destination-quotes','查看报价',`data-key="${key}"`)}</div>`);$('editor').classList.add('side-editor');
}
function quoteForm(){const unique=[...new Map(data.products.map(d=>[d.geoKey,d])).values()];const d=selected();dialog('录入真实报价',`<form id="quoteForm" class="form-grid"><label class="full">目的地<select name="productKey" required>${unique.map(x=>`<option value="${x.key}" ${x.geoKey===(quoteGeo||d?.geoKey)?'selected':''}>${esc(x.country)} / ${esc(x.destination)}</option>`).join('')}</select></label><label>报价类型<select name="kind"><option value="COST">供应商成本价</option><option value="SALE">对客销售价</option></select></label><label>服务项目<input name="service" required maxlength="200" placeholder="填写真实服务名称"></label><label>金额<input name="amount" type="number" min="0.01" max="1000000000" step="0.01" required></label><label>币种<select name="currency">${['CNY','USD','EUR','JPY','GBP','HKD','SGD','THB','AUD','CAD','KRW'].map(c=>`<option>${c}</option>`).join('')}</select></label><label>计价单位<input name="unit" required maxlength="50" placeholder="如：人、车、天"></label><label>供应商 / 报价来源<input name="supplier" maxlength="200" placeholder="成本价必须填写供应商"></label><label>有效期至<input name="validUntil" type="date"></label><label class="full">备注 / 适用条件<textarea name="notes" maxlength="2000" rows="3" placeholder="如人数、车型、税费和退改条件"></textarea></label><p class="form-note full">保存为独立历史记录，不自动修改商品售价。不同币种不自动换算。</p><div class="actions full"><button class="primary" type="submit" data-write>保存报价</button></div></form>`);}
function preparationForm(key){const d=data.products.find(x=>x.key===key);if(!d)return;dialog('创建任务 · '+d.destination,`<form id="preparationForm" class="form-stack"><input type="hidden" name="productKey" value="${d.key}"><p>${esc(d.title)}</p><label>目标店铺<select name="shopId" required>${data.shops.map(s=>`<option value="${s.id}" ${s.id===d.shopId?'selected':''}>${esc(s.name)}${s.executionSupported?'':'（执行待适配）'}</option>`).join('')}</select></label><label>准备备注<textarea name="notes" rows="3" maxlength="1000"></textarea></label><div class="notice">先保存产品准备单，不会启动浏览器或发布。正式执行仍需资料核对、范围确认与人工开始。</div>${d.duplicateBlocked?'<p class="error">原店铺已有该商品的任务或成功记录；不能重复创建。可在自动化任务或上架记录中查看。</p>':''}<button type="submit" class="primary" data-write>保存准备单</button></form>`);}
async function reviewBatch(limit=5){preview=await post('/api/v1/publishing-preview',{limit});dialog('核对执行范围',`<form id="batchForm" class="form-stack"><div class="notice">${esc(preview.scope)}。创建不会自动开始。</div><label>最多选取数量<select id="reviewLimit">${[1,5,20].map(n=>`<option ${n===limit?'selected':''}>${n}</option>`).join('')}</select></label><div class="table-wrap"><table><thead><tr><th>次序</th><th>商品</th><th>目的地</th></tr></thead><tbody>${preview.tasks.map(t=>`<tr><td>${t.priority}</td><td>${esc(t.listing.title)}${variantSummary(t)}${preview.draftId?`<details><summary>核对本次图片</summary><div class="publishing-slots">${['secondary','details'].flatMap(group=>t.assets[group].map((a,index)=>`<a href="${previewImage(preview,t,group,index)}" target="_blank" rel="noopener"><img style="width:100%;height:100px;object-fit:contain" src="${previewImage(preview,t,group,index)}" alt="${group==='secondary'?'副图':'详情'}第 ${index+1} 张"></a>`)).join('')}</div></details>`:''}</td><td>${esc(t.listing.city||t.listing.country)}</td></tr>`).join('')}</tbody></table></div><p class="form-note">${Object.entries(preview.classification).map(([k,v])=>esc(k)+' '+v).join(' · ')}。完整排除原因可在原操作台预览。</p><label>模式<select name="mode"><option value="DRY_RUN">仅填写（首条完成后暂停，不提交）</option><option value="LIVE">正式发布（开始前还需确认）</option></select></label><label class="check-label"><input name="reviewed" type="checkbox" required>我已核对本批店铺、商品、资料和执行范围</label><button type="submit" class="primary" data-write ${!preview.tasks.length?'disabled data-locked="true"':''}>生成 ${preview.tasks.length} 条执行任务</button></form>`);}
let fetchingRun=null;
async function syncTaskDetail(){const id=selectedTask,x=taskItems().find(x=>x.id===id);if(!x?.runId||fetchingRun===x.runId)return;fetchingRun=x.runId;try{const detail=await get('/api/v1/task?id='+encodeURIComponent(x.runId));if(selectedTask===id&&JSON.stringify(detail)!==JSON.stringify(taskDetail)){taskDetail=detail;renderTasks();}}finally{if(fetchingRun===x.runId)fetchingRun=null;}}
async function selectTask(id){selectedTask=id;taskDetail=null;renderTasks();await syncTaskDetail();}
function associateResultDialog(runId){
 const record=data.engine.records.find(r=>r.runId===runId&&r.verified===false&&!r.itemId);
 if(!record)throw Error('该任务状态已变化，请刷新后查看核验记录');
 dialog('关联原商品并核验',`<form id="associateResultForm" class="form-stack"><input type="hidden" name="runId" value="${esc(runId)}"><input type="hidden" name="requestId" value="${requestId()}"><p>原店铺：<strong>${esc(data.engine.shop.name)}</strong></p><label class="form-stack">原商品完整标题<input readonly value="${esc(record.title)}"></label><div class="notice"><p>只查询后台已有商品，不重新发布。系统核对店铺、标题、价格、库存和创建时间；信息不匹配时仍保持待核验。</p><p>核验成功后只记录本条结果，剩余任务不会自动执行。</p></div><label class="form-stack">后台商品 ID<input name="itemId" inputmode="numeric" pattern="[0-9]{6,30}" required autocomplete="off" placeholder="在原店铺全部商品中查找并复制 ID"></label><label class="check-label"><input name="confirmed" type="checkbox" required>我已核对原店铺与商品，确认此 ID 属于本次提交</label><button type="submit" class="primary" data-write>查询后台并核验原商品</button></form>`);
}
function missingResultGuidance(engine){
 const runIds=new Set((engine.batch?.items||[]).filter(x=>x.displayState==='RESULT_UNKNOWN'||x.runState==='RESULT_UNKNOWN').map(x=>x.runId));
 const missing=engine.records.filter(r=>runIds.has(r.runId)&&r.verified===false&&!r.itemId);
 if(!missing.length)return '';
 return `<section class="notice" aria-label="缺少商品 ID 的处理说明"><strong>尚未取得商品 ID：先人工核对原商品</strong><p>当前店铺：${esc(engine.shop.name)}</p>${missing.map(r=>`<label class="form-stack">完整商品标题<input readonly aria-label="${esc(r.destination)}完整商品标题" value="${esc(r.title)}"></label>${btn('associate-result','关联原商品并核验',`type="button" data-id="${esc(r.runId)}" data-write`)}`).join('')}<ol><li>在执行 Chrome 的淘宝商品后台，进入“全部”，按完整商品标题搜索。</li><li>核对店铺、标题、价格、库存和发布时间；找到后记录商品 ID，保留原页面。</li><li>找到原商品后，使用“关联原商品并核验”输入商品 ID；系统仍会核对后台证据。未找到商品也不能直接判定发布失败。</li></ol><p>下方勾选不会补回商品 ID；请先关联原商品。核验完成前不要重新发布。</p></section>`;
}
async function engineAction(action){const b=data.engine.batch;if(!b)throw Error('当前没有执行批次');if(!b.executionScope)throw Error('执行服务尚未加载新版确认保护，请停止任务并重新启动工作台后再核对');const scopeFields=`<input type="hidden" name="batchId" value="${esc(b.id)}"><input type="hidden" name="scope" value="${esc(b.executionScope)}">`;if(action==='start'){dialog('确认开始执行',`<form id="executeForm" class="form-stack"><input type="hidden" name="action" value="start">${scopeFields}<p>店铺：${esc(data.engine.shop.name)} · 本批 ${b.total} 个商品</p><div class="notice ${b.mode==='LIVE'?'danger':''}">${b.mode==='LIVE'?'正式发布：开始后会提交真实商品。':'仅填写：首条填完后暂停，不会提交商品。'}</div><label class="check-label"><input type="checkbox" required>我确认执行以上范围</label><button type="submit" class="primary" data-write>确认并开始</button></form>`);return;}
 if(action==='retry'){const plan=retryPlan(b,data.engine.active);if(!plan.allowed)throw Error(plan.reason);dialog('核对异常链接重试范围',`<form id="executeForm" class="form-stack"><input type="hidden" name="action" value="retry">${scopeFields}<input type="hidden" name="retryIds" value="${esc(plan.eligible.map(x=>x.id).sort().join(','))}"><p>店铺：${esc(data.engine.shop.name)} · 仅本批 ${plan.eligible.length} 条异常商品；已成功商品不会重复发布。</p><div class="notice ${b.mode==='LIVE'?'danger':''}">${b.mode==='LIVE'?'原模式为正式发布，确认后会继续真实上架。':'原模式为仅填写，不提交商品。'}</div><ul class="retry-scope">${plan.eligible.map(x=>`<li><strong>${esc(x.destination)}</strong><span>${esc(failureSummary(x))}</span><small>已尝试 ${x.attempts} / ${x.maxAttempts} 次</small></li>`).join('')}</ul><label class="check-label"><input name="humanVerified" type="checkbox" required>我已核对以上异常与原执行页面，确认按原模式重试这些商品</label><p class="form-note">点击后先检查登录、资料和恢复条件；每条沿用原尝试上限，验证码和待核验商品须先人工处理。重试不代表定位问题已修复。</p><button type="submit" class="primary" data-write>检查条件并重试 ${plan.eligible.length} 条</button></form>`);return;}
 const guidance=missingResultGuidance(data.engine);
 dialog('人工处理与恢复检查',`<form id="executeForm" class="form-stack"><input type="hidden" name="action" value="${action}">${scopeFields}${guidance||'<p>请在执行 Chrome 中处理当前问题，保留原页面。</p>'}<label class="check-label"><input name="humanVerified" type="checkbox" required>我已人工处理登录、验证码或页面问题</label><p class="form-note">点击后先检查恢复条件；结果不明只核验原商品，禁止再次提交。</p><button type="submit" class="primary" data-write>${guidance?'重新检查核验条件':'检查条件，通过后继续'}</button></form>`);}
document.addEventListener('click',async event=>{const target=event.target.closest('[data-action]');if(!target)return;const {action,key,id}=target.dataset;try{switch(action){
 case 'material-library':materialLibraryDialog(id);break;
 case 'library-tab':browseFilter=target.dataset.filter;tablePage=1;renderProducts();if(browseFilter==='needs')await loadMaterialAudit();break;
 case 'rescan-materials':{const shopId=productShop;if(materialAuditLoading.has(shopId))break;materialAuditLoading.add(shopId);materialAuditErrors.delete(shopId);renderProducts();try{materialAudits.set(shopId,await post('/api/os/material-audit',{shopId}));}catch(e){materialAuditErrors.set(shopId,e.message);}finally{materialAuditLoading.delete(shopId);if(page==='products'&&productShop===shopId)renderProducts();}break;}
 case 'library-page':tablePage=Number(target.dataset.page);renderProducts();break;
 case 'library-reset':query='';browseFilter='';productCountry='';productGeo='';tablePage=1;renderProducts();break;
 case 'shop-products':productCountry='';productShop=id;productGeo='';query='';browseFilter=target.dataset.group||'';materialGroup=target.dataset.group||'main';tablePage=1;location.hash='products';renderProducts();break;
 case 'choose-product-shop':productShop='';productGeo='';query='';renderProducts();break;
 case 'product-ready':browseFilter='ready';tablePage=1;renderProducts();break;
 case 'material-detail':productDetail(key,target.dataset.group);break;
 case 'shop-tasks':taskShop=id;selectedTask=null;location.hash='tasks';renderTasks();break;
 case 'record-reset':resetRecordFilters();renderRecords();break;
 case 'record-sort':recordAscending=!recordAscending;tablePage=1;renderRecords();break;
 case 'record-export':exportRecords();break;
 case 'record-copy':try{await navigator.clipboard.writeText(id);toast('平台 ID 已复制');}catch{dialog('复制平台 ID',`<label class="form-stack">当前浏览器不支持直接复制，请选择下方编号复制。<input readonly value="${esc(id)}" aria-label="平台 ID"></label>`);$('editorBody').querySelector('input').select();}break;
 case 'record-history':{const r=recordView().all.find(r=>String(r.index)===id);if(r)dialog('历史上架记录',`<p>${esc(r.title)}</p><dl class="detail-list"><dt>所属店铺</dt><dd>${esc(shopName(r.shopId))}</dd><dt>商品 ID</dt><dd>${esc(r.itemId||'未取得')}</dd><dt>执行结果</dt><dd>${recordResultLabel(r)}</dd><dt>仓库核验</dt><dd>${recordWarehouseLabel(r)}</dd><dt>记录时间</dt><dd>${time(r.at)}</dd></dl><p class="form-note">此历史记录未关联执行过程，暂无步骤日志。</p>`);break;}
 case 'record-shop':recordShop=id;tablePage=1;renderRecords();break;
 case 'directory-region':destinationRegion=target.dataset.region;destinationCountry='';tablePage=1;renderDestinations();break;
 case 'directory-reset':destinationRegion='';destinationCountry='';destinationType='';destinationState='';query='';tablePage=1;renderDestinations();break;
 case 'directory-view':destinationView=target.dataset.view;renderDestinations();break;
 case 'directory-page':tablePage=Number(target.dataset.page);renderDestinations();break;
 case 'directory-retry':directoryPositionError=false;loadDirectoryPositions();renderDestinations();break;
 case 'directory-map':{const d=data.products.find(x=>x.key===key),p=directoryPositions?.get(key);if(d&&p)dialog(d.destination+' · 全球位置',`${directoryMap(d,p,true)}<p class="dc-map-caption">${esc(d.country)} · ${p.precision==='country'?'国家示意点':'城市中心点'} · ${Math.abs(p.lat).toFixed(2)}°${p.lat>=0?'N':'S'}，${Math.abs(p.lng).toFixed(2)}°${p.lng>=0?'E':'W'}${p.inferred?' · 位置待复核':''}</p>`);break;}
 case 'directory-more':{const d=data.products.find(x=>x.key===key);if(d)dialog(d.destination+' · 更多操作',`<div class="dc-more-actions">${btn('product-detail','查看原资料',`data-key="${d.key}"`)}${btn('destination-products','关联产品',`data-key="${d.key}"`)}${btn('destination-quotes','历史报价',`data-key="${d.key}"`)}${btn('destination-records','执行记录',`data-key="${d.key}"`)}</div>`);break;}
 case 'country-filter':destinationCountry=target.dataset.country;tablePage=1;renderDestinations();break;
 case 'directory-select':selectedKey=key;renderDestinations();break;
 case 'select-destination':chooseDestination(key);break;case 'locate':$('editor').close();location.hash='overview';chooseDestination(key);break;
 case 'destination-quotes':quoteGeo=data.products.find(x=>x.key===key)?.geoKey||'';quoteKind='ALL';$('editor').close();location.hash='quotes';if(page==='quotes')renderQuotes();break;
 case 'destination-products':$('editor').close();productCountry='';query='';productShop='';productGeo=data.products.find(d=>d.key===key)?.geoKey||'';browseFilter='';location.hash='products';break;
 case 'destination-shops':$('editor').close();shopGeo=data.products.find(d=>d.key===key)?.geoKey||'';location.hash='shops';break;
 case 'destination-records':$('editor').close();resetRecordFilters();recordShop='';recordGeo=data.products.find(d=>d.key===key)?.geoKey||'';recordQuery='';location.hash='records';break;
 case 'clear-shop-destination':shopGeo='';renderShops();break;case 'clear-product-destination':productGeo='';renderProducts();break;case 'clear-record-destination':recordGeo='';renderRecords();break;
 case 'prepare':preparationForm(key);break;case 'product-detail':productDetail(key);break;
 case 'quote-retry':await boot();break;
 case 'quote-reset':query='';quoteGeo='';quoteKind='ALL';tablePage=1;renderQuotes();$('quoteFilter').focus();break;
 case 'quote-show-all':query='';quoteGeo='';quoteKind='ALL';quoteSort='newest';tablePage=1;renderQuotes();$('quotesListHeading').focus();$('quotesListHeading').scrollIntoView({block:'nearest'});break;
 case 'add-quote':quoteForm();$('editor').classList.add('side-editor');break;case 'quote-kind':quoteKind=target.dataset.kind;tablePage=1;renderQuotes();break;case 'clear-quote-destination':quoteGeo='';tablePage=1;renderQuotes();break;
 case 'quote-detail':{const q=data.quotes.find(q=>q.id===id);dialog(q.destination+' · '+(q.kind==='COST'?'成本价':'销售价'),`<dl class="detail-list">${[['服务项目',q.service],['金额',money(q)],['供应商',q.supplier||'未填写'],['有效期',q.validUntil||'未设期限'],['录入时间',time(q.at)],['状态',q.archived?'已归档':'历史记录']].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="long-text section-gap">${esc(q.notes||'无备注')}</p>${!q.archived?`<div class="actions section-gap">${btn('archive-quote','归档此报价（保留历史）',`data-id="${id}" data-write`)}</div>`:''}`);break;}
 case 'archive-quote':await operate(async()=>{await post('/api/os/quotes/archive',{id});$('editor').close();toast('报价已归档，历史记录保留');});break;
 case 'overview-products':productShop='';productGeo='';productCountry='';browseFilter='';location.hash='products';renderProducts();break;
 case 'overview-verified':resetRecordFilters();recordShop='';recordResult='success';location.hash='records';renderRecords();break;
 case 'overview-records':resetRecordFilters();recordShop='';location.hash='records';renderRecords();break;
 case 'overview-running':await overviewTaskQueue('running');break;
 case 'overview-pending':await overviewTaskQueue('waiting');break;
 case 'overview-task-link':$('editor').close();location.hash='tasks';break;
 case 'overview-attention':overviewAttentionDialog();break;
 case 'overview-product-detail':{const p=data.products.find(p=>p.key===key);if(p){selectedKey=key;$('editor').close();productShop=p.shopId;productGeo=p.geoKey;location.hash='products';renderProducts();}break;}
 case 'overview-region':destinationRegion=target.dataset.region;destinationCountry='';destinationType='';destinationState='';query='';tablePage=1;location.hash='destinations';renderDestinations();break;
 case 'overview-country':destinationCountry=target.dataset.country;tablePage=1;query='';location.hash='destinations';renderDestinations();break;
 case 'add-library':dialog('新增店铺产品库',`<form id="shopForm" data-library="true" class="form-stack"><label>店铺名称<input name="name" required maxlength="80" placeholder="填写其他店铺的真实名称"></label><p class="form-note">创建店铺及其独立空产品库，已有商品不会复制。创建后可在产品库列表中查看该店铺。</p><button type="submit" class="primary" data-write>创建产品库</button></form>`);break;
 case 'add-shop':dialog('新增店铺',`<form id="shopForm" class="form-stack"><label>平台店铺名称<input name="name" required maxlength="80" placeholder="填写后台显示的真实店铺名称"></label><p class="form-note">创建独立的项目执行环境。新店铺可登录和管理，自动发布需完成店铺适配。</p><button type="submit" class="primary" data-write>添加店铺</button></form>`);break;
 case 'remove-shop':{const s=data.shops.find(s=>s.id===id);dialog('移除店铺',`<form id="removeShopForm" class="form-stack"><input name="shopId" type="hidden" value="${id}"><p>从工作台管理列表移除 ${esc(s.name)}，保留历史记录和浏览器资料。未完成任务或待核验记录会阻止移除。</p><label>输入店铺名称确认<input name="confirmName" required autocomplete="off"></label><button type="submit" data-write>确认移除</button></form>`);break;}
 case 'shop-browser':case 'shop-check':await operate(async()=>{const r=await post('/api/os/shops/'+(action==='shop-check'?'check':'browser'),{shopId:id});toast((action==='shop-browser'?'已在服务主机打开浏览器 · ':'')+r.browser.label+' · '+r.browser.reason);});break;
 case 'engine-browser':await operate(async()=>{await post('/api/v1/browser');toast('已打开项目专用 Chrome，请人工处理登录或验证');});break;
 case 'check':await operate(async()=>{await post('/api/v1/check');toast('配置和浏览器状态已检查');});break;
 case 'product-all':browseFilter='';tablePage=1;renderProducts();break;case 'product-needs':browseFilter='needs';tablePage=1;renderProducts();break;
 case 'previous-page':tablePage--;render();break;case 'next-page':tablePage++;render();break;
 case 'select-task':await selectTask(id);document.querySelector('.task-summary-grid').scrollIntoView({block:'start'});break;case 'queue-filter':queueFilter=target.dataset.filter;taskTablePage=1;renderTasks();break;
 case 'task-prev':taskTablePage--;renderTasks();break;case 'task-next':taskTablePage++;renderTasks();break;
 case 'task-details':case 'task-logs':if(id)await selectTask(id);else await syncTaskDetail();$('taskExecutionDetails').open=true;$('taskExecutionDetails').scrollIntoView({block:'nearest'});break;
 case 'cancel-preparation':await operate(async()=>{await post('/api/os/preparations/cancel',{id});toast('已取消准备单，未启动任何执行');});break;
 case 'review-selected':{const draft=data.preparations.find(d=>d.id===id);const r=await post('/api/os/selected-preview',{productKey:draft.productKey,shopId:draft.shopId});dialog('核对单商品任务',`<form id="selectedForm" class="form-stack"><input type="hidden" name="productKey" value="${draft.productKey}"><input type="hidden" name="shopId" value="${draft.shopId}"><input type="hidden" name="selectionHash" value="${r.selectionHash}"><input type="hidden" name="draftId" value="${r.draftId||''}">${variantSummary(r.task)}${variantImages(r,r.task)}<p>${esc(r.task.listing.title)}</p><p>店铺：${esc(r.shop.name)}</p><div class="notice">${esc(r.scope)}。此入口仅填写到发布页，不提交商品。</div><label class="check-label"><input type="checkbox" required>已核对该商品的标题、素材、价格与店铺</label><button type="submit" class="primary" data-write>生成单商品仅填写任务</button></form>`);break;}
 case 'associate-result':associateResultDialog(id);break;case 'review-batch':await reviewBatch();break;case 'start':case 'continue':case 'retry':await engineAction(action);break;
 case 'pause':await operate(async()=>{await post('/api/v1/pause');toast('已请求停止，等待当前步骤结束并保存断点');});break;
 case 'skip':dialog('永久跳过此商品',`<form id="skipForm" class="form-stack"><input name="taskId" type="hidden" value="${id}"><p>跳过后保留原判重键，不能重新创建同一商品任务。结果不明的商品不能跳过。</p><label>跳过原因<textarea name="reason" required maxlength="600"></textarea></label><button type="submit" data-write>确认永久跳过</button></form>`);break;
 case 'record-detail':{const r=await get('/api/v1/task?id='+id);dialog('执行证据 · '+(r.task.listing.city||r.task.listing.country),`<p class="long-text">${esc(r.task.listing.title||r.task.listing.city||r.task.listing.country)}</p><p>${badge(r.state)}</p><p class="section-gap">${esc(r.reason||r.issue?.condition||'')}</p><dl class="detail-list"><dt>执行 ID</dt><dd>${esc(r.id)}</dd><dt>来源导入</dt><dd>${esc(r.importId)}</dd><dt>商品 ID</dt><dd>${esc(r.result?.itemId||r.checkpoint.itemId||'未取得')}</dd><dt>平台状态</dt><dd>${esc(r.result?.status||'尚未确认')}</dd></dl>${r.screenshotError?`<p>本次截图未保存：${esc(r.screenshotError)}</p>`:''}${r.screenshot?`<a href="${esc(r.screenshot)}" target="_blank" rel="noopener">打开核验截图</a>`:''}<ul class="log-list">${r.events.map(ev=>`<li><time>${shortTime(ev.at)}</time>${esc(ev.label)}<p>${esc(ev.reason)}</p>${ev.screenshotError?`<p>本次截图未保存：${esc(ev.screenshotError)}</p>`:''}${ev.screenshot?`<a href="${esc(ev.screenshot)}" target="_blank" rel="noopener">步骤截图</a>`:''}</li>`).join('')}</ul>`);break;}
 case 'import':await operate(async()=>{await post('/api/v1/import',data.engine.settings);toast('只读导入与校验完成，可查看产品和预览执行范围');});break;
 case 'execution-setting':if(data.engine.settings.executionEnabled){await operate(()=>post('/api/v1/settings',{executionEnabled:false}));toast('执行许可已关闭');}else dialog('开启任务执行许可',`<form id="permitForm" class="form-stack"><div class="notice danger">开启后可人工开始执行批次。正式模式会发布真实商品。</div><label>输入执行店铺名称「${esc(data.engine.shop.name)}」<input name="confirmShop" required autocomplete="off"></label><button class="primary" type="submit" data-write>确认开启执行许可</button></form>`);break;
 }}catch(e){toast(e.message,true);}});
document.addEventListener('input',event=>{const input=event.target;if(input.id==='taskSearch'){taskSearch=input.value;taskTablePage=1;renderTasks();return;}if(['productFilter','destinationFilter','quoteFilter','recordFilter'].includes(input.id)){const start=input.selectionStart,id=input.id;if(id==='recordFilter')recordQuery=input.value;else query=input.value;tablePage=1;render();const next=$(id);next.focus();if(start!==null)next.setSelectionRange(start,start);}});
document.addEventListener('change',e=>{if(!['directoryType','directoryState','directorySize'].includes(e.target.id))return;const id=e.target.id;if(id==='directoryType')destinationType=e.target.value;if(id==='directoryState')destinationState=e.target.value;if(id==='directorySize')destinationSize=Number(e.target.value);tablePage=1;renderDestinations();document.getElementById(id)?.focus();});
document.addEventListener('change',async event=>{if(event.target.id==='quoteSort'){quoteSort=event.target.value;tablePage=1;renderQuotes();$('quoteSort').focus();return;}if(['libraryShop','libraryCountry','libraryPageSize'].includes(event.target.id)){if(event.target.id==='libraryShop'){productShop=event.target.value;productGeo='';productCountry='';query='';browseFilter='';}if(event.target.id==='libraryCountry')productCountry=event.target.value;if(event.target.id==='libraryPageSize')productPageSize=Number(event.target.value);tablePage=1;renderProducts();return;}if(event.target.id==='taskShopSelector'){taskShop=event.target.value;selectedTask=null;taskDetail=null;taskTablePage=1;taskSearch='';renderTasks();}if(event.target.id==='batchSelector'){selectedBatch=event.target.value||null;taskTablePage=1;selectedTask=null;taskDetail=null;data.engine=await get('/api/v1/state'+(selectedBatch?'?batch='+encodeURIComponent(selectedBatch):''));connect();renderTasks();}if(event.target.id==='reviewLimit')try{await reviewBatch(Number(event.target.value));}catch(e){toast(e.message,true);}});
document.addEventListener('submit',event=>{const form=event.target;if(!['quoteForm','preparationForm','shopForm','removeShopForm','settingsForm','permitForm','batchForm','executeForm','associateResultForm','skipForm','selectedForm'].includes(form.id))return;event.preventDefault();const input=Object.fromEntries(new FormData(form));operate(async()=>{switch(form.id){
 case 'selectedForm':{const b=await post('/api/os/selected-create',{productKey:input.productKey,shopId:input.shopId,draftId:input.draftId||undefined,mode:'DRY_RUN',review:{reviewed:true,selectionHash:input.selectionHash,authorization:'操作人在 Travel OS 核对所选目的地；仅填写，不提交'}});selectedBatch=b.id;connect();toast('单商品仅填写任务已入队，尚未开始');break;}
 case 'quoteForm':await post('/api/os/quotes/add',{...input,requestId:requestId()});toast('报价已保存，目的地历史已联动');break;
 case 'preparationForm':await post('/api/os/preparations/create',{...input,requestId:requestId()});location.hash='tasks';toast('准备单已保存；尚未进入执行队列');break;
 case 'shopForm':await post('/api/os/shops/add',{name:input.name});await refresh();if(form.dataset.library){productShop=data.shops.find(s=>s.name===input.name)?.id||'';productGeo='';productCountry='';browseFilter='';query='';location.hash='products';toast('店铺产品库已创建，当前为空库');}else toast('店铺已添加');break;
 case 'removeShopForm':await post('/api/os/shops/remove',input);toast('店铺已移除，历史记录保留');break;
 case 'settingsForm':await post('/api/v1/settings',input);toast('资料路径已保存');break;
 case 'permitForm':await post('/api/v1/settings',{executionEnabled:true,confirmShop:input.confirmShop});toast('执行许可已开启；仍需手动开始任务');break;
 case 'batchForm':{const b=await post('/api/v1/create',{importId:preview.importId,draftId:preview.draftId,limit:Number($('reviewLimit').value),mode:input.mode,review:{reviewed:true,selectionHash:preview.selectionHash,authorization:'操作人在 Travel OS 核对本批范围；创建不等于开始'}});selectedBatch=b.id;connect();toast('执行批次已创建，尚未开始');break;}
 case 'associateResultForm':{await post('/api/v1/reconcile',{id:input.runId,itemId:input.itemId.trim(),requestId:input.requestId,confirmed:input.confirmed==='on'});toast('原商品核验成功；剩余任务未启动，请重新核对后继续');break;}
 case 'executeForm':{if(!input.scope||input.batchId!==data.engine.batch?.id||input.scope!==data.engine.batch?.executionScope){$('editor').close();throw Error('批次范围或状态已变化，请重新打开并核对');}if(input.action==='retry'){const plan=retryPlan(data.engine.batch,data.engine.active);if(!plan.allowed||input.batchId!==data.engine.batch.id||input.retryIds!==plan.eligible.map(x=>x.id).sort().join(','))throw Error(plan.reason||'重试范围已变化，请关闭并重新核对');}const payload={id:input.batchId,scope:input.scope,requestId:requestId(),humanVerified:input.humanVerified==='on'};if(input.action!=='start'){const r=await post('/api/v1/recovery-check',{...payload,operation:input.action});if(!r.ready)throw Error(r.checks.filter(c=>c.ok!==true).map(c=>c.name+'：'+c.detail).join('\n'));}await post('/api/v1/'+input.action,payload);toast('请求已交给执行内核');break;}
 case 'skipForm':await post('/api/os/batch/skip',{...input,id:data.engine.batch.id});toast('商品已永久跳过');break;
 }$('editor').close();});});
$('closeEditor').onclick=()=>$('editor').close();$('checkBrowser').onclick=()=>{location.hash='settings';renderSettings();setupUI.connect();};$('reconnect').onclick=()=>boot();window.addEventListener('hashchange',route);window.addEventListener('pagehide',()=>{stream?.close();globe?.dispose();});
window.addEventListener('offline',()=>{stream?.close();status(false);});window.addEventListener('online',()=>boot());
// Phosphor regular icons, MIT. Embedded locally; no runtime network dependency.
const overviewIconSources={"play":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMzIuNCwxMTQuNDksODguMzIsMjYuMzVhMTYsMTYsMCwwLDAtMTYuMi0uM0ExNS44NiwxNS44NiwwLDAsMCw2NCwzOS44N1YyMTYuMTNBMTUuOTQsMTUuOTQsMCwwLDAsODAsMjMyYTE2LjA3LDE2LjA3LDAsMCwwLDguMzYtMi4zNUwyMzIuNCwxNDEuNTFhMTUuODEsMTUuODEsMCwwLDAsMC0yN1pNODAsMjE1Ljk0VjQwbDE0My44Myw4OFoiLz48L3N2Zz4=","file-text":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMTMuNjYsODIuMzRsLTU2LTU2QTgsOCwwLDAsMCwxNTIsMjRINTZBMTYsMTYsMCwwLDAsNDAsNDBWMjE2YTE2LDE2LDAsMCwwLDE2LDE2SDIwMGExNiwxNiwwLDAsMCwxNi0xNlY4OEE4LDgsMCwwLDAsMjEzLjY2LDgyLjM0Wk0xNjAsNTEuMzEsMTg4LjY5LDgwSDE2MFpNMjAwLDIxNkg1NlY0MGg4OFY4OGE4LDgsMCwwLDAsOCw4aDQ4VjIxNlptLTMyLTgwYTgsOCwwLDAsMS04LDhIOTZhOCw4LDAsMCwxLDAtMTZoNjRBOCw4LDAsMCwxLDE2OCwxMzZabTAsMzJhOCw4LDAsMCwxLTgsOEg5NmE4LDgsMCwwLDEsMC0xNmg2NEE4LDgsMCwwLDEsMTY4LDE2OFoiLz48L3N2Zz4=","warning-circle":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRBMTA0LDEwNCwwLDEsMCwyMzIsMTI4LDEwNC4xMSwxMDQuMTEsMCwwLDAsMTI4LDI0Wm0wLDE5MmE4OCw4OCwwLDEsMSw4OC04OEE4OC4xLDg4LjEsMCwwLDEsMTI4LDIxNlptLTgtODBWODBhOCw4LDAsMCwxLDE2LDB2NTZhOCw4LDAsMCwxLTE2LDBabTIwLDM2YTEyLDEyLDAsMSwxLTEyLTEyQTEyLDEyLDAsMCwxLDE0MCwxNzJaIi8+PC9zdmc+","list-bullets":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik04MCw2NGE4LDgsMCwwLDEsOC04SDIxNmE4LDgsMCwwLDEsMCwxNkg4OEE4LDgsMCwwLDEsODAsNjRabTEzNiw1Nkg4OGE4LDgsMCwwLDAsMCwxNkgyMTZhOCw4LDAsMCwwLDAtMTZabTAsNjRIODhhOCw4LDAsMCwwLDAsMTZIMjE2YTgsOCwwLDAsMCwwLTE2Wk00NCw1MkExMiwxMiwwLDEsMCw1Niw2NCwxMiwxMiwwLDAsMCw0NCw1MlptMCw2NGExMiwxMiwwLDEsMCwxMiwxMkExMiwxMiwwLDAsMCw0NCwxMTZabTAsNjRhMTIsMTIsMCwxLDAsMTIsMTJBMTIsMTIsMCwwLDAsNDQsMTgwWiIvPjwvc3ZnPg==","cube":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMjMuNjgsNjYuMTUsMTM1LjY4LDE4aDBhMTUuODgsMTUuODgsMCwwLDAtMTUuMzYsMGwtODgsNDguMTdhMTYsMTYsMCwwLDAtOC4zMiwxNHY5NS42NGExNiwxNiwwLDAsMCw4LjMyLDE0bDg4LDQ4LjE3YTE1Ljg4LDE1Ljg4LDAsMCwwLDE1LjM2LDBsODgtNDguMTdhMTYsMTYsMCwwLDAsOC4zMi0xNFY4MC4xOEExNiwxNiwwLDAsMCwyMjMuNjgsNjYuMTVaTTEyOCwzMmgwbDgwLjM0LDQ0TDEyOCwxMjAsNDcuNjYsNzZaTTQwLDkwbDgwLDQzLjc4djg1Ljc5TDQwLDE3NS44MlptOTYsMTI5LjU3VjEzMy44MkwyMTYsOTB2ODUuNzhaIi8+PC9zdmc+","house":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMTkuMzEsMTA4LjY4bC04MC04MGExNiwxNiwwLDAsMC0yMi42MiwwbC04MCw4MEExNS44NywxNS44NywwLDAsMCwzMiwxMjB2OTZhOCw4LDAsMCwwLDgsOGg2NGE4LDgsMCwwLDAsOC04VjE2MGgzMnY1NmE4LDgsMCwwLDAsOCw4aDY0YTgsOCwwLDAsMCw4LThWMTIwQTE1Ljg3LDE1Ljg3LDAsMCwwLDIxOS4zMSwxMDguNjhaTTIwOCwyMDhIMTYwVjE1MmE4LDgsMCwwLDAtOC04SDEwNGE4LDgsMCwwLDAtOCw4djU2SDQ4VjEyMGw4MC04MCw4MCw4MFoiLz48L3N2Zz4=","check-circle":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xNzMuNjYsOTguMzRhOCw4LDAsMCwxLDAsMTEuMzJsLTU2LDU2YTgsOCwwLDAsMS0xMS4zMiwwbC0yNC0yNGE4LDgsMCwwLDEsMTEuMzItMTEuMzJMMTEyLDE0OC42OWw1MC4zNC01MC4zNUE4LDgsMCwwLDEsMTczLjY2LDk4LjM0Wk0yMzIsMTI4QTEwNCwxMDQsMCwxLDEsMTI4LDI0LDEwNC4xMSwxMDQuMTEsMCwwLDEsMjMyLDEyOFptLTE2LDBhODgsODgsMCwxLDAtODgsODhBODguMSw4OC4xLDAsMCwwLDIxNiwxMjhaIi8+PC9zdmc+","globe":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRoMEExMDQsMTA0LDAsMSwwLDIzMiwxMjgsMTA0LjEyLDEwNC4xMiwwLDAsMCwxMjgsMjRabTg4LDEwNGE4Ny42MSw4Ny42MSwwLDAsMS0zLjMzLDI0SDE3NC4xNmExNTcuNDQsMTU3LjQ0LDAsMCwwLDAtNDhoMzguNTFBODcuNjEsODcuNjEsMCwwLDEsMjE2LDEyOFpNMTAyLDE2OEgxNTRhMTE1LjExLDExNS4xMSwwLDAsMS0yNiw0NUExMTUuMjcsMTE1LjI3LDAsMCwxLDEwMiwxNjhabS0zLjktMTZhMTQwLjg0LDE0MC44NCwwLDAsMSwwLTQ4aDU5Ljg4YTE0MC44NCwxNDAuODQsMCwwLDEsMCw0OFpNNDAsMTI4YTg3LjYxLDg3LjYxLDAsMCwxLDMuMzMtMjRIODEuODRhMTU3LjQ0LDE1Ny40NCwwLDAsMCwwLDQ4SDQzLjMzQTg3LjYxLDg3LjYxLDAsMCwxLDQwLDEyOFpNMTU0LDg4SDEwMmExMTUuMTEsMTE1LjExLDAsMCwxLDI2LTQ1QTExNS4yNywxMTUuMjcsMCwwLDEsMTU0LDg4Wm01Mi4zMywwSDE3MC43MWExMzUuMjgsMTM1LjI4LDAsMCwwLTIyLjMtNDUuNkE4OC4yOSw4OC4yOSwwLDAsMSwyMDYuMzcsODhaTTEwNy41OSw0Mi40QTEzNS4yOCwxMzUuMjgsMCwwLDAsODUuMjksODhINDkuNjNBODguMjksODguMjksMCwwLDEsMTA3LjU5LDQyLjRaTTQ5LjYzLDE2OEg4NS4yOWExMzUuMjgsMTM1LjI4LDAsMCwwLDIyLjMsNDUuNkE4OC4yOSw4OC4yOSwwLDAsMSw0OS42MywxNjhabTk4Ljc4LDQ1LjZhMTM1LjI4LDEzNS4yOCwwLDAsMCwyMi4zLTQ1LjZoMzUuNjZBODguMjksODguMjksMCwwLDEsMTQ4LjQxLDIxMy42WiIvPjwvc3ZnPg==","map-pin":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsNjRhNDAsNDAsMCwxLDAsNDAsNDBBNDAsNDAsMCwwLDAsMTI4LDY0Wm0wLDY0YTI0LDI0LDAsMSwxLDI0LTI0QTI0LDI0LDAsMCwxLDEyOCwxMjhabTAtMTEyYTg4LjEsODguMSwwLDAsMC04OCw4OGMwLDMxLjQsMTQuNTEsNjQuNjgsNDIsOTYuMjVhMjU0LjE5LDI1NC4xOSwwLDAsMCw0MS40NSwzOC4zLDgsOCwwLDAsMCw5LjE4LDBBMjU0LjE5LDI1NC4xOSwwLDAsMCwxNzQsMjAwLjI1YzI3LjQ1LTMxLjU3LDQyLTY0Ljg1LDQyLTk2LjI1QTg4LjEsODguMSwwLDAsMCwxMjgsMTZabTAsMjA2Yy0xNi41My0xMy03Mi02MC43NS03Mi0xMThhNzIsNzIsMCwwLDEsMTQ0LDBDMjAwLDE2MS4yMywxNDQuNTMsMjA5LDEyOCwyMjJaIi8+PC9zdmc+","bag":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMTYsNjRIMTc2YTQ4LDQ4LDAsMCwwLTk2LDBINDBBMTYsMTYsMCwwLDAsMjQsODBWMjAwYTE2LDE2LDAsMCwwLDE2LDE2SDIxNmExNiwxNiwwLDAsMCwxNi0xNlY4MEExNiwxNiwwLDAsMCwyMTYsNjRaTTEyOCwzMmEzMiwzMiwwLDAsMSwzMiwzMkg5NkEzMiwzMiwwLDAsMSwxMjgsMzJabTg4LDE2OEg0MFY4MEg4MFY5NmE4LDgsMCwwLDAsMTYsMFY4MGg2NFY5NmE4LDgsMCwwLDAsMTYsMFY4MGg0MFoiLz48L3N2Zz4=","calendar-blank":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMDgsMzJIMTg0VjI0YTgsOCwwLDAsMC0xNiwwdjhIODhWMjRhOCw4LDAsMCwwLTE2LDB2OEg0OEExNiwxNiwwLDAsMCwzMiw0OFYyMDhhMTYsMTYsMCwwLDAsMTYsMTZIMjA4YTE2LDE2LDAsMCwwLDE2LTE2VjQ4QTE2LDE2LDAsMCwwLDIwOCwzMlpNNzIsNDh2OGE4LDgsMCwwLDAsMTYsMFY0OGg4MHY4YTgsOCwwLDAsMCwxNiwwVjQ4aDI0VjgwSDQ4VjQ4Wk0yMDgsMjA4SDQ4Vjk2SDIwOFYyMDhaIi8+PC9zdmc+","stack":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMzAuOTEsMTcyQTgsOCwwLDAsMSwyMjgsMTgyLjkxbC05Niw1NmE4LDgsMCwwLDEtOC4wNiwwbC05Ni01NkE4LDgsMCwwLDEsMzYsMTY5LjA5bDkyLDUzLjY1LDkyLTUzLjY1QTgsOCwwLDAsMSwyMzAuOTEsMTcyWk0yMjAsMTIxLjA5bC05Miw1My42NUwzNiwxMjEuMDlBOCw4LDAsMCwwLDI4LDEzNC45MWw5Niw1NmE4LDgsMCwwLDAsOC4wNiwwbDk2LTU2QTgsOCwwLDEsMCwyMjAsMTIxLjA5Wk0yNCw4MGE4LDgsMCwwLDEsNC02LjkxbDk2LTU2YTgsOCwwLDAsMSw4LjA2LDBsOTYsNTZhOCw4LDAsMCwxLDAsMTMuODJsLTk2LDU2YTgsOCwwLDAsMS04LjA2LDBsLTk2LTU2QTgsOCwwLDAsMSwyNCw4MFptMjMuODgsMEwxMjgsMTI2Ljc0LDIwOC4xMiw4MCwxMjgsMzMuMjZaIi8+PC9zdmc+","lightning":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMTUuNzksMTE4LjE3YTgsOCwwLDAsMC01LTUuNjZMMTUzLjE4LDkwLjlsMTQuNjYtNzMuMzNhOCw4LDAsMCwwLTEzLjY5LTdsLTExMiwxMjBhOCw4LDAsMCwwLDMsMTNsNTcuNjMsMjEuNjFMODguMTYsMjM4LjQzYTgsOCwwLDAsMCwxMy42OSw3bDExMi0xMjBBOCw4LDAsMCwwLDIxNS43OSwxMTguMTdaTTEwOS4zNywyMTRsMTAuNDctNTIuMzhhOCw4LDAsMCwwLTUtOS4wNkw2MiwxMzIuNzFsODQuNjItOTAuNjZMMTM2LjE2LDk0LjQzYTgsOCwwLDAsMCw1LDkuMDZsNTIuOCwxOS44WiIvPjwvc3ZnPg==","clock":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsMjRBMTA0LDEwNCwwLDEsMCwyMzIsMTI4LDEwNC4xMSwxMDQuMTEsMCwwLDAsMTI4LDI0Wm0wLDE5MmE4OCw4OCwwLDEsMSw4OC04OEE4OC4xLDg4LjEsMCwwLDEsMTI4LDIxNlptNjQtODhhOCw4LDAsMCwxLTgsOEgxMjhhOCw4LDAsMCwxLTgtOFY3MmE4LDgsMCwwLDEsMTYsMHY0OGg0OEE4LDgsMCwwLDEsMTkyLDEyOFoiLz48L3N2Zz4=","storefront":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMzIsOTZhNy44OSw3Ljg5LDAsMCwwLS4zLTIuMkwyMTcuMzUsNDMuNkExNi4wNywxNi4wNywwLDAsMCwyMDIsMzJINTRBMTYuMDcsMTYuMDcsMCwwLDAsMzguNjUsNDMuNkwyNC4zMSw5My44QTcuODksNy44OSwwLDAsMCwyNCw5NmgwdjE2YTQwLDQwLDAsMCwwLDE2LDMydjcyYTgsOCwwLDAsMCw4LDhIMjA4YTgsOCwwLDAsMCw4LThWMTQ0YTQwLDQwLDAsMCwwLDE2LTMyVjk2Wk01NCw0OEgyMDJsMTEuNDIsNDBINDIuNjFabTUwLDU2aDQ4djhhMjQsMjQsMCwwLDEtNDgsMFptLTE2LDB2OGEyNCwyNCwwLDAsMS0zNS4xMiwyMS4yNiw3Ljg4LDcuODgsMCwwLDAtMS44Mi0xLjA2QTI0LDI0LDAsMCwxLDQwLDExMnYtOFpNMjAwLDIwOEg1NlYxNTEuMmE0MC41Nyw0MC41NywwLDAsMCw4LC44LDQwLDQwLDAsMCwwLDMyLTE2LDQwLDQwLDAsMCwwLDY0LDAsNDAsNDAsMCwwLDAsMzIsMTYsNDAuNTcsNDAuNTcsMCwwLDAsOC0uOFptNC45My03NS44YTguMDgsOC4wOCwwLDAsMC0xLjgsMS4wNUEyNCwyNCwwLDAsMSwxNjgsMTEydi04aDQ4djhBMjQsMjQsMCwwLDEsMjA0LjkzLDEzMi4yWiIvPjwvc3ZnPg==","gear":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0xMjgsODBhNDgsNDgsMCwxLDAsNDgsNDhBNDguMDUsNDguMDUsMCwwLDAsMTI4LDgwWm0wLDgwYTMyLDMyLDAsMSwxLDMyLTMyQTMyLDMyLDAsMCwxLDEyOCwxNjBabTg4LTI5Ljg0cS4wNi0yLjE2LDAtNC4zMmwxNC45Mi0xOC42NGE4LDgsMCwwLDAsMS40OC03LjA2LDEwNy4yMSwxMDcuMjEsMCwwLDAtMTAuODgtMjYuMjUsOCw4LDAsMCwwLTYtMy45M2wtMjMuNzItMi42NHEtMS40OC0xLjU2LTMtM0wxODYsNDAuNTRhOCw4LDAsMCwwLTMuOTQtNiwxMDcuNzEsMTA3LjcxLDAsMCwwLTI2LjI1LTEwLjg3LDgsOCwwLDAsMC03LjA2LDEuNDlMMTMwLjE2LDQwUTEyOCw0MCwxMjUuODQsNDBMMTA3LjIsMjUuMTFhOCw4LDAsMCwwLTcuMDYtMS40OEExMDcuNiwxMDcuNiwwLDAsMCw3My44OSwzNC41MWE4LDgsMCwwLDAtMy45Myw2TDY3LjMyLDY0LjI3cS0xLjU2LDEuNDktMywzTDQwLjU0LDcwYTgsOCwwLDAsMC02LDMuOTQsMTA3LjcxLDEwNy43MSwwLDAsMC0xMC44NywyNi4yNSw4LDgsMCwwLDAsMS40OSw3LjA2TDQwLDEyNS44NFE0MCwxMjgsNDAsMTMwLjE2TDI1LjExLDE0OC44YTgsOCwwLDAsMC0xLjQ4LDcuMDYsMTA3LjIxLDEwNy4yMSwwLDAsMCwxMC44OCwyNi4yNSw4LDgsMCwwLDAsNiwzLjkzbDIzLjcyLDIuNjRxMS40OSwxLjU2LDMsM0w3MCwyMTUuNDZhOCw4LDAsMCwwLDMuOTQsNiwxMDcuNzEsMTA3LjcxLDAsMCwwLDI2LjI1LDEwLjg3LDgsOCwwLDAsMCw3LjA2LTEuNDlMMTI1Ljg0LDIxNnEyLjE2LjA2LDQuMzIsMGwxOC42NCwxNC45MmE4LDgsMCwwLDAsNy4wNiwxLjQ4LDEwNy4yMSwxMDcuMjEsMCwwLDAsMjYuMjUtMTAuODgsOCw4LDAsMCwwLDMuOTMtNmwyLjY0LTIzLjcycTEuNTYtMS40OCwzLTNMMjE1LjQ2LDE4NmE4LDgsMCwwLDAsNi0zLjk0LDEwNy43MSwxMDcuNzEsMCwwLDAsMTAuODctMjYuMjUsOCw4LDAsMCwwLTEuNDktNy4wNlptLTE2LjEtNi41YTczLjkzLDczLjkzLDAsMCwxLDAsOC42OCw4LDgsMCwwLDAsMS43NCw1LjQ4bDE0LjE5LDE3LjczYTkxLjU3LDkxLjU3LDAsMCwxLTYuMjMsMTVMMTg3LDE3My4xMWE4LDgsMCwwLDAtNS4xLDIuNjQsNzQuMTEsNzQuMTEsMCwwLDEtNi4xNCw2LjE0LDgsOCwwLDAsMC0yLjY0LDUuMWwtMi41MSwyMi41OGE5MS4zMiw5MS4zMiwwLDAsMS0xNSw2LjIzbC0xNy43NC0xNC4xOWE4LDgsMCwwLDAtNS0xLjc1aC0uNDhhNzMuOTMsNzMuOTMsMCwwLDEtOC42OCwwLDgsOCwwLDAsMC01LjQ4LDEuNzRMMTAwLjQ1LDIxNS44YTkxLjU3LDkxLjU3LDAsMCwxLTE1LTYuMjNMODIuODksMTg3YTgsOCwwLDAsMC0yLjY0LTUuMSw3NC4xMSw3NC4xMSwwLDAsMS02LjE0LTYuMTQsOCw4LDAsMCwwLTUuMS0yLjY0TDQ2LjQzLDE3MC42YTkxLjMyLDkxLjMyLDAsMCwxLTYuMjMtMTVsMTQuMTktMTcuNzRhOCw4LDAsMCwwLDEuNzQtNS40OCw3My45Myw3My45MywwLDAsMSwwLTguNjgsOCw4LDAsMCwwLTEuNzQtNS40OEw0MC4yLDEwMC40NWE5MS41Nyw5MS41NywwLDAsMSw2LjIzLTE1TDY5LDgyLjg5YTgsOCwwLDAsMCw1LjEtMi42NCw3NC4xMSw3NC4xMSwwLDAsMSw2LjE0LTYuMTRBOCw4LDAsMCwwLDgyLjg5LDY5TDg1LjQsNDYuNDNhOTEuMzIsOTEuMzIsMCwwLDEsMTUtNi4yM2wxNy43NCwxNC4xOWE4LDgsMCwwLDAsNS40OCwxLjc0LDczLjkzLDczLjkzLDAsMCwxLDguNjgsMCw4LDgsMCwwLDAsNS40OC0xLjc0TDE1NS41NSw0MC4yYTkxLjU3LDkxLjU3LDAsMCwxLDE1LDYuMjNMMTczLjExLDY5YTgsOCwwLDAsMCwyLjY0LDUuMSw3NC4xMSw3NC4xMSwwLDAsMSw2LjE0LDYuMTQsOCw4LDAsMCwwLDUuMSwyLjY0bDIyLjU4LDIuNTFhOTEuMzIsOTEuMzIsMCwwLDEsNi4yMywxNWwtMTQuMTksMTcuNzRBOCw4LDAsMCwwLDE5OS44NywxMjMuNjZaIi8+PC9zdmc+","upload-simple":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNTYgMjU2IiBmaWxsPSJjdXJyZW50Q29sb3IiPjxwYXRoIGQ9Ik0yMjQsMTQ0djY0YTgsOCwwLDAsMS04LDhINDBhOCw4LDAsMCwxLTgtOFYxNDRhOCw4LDAsMCwxLDE2LDB2NTZIMjA4VjE0NGE4LDgsMCwwLDEsMTYsMFpNOTMuNjYsNzcuNjYsMTIwLDUxLjMxVjE0NGE4LDgsMCwwLDAsMTYsMFY1MS4zMWwyNi4zNCwyNi4zNWE4LDgsMCwwLDAsMTEuMzItMTEuMzJsLTQwLTQwYTgsOCwwLDAsMC0xMS4zMiwwbC00MCw0MEE4LDgsMCwwLDAsOTMuNjYsNzcuNjZaIi8+PC9zdmc+"};
const overviewIcon=name=>`<img src="${overviewIconSources[name]}" alt="">`;
document.querySelectorAll("[data-ov-icon]").forEach(el=>el.innerHTML=overviewIcon(el.dataset.ovIcon));
async function boot(){if(booting)return;booting=true;if(!data&&page==='overview')$('overviewMetrics').innerHTML='<div class="ov-loading" role="status">正在读取产品与执行状态…</div>';try{await refresh();connect();route();if(page==='tasks'&&selectedTask)await selectTask(selectedTask);}catch(e){status(false);toast(e.message,true);if(!data&&page==='overview')$('overviewMetrics').innerHTML='<div class="ov-loading" role="alert">数据暂时无法读取，重新连接后恢复。</div>';if(!data&&page==='quotes')$('page-quotes').innerHTML=heading('报价库','管理目的地产品报价与历史记录。')+`<div class="quotes-card quotes-empty" role="alert"><h3>报价暂时无法加载</h3><p>请检查服务连接后重试。</p>${btn('quote-retry','重新加载','class="primary"')}</div>`;}finally{booting=false;}}
route();
if(page==='quotes'){$('page-quotes').innerHTML=heading('报价库','管理目的地产品报价与历史记录。')+'<div class="quotes-card quotes-empty" role="status">正在加载报价…</div>';}
boot();
