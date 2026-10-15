import {shopFetch} from './shop-scope.js';
// Single-item controls used by the production workbench and isolated QA.
import {requestId} from './task-view-model.mjs';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = globalThis.LyUiCopy;
const states = {PENDING:'等待处理',RUNNING:'正在执行',FAILED:'执行异常',RESULT_UNKNOWN:'待核验',NEW_SUCCESS:'新增上架已核验',EXISTING_VERIFIED:'已有商品已核验',MANUAL_SKIPPED:'已手动跳过',PREFLIGHT_SKIPPED:'预检未通过',WAITING_HUMAN:'等待人工处理',PAUSED:'已暂停'};
const stateName = state => Object.hasOwn(states,state) ? states[state] : '状态待确认';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '未记录';
const verifyFields = ['roundId','windowId','key','expectedRevision','requestId'];
const verifyOutcomeNames = {VERIFIED:'核验通过',UNRESOLVED:'仍待核验',INTERRUPTED:'中断记录已整理'};
const verifyRejections = new Set(['ITEM_VERIFY_REQUEST_INVALID','ITEM_VERIFY_REQUEST_CONFLICT','ITEM_VERIFY_STALE_REVISION','ITEM_VERIFY_STATE_PROTECTED','ITEM_VERIFY_RUN_PROTECTED','ITEM_VERIFY_QUEUE_PROTECTED','ITEM_VERIFY_PARENT_NOT_IDLE','ITEM_VERIFY_EXECUTION_NOT_SETTLED','ITEM_VERIFY_WINDOW_ADAPTER_REQUIRED','ITEM_VERIFY_OTHER_WINDOW_OPEN','ITEM_VERIFY_WINDOW_SNAPSHOT_INVALID','ITEM_HOST_SHOP_REMOVED','ITEM_HOST_INTEGRITY_FAILED']);
export function candidateEvidenceHtml(proof) {
  if(!proof)return '';
  const missing='<section class="round-item-candidates"><h4>后台候选商品</h4><p>原查重证据暂不可用，此条仍待核验。请查看原执行记录，不能据此重新发布。</p></section>';
  const validDate=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
  if(proof.status!=='AVAILABLE'||!['ORIGINAL','VERIFICATION_ATTEMPT'].includes(proof.source)||!validDate(proof.recordedAt)||!Number.isInteger(proof.total)||proof.total>1000||!Array.isArray(proof.items)||!proof.items.length||proof.items.length>50||proof.total<proof.items.length)return missing;
  if(proof.items.some(c=>!c||typeof c.itemId!=='string'||!/^\d{6,30}$/.test(c.itemId)||typeof c.title!=='string'||!c.title||c.title.length>1000||typeof c.ambiguous!=='boolean'||!Array.isArray(c.conflicts)||c.conflicts.some(x=>!x||typeof x.country!=='string'||(x.city!==null&&typeof x.city!=='string'))||(c.queryObservedAt!==null&&!validDate(c.queryObservedAt))))return missing;
  return `<details class="round-item-candidates"><summary>待核对候选商品（${proof.total}）</summary>
    <p>以下为已保存的查重快照，不代表当前在售或已核验。标题或地名相近仍需核对商品范围。</p>
    <p class="muted">${proof.source==='VERIFICATION_ATTEMPT'?'最近核验尝试':'原查重'}记录时间：${escape(date(proof.recordedAt))}</p>
    <ol>${proof.items.map(c=>`<li><strong>${escape(c.title)}</strong><p>商品 ID：${escape(c.itemId)}</p>
      <p>${c.ambiguous?'存在地名或商品范围冲突，暂不能确认归属。':'地名相关，但尚未确认与原任务是同一商品。'}</p>
      ${c.conflicts.length?`<p>涉及目的地：${c.conflicts.map(x=>escape([x.country,x.city].filter(Boolean).join(' · '))).join('；')}</p>`:''}
      <p class="muted">${c.queryObservedAt?'查询中出现时间：'+escape(date(c.queryObservedAt)):'本次查询未单独确认该候选，保留原列表快照。'}</p>
      <a href="https://item.taobao.com/item.htm?id=${encodeURIComponent(c.itemId)}" target="_blank" rel="noopener noreferrer">查看候选商品 ↗</a></li>`).join('')}</ol>
    ${proof.truncated?'<p>候选较多，此处展示前50条；完整证据请查看原执行记录。</p>':''}
  </details>`;
}

