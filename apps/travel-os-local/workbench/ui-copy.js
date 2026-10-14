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
  globalThis.LyUiCopy = Object.freeze({ text: safeText, reason: reasonText, step: stepName, event: eventName, state: value => {const text=states[value]||safeText(value);return /[A-Za-z]{2,}/.test(text)?'状态待确认':text;} });
})();
