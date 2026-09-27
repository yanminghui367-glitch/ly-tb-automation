// Product projections only: these never move an execution task or control a page.
export function redact(value='') {
  return String(value).replace(/\u001b\[[0-9;]*m/g,'')
    .replace(/((?:cookie|authorization)\s*[=:：]\s*)[^\r\n]+/gi,'$1[已隐藏]')
    .replace(/https?:\/\/\S+/g,'[页面地址]')
    .replace(/((?:password|passwd|cookie|authorization|access[_-]?token|refresh[_-]?token|token|密码)\s*[=:：]\s*)[^\s,;]+/gi,'$1[已隐藏]')
    .slice(0,8000);
}
export function classify(reason='',state='') {
  const raw=redact(reason);
  if(['VERIFIED','SUCCEEDED'].includes(state))return {category:'已成功',next:'查看平台核验记录',condition:'成功商品禁止再次发布，无需恢复',raw};
  if(['PENDING','QUEUED','READY'].includes(state))return {category:'待开始',next:'核对批次范围后开始',condition:'资料核对完成、执行浏览器与店铺检查通过',raw};
  if(state==='RESULT_UNKNOWN'||/提交结果未知|提交可能|结果待核验/.test(raw))return {category:'待核验',next:'先核验原商品，不再次提交',condition:'已登录原店铺，原 checkpoint 中存在商品 ID；无 ID 时先在后台人工核对',raw};
  if(state==='PAUSED_CAPTCHA'||/CAPTCHA|验证码|滑块/.test(raw))return {category:'验证码',next:'在执行 Chrome 人工完成验证，再检查并继续',condition:'验证已消失、原页面保留、店铺身份通过重新检查',raw};
  if(/SOURCE_OR_ASSET_CHANGED|UNVERIFIED_CATEGORY|UNSUPPORTED_SOURCE|错图|缺图|缺失|素材|资料|ENOENT/.test(raw))return {category:'资料问题',next:'核对原资料与图片后重新校验',condition:'原任务快照与文件哈希一致；不能替换冻结任务资料',raw};
  if(/登录|店铺身份|LOGIN|浏览器未运行|browser.*closed|disconnected/i.test(raw))return {category:'登录 / 浏览器',next:'打开执行 Chrome，人工登录原店铺后检查',condition:'执行浏览器可用且目标店铺身份核验通过',raw};
  if(/locator\.|expect\(|strict mode|定位|页面.*校验/.test(raw))return {category:'页面校验',next:'查看截图与错误，核对页面后有限重试',condition:'页面步骤符合已有映射；需改内核时先确认',raw};
  if(state==='DRY_RUN_COMPLETE')return {category:'仅填写完成',next:'查看填写结果；本批不会自动转正式模式',condition:'当前内核的仅填写批次在首条完成后停止',raw};
  if(/操作者暂停|程序中断|程序已停止/.test(raw))return {category:'执行中断',next:'检查原任务断点后继续',condition:'程序空闲、断点已持久化、浏览器与源文件检查通过',raw};
  if(state==='FAILED')return {category:'执行失败',next:'查看原始错误并人工确认原因',condition:'未达重试上限，且不是提交结果不明的任务',raw};
  return {category:'待人工确认',next:'查看原始错误和截图，确认原因后再操作',condition:'原因未被可靠识别，不推定已具备恢复条件',raw};
}
export function browserView(raw={},now=Date.now(),fresh=false) {
  const checkedAt=raw.checkedAt||(fresh?new Date(now).toISOString():null);
  const age=now-Date.parse(checkedAt),stale=!Number.isFinite(age)||age<0||age>15000;
  const known=!stale&&typeof raw.running==='boolean';
  const verified=known&&raw.running&&raw.loginState==='LOGGED_IN'&&raw.loggedIn===true;
  const loginState=known?raw.loginState||'LOGIN_UNVERIFIED':'CHECK_REQUIRED';
  return {running:known?raw.running:null,loggedIn:verified,loginState,checkedAt,stale,
    label:!known?'待检查':!raw.running?'未运行':verified?'已登录':loginState==='PAUSED_CAPTCHA'?'等待人工验证':loginState==='LOGIN_UNVERIFIED'?'待检查':'需要登录',
    reason:stale?'状态已过期，请重新检查执行浏览器。':redact(raw.reason||(!raw.running?'执行浏览器未运行':'尚未确认登录状态'))};
}
export function pauseView(flow,source,runs) {
  if(flow.active||source.active){
    const finishingRun=runs.some(r=>r.id===source.active&&['PAUSED','PAUSED_CAPTCHA','RESULT_UNKNOWN'].includes(r.state));
    const finishingBatch=flow.active&&!source.active&&['PAUSED','WAITING_HUMAN'].includes(flow.store?.batch(flow.active)?.state);
    const pausing=flow.stopping||source.stop||finishingRun||finishingBatch;
    return {state:pausing?'PAUSING':'RUNNING',saved:false,label:pausing?'正在暂停':'运行中',detail:pausing?'已请求停止，等待当前步骤结束并保存断点。尚未确认安全暂停。':'当前任务由本地服务执行，关闭网页不会停止任务。'};
  }
  if(runs.some(r=>r.state==='RESULT_UNKNOWN'))return {state:'VERIFY_REQUIRED',saved:true,label:'待核验',detail:'提交结果尚不明确。仅允许核验原商品，禁止直接重新发布。'};
  if(runs.some(r=>r.state==='RUNNING'||r.state==='SUBMITTING'))return {state:'CHECK_REQUIRED',saved:false,label:'待检查',detail:'持久状态仍显示运行中，需要人工核对；不会宣称已暂停。'};
  if(runs.some(r=>['PAUSED','PAUSED_CAPTCHA'].includes(r.state)))return {state:'PAUSED',saved:true,label:'已暂停',detail:'运行已停止，数据库已记录任务状态与断点。继续前重新检查恢复条件。'};
  return {state:'IDLE',saved:true,label:'空闲',detail:'没有正在执行的任务。'};
}
