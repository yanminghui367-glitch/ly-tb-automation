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
    PRE_SUBMIT_PAGE_RECOVERY:'发布页超时后新页恢复', RESIDUAL_PAGE_REFILL:'提交前新页重填', PRE_SUBMIT_REFILL_EXHAUSTED:'新页恢复后仍未就绪', SUCCESS_GOAL_CREATED:'已创建新增成功目标', SUCCESS_GOAL_TARGET_REACHED:'新增成功目标已达到', SUCCESS_GOAL_EXHAUSTED:'目标范围已耗尽', SUCCESS_GOAL_STOPPED:'成功目标已停止', SUCCESS_GOAL_RETRY_PASS:'开始安全失败项重试轮', SUCCESS_GOAL_ITEM_EXCLUDED:'商品不满足本次恢复条件',
    STEP_INTENT: '开始执行步骤', STEP_VERIFIED: '步骤核对通过', STEP_FAILED: '步骤执行异常',
    SUBMITTING: '正在提交商品', SUBMIT_CLICKED: '已点击提交', SUBMIT_EVIDENCE: '已记录提交凭据',
    RESULT_UNKNOWN: '提交结果待核验', PAUSED: '任务已暂停', WAITING_HUMAN: '等待人工处理',
    FAILED: '任务执行异常', VERIFIED: '商品结果已核验', PROGRAM_CLOSED: '工作台已关闭并保存断点',
    TASK_CREATED: '已创建任务', TASK_QUEUED: '任务已排队', TASK_STARTED: '任务已开始',
    TASK_PAUSED: '任务已暂停', TASK_RESUMED: '任务已恢复', TASK_COMPLETED: '任务已完成',
    SCHEDULER_ERROR: '任务调度异常', BATCH_PREFLIGHT_FAILED: '批次资料检查未通过'
  };
  const steps = {
    'open-clean-navigation-form':'重新打开干净发布页', 'open-clean-refill-form':'打开新页重新填写',
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
    const issue=(title,cause,action,known=true)=>({title,cause,action:Array.isArray(action)?action.join(' '):action,actions:Array.isArray(action)?action:[action],known});
    if(state==='RESULT_UNKNOWN'||submissionUncertain||/提交结果未知|提交可能|结果待核验|已有商品记录未能在原店铺核实/.test(raw))return issue('先核验原商品结果',/existing-listing|known-listing/.test(stage)||/已有商品记录/.test(raw)?'查重时发现已有商品记录，但还没确认它是不是当前店铺里的这条商品。':'系统还没确认淘宝是否已成功上架这条商品，直接重发可能造成重复商品。',['点击下方“查看当前商品详情与处理记录”，在“下一步”点击“核验原商品”；如果显示“核对上次核验结果”或“恢复上次核验记录”，沿用该入口。','只有显示“已有商品已核验”或“新增上架已核验”后，再回到本页点击“检查并继续本轮”。','如果核验入口不可用或仍未通过，查看详情里的原因并交维护人员处理。不要再次提交或重新发布。']);
    if(state==='PAUSED_CAPTCHA'||/CAPTCHA|CHALLENGE_PRESENT|验证码|滑块/.test(raw))return issue('需要你完成验证码','淘宝页面弹出了验证码或滑块，系统不能代替你完成，所以暂停。',['点击本页“打开执行 Chrome”，在淘宝页面人工完成验证。','确认验证码或滑块已经消失，再回到网站点击“检查并继续本轮”。']);
    if(/内核发生变化|内核校验失败|内核文件变化|内核已改变|KERNEL_(?:CHANGED|MISMATCH)|INTEGRITY_FAILED/.test(raw))return issue('网站代码改动尚未同步','网站代码被修改，但与已核对的版本记录不一致，系统因此停止执行。',['这项无法靠重复点击“继续”解决。保留原任务，交维护人员核对代码、同步版本并重载网站。','维护完成后刷新网页，再点击“检查并继续本轮”。']);
    if(/SOURCE_OR_ASSET_CHANGED|PACKAGE_CHANGED_SINCE_REVIEW/.test(raw))return issue('原任务还在使用修改前的资料','表格或图片改过了，但原任务记住的还是修改前的资料版本，所以暂时不能继续。',['在网站“资料设置”确认最新资料已经保存，不必反复上传同一份资料。','交维护人员修复原任务与新资料的版本绑定；完成后回到原任务点击“检查并继续本轮”。','保留原任务和跳过记录。重新开始一轮不会自动更新原任务的资料。']);
    if(/ENOENT|找不到指定文件|文件不存在|缺图|缺少.*图片/.test(raw))return issue('找不到任务要用的文件','任务要用的表格或图片，在原来的位置找不到了。',['进入网站“资料设置”，核对文件目录和名称，确认文件是否被移动、改名或删除。','恢复缺失文件或补齐资料并保存；若使用了新版本，请先核对原任务的版本绑定，再点击“检查并继续本轮”。']);
    if(/运费模板.*(?:不存在|未找到|不匹配|未通过)|FREIGHT_TEMPLATE/.test(raw)||(stage==='freight-template'&&/timeout|超时|locator|expect\(/i.test(raw)))return issue('运费模板没选成功','系统没有成功选中这家店铺要求的运费模板，可能是名称不符或列表没有加载出来。',['点击“打开执行 Chrome”，在当前店铺核对运费模板的实际模板名称和列表是否加载完成。','到网站“资料设置”核对本店模板设置；修改业务配置后需核对原任务是否同步，再点击“检查并继续本轮”。']);
    if(/NO_SKU_UNVERIFIED|ROOT_ANCESTRY_CHANGED/.test(raw))return issue('商品销售规格没检查通过','淘宝页面里的销售规格区域，与系统预期的不一致，系统还不能确认这条无规格商品可以提交。',['点击“查看当前商品详情与处理记录”，查看这一步的报错和截图。','这项通常需要维护人员核对淘宝页面并修复操作；修复后再点击“检查并继续本轮”，不要直接提交。']);
    if(/(?:图片|详情图|主图).*(?:尺寸|超长|比例|分割)|IMAGE_(?:SIZE|DIMENSION)|DETAIL_IMAGE_/.test(raw))return issue('图片没通过平台检查','当前图片尺寸或详情图添加结果没通过检查，需要先看淘宝给出的具体提示。',['点击“打开执行 Chrome”，查看图片区域的报错。','若平台明确提示尺寸不符，按提示调整原资料图片并保存，再核对原任务的图片版本绑定。','问题处理后，回网站点击“检查并继续本轮”；没有尺寸提示时，不要直接裁图，先查看商品详情中的具体错误。']);
    if(/CONTENT_REVIEW_HELD|CONTENT_MISMATCH|主图内容待核验|错图/.test(raw))return issue('商品图片需要核对','系统还没确认主图、详情图和当前目的地是否对应，暂时停止处理。',['点击“查看当前商品详情与处理记录”，核对目的地和图片。','若商品已上架，请在执行 Chrome 检查平台实际内容，保留原商品记录，不要重新发布；若图片确实有误，修正并核对资料绑定后再继续。']);
    if(/ITEM_RETRY_BUDGET_EXHAUSTED|ROUND_.*(?:EXHAUSTED|BUDGET)|尝试.*上限|恢复.*耗尽|不具备额外安全恢复条件/.test(raw))return issue('这条商品暂时不能再试','这条商品没有通过重试次数或恢复条件检查，所以暂时不能再次执行。',['点击“查看当前商品详情与处理记录”，查看已尝试次数和不允许恢复的原因。','只有页面明确允许跳过时，才按原计划跳过；首轮结束后再检查重试入口。不重置次数，也不要重建任务绕过限制。']);
    if(/LOGIN|登录|店铺身份|浏览器未运行|BROWSER_UNAVAILABLE|browser.*closed|disconnected/i.test(raw))return issue('执行浏览器或店铺登录需要处理','执行浏览器没有连接，或系统还没确认当前登录身份属于这家店铺。',['点击本页“打开执行 Chrome”，确认浏览器已打开，且登录的是当前店铺。','完成登录或身份提示后，回网站点击“检查并继续本轮”。']);
    if(/MATERIAL_UPLOAD_|MAIN_MATERIAL_FRAME_|ATTRIBUTE_SELECTION_MISMATCH/.test(raw))return issue('当前操作没确认成功',`${stage?'卡在“'+stepName(stage)+'”：':''}系统没有确认图片上传、选图或属性选择已经成功，具体哪一项失败还要看当前页面。`,['点击“打开执行 Chrome”，查看当前页面是否有未加载的图片、遮挡弹窗或选中结果不符。','处理页面提示后，回网站点击“检查并继续本轮”。','如果仍停在同一步，点击“查看当前商品详情与处理记录”，查看报错和步骤截图，交维护人员修复，不要反复点击继续。']);
    if(/TimeoutError|timed?\s*out|超时|locator\.|expect\(|strict mode/i.test(raw)){
      const selecting=/^select-detail-\d+$/.test(stage),label=stage?stepName(stage):'当前页面操作';
      return issue(selecting?'详情图没选成功':'当前页面操作没完成',selecting?`卡在“${label}”：系统没有完成选图，或选完后没检测到成功，所以暂停。现有记录还不能确定是图片窗口没打开、图片没加载，还是点击没有生效。`:`卡在“${label}”：系统没等到需要的按钮或图片，或点击后没检测到成功。具体触发原因仍需核对当前页面。`,['点击本页“打开执行 Chrome”，查看淘宝当前页面。','如果图片窗口还在加载，等它加载完成；如果有遮挡弹窗，先关闭；如果要求登录或验证码，手动处理。','回到网站，点击“检查并继续本轮”。','如果仍卡在同一步，点击“查看当前商品详情与处理记录”，查看具体报错和步骤截图；可能需要维护人员修复，反复点继续不一定能恢复。']);
    }
    if(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|连接中断|连接被/.test(raw))return issue('连接中断','网站与本地服务或淘宝的连接未完成，当前操作没能继续。',['确认本地服务已连接，并点击“打开执行 Chrome”查看淘宝是否能正常打开。','恢复连接后刷新网站；如已进入提交阶段，应先核验原商品结果，不要直接重新发布。','只有确认未提交且页面允许恢复时，再点击“检查并继续本轮”。']);
    return issue('异常原因还不能确定',`${stage?'卡在“'+stepName(stage)+'”。':''}现有记录不足以确认具体原因，不能直接判断是图片、登录还是网页操作出了问题。`,['点击“查看当前商品详情与处理记录”，查看本次异常记录和步骤截图。','将具体报错交维护人员定位；修复后再点击“检查并继续本轮”。不要重建原任务或反复发布。'],false);
  };
  globalThis.LyUiCopy = Object.freeze({ text: safeText, reason: reasonText, diagnose, step: stepName, event: eventName, state: value => {const text=states[value]||safeText(value);return /[A-Za-z]{2,}/.test(text)?'状态待确认':text;} });
})();