export function submissionSummary(item, submissionEvidence) {
  if (item.submitted === true) return {label:'已点击提交',detail:'请以已保存的后台核验结果为准，不要重复发布。'};
  if (['NEW_SUCCESS','EXISTING_VERIFIED'].includes(item.state)) return {label:'商品结果已核验',detail:'本条已有核验结果；当前记录未明确本次提交情况，不要重复发布。'};
  if (item.submissionUncertain === true || submissionEvidence === true) return {label:'提交情况待核验',detail:'存在提交阶段或商品返回证据。先核对原商品，暂不能重新发布或跳过。'};
  if (submissionEvidence === false && item.submitted === false && item.submissionUncertain === false) {
    if (item.stage === 'existing-listing-check' && item.state === 'RESULT_UNKNOWN') return {label:'尚未提交 · 已有商品待核对',detail:'后台找到相关商品，系统已隔离此条。需要确认是否属于同一商品，不能直接重新发布。'};
    return {label:'尚未点击提交',detail:'下一步以服务检查结果为准；资料或店铺状态变化后需要重新检查。'};
  }
  return {label:'提交情况未记录',detail:'不能据此判定未发布，请先查看原执行记录。'};
}

// The caller owns the existing dialog, shop context and original-run navigation.
// Controlled single-item actions use the existing server; never contacts Chrome.
export function mountRoundItemDetail(root, scope, {request = shopFetch, onRun = null, canContinueAfterSkip = () => false, onContinueAfterSkip = null, labelStep = value => value ? '步骤待确认，查看定位信息' : '尚未开始', makeId = requestId} = {}) {
  let alive = true, generation = 0, data = null, loading = false, writing = false;
  let draft = '', pending = null, pendingContinueAfterSkip = false, continuePending = null, verifyPending = null, retryPending = null, notice = '', error = '', readFailed = false;
  let controlBusy=false,controlNotice='',controlError='';
  const controlFor=v=>v?{id:v.roundId,windowId:v.windowId,key:v.key,verificationRequestId:v.requestId}:null;
  const original = Object.freeze({roundId:scope.roundId,windowId:scope.windowId,key:scope.key});
  const query = new URLSearchParams(original);
  const validScope = v => v && Object.entries(original).every(([k,val]) => v[k] === val) && typeof v.revision === 'string' && !!v.revision && v.current?.key === original.key;
  const validVerifyRequest = v => v && !Array.isArray(v) && Object.keys(v).length === verifyFields.length && verifyFields.every(k=>typeof v[k]==='string' && !!v[k]) && Object.entries(original).every(([k,val])=>v[k]===val);
  const validRetryRequest = (v,executionWindowId) => v && !Array.isArray(v) && Object.keys(v).length===verifyFields.length && verifyFields.every(k=>typeof v[k]==='string' && !!v[k]) && v.roundId===original.roundId && v.key===original.key && (v.windowId===original.windowId || executionWindowId===original.windowId);
  async function json(url, init = {}) {
    const response = await request(url,{cache:'no-store',...init});
    let value; try {value = await response.json();} catch {throw Error('服务响应无法读取。');}
    if (!response.ok) throw Object.assign(Error(value.error || '服务暂时无法完成此操作。'),{status:response.status,code:value.code,retainRequest:value.retainRequest===true});
    return value;
  }
  function render() {
    if (!alive) return;
    const x = data?.current, summary = x && (retryPending ? {
      label:writing?'正在重试，提交状态待确认':'本次重试结果待核对',
      detail:'下方商品信息是本次请求前的记录。请等待或核对原请求，不能据此判断当前是否已提交。'
    } : submissionSummary(x,data?.submissionEvidence));
    const verifyCap = data?.capabilities?.verify;
    const retryCap = data?.capabilities?.retry;
    const retryRecovery = retryCap?.allowed===true && retryCap.mode==='RECOVER' && validRetryRequest(retryCap.request,retryCap.executionWindowId);
    const verifyRecovery = verifyCap?.allowed === true && verifyCap.mode === 'RECOVER' && validVerifyRequest(verifyCap.request);
    const serverControl=data?.verificationControl;
    const boundControl=serverControl?.id===original.roundId&&serverControl?.windowId===original.windowId&&serverControl?.key===original.key&&typeof serverControl.verificationRequestId==='string'&&!!serverControl.verificationRequestId;
    const control=verifyPending?controlFor(verifyPending):boundControl?serverControl:null;
    const canVerify = !loading && !writing && !readFailed && !pending && !verifyPending && !retryPending && (verifyRecovery || (verifyCap?.allowed === true && verifyCap.mode === 'VERIFY' && x?.state === 'RESULT_UNKNOWN'));
    const canSkip = data?.capabilities?.skip?.allowed === true && data?.submissionEvidence === false && x?.submitted === false && x?.submissionUncertain === false && ['PENDING','FAILED','WAITING_HUMAN'].includes(x?.state) && !loading && !writing && !pending && !continuePending && !verifyPending && !retryPending;
    const canSkipAndContinue = canSkip && !data?.windowOutcome && typeof onContinueAfterSkip==='function' && !!canContinueAfterSkip({roundId:original.roundId,windowId:original.windowId,key:original.key});
    const canRetry = !loading && !writing && !readFailed && !pending && !verifyPending && !retryPending && (retryRecovery || retryCap?.allowed===true && retryCap.mode==='RETRY' && data?.submissionEvidence===false && x?.submitted===false && x?.submissionUncertain===false && ['PENDING','FAILED'].includes(x?.state));
    const budgetReason = !pending && !verifyPending && !retryPending && !control && !verifyRecovery && !['RESULT_UNKNOWN','NEW_SUCCESS','EXISTING_VERIFIED','MANUAL_SKIPPED'].includes(x?.state) && retryCap?.allowed===false && ['ITEM_RETRY_BUDGET_EXHAUSTED','ITEM_RETRY_BUDGET_EXTRA_UNSAFE','ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED'].includes(retryCap.code) ? retryCap.reason : '';
    const nextStep = retryPending ? '本次操作结果尚未确认；沿用原操作核对，不创建第二次重试。' : canRetry ? retryCap.reason : x?.state === 'MANUAL_SKIPPED' ? '本轮已手动跳过此条，原执行记录与跳过原因均保留。' : x?.state === 'RESULT_UNKNOWN' && x?.stage === 'existing-listing-check' && data?.submissionEvidence === false
      ? '请在目标店铺后台核对上述候选；此条保持隔离，核验完成前不重发。'
      : budgetReason || data?.capabilities?.skip?.reason || '操作条件尚未确认，请刷新状态。';
    root.innerHTML = `<section class="round-item-detail" aria-busy="${loading || writing}">
      <div class="round-item-toolbar"><strong>当前任务</strong><button type="button" data-item-action="refresh" ${loading || writing || pending || continuePending || verifyPending || retryPending ? 'disabled' : ''}>${loading?'正在读取…':'刷新状态'}</button></div>
      <p role="status" class="round-item-feedback">${escape(notice || (loading?'正在读取任务状态…':''))}</p>
      <p role="alert" class="error">${escape(copy.reason(error))}</p>
      ${x ? `<header><h3>${escape(x.destination || '未记录目的地')}</h3><p class="round-item-title">${escape(x.title)}</p><span class="badge">${retryPending?'请求前状态：':''}${escape(stateName(x.state))}</span></header>
      <div class="notice round-item-summary"><strong>${escape(summary.label)}</strong><p>${escape(summary.detail)}</p></div>
      <dl class="round-item-facts"><div><dt>${retryPending?'请求前步骤':'当前 / 失败步骤'}</dt><dd>${escape(labelStep(x.stage || ''))}</dd></div><div><dt>${retryPending?'请求前问题':'当前问题'}</dt><dd>${escape(copy.reason(x.reason || '当前没有记录问题原因。'))}</dd></div><div><dt>开始时间</dt><dd>${escape(date(x.started))}</dd></div><div><dt>结束时间</dt><dd>${escape(date(x.finished))}</dd></div></dl>
      ${data.windowOutcome ? `<p class="notice">所选轮次已保存的结果：${escape(stateName(data.windowOutcome.state))}。当前任务状态与历史轮次分别保留。</p>` : ''}
      ${candidateEvidenceHtml(data.candidates)}
      <section class="round-item-next"><h4>下一步</h4><p>${escape(control ? '正在核验此商品，可请求暂停或停止；其他任务保持原状态。' : verifyRecovery ? verifyCap.reason : ['NEW_SUCCESS','EXISTING_VERIFIED'].includes(x.state) ? '商品结果已核验，原记录保留，无需再次发布。' : x.state==='RESULT_UNKNOWN' ? verifyCap?.reason || nextStep : nextStep)}</p>
      ${canVerify ? `<button type="button" class="round-item-primary" data-item-action="verify">${verifyRecovery?'恢复上次核验记录':'核验原商品'}</button><p class="muted">只核对原商品与保存结果，不重新发布，也不自动执行下一条。</p>` : ''}
      ${canRetry ? `<button type="button" class="round-item-primary" data-item-action="retry">${retryRecovery?'整理上次重试记录':'重新检查并重试此条'}</button>` : ''}
      ${retryPending ? `<p class="notice">${writing?'正在检查并处理所选商品；其他商品不会启动。':'上次请求结果尚未确认。核对将沿用原操作编号，不创建第二次重试。'}</p><button type="button" data-item-action="retry-reconcile" ${writing?'disabled':''}>${writing?'正在处理…':'核对上次重试结果'}</button><p class="muted">需要暂停时，请使用轮次状态区的暂停按钮。</p>` : ''}
      ${verifyPending ? `<p class="notice">${writing?'正在核验或恢复原操作，请等待结果。':'上次请求结果尚未确认。继续核对会沿用原操作编号，不创建新的核验。'}</p><button type="button" class="round-item-primary" data-item-action="verify-reconcile" ${writing?'disabled':''}>${writing?'正在处理…':'核对上次核验结果'}</button>` : ''}
      ${control ? `<div class="round-item-controls"><p class="muted">仅控制当前商品核验；请求将在安全检查处生效，原商品不重新提交。</p><button type="button" data-item-action="verify-pause" ${controlBusy?'disabled':''}>暂停核验</button><button type="button" data-item-action="verify-stop" ${controlBusy?'disabled':''}>停止核验</button><p role="status">${escape(controlNotice)}</p><p role="alert" class="error">${escape(controlError)}</p></div>` : ''}
      ${canSkip ? `<form data-item-skip><label>跳过原因<textarea name="reason" maxlength="1000" required placeholder="说明本轮不处理此商品的原因">${escape(draft)}</textarea></label><p class="muted">只有系统确认未提交时才可跳过。原商品与失败记录会保留，跳过后不会再次发布。</p><div class="round-item-skip-actions"><button type="submit" name="skipMode" value="skip">仅跳过此条</button>${canSkipAndContinue ? `<button type="submit" name="skipMode" value="continue" class="round-item-primary">跳过此条并继续本轮</button>` : ''}</div></form>` : ''}
      ${continuePending ? `<p class="notice">跳过已记录，继续本轮的请求结果尚未确认；核对会沿用原请求编号。</p><button type="button" data-item-action="continue-reconcile" ${writing?'disabled':''}>${writing?'正在请求继续…':'沿用原请求继续本轮'}</button>` : ''}
      ${pending ? `<p class="notice">${writing?'正在保存跳过决定，请等待结果。':'跳过请求的结果尚未确认。核对将沿用原操作编号和原因，不创建第二次操作。'}</p><button type="button" data-item-action="reconcile" ${writing?'disabled':''}>核对跳过结果</button>` : ''}
      ${x.runId && onRun ? '<button type="button" data-item-action="run">查看原执行日志与证据</button>' : ''}
      </section>
      <details class="round-item-history"><summary>处理记录（${data.attempts?.length || 0}）</summary>
        <p class="muted">原有运行可能未分段记录，以下列表不代表全部历史操作。</p>
        ${data.attempts?.length ? `<ol>${data.attempts.map(a=>`<li><strong>${escape(a.kind==='MANUAL_SKIP'?'手动跳过':a.kind==='MANUAL_RETRY'?'手动重试':a.kind==='VERIFY_ONLY'?'原商品核验':'处理尝试')} · ${escape(a.kind==='VERIFY_ONLY'?(Object.hasOwn(verifyOutcomeNames,a.disposition)?verifyOutcomeNames[a.disposition]:(a.finished?'结果待确认':'结果尚未保存')):stateName(a.state))}</strong><p>${escape(copy.reason(a.reason || (a.disposition==='VERIFIED'?'原商品结果已核验。':'未记录原因')))}</p>${a.disposition==='VERIFIED' && a.resultItemId ? `<p>商品 ID：${escape(a.resultItemId)}</p>` : ''}<small>${escape(date(a.started))} → ${escape(date(a.finished))}</small></li>`).join('')}</ol>` : '<p>尚无分段处理记录；已有运行请查看原执行日志。</p>'}
      </details><details class="round-item-diagnostics"><summary>定位信息</summary><dl><dt>失败或当前步骤</dt><dd>${escape(labelStep(x.stage || ''))}</dd><dt>轮次</dt><dd>${escape(data.windowId)}</dd><dt>任务</dt><dd>${escape(data.key)}</dd><dt>资料版本</dt><dd>${escape(data.taskHash)}</dd></dl></details>` : '<p>读取成功后展示商品状态、原因和可用操作。</p>'}
    </section>`;
    root.querySelector('[data-item-action="refresh"]')?.addEventListener('click',()=>load());
    root.querySelector('[data-item-action="reconcile"]')?.addEventListener('click',()=>save());
    root.querySelector('[data-item-action="continue-reconcile"]')?.addEventListener('click',()=>continueRound());
    root.querySelector('[data-item-action="verify-reconcile"]')?.addEventListener('click',()=>verify());
    root.querySelector('[data-item-action="retry-reconcile"]')?.addEventListener('click',()=>retry());
    root.querySelector('[data-item-action="retry"]')?.addEventListener('click',()=>{
      if(!canRetry||writing||retryPending||pending||verifyPending)return;
      retryPending=Object.freeze(retryRecovery?{...retryCap.request}:{...original,expectedRevision:data.revision,requestId:makeId()});retry();
    });
    root.querySelector('[data-item-action="verify"]')?.addEventListener('click',()=>{
      if (!canVerify || writing || verifyPending || pending) return;
      verifyPending=Object.freeze(verifyRecovery ? {...verifyCap.request} : {...original,expectedRevision:data.revision,requestId:makeId()});
      verify();
    });
    for(const action of ['pause','stop'])root.querySelector('[data-item-action="verify-'+action+'"]')?.addEventListener('click',()=>controlVerification(action,control));
    root.querySelector('[data-item-action="run"]')?.addEventListener('click',()=>onRun(x.runId));
    const form=root.querySelector('[data-item-skip]');
    form?.querySelector('textarea').addEventListener('input',e=>{draft=e.target.value;});
    form?.addEventListener('submit',e=>{
      e.preventDefault(); if (!canSkip || writing || pending || continuePending) return;
      draft=form.elements.reason.value;
      if (!draft.trim()) {error='请填写跳过原因。';render();root.querySelector('textarea')?.focus();return;}
      pendingContinueAfterSkip=e.submitter?.value==='continue';
      if(pendingContinueAfterSkip&&!canSkipAndContinue){pendingContinueAfterSkip=false;error='当前商品不是本轮可继续的安全断点，请刷新后检查状态。';render();return;}
      pending=Object.freeze({...original,expectedRevision:data.revision,requestId:makeId(),reason:draft.trim()});
      save();
    });
  }
  async function controlVerification(action,scope) {
    if(!alive||controlBusy||!scope)return;
    controlBusy=true;controlError='';controlNotice='正在请求'+(action==='stop'?'停止':'暂停')+'核验…';render();
    try{
      const receipt=await json('/api/v1/rounds/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(scope)});
      if(receipt.requestedAction!==action||Object.entries(scope).some(([k,v])=>receipt.verificationControl?.[k]!==v))throw Error('控制回执与原核验不一致，请刷新核对状态。');
      if(alive)controlNotice=action==='stop'?'已请求停止核验，等待安全检查完成并保存结果。':'已请求暂停核验，等待安全检查完成并保存断点。';
    }catch(e){if(alive){controlNotice='';controlError=e.message||'请求结果未确认，请核对当前状态。';}}
    finally{controlBusy=false;if(alive)render();}
  }
  async function load() {
    if (!alive || writing || pending || continuePending || verifyPending || retryPending) return;
    const id=++generation;loading=true;error='';render();
    try {
      const value=await json('/api/v1/rounds/item?'+query);
      if (!validScope(value)) throw Error('返回的任务范围不一致，请关闭详情后重新选择。');
      if (value.capabilities?.verify?.allowed === true && (value.capabilities.verify.mode==='RECOVER' ? !validVerifyRequest(value.capabilities.verify.request) : value.capabilities.verify.mode!=='VERIFY')) throw Error('核验恢复范围不一致，当前操作已禁用，请刷新核对。');
      if(value.capabilities?.retry?.allowed===true && (value.capabilities.retry.mode==='RECOVER'?!validRetryRequest(value.capabilities.retry.request,value.capabilities.retry.executionWindowId):value.capabilities.retry.mode!=='RETRY'))throw Error('重试范围不一致，当前操作已禁用，请刷新核对。');
      if (!alive || id!==generation) return;
      data=value;readFailed=false;
    } catch(e) {if (alive && id===generation) {readFailed=true;error=copy.reason(e.message) || '读取失败，请刷新重试。';}}
    finally {if (alive && id===generation) {loading=false;render();}}
  }
  async function verify() {
    if (!alive || writing || pending || retryPending || !verifyPending) return;
    const intent=verifyPending;
    writing=true;error='';notice='';render();
    try {
      const receipt=await json('/api/v1/rounds/item-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent)});
      const outcome=receipt?.outcome;
      const bound=typeof receipt?.attemptId==='string' && !!receipt.attemptId && ['roundId','windowId','key','requestId'].every(k=>receipt[k]===intent[k]);
      const known=outcome && Object.hasOwn(verifyOutcomeNames,outcome.disposition);
      const verified=outcome?.disposition==='VERIFIED';
      const consistent=verified
        ? ['NEW_SUCCESS','EXISTING_VERIFIED'].includes(outcome.state) && outcome.submittedByThisAction===false && /^\d+$/.test(String(outcome.result?.itemId||'')) && ['出售中','仓库中'].includes(outcome.result?.status) && outcome.item?.key===intent.key && outcome.item.state===outcome.state && outcome.item.submissionUncertain===false && outcome.item.result?.itemId===outcome.result.itemId && outcome.item.result?.status===outcome.result.status
        : outcome?.disposition==='UNRESOLVED'
          ? outcome.state==='RESULT_UNKNOWN' && outcome.submittedByThisAction===false
          : outcome?.disposition==='INTERRUPTED' && outcome.state==='RESULT_UNKNOWN' && outcome.snapshot?.item?.key===intent.key && outcome.snapshot.item.state===outcome.state && (!Object.hasOwn(outcome,'submittedByThisAction') || outcome.submittedByThisAction===false);
      if (!bound || !known || !consistent) throw Error('核验回执不完整或与所选商品不一致，请核对原操作结果。');
      if (!alive) return;
      verifyPending=null;
      notice=verified ? `原商品核验通过，商品 ID：${outcome.result.itemId}。未重新提交。` : outcome.disposition==='INTERRUPTED' ? '上次中断记录已整理，尚未确认商品结果。请刷新后重新核验。' : '本次仍未确认商品结果，原商品保持保护。请查看处理记录。';
    } catch(e) {
      if (!alive) return;
      // Only known definitive rejections release the local intent. In-progress,
      // storage, transport and malformed receipts retain the exact original ID.
      if (!e.retainRequest && e.status>=400 && e.status<500 && verifyRejections.has(e.code)) {verifyPending=null;readFailed=true;}
      error=copy.reason(e.message) || '请求结果尚未确认，请核对上次核验结果。';
    } finally {
      writing=false;
      if (alive) {render();if (!verifyPending && !readFailed) await load();}
    }
  }
  async function retry() {
    if(!alive||writing||pending||verifyPending||!retryPending)return;
    const intent=retryPending;writing=true;error='';notice='';render();
    try{
      const receipt=await json('/api/v1/rounds/item-retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(intent)});
      const outcome=receipt?.outcome;
      const saved=outcome?.snapshot?.item;
      const known=['PENDING','FAILED','PREFLIGHT_SKIPPED','MANUAL_SKIPPED','WAITING_HUMAN','RESULT_UNKNOWN','NEW_SUCCESS','EXISTING_VERIFIED'].includes(outcome?.state);
      const successful=['NEW_SUCCESS','EXISTING_VERIFIED'].includes(outcome?.state);
      const consistent=saved?.key===intent.key&&saved.state===outcome.state&&typeof saved.submitted==='boolean'&&typeof saved.submissionUncertain==='boolean'&&(!successful||saved.submissionUncertain===false&&/^\d{6,30}$/.test(String(saved.result?.itemId||''))&&['出售中','仓库中'].includes(saved.result?.status));
      if(!['roundId','windowId','key','requestId'].every(k=>receipt?.[k]===intent[k])||typeof receipt?.attemptId!=='string'||!receipt.attemptId||typeof receipt.executionWindowId!=='string'||!receipt.executionWindowId||receipt.finished!==true||!['FINISHED','INTERRUPTED'].includes(outcome?.disposition)||!known||!consistent||outcome.snapshot?.parent?.id!==intent.roundId||outcome.snapshot?.window?.id!==receipt.executionWindowId)throw Error('重试回执不完整或与所选商品不一致，请核对原操作结果。');
      if(!alive)return;
      retryPending=null;
      notice=outcome.disposition==='INTERRUPTED'?'上次中断记录已整理，本次未重新执行。请刷新查看当前允许的操作。':`本次单条处理已记录：${stateName(outcome.state)}。其他商品未启动。`;
    }catch(e){
      if(!alive)return;
      if(!e.retainRequest&&e.status>=400&&e.status<500&&['ITEM_RETRY_REQUEST_INVALID','ITEM_RETRY_REQUEST_CONFLICT','ITEM_RETRY_STALE_REVISION','ITEM_RETRY_SUBMISSION_PROTECTED','ITEM_RETRY_STATE_PROTECTED','ITEM_RETRY_RUN_PROTECTED','ITEM_RETRY_OTHER_RESOLUTION_REQUIRED','ITEM_RETRY_OTHER_WINDOW_OPEN','ITEM_RETRY_RELEASE_GATE_REQUIRED','ITEM_RETRY_NOT_ATTEMPTED','ITEM_RETRY_BUDGET_EXHAUSTED','ITEM_RETRY_BUDGET_EXTRA_UNSAFE','ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED'].includes(e.code)){retryPending=null;readFailed=true;}
      error=e.message||'请求结果尚未确认，请核对上次重试结果。';
    }finally{writing=false;if(alive){render();if(!retryPending&&!readFailed)await load();}}
  }
  async function save() {
    if (!alive || writing || continuePending || verifyPending || retryPending || !pending) return;
    writing=true;error='';render();
    try {
      const skipIntent=pending,continueAfterSkip=pendingContinueAfterSkip;
      const receipt=await json('/api/v1/rounds/item-skip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
      if (typeof receipt.attemptId !== 'string' || !receipt.attemptId || receipt.outcome?.state!=='MANUAL_SKIPPED' || receipt.outcome?.item?.key !== pending.key || receipt.outcome?.item?.state !== 'MANUAL_SKIPPED' || receipt.outcome?.item?.submitted !== false || receipt.outcome?.item?.submissionUncertain !== false || receipt.outcome?.reason !== pending.reason || receipt.outcome?.submitted !== false) throw Error('保存回执不完整或与所选商品不一致，需要核对原操作结果。');
      pending=null;pendingContinueAfterSkip=false;draft='';
      if(continueAfterSkip){
        continuePending=Object.freeze({roundId:skipIntent.roundId,windowId:skipIntent.windowId,key:skipIntent.key,requestId:makeId()});
        writing=false;
        await continueRound();return;
      }
      notice='跳过决定已保存，原执行记录保留。';
    } catch(e) {
      // A definitive rejection is different from a lost response. Do not
      // regenerate request IDs on transport errors or unclear server failures.
      if (e.status>=400 && e.status<500) {pending=null;readFailed=true;}
      error=copy.reason(e.message) || '请求结果尚未确认，请核对跳过结果。';
    } finally {
      writing=false;
      if (alive) {render();if (!pending && !continuePending && !readFailed) await load();}
    }
  }
  async function continueRound() {
    if(!alive||writing||pending||!continuePending)return;
    const intent=continuePending;writing=true;error='';notice='跳过已记录，正在继续本轮剩余商品…';render();
    try{
      const receipt=await onContinueAfterSkip(intent);
      if(receipt?.id!==intent.roundId)throw Error('继续请求的轮次与当前商品不一致。');
      continuePending=null;notice='当前商品已跳过，本轮剩余商品已交由原执行器继续处理。';
    }catch(e){
      error='当前商品已安全跳过，但继续请求尚未确认：'+(e.message||'服务暂时无法完成此操作。')+'。可沿用原请求编号再次核对。';
    }finally{
      writing=false;
      if(alive){render();if(!continuePending&&!readFailed)await load();}
    }
  }
  const ready=load();
  return {ready,refresh:load,dispose(){alive=false;generation++;root.replaceChildren();}};
}

// Shared current-item control. Served through the existing round detail module.
// A single operator decision, using the existing item-skip and round-resume APIs.
// Keep the exact requests through a lost response or page reload. Never infer
// that a submission is safe from the status banner alone.
export function createCurrentItemSkip({request=shopFetch,storage=sessionStorage,currentRound,makeId=requestId,onChange=()=>{}}) {
 const storageKey='ly-current-item-skip-v1';
 let pending=null,working=false,notice='',error=false,noticeScope=null;
 try {
  const saved=JSON.parse(storage.getItem(storageKey)||'null');
  if(saved?.version===1&&saved.skip&&saved.resume&&saved.skip.roundId===saved.resume.id&&saved.skip.windowId===saved.resume.windowId&&typeof saved.skip.key==='string'&&typeof saved.skip.expectedRevision==='string'&&typeof saved.skip.requestId==='string'&&typeof saved.resume.requestId==='string'&&typeof saved.resume.manifestHash==='string')pending=saved;
 } catch {}
 const sameRound=(r,p)=>r?.id===p.resume.id&&r.window?.id===p.resume.windowId&&r.manifestHash===p.resume.manifestHash;
 const publish=()=>onChange();
 function save(value){storage.setItem(storageKey,JSON.stringify(value));pending=value;}
 function clear(){storage.removeItem(storageKey);pending=null;}
 async function json(path,input){
  const response=await request(path,input===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  let body;try{body=await response.json();}catch{throw Error('服务回执未能读取，请核对此次跳过。');}
  if(!response.ok)throw Object.assign(Error(body.error||'服务暂时无法完成此操作。'),{confirmedRejection:true});
  return body;
 }
 function view(r){
  const recover=pending&&r?.id===pending.resume.id&&r.manifestHash===pending.resume.manifestHash;
  // Feedback belongs to the item that produced it. Once that item is no longer
  // current, keep the durable skip in round history but clear this action banner.
  if(noticeScope&&!pending&&(r?.id!==noticeScope.roundId||r?.window?.id!==noticeScope.windowId||r?.current?.key!==noticeScope.key)){
   notice='';error=false;noticeScope=null;
  }
  const open=r?.window&&!['COMPLETED','STOPPED'].includes(r.window.state);
  const skipped=r?.current?.state==='MANUAL_SKIPPED';
  const shown=!!recover||!!(open&&r.current&&!['NEW_SUCCESS','EXISTING_VERIFIED','PREFLIGHT_SKIPPED'].includes(r.current.state));
  let reason='跳过尚未提交的当前商品，并检查后继续本轮。';
  let allowed=!!recover||!!(shown&&!r.active&&!r.executionRecovery&&!r.verificationControl&&['PAUSED','SYSTEM_BLOCKED','WAITING_HUMAN'].includes(r.state)&&['PENDING','FAILED','WAITING_HUMAN'].includes(r.current.state)&&r.current.submitted===false&&r.current.submissionUncertain===false);
  if(pending&&!recover){allowed=false;reason='上次跳过请求尚待核对，请回到原轮次处理。';}
  else if(r?.active||r?.executionRecovery){allowed=false;reason='请先暂停并保存断点，执行器停稳后可跳过。';}
  else if(skipped&&!recover)reason='此条已跳过，继续本轮会处理后续商品，无需重复跳过。';
  else if(!allowed)reason='已有提交、待核验或受保护记录，请查看此条详情。';
  return {shown,allowed:allowed&&!working,label:working?'正在处理…':recover?'核对此次跳过':skipped?'已跳过此条':'跳过此条',reason,
   roundId:r?.id,windowId:recover?pending.skip.windowId:r?.window?.id,key:recover?pending.skip.key:r?.current?.key,
   notice:notice||(recover?'上次请求尚待核对，点击按钮将沿用原操作记录。':''),error};
 }
 async function run(scope){
  if(working)return;
  const r=currentRound(),v=view(r);
  if(!v.allowed||scope.roundId!==v.roundId||scope.windowId!==v.windowId||scope.key!==v.key)throw Error('当前商品或轮次已变化，请刷新后重新操作。');
  working=true;noticeScope={roundId:scope.roundId,windowId:scope.windowId,key:scope.key};notice='正在核对当前商品是否尚未提交…';error=false;publish();
  try {
   if(!pending){
    const query=new URLSearchParams(scope),detail=await json('/api/v1/rounds/item?'+query);
    const live=currentRound();
    if(live?.id!==r.id||live.window?.id!==r.window.id||live.manifestHash!==r.manifestHash||live.current?.key!==scope.key||live.active||detail.roundId!==scope.roundId||detail.windowId!==scope.windowId||detail.key!==scope.key||detail.current?.key!==scope.key)throw Error('当前商品或轮次已变化，请刷新后重新操作。');
    if(detail.capabilities?.skip?.allowed!==true||detail.submissionEvidence!==false||detail.current.submitted!==false||detail.current.submissionUncertain!==false)throw Error(detail.capabilities?.skip?.reason||'此条已有提交或待核验记录，不能跳过。');
    const reason=('操作者在本轮操作区点击“跳过此条”：'+(r.current.destination||'当前商品')+'；'+(r.current.reason||r.reason||'页面卡顿，人工跳过')).slice(0,1000);
    save({version:1,destination:r.current.destination||'当前商品',skip:{...scope,expectedRevision:detail.revision,requestId:makeId(),reason},resume:{id:r.id,windowId:r.window.id,manifestHash:r.manifestHash,requestId:makeId()}});
   }
   let receipt;
   try{receipt=await json('/api/v1/rounds/item-skip',pending.skip);}catch(e){if(e.confirmedRejection)clear();throw e;}
   if(receipt.outcome?.state!=='MANUAL_SKIPPED'||receipt.outcome.submitted!==false||receipt.outcome.item?.key!==pending.skip.key)throw Error('跳过回执与原商品不一致，请核对此次跳过。');
   const destination=pending.destination;
   notice='已跳过'+destination+'，正在检查本轮继续条件…';publish();
   if(!sameRound(currentRound(),pending)){
    clear();notice='已跳过'+destination+'；轮次范围已变化，请从原轮次检查继续条件。';error=true;return;
   }
   try {
    await json('/api/v1/rounds/resume',pending.resume);
    clear();notice='已跳过'+destination+'，已请求继续本轮。';
   } catch(e) {
    if(e.confirmedRejection)clear();
    notice='已跳过'+destination+'；继续本轮'+(e.confirmedRejection?'未通过检查：':'尚未确认：')+e.message;error=true;
   }
  } catch(e) {
   notice=(pending?'跳过结果尚未确认，请点击“核对此次跳过”沿用原请求。':'未跳过当前商品：')+' '+e.message;error=true;
  } finally {working=false;publish();}
 }
 return {view,run};
}
