const $=id=>document.getElementById(id);
let state,preview,page=0,busy=false,uploadId;
$('sourceRecognize').disabled=true;
$('sourceNext').disabled=true;
const labels={QUEUED:'等待执行',RUNNING:'执行中',PAUSED:'已暂停',PAUSED_CAPTCHA:'等待人工验证',SUBMITTING:'正在提交',RESULT_UNKNOWN:'结果待核验',VERIFIED:'已核验成功',DRY_RUN_COMPLETE:'已填好，未提交'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,input){const r=await fetch('/api/source/'+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(!r.ok)throw Error(d.error||'操作失败');return d;}
function feedback(text){$('sourceFeedback').textContent=text;}
async function action(fn){if(busy)return;busy=true;$('sourceRecognize').disabled=true;try{await fn();}catch(e){feedback(e.message);if($('sourcePreview').open)$('sourcePreviewStatus').textContent=e.message;}finally{busy=false;$('sourceRecognize').disabled=false;}}
function render(){
 const items=state?.batch?.items||[],term=$('sourceSearch').value.trim();
 $('sourceNext').disabled=!items.some(x=>!x.completed&&!x.run&&!x.issues.length);
 const filtered=items.filter(x=>!term||(x.destination+x.title+String(x.order)).includes(term)),pages=Math.max(1,Math.ceil(filtered.length/20));page=Math.min(page,pages-1);
 $('sourceRows').innerHTML=filtered.slice(page*20,page*20+20).map(x=>`<tr><td>${x.order}</td><td><strong>${esc(x.destination)}</strong><small>${esc(x.title)}</small></td><td>¥${esc(x.price)}<small>${esc(x.inventory)} 件</small></td><td class="${x.completed?'source-good':x.issues.length?'source-warning':''}">${x.completed?'已完成 · '+esc(x.completed.itemId):x.issues.length?esc(x.issues.join('；')):x.run?'已有任务':'待预览确认'}</td><td><button class="secondary" data-preview="${x.order}" type="button">预览</button></td></tr>`).join('')||'<tr><td colspan="5">没有匹配商品。</td></tr>';
 $('sourcePage').textContent=`第 ${page+1} / ${pages} 页 · ${filtered.length} 条`;$('sourcePrevious').disabled=page===0;$('sourceFollowing').disabled=page===pages-1;
 $('sourcePause').disabled=!state?.active;
 $('sourceRuns').innerHTML=(state?.runs||[]).map(r=>`<article class="source-run"><strong>${r.order} · ${esc(r.title)}</strong><p>${labels[r.state]||esc(r.state)} · ${r.mode==='LIVE'?'正式提交':'仅填写'} · ${r.target==='WAREHOUSE'?'放入仓库':'按表格上架'}</p>${r.reason?`<p class="source-warning">${esc(r.reason)}</p>`:''}${r.result?`<p class="source-good">商品 ID ${esc(r.result.itemId)} · ${esc(r.result.status)}</p>`:''}<button class="secondary" data-events="${r.id}" type="button">日志与截图</button>${['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(r.state)?`<button class="primary" data-resume="${r.id}" type="button">${r.state==='RESULT_UNKNOWN'?'核验提交结果':'处理完成，继续'}</button>`:''}${r.state==='DRY_RUN_COMPLETE'?`<button class="primary" data-publish="${r.id}" type="button">核对后正式提交</button>`:''}</article>`).join('')||'暂无新任务。';
}
async function refresh(){state=await api('state');render();const r=await fetch('/api/browser/status');const s=await r.json();$('sourceBrowser').textContent=s.browser.loggedIn?'专用 Chrome 已登录 · 五洲畅游':s.browser.reason||'专用 Chrome 未运行';}
async function show(order){preview=await api(`preview?batch=${state.batch.id}&order=${order}`);const t=preview.task;
 $('sourcePreviewTitle').textContent=`${t.priority} · ${t.listing.city||t.listing.country}`;$('sourcePreviewInfo').textContent=`${t.listing.title}（已选用表格标题，来源：${t.source.sheet} 第 ${t.source.row} 行）${t.listing.titleVersions[1]?'；保留旧包备选标题：'+t.listing.titleVersions[1]:''}`;
 $('sourcePreviewIssues').textContent=t.adapterIssues.join('；');
 const names={category_path:'类目',brand:'品牌',price_cny:'价格',inventory:'库存',listing_time:'表格上架方式',shipping_time:'发货时效',ship_from:'发货地',freight_template:'运费模板',procurement:'采购地',ship_from_region:'发货范围'};
 $('sourceFields').innerHTML=Object.entries(names).map(([k,v])=>`<div>${v}：${esc(t.business[k])}</div>`).join('');
 $('sourceGallery').innerHTML=preview.assets.map(a=>`<figure><a href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy" /></a><figcaption>${a.group==='main'?'主图':a.group==='secondary'?'副图':'详情'} ${a.index+1} · ${esc(a.name)}</figcaption></figure>`).join('');
 $('sourceReviewed').checked=false;$('sourceMode').value='DRY_RUN';$('sourceTarget').value='SOURCE';$('sourcePreviewStatus').textContent='';$('sourceExecute').disabled=true;
 $('sourceTarget').options[0].textContent='按表格：'+t.business.listing_time;$('sourcePreview').showModal();
}
$('sourceReviewed').onchange=()=>{$('sourceExecute').disabled=!$('sourceReviewed').checked||!!preview.task.adapterIssues.length||!!state.batch.items.find(x=>x.order===preview.task.priority)?.completed;};
$('sourceExecute').onclick=()=>action(async()=>{const r=await api('start',{batchId:preview.batchId,order:preview.task.priority,mode:$('sourceMode').value,target:$('sourceTarget').value,review:{reviewed:$('sourceReviewed').checked,taskHash:preview.taskHash,at:new Date().toISOString()}});$('sourcePreview').close();feedback(`已创建第 ${r.order} 条任务。执行状态见下方。`);await refresh();});
$('sourceRecognize').onclick=()=>action(async()=>{feedback('正在只读识别表格、校验图片，请稍候…');state=await api('import',{workbook:$('sourceWorkbook').value.trim(),assetRoot:$('sourceImages').value.trim()});page=0;render();feedback(`已识别 ${state.batch.summary.total} 条，${state.batch.summary.images} 张图片；${state.batch.summary.blocked} 条有资料阻塞。已完成记录自动跳过。`);});
$('sourceNext').onclick=()=>action(async()=>{const next=state?.batch?.items.find(x=>!x.completed&&!x.run&&!x.issues.length);if(!next)throw Error('没有可新建任务的商品，请查看执行记录或处理阻塞');await show(next.order);});
$('sourceSearch').oninput=()=>{page=0;render();};$('sourcePrevious').onclick=()=>{page--;render();};$('sourceFollowing').onclick=()=>{page++;render();};
$('sourcePreviewClose').onclick=()=>$('sourcePreview').close();$('sourceEventsClose').onclick=()=>$('sourceEvents').close();
$('sourcePause').onclick=()=>action(async()=>{await api('pause',{});feedback('已请求暂停；当前页面动作结束后保存断点。');});
$('sourceRows').onclick=e=>{const b=e.target.closest('[data-preview]');if(b)action(()=>show(Number(b.dataset.preview)));};
$('sourceRuns').onclick=e=>action(async()=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.events){const {events}=await api('events?id='+b.dataset.events);$('sourceEventRows').innerHTML=events.map(e=>`<article><strong>${esc(e.payload.name||labels[e.kind]||e.kind)}</strong> · ${esc(e.at)}${e.payload.durationMs!==undefined?` · ${e.payload.durationMs}ms`:''}<p>${esc(e.payload.error||e.payload.reason||'')}</p>${e.payload.screenshot?`<a href="/output/tasks/${b.dataset.events}/${encodeURIComponent(e.payload.screenshot.split(/[\\/]/).at(-1))}" target="_blank" rel="noopener">查看步骤截图</a>`:''}</article>`).join('');$('sourceEvents').showModal();}else{await api('resume',{id:b.dataset.resume||b.dataset.publish,publish:!!b.dataset.publish});await refresh();}});
$('sourceLogin').onclick=()=>action(async()=>{const r=await fetch('/api/chrome/launch',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const d=await r.json();if(!r.ok)throw Error(d.error);await refresh();});
async function upload(files){if(!uploadId)uploadId=(await api('upload',{begin:true})).id;let result;for(let i=0;i<files.length;i++){const f=files[i];if(!/\.(xlsx|png|jpe?g|webp)$/i.test(f.name))continue;feedback(`正在上传 ${i+1}/${files.length}：${f.name}`);const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});result=await api('upload',{id:uploadId,name:f.webkitRelativePath||f.name,data});if(/\.xlsx$/i.test(f.name))$('sourceWorkbook').value=result.path;}return result;}
$('sourceExcelFile').onchange=()=>action(async()=>{await upload([...$('sourceExcelFile').files]);feedback('Excel 上传完成，请选择图片目录并识别。');});
$('sourceImageFiles').onchange=()=>action(async()=>{const files=[...$('sourceImageFiles').files],r=await upload(files);if(r){$('sourceImages').value=r.root;feedback('图片上传完成，点击“识别本机资料”继续。');}});
refresh().then(()=>{$('sourceWorkbook').value=state.batch?.workbook||state.defaults.workbook;$('sourceImages').value=state.batch?.assetRoot||state.defaults.assetRoot;$('sourceRecognize').disabled=false;if(state.batch)feedback(`已载入 ${state.batch.summary.total} 条商品；历史结果和断点已保留。`);}).catch(e=>feedback('执行服务尚未启动：'+e.message));
setInterval(()=>{if(!busy)refresh().catch(e=>feedback('连接中断，任务状态以恢复后的记录为准：'+e.message));},5000);
