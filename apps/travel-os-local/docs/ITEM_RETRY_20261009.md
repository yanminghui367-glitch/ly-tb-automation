# 网站单条重试候选｜2026-10-09

## 2026-10-11 后续安装记录

本节更新后续实施状态，不改写下文10月9日当时结论。检查时旧执行Chrome已停止，重新建立25表一致备份并取得独立维护审核后，19项审核包已安装至正式服务。原数据库全部业务行、旧任务快照及历史结果保持。独立安装验收、正式网页截图与新后台入口诊断见 [P0/P1实施记录](P0_P1_20261011.md)。本轮没有真实重试或整批恢复，不代表平台发布验收通过。

## 维护准备完成，等待原后台现场处理确认

本轮实际完成一致性备份，目录 `output/item-actions-r16/table-response/retry-maintenance-1791519551290/`：`execution-before.sqlite`（67,039,232字节）、`product-before.sqlite`（40,960字节）、`jobs-before.json`及 `before.json` / `capture-result.json`。不包含浏览器Profile或登录凭证，不进入源码同步范围。

独立维护准备报告 `output/independent100-20261009/qa/manual-retry-maintenance-preparation-review-r1.json`，SHA256 `024eb4181d2c3aae0d891abf14cedbd38563662f4f88551394262c7d0b8d4ff8`：两库integrity_check均ok，25表全部行、列和完整schema对象与备份前及当前正式库一致；1条已封尝试、0未封尝试；jobs/settings不变，84正式源码hash及19项包原字节保持。读取前后PID24352/37内核、三执行者idle、SYSTEM_BLOCKED保持，没有POST、执行Chrome操作或生产数据写入。

上一目标轮完成候选实现与验收，本轮完成可用备份和独立校验，均为实际进展。11:36原列表诊断、随后的状态答复、12:17候选验收及本轮均遇到相同未解决条件：后台发货异常提示的处理状态尚未收到操作者确认。代码/隔离验证/更新包/当前备份准备已完成；下一依赖步骤是保留现场下确认平台提示，再审维护与真实执行条件。不能通过重复查询或重新发布代替人工处理，也不能用关机更新销毁现场。

目标并未完成；当前进入待人工事实确认的阻塞状态。确认后应重新核验现场、身份、原任务范围与备份时效，再完成维护审核。此报告不批准shutdown/install/LIVE，也不将已有备份作为以后任意时刻安装的依据。原后台列表ret失败根因仍未确认，后续仍须验证完整查重链路；独立100、原700和Codex实际断开不能标记通过。

## 12:17 最终候选集成复核通过，未部署

独立集成报告 `output/independent100-20261009/qa/manual-retry-integration-review-r1.json`，SHA256 `a0aca64d60b2ab0fed02d1d2bc6ff9beb0d482ccf56314cf39bcedd8635b40ba`：`maintenancePreparationAllowed=true`、`deploymentAllowed=false`、`liveRetryAllowed=false`。这是本轮最终候选结论，更新下文12:12“完整候选复核待完成”的当时状态。

网页复查发现并修复：响应丢失时旧快照误称当前尚未提交；缺少成功商品证据、跨父轮次/执行窗口或未知状态的回执被当作完成。现在处理中/断线明确显示结果待核对，旧字段标为请求前记录；严格核验已知状态、父轮次、执行窗口和成功商品ID/状态。不完整回执保留原请求，只能核对，不能另建重试。

最终UI SHA256 `41aa791253f981c2ec0b197e5917836d1b36c91dce132baf5a2e313da8400a35`；独立新增10/10反例、独立亲跑实际工作台16/16，桌面、390px手机实际点击、断线及成功截图已目视。报告分别位于 `output/independent100-20261009/qa/manual-retry-ui-adversarial-1791519333220/result.json` 与 `output/playwright/item-retry-independent-final-20261009/result.json`。作者最后同一UI16项证据为候选 `output/playwright/item-retry/2026-10-09T04-14-37.527Z/result.json`。878完整回归与核心20、server4证据复用，不重复累计；最后变化仅UI及UI测试，核心11文件哈希不变。

旧19项更新包保留为历史，最终包改为 `output/item-actions-r16/table-response/retry-overlay-1791519370953/overlay.json`，SHA256 `6351c8fbe01d40e16d3a3e811a6a8a7e26593f45ecb3df9559b1af18d572b866`。没有安装动作。12:16正式健康与轮次只读记录 `output/item-actions-r16/table-response/manual-retry-1791517483795/production-observed-20261009T0416.json` 确认服务、状态与计数仍保持下述值。

## 当前状态与适用范围

12:12 核对正式服务仍为 PID24352 / `20261009-execution-attempts` / 37 项内核，校验通过，原轮次 SYSTEM_BLOCKED、active=false。本文实现位于 `output/item-actions-r16/table-response/manual-retry-1791517483795/project`，尚未安装到局域网正式服务，不代表已恢复真实上架。

