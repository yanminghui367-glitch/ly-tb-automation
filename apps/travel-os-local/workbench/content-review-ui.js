const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decisions = [['UNREVIEWED','未审核'],['PASS','审核通过'],['MISMATCH','内容不符，需修改']];
function imageUrl(value) {
 const raw=String(value||'');
 if(!raw||/[\\\u0000-\u0020]/.test(raw))return '';
 try {const parsed=new URL(raw,'http://localhost');return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!raw.startsWith('//')?raw:'';} catch {return '';}
}

// This panel records a human review of the server's frozen product and images.
// Creating a list or saving a review never starts an execution task.
export function mountContentReview(container,{get,post,shopName='',onSaved=()=>{},requestId=()=>globalThis.crypto.randomUUID()}={}) {
 let alive=true,loading=false,writing=false,snapshot=null,offset=0,error='',notice='',confirmed=false,generation=0;
 const limit=20,drafts=new Map(),repairs=new Set(),pending=new Map();
 const name=()=>typeof shopName==='function'?shopName():shopName;
 const items=()=>snapshot?.items||[];
 const draft=item=>{
  const stored=drafts.get(item.key);
  const identity=JSON.stringify([item.taskHash,item.mainHashes]);
  if(stored?.identity===identity)return stored;
  const review=item.review||{},value={identity,decision:decisions.some(([key])=>key===review.decision)?review.decision:'UNREVIEWED',observedText:review.observedText||'',reviewer:review.reviewer||''};
  drafts.set(item.key,value);return value;
 };
 const button=(action,label,attrs='')=>`<button type="button" data-content-action="${action}" ${attrs}>${label}</button>`;
 function draw() {
  if(!alive)return;
  const disabled=loading||writing,total=Number(snapshot?.total)||0,round=snapshot?.round;
  container.innerHTML=`<section class="ops-preview content-review" aria-label="商品内容审核" aria-busy="${disabled}">
   <div class="ops-heading"><div><h2>商品内容审核${name()?` · ${esc(name())}`:''}</h2><p class="form-note">核对清单中的商品标题与主图内容，逐条保存审核结果，再回任务页继续执行。</p></div>${button('refresh',loading?'读取中…':'刷新审核状态',disabled?'disabled':'')}</div>
   ${error?`<p class="notice danger" role="alert">${esc(error)}</p>`:''}${notice?`<p class="notice" role="status">${esc(notice)}</p>`:''}
   ${!snapshot?`<p class="form-note">${loading?'正在读取商品清单…':'尚未读取到商品资料，可刷新重试。'}</p>`:!total?'<p class="notice">当前店铺尚无商品资料，请先在资料设置中导入。</p>':!round?`
    <p class="notice">已导入 ${total} 条商品，尚未建立执行清单。建立后再逐条核对图片与标题。</p>
    <label><input type="checkbox" data-content-field="confirmed" ${confirmed?'checked':''} ${disabled?'disabled':''}> 我已核对当前店铺和 ${total} 条商品，确认以本次导入资料建立执行清单</label>
    <p>${button('create','建立执行清单',`class="primary" ${disabled||!confirmed?'disabled':''}`)}</p>`:`
    <p class="form-note" role="status">共 ${total} 条 · 已审核 ${esc(snapshot.reviewed??0)} 条 · 未审核 ${esc(snapshot.unreviewed??total)} 条 · 内容不符 ${esc(snapshot.mismatched??0)} 条</p>
    ${items().map((item,index)=>{
     const value=draft(item),token=`content-review-${index}`,status=decisions.find(([key])=>key===item.review?.decision)?.[1]||'未审核';
     return `<section class="ops-preview" data-content-key="${esc(item.key)}" aria-label="${esc(item.destination)}内容审核">
      <h3>${esc(item.position??offset+index+1)}. ${esc(item.destination)} <small>已保存：${status}</small></h3><p>${esc(item.title)}</p>
      ${item.preflightCredit>0?`<p class="form-note">历史预检抵扣 ${esc(item.preflightCredit)} 次；有效尝试 ${esc(item.effectiveAttempts??'—')} 次。原历史保留</p>`:''}
      <div class="ops-tools">${(item.images||[]).map(image=>{const url=imageUrl(image.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" width="160" height="160" loading="lazy" alt="${esc(image.name||item.destination+'主图')}"><span>${esc(image.name||'打开主图查看')}</span></a>`:'<p class="notice danger">主图地址不可用，请刷新核对。</p>';}).join('')||'<p class="notice danger">暂无可查看的主图，请先核对资料。</p>'}</div>
      <div class="setup-format"><label for="${token}-decision">审核结果<select id="${token}-decision" data-content-field="decision" ${disabled?'disabled':''}>${decisions.map(([key,label])=>`<option value="${key}" ${value.decision===key?'selected':''}>${label}</option>`).join('')}</select></label>
      <label for="${token}-reviewer">审核者<input id="${token}-reviewer" data-content-field="reviewer" value="${esc(value.reviewer)}" maxlength="160" autocomplete="off" ${disabled?'disabled':''}></label></div>
      <label for="${token}-observed">实际观察到的文字与内容<textarea id="${token}-observed" data-content-field="observedText" rows="3" maxlength="1000" placeholder="请填写实际看到的目的地、服务文字及发现的问题" ${disabled?'disabled':''}>${esc(value.observedText)}</textarea></label>
      <p>${button('review','保存本条审核',`class="primary" ${disabled?'disabled':''}`)}</p>
      ${item.repairEligible?`<div class="notice"><p>本条此前在执行前检查时被拦住，可核对并恢复尚未启动的记录。原异常历史保留。</p><label><input type="checkbox" data-content-field="repairConfirmed" ${repairs.has(item.key)?'checked':''} ${disabled?'disabled':''}> 确认恢复本条未启动记录</label><p>${button('repair','恢复未启动记录',disabled||!repairs.has(item.key)?'disabled':'')}</p></div>`:''}
     </section>`;
    }).join('')||'<p class="notice">本页暂无商品，可返回上一页或刷新。</p>'}
    <div class="ops-pagination"><span>第 ${Math.floor(offset/limit)+1} / ${Math.max(1,Math.ceil(total/limit))} 页 · 每页 ${limit} 条</span><div>${button('previous','上一页',disabled||!offset?'disabled':'')}${button('next','下一页',disabled||offset+limit>=total?'disabled':'')}</div></div>`}
  </section>`;
 }
 async function load() {
  if(!alive||loading||writing)return;
  loading=true;const ticket=++generation;draw();
  try {const next=await get(`/api/v1/content-preparation?offset=${offset}&limit=${limit}`);if(!alive||ticket!==generation)return false;snapshot=next;error='';return true;}
  catch(e){if(alive&&ticket===generation)error=e.message||'读取失败，请重试。';return false;}
  finally{if(alive&&ticket===generation){loading=false;draw();}}
 }
 async function save(action,item) {
  if(!alive||loading||writing||!snapshot)return;
  let body,path;
  if(action==='create') {
   if(!confirmed||snapshot.round||!snapshot.total)return;
   path='create';body={importId:snapshot.importId,expectedCount:snapshot.total,confirmed:true};
  } else {
   if(!item||!snapshot.round)return;
   body={id:snapshot.round.id,manifestHash:snapshot.round.manifestHash,key:item.key};path=action;
   if(action==='review') {
    const value=draft(item);
    if(!value.reviewer.trim()||!value.observedText.trim()){error='请填写审核者和实际观察内容，再保存审核结果。';draw();return;}
    if(value.reviewer.length>160||value.observedText.length>1000){error='审核者限160字，实际观察内容限1000字，请缩短后保存。';draw();return;}
    Object.assign(body,{taskHash:item.taskHash,mainHashes:item.mainHashes,decision:value.decision,observedText:value.observedText.trim(),reviewer:value.reviewer.trim()});
   } else if(action==='repair') {
    if(!item.repairEligible||!repairs.has(item.key))return;body.confirmed=true;
   } else return;
  }
  const signature=JSON.stringify([path,body]);if(!pending.has(signature))pending.set(signature,requestId());body.requestId=pending.get(signature);
  writing=true;error='';notice='';draw();
  let saved=false;
  try {await post(`/api/v1/content-preparation/${path}`,body);if(!alive)return;pending.delete(signature);saved=true;notice=action==='create'?'执行清单已建立，请逐条核对并保存审核。':action==='repair'?'未启动记录已恢复，尚未开始执行。':'本条审核已保存。';if(item)repairs.delete(item.key);confirmed=false;}
  catch(e){if(alive)error=e.message||'保存失败，请保留输入并重试。';}
  finally {if(alive){writing=false;draw();}}
  if(saved&&alive){const loaded=await load();if(alive&&loaded&&action==='review'){drafts.delete(item.key);draw();}if(alive)await onSaved({action,key:item?.key});}
 }
 function field(event) {
  if(loading||writing)return;
  const target=event.target,key=target.dataset?.contentField;
  if(!key)return;
  if(key==='confirmed'){confirmed=target.checked;draw();return;}
  const card=target.closest?.('[data-content-key]'),item=items().find(row=>row.key===card?.dataset.contentKey);
  if(!item)return;
  if(key==='repairConfirmed'){target.checked?repairs.add(item.key):repairs.delete(item.key);draw();return;}
  if(['decision','reviewer','observedText'].includes(key))draft(item)[key]=target.value;
 }
 function click(event) {
  const target=event.target.closest?.('[data-content-action]');if(!target||target.disabled||loading||writing)return;
  const action=target.dataset.contentAction;
  if(action==='refresh')return load();
  if(action==='previous'||action==='next'){const next=offset+(action==='next'?limit:-limit);if(next<0||next>=Number(snapshot?.total))return;offset=next;return load();}
  const key=target.closest?.('[data-content-key]')?.dataset.contentKey;
  return save(action,items().find(item=>item.key===key));
 }
 container.addEventListener('click',click);container.addEventListener('input',field);container.addEventListener('change',field);
 draw();const ready=load();
 return {ready,refresh:load,dispose(){alive=false;generation++;container.removeEventListener('click',click);container.removeEventListener('input',field);container.removeEventListener('change',field);}};
}
