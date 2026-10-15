// Display-only translations for machine states, execution steps and diagnostics.
// Internal state values remain unchanged in storage and API payloads.
(() => {
  const states = {
    PAUSED_CAPTCHA: '遇到验证码，等待人工处理',
    WAITING_HUMAN: '等待人工处理', PAUSED: '已暂停', PAUSING: '正在暂停',
    SYSTEM_BLOCKED: '系统异常，执行已暂停', RESULT_UNKNOWN: '提交结果待核验',
    SUBMITTING: '正在提交', RUNNING: '正在执行', READY: '等待开始',
    PENDING: '等待处理', QUEUED: '等待执行', RETRY: '等待重试',
    WAITING_FOR_REVIEW: '等待审核', COMPLETED_WITH_ISOLATIONS: '部分商品已隔离，批次结束',
    RISK_PAUSED: '风控暂停，等待人工处理', PAUSED_RISK_CONTROL: '风控暂停，等待人工处理',
    MANUAL_FIELD_REQUIRED: '需要人工填写', FINAL_REVIEW_REQUIRED: '等待人工核验',
    SESSION_REVALIDATION_FAILED: '店铺登录状态需要重新核验',
    FAILED: '执行异常', VERIFIED: '已核验上架', SUCCEEDED: '已核验上架',
    NEW_SUCCESS: '新增商品已核验', EXISTING_VERIFIED: '已有商品已核验',
    PREFLIGHT_SKIPPED: '资料预检未通过', MANUAL_SKIPPED: '已手动跳过',
    DRY_RUN_COMPLETE: '仅填写完成，尚未提交', NEEDS_REVIEW: '存在待核验项目',
    COMPLETED: '已完成', STOPPED: '已停止', CANCELLED: '已取消',
    MAIN_MATERIAL_FRAME_ORIGIN: '主图页面来源异常', CONTENT_MISMATCH: '商品素材与目的地不一致',
    CONTENT_REVIEW_REQUIRED: '商品内容需要人工核对', BROWSER_UNAVAILABLE: '执行浏览器不可用',
    CHALLENGE_PRESENT: '页面出现人工验证', ENOENT: '找不到指定文件或目录',
    EACCES: '没有访问文件的权限', ECONNRESET: '连接被重置',
    ECONNREFUSED: '连接被拒绝', ETIMEDOUT: '连接等待超时',
    TimeoutError: '操作等待超时', AbortError: '操作已中止', TypeError: '数据格式异常'
  };
  const kinds = {
    STEP_INTENT: '开始执行步骤', STEP_VERIFIED: '步骤核对通过', STEP_FAILED: '步骤执行异常',
    SUBMITTING: '正在提交商品', SUBMIT_CLICKED: '已点击提交', SUBMIT_EVIDENCE: '已记录提交凭据',
    RESULT_UNKNOWN: '提交结果待核验', PAUSED: '任务已暂停', WAITING_HUMAN: '等待人工处理',
    FAILED: '任务执行异常', VERIFIED: '商品结果已核验', PROGRAM_CLOSED: '工作台已关闭并保存断点',
    TASK_CREATED: '已创建任务', TASK_QUEUED: '任务已排队', TASK_STARTED: '任务已开始',
    TASK_PAUSED: '任务已暂停', TASK_RESUMED: '任务已恢复', TASK_COMPLETED: '任务已完成',
    SCHEDULER_ERROR: '任务调度异常', BATCH_PREFLIGHT_FAILED: '批次资料检查未通过'
  };
  const steps = {
    'open-new-form': '打开商品发布页', title: '填写商品标题', 'guide-title': '填写导购标题',
    price: '核对价格', inventory: '核对库存', brand: '核对品牌',
    'custom-service': '核对定制服务', 'listing-state': '核对上架方式',
    'shipping-time': '核对发货时效', 'shipping-region': '核对发货范围',
    'single-origin': '核对单一发货地', logistics: '核对物流设置',
    'freight-template': '核对运费模板', 'ship-from': '核对发货地',
    procurement: '核对采购地', 'region-restriction': '核对区域设置',
    'open-details': '打开详情编辑区', 'insert-details': '添加详情图片',
    'pre-submit-review': '提交前核对商品信息', 'submit-once': '提交商品',
    'verify-platform-result': '核验平台处理结果', preflight: '检查资料与已有商品',
    'existing-listing-check': '核对已有商品', 'known-listing-check': '核验原商品',
    'existing-listing-query': '读取商品列表', 'known-listing-query': '读取原商品结果',
    'content-preflight': '核对商品主图', 'content-review': '核对商品内容',
    'existing-verified': '核验已有商品', 'platform-verified': '核验本轮商品',
    'manual-skip': '记录手动跳过', WAITING_FOR_REVIEW: '等待审核',
    MANUAL_FIELD_REQUIRED: '等待人工填写', FINAL_REVIEW_REQUIRED: '等待人工核验',
    SESSION_REVALIDATION_FAILED: '重新核验店铺登录状态', PAUSED_RISK_CONTROL: '等待人工处理风控验证',
    RISK_PAUSED: '等待人工处理风控验证', PACKAGE_REVALIDATION_FAILED: '重新核对商品资料',
    PACKAGE_CHANGED_SINCE_REVIEW: '商品资料发生变化', PACKAGE_SNAPSHOT_MISSING: '缺少冻结的商品资料',
    DUPLICATE_LISTING_DETECTED: '核对同店重复商品', SHOP_REVALIDATION_FAILED: '重新核对当前店铺',
    MAPPING_INVALID: '重新核对字段映射', MAPPING_CHANGED_SINCE_REVIEW: '字段映射发生变化',
    MAPPING_SNAPSHOT_MISSING: '缺少冻结的字段映射', FIELD_VALUE_MISSING: '商品资料缺少必需字段',
    PAGE_OR_MAPPING_PAUSED: '页面或字段映射需要人工核验'
  };
  const codePattern = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:ENOENT|EACCES|ECONNRESET|ECONNREFUSED|ETIMEDOUT|TimeoutError|AbortError|TypeError)\b/g;
  const safeText = value => {
    let text = String(value ?? '');
    text = text.replace(codePattern, token => states[token] || kinds[token] || '系统内部异常');
    text = text.replace(/\bError:\s*/g, '执行异常：').replace(/\b(?:at\s+)?[A-Za-z_$][\w$]*\s*\([^\n)]*\)/g, '');
    text = text.replace(/(?:[A-Z]:\\[^\s:]+|\\\\[^\s]+|\b(?:workbench|node_modules)\\[^\s]+)/gi, '本机文件位置');
    return text.replace(/[ \t]{2,}/g, ' ').trim();
  };
  const reasonText = value => {
    if(/SOURCE_OR_ASSET_CHANGED|PACKAGE_CHANGED_SINCE_REVIEW/.test(String(value??'')))return diagnose(value).cause;
    let text = safeText(value).replace(/\bChrome\b/gi, '执行浏览器').replace(/\bPlaywright\b/gi, '自动化程序').replace(/\bExcel\b/gi, '表格文件').replace(/\bDRY_RUN\b/gi, '仅填写模式').replace(/\bLIVE\b/g, '正式执行').replace(/\bID\b/g, '编号');
    return /[A-Za-z]{2,}/.test(text) ? '系统记录了技术异常，请按页面提供的处理建议检查；详细诊断已保存在本机。' : text;
  };
  const stepName = value => {
    const step = String(value ?? '');
    const indexed = step.match(/^(main-image|select-detail)-(\d+)$/);
    if (indexed) return `${indexed[1] === 'main-image' ? '核对主图' : '选择详情图'} ${indexed[2]}`;
    const attribute = step.match(/^attribute-(pattern|size|style|subject|people)$/);
    if (attribute) return `核对商品属性：${({pattern:'图案',size:'尺寸',style:'款式',subject:'科目',people:'适用人数'})[attribute[1]]}`;
    const text = steps[step] || safeText(step);
    return /[A-Za-z]{2,}/.test(text) ? '正在核对当前步骤' : text || '尚未开始';
  };
  const eventName = (label, kind) => {
    const text = reasonText(label || kinds[kind] || kind || '状态已更新');
    return /[A-Za-z]{2,}/.test(text) ? kinds[kind] || '执行状态已记录' : text;
  };
  // Display guidance only: never grants retry permission or changes a task.
  const diagnose = (value, {state='', stage='', submissionUncertain=false}={}) => {
    const raw=String(value??'');
    const issue=(title,cause,action,known=true)=>({title,cause,action,known});
    if(state==='RESULT_UNKNOWN'||submissionUncertain||/提交结果未知|提交可能|结果待核验/.test(raw))return issue('提交结果待核验','尚未确认平台是否已经收到并发布这条商品。','查看原商品详情和后台核验记录，先确认原商品结果；不要再次提交或重新发布。');
    if(state==='PAUSED_CAPTCHA'||/CAPTCHA|CHALLENGE_PRESENT|验证码|滑块/.test(raw))return issue('需要人工验证','执行页面出现验证码或平台人工验证，自动执行已暂停。','打开执行浏览器，人工完成验证；确认验证消失后，点击“检查并继续本轮”。');
    if(/内核发生变化|内核校验失败|内核文件变化|内核已改变|KERNEL_(?:CHANGED|MISMATCH)|INTEGRITY_FAILED/.test(raw))return issue('网站执行版本不一致','执行代码与已验收的版本记录不一致。','保留原任务，交维护人员核对代码、同步已验收版本并重载网站；完成后刷新页面再检查。');
    if(/SOURCE_OR_ASSET_CHANGED|PACKAGE_CHANGED_SINCE_REVIEW/.test(raw))return issue('任务资料与当前文件不一致','当前表格或图片已改变，原任务仍记录修改前的资料版本，执行前核对未通过。','在“资料设置”确认最新资料已保存，再由维护人员核对原任务与新资料的版本绑定；完成后继续原任务。重新开始一轮不会自动更新旧快照。');
    if(/ENOENT|找不到指定文件|文件不存在|缺图|缺少.*图片/.test(raw))return issue('资料文件缺失','任务引用的表格或图片在原位置找不到。','在资料设置核对文件目录和名称，恢复缺失文件或补齐资料后保存；保留原任务，再检查对应的资料版本。');
    if(/运费模板.*(?:不存在|未找到|不匹配|未通过)|FREIGHT_TEMPLATE/.test(raw)||(stage==='freight-template'&&/timeout|超时|locator|expect\(/i.test(raw)))return issue('运费模板未核对通过','任务要求的运费模板尚未成功选择或与店铺实际模板不一致。','在店铺后台核对实际模板名称，再检查本店资料的运费模板设置；不要套用其他店铺的模板。');
    if(/NO_SKU_UNVERIFIED|ROOT_ANCESTRY_CHANGED/.test(raw))return issue('销售规格核对未通过','平台销售规格区域未通过当前无规格商品的结构核对，尚未确认可以安全提交。','打开当前商品详情与步骤截图，交维护人员核对发布页结构；确认适配后再继续，不要跳过提交前检查。');
    if(/(?:图片|详情图|主图).*(?:尺寸|超长|比例|分割)|IMAGE_(?:SIZE|DIMENSION)|DETAIL_IMAGE_/.test(raw))return issue('图片规格需要处理','当前图片尺寸或详情图插入状态未通过检查。','查看平台图片提示，按提示调整原资料图片并保存；同时核对原任务的图片版本，再检查并继续。');
    if(/CONTENT_REVIEW_HELD|CONTENT_MISMATCH|主图内容待核验|错图/.test(raw))return issue('商品图片内容需要核对','商品图片与目的地的一致性尚未确认。','核对当前商品的目的地、主图与详情；已有商品应检查平台实际内容，保留原商品记录，不要重新发布。');
    if(/ITEM_RETRY_BUDGET_EXHAUSTED|ROUND_.*(?:EXHAUSTED|BUDGET)|尝试.*上限|恢复.*耗尽|不具备额外安全恢复条件/.test(raw))return issue('原任务恢复条件未满足','原任务的尝试次数或额外恢复条件未通过检查。','查看当前商品详情中的尝试与恢复记录；可按原计划跳过问题商品，待首轮结束后检查是否允许重试，不重置次数或重建任务绕过限制。');
    if(/LOGIN|登录|店铺身份|浏览器未运行|BROWSER_UNAVAILABLE|browser.*closed|disconnected/i.test(raw))return issue('店铺登录或浏览器不可用','执行浏览器未连接，或目标店铺的登录身份尚未确认。','打开执行浏览器，确认登录的是当前店铺；如有登录或身份提示，处理后再检查并继续。');
    if(/MATERIAL_UPLOAD_|MAIN_MATERIAL_FRAME_|ATTRIBUTE_SELECTION_MISMATCH/.test(raw))return issue('页面操作核对未通过','素材上传、图片选择或属性选择的结果未通过回读核对。','查看当前步骤截图，确认上传或选择是否完成；若页面结构变化，交维护人员修复适配后再继续。');
    if(/TimeoutError|timed?\s*out|超时|locator\.|expect\(|strict mode/i.test(raw))return issue('当前页面步骤未完成','页面控件未在规定时间内出现，或操作后的状态未通过检查；具体触发原因仍需核对页面。','打开执行浏览器和当前商品步骤截图，检查弹窗、加载状态及控件；处理后通过原任务检查恢复条件，持续失败时交维护人员修复。');
    if(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|连接中断|连接被/.test(raw))return issue('连接中断','当前页面与服务或平台之间的连接未完成。','检查本地服务与执行浏览器的连接，恢复后重新读取最新状态；如已进入提交阶段，应先核验原商品结果。');
    return issue('异常原因待确认','当前步骤发生异常，现有记录尚不足以确认具体原因。','打开当前商品详情，查看本次异常记录和步骤截图，将记录交维护人员定位；原因明确后再检查恢复条件。',false);
  };
  globalThis.LyUiCopy = Object.freeze({ text: safeText, reason: reasonText, diagnose, step: stepName, event: eventName, state: value => {const text=states[value]||safeText(value);return /[A-Za-z]{2,}/.test(text)?'状态待确认':text;} });
})();