原700计数：69已有核验、223新增核验、0失败、109预检跳过、0手动跳过、131待核验或隔离、1待人工、167待处理，互斥合计700。第三窗口13新增、2待核验或隔离、85待处理。本轮未发真实执行控制请求，未连接执行Chrome。

上一用户状态答复只复核已存在证据，按无新增进展记录。本轮补齐单条重试核心、原接口与真实网页交互，并发现和修复中断边界，属于实现与验证进展。独立100、原700全部结果、Codex实际断开验收仍未完成。

## 操作与实现

候选页面入口：自动化任务 → 执行轮次记录 → 查看 → 商品详情 → **重新检查并重试此条**。只在原店铺、原资料版本、已停稳、未提交且允许恢复时展示；已成功或结果不明的商品不提供重发入口。

- 复用 ListingRound、SourceWorkflow、BatchWorkflow 及原发布者，同一执行租约只处理所选 key，不为其他分配商品预检或建队列，处理后暂停。
- 先查重、校验店铺、资料及提交证据。原暂停 run/queue 复用；已封轮次保留原结果，创建范围恰好一条的关联补跑窗口。
- MANUAL_RETRY 追加关联原尝试，不覆盖旧记录；历史未分段时明确标记，不伪造 INITIAL。
- 请求包含原轮次、窗口、key、读取版本和操作编号。重复点击或响应丢失沿用原编号读取回执，不能创建第二次重试。
- 未封重试在服务重启后只能先整理原记录。原队列普通继续不得旁路该记录；整理后再次执行需要网站明确的新操作。
- 中断发生在原 run 创建与账本绑定之间时，严格核对原映射后只绑定已有 run，封存 INTERRUPTED，不能另建或执行。
- 记录或轮次终态保存失败保持原执行锁；提交证据在异步检查期间变化时不进入可能覆写标志的通用失败投影。
- 已封尝试但停止窗口未封的重启恢复，只完成原停止记录；原窗口/执行窗口可展示对应恢复入口，不能影响新窗口。
- 查询故障使用独立 `existing-listing-query` / `known-listing-query` 步骤，旧 run/checkpoint 原样保留，不把查询失败归因于旧上传断点。

主修改：`round-item-retry.mjs`、`round-item-retry-api.mjs`；关联 `round-item-attempts`、`round-execution-attempts`、`round-windows`、`listing-round`、`product-api`、`round-verification`、单条详情API与UI。未修改商品业务值、发布规则、浏览器Profile、原数据和登录资料。

## 验证证据

以下均为隔离数据，不能代替淘宝真实发布或独立100验收；有重叠的数量不相加。

|证据|结果|边界|
|---|---|---|
|候选项目根目录 `retry-full-r1.log`|878/878，exit0|完整服务测试；随后只做详情提示文案/互斥小改|
|`retry-syntax-r1.log`，后补 `node --check round-item-detail.js`|exit0|源码语法|
|`output/independent100-20261009/qa/manual-retry-independent-r5.log`|独立20/20|R1—R8，中断、并发、证据保留、新旧窗口隔离|
|候选 `scripts/round-item-retry-http.test.mjs`|4/4，独立复跑通过|实际 server 回调、Host/Origin、互斥、忙时暂停/停止|
|候选 `output/playwright/item-retry/2026-10-09T04-09-53.487Z/result.json`|作者15/15|实际工作台HTML/ProductApi、临时SQLite、独立Chrome；模拟执行器|

网页证据包括桌面/390×844、移动端实际点击、结果响应丢失、同请求核对、原商品成功后重试/跳过消失、刷新结果保留；0页面异常、0外部网络、0正式任务请求。截图同目录 `01-retry-desktop.png`、`02-retry-mobile.png`、`03-response-lost.png`、`04-retry-finished.png`。

独立核心报告 `output/independent100-20261009/qa/manual-retry-core-review-r1.json`，SHA256 `d714ce3f46546cc0bc739d16c308187a2cb9824380d46700062b02c0b8653eef`：允许进一步集成，不允许生产部署或LIVE重试。39候选内核校验及84正式源文件保持已独立检查。完整候选网页复核另行记录。

## 更新准备及仍未完成

已准备19项精确文件更新：`output/item-actions-r16/table-response/retry-overlay-1791519082172/overlay.json`，SHA256 `c48a280922c654ddde2912919c4e093cb7f677edc1efa2796cc01dde95587c81`。保存 before/after 原字节、84正式源漂移保护及旧内核基线。准备脚本只写隔离输出，不安装、不停止程序、不恢复任务、不同步GitHub。

正式原后台列表返回失败仍未定因。此前发货异常提醒的人工处理状态尚未确认，真实发布维持暂停。现有正常关机路径 `server.mjs:shutdownProgram` 会调用 `browserEnvironment.closeAll()`，因此本轮也未以更新为由关闭需要保留的后台现场。待该现场处理状态确认、候选与维护审核完成后，再更新并通过实际网站验证；不得直接复制候选覆盖正在运行的内核。

本模块不能解决缺失素材、未确认商品归属或平台人工验证。没有声称已修好原列表返回失败，未将模拟提交计入700进度。
