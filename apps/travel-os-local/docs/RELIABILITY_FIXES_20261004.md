# 按最终审查报告实施：执行确认、原商品核验、截图证据

## 【当前阶段】

2026-10-04，本地实现与隔离回归完成；正式服务尚未重启，未进行真实淘宝验证。这是实施者自验记录，不是独立 QA 放行或新增 LIVE 授权。

依据：[最终审查报告](QA_AUDIT_20261004.md)。用户随后指令为“按照最终版一步一步优化”“继续”，本轮按 A03 → A01 → A02 顺序实施，并维护 A06 已失配的浏览器脚本。原报告与其三轮复查、两次确认记录保留不动。

## 【本轮目标】

防止旧确认启动另一批商品；为缺少商品 ID 的待核验任务增加受控关联入口；防止截图失败后仍显示成功路径或旧图。保持现有技术栈、资料快照、随机规则、去重和人工验证闸门。

## 【检查到的现状】

- 修改前代码测试为 180/180；A03 在真实本地 API、SSE 和两客户端生命周期中可复现。模拟执行器不等于真实发布。
- 缺少 ID 的 RESULT_UNKNOWN 仍应禁止再次提交，正确处理是核对原商品，而非取消防重。
- 截图失败时旧实现会登记不存在的路径或复用 paused.png；旧监控还会回退显示更早的图片。
- 原 `qa:travel-os` 查找已移到首页的地球和旧店铺卡片，不能覆盖当前工作台旅程。
- 运行服务 23:24:39（北京时间）只读健康采样仍为旧进程、加载 11 个冻结文件；新磁盘代码为 13 个。没有重启或接管正式 Chrome。

## 【本轮完成】

### A03：固定并复核执行确认范围

打开确认窗口时固定批次 ID 和服务端范围指纹。指纹包含店铺、模式、冻结商品、状态、重试次数和持久事件版本。开始、继续、重试在所有异步检查之后、实际调度之前再次同步比较；范围变化必须重新确认。重复的已受理请求只返回原回执。

新版和旧版产品工作台均接入。修复范围是 `/api/v1/start|continue|retry`；没有据此声称所有历史 CLI 或旧底层入口都具备新确认协议。旧网页请求新版接口缺少指纹会被拒绝，须刷新页面。

### A01：只读关联原商品，原子保存本地结果

任务中心对缺少 ID 的待核验任务提供“关联原商品并核验”，原恢复窗口也可进入。操作者核对原店铺与完整标题，填入后台 ID 并确认。

程序只查询原店铺商品列表，匹配 ID、冻结标题、价格、库存、状态与原提交时间。时间来自最后一次 SUBMITTING 到其后 RESULT_UNKNOWN 事件，按后台分钟精度向外取整，使用北京时间；不以当前时间代替原提交时间。后台列名、身份或创建时间不能确认时保持阻塞。

核验证据完整后，以同一 SQLite 事务写入原任务检查点、结果、历史、审计事件、队列状态和请求回执。相同请求再次送达不会重复查询或写成功。截图失败、错店、错商品、重复 ID、任务变化、数据库写入失败均不会把任务标成功。仅本条回写；有余项的批次保持 PAUSED，不自动开始剩余商品。

该入口不修改原商品、价格、图片或任务资料，不重新提交商品，不开启执行许可。测试所用卖家页面为本地合成 DOM；未用新流程处理正式盐湖城任务。

### A02：截图成功才登记路径，失败如实显示

步骤、暂停及提交后的辅助截图使用唯一文件名，保存后检查文件存在及 PNG 标识，再登记路径；失败记录时间和原因、路径为 null，不继承旧 paused.png。截图失败不替代业务异常；提交后辅助截图失败仍进入原结果核验，禁止因此重新提交。

任务接口、日志、记录详情及旧监控显示“本次截图未保存”。当前截图失败时，旧监控不回退把更早的截图当成当前证据。原有历史图片保留在各自步骤中。新关联核验成功后，当前检查点引用新核验截图。

本轮只修复 SourceWorkflow 的这些截图路径及其展示，不宣称所有历史浏览器模块或外部删除的图片都已覆盖。

### A06：维护现有工作台旅程检查

按当前页面核验总览、目的地检索、成本/销售报价、店铺增删、准备单、队列、人工暂停/恢复、移动端和断线反馈。替换过期选择器，显式展开已折叠的目的地面板；保留业务断言，不降低期望值。首页地球由独立页面负责，本轮未重验其视觉或交互。

### 文件范围

| 修改文件 | 范围 |
|---|---|
| `workbench/product-api.mjs` | 执行范围校验、关联接口、截图错误投影 |
| `workbench/travel-os.js` | 固定确认范围、原商品关联窗口、截图错误说明 |
| `workbench/product.js` | 旧版确认范围与截图展示 |
| `workbench/server.mjs` | 被移除店铺的写操作拦截清单增加 reconcile |
| `workbench/source-workflow.mjs` | 仅截图记录增量，未重写填写、提交或核验流程 |
| `workbench/kernel-lock.json` | 新版冻结清单与授权说明 |
| `workbench/scripts/product-api.test.mjs` | 合法调用传入范围、新增截图投影检查 |
| `workbench/scripts/travel-os-ui-qa.mjs` | 当前界面选择器、明确等待、独立浏览器与唯一输出目录 |
| `docs/PROJECT_STATUS.md`、`SOURCE_MANIFEST.json` | 当前状态和源码摘要 |

新增产品代码：`workbench/result-reconciliation.mjs`、`workbench/task-screenshot.mjs`。

新增验证脚本：`workbench/scripts/execution-scope.test.mjs`、`execution-scope-ui-qa.mjs`、`result-reconciliation.test.mjs`、`reconciliation-ui-qa.mjs`、`task-screenshot.test.mjs`。

新增记录：本文、`docs/kernel-baselines/20261004-before-reliability-fixes.json`。旧 11 文件冻结清单完整保留；其中仅 source-workflow 改变，其他 10 个文件保持原字节；两个新增模块纳入冻结后共 13 个。未改数据库结构或升级依赖，保留本轮前未提交修改。

## 【验证结果】

统一证据目录：`output/playwright/reliability-fixes-20261004/`。下表的通过仅限测试所覆盖的本地范围。

| 检查 | 结果 | 证据 / 说明 |
|---|---|---|
| Node 单元与集成 | 202/202 | `final-tests.log`；包括并发确认、状态往返、数据库事务回滚、重开数据库回执、截图失败 |
| 原项目语法检查 | 通过 | `final-check.log`；新模块由上述测试实际导入，新浏览器脚本已执行 |
| A03 两客户端与新旧界面 | 14 项 | `a03-acceptance/result.json`；真实本地接口/SSE，替身在填写前停止 |
| A01/A02 关联和证据界面 | 15 项 | `a01-a02-acceptance/result.json`；原始错误价格被拒绝，正确合成证据可关联，余项暂停 |
| 当前工作台旅程 | 29 项 | `a06-journey-final/qa.json`；临时数据与独立浏览器 |
| 相邻报价 / 随机规则 / 属性导航 | 31 / 22 / 9 项 | `adjacent-ui/`；本轮复用已有隔离脚本；无真实平台请求 |
| 冻结与源码边界 | 见最终记录 | `final-integrity.json`；原报告摘要、允许修改清单和现有文件摘要逐项核对 |

A01/A02 浏览器日志内一条 API 错误是故意输入错误价格后的预期拒绝，不是未处理浏览器异常；浏览器 errors 与外部请求均为 0。独立截图已查看 390×844 关联窗口和桌面证据窗口；未更改首页视觉。

早期失败记录保留：A01 合成页面未声明 UTF-8，身份检查正确拒绝乱码；A02 测试清理顺序使 SQLite 未关闭即删除，已修正；A06 旧选择器与折叠状态已对齐；最终截图界面测试最初点击了隐藏总览入口，改为定位记录表的真实按钮。没有覆盖原失败结果或放宽安全断言。

关键截图：

- [过期确认被拒绝](../output/playwright/reliability-fixes-20261004/a03-acceptance/03-stale-confirmation-blocked.png)
- [手机关联窗口](../output/playwright/reliability-fixes-20261004/a01-a02-acceptance/02-associate-mobile.png)
- [错误价格拒绝](../output/playwright/reliability-fixes-20261004/a01-a02-acceptance/03-price-mismatch.png)
- [关联后余项暂停](../output/playwright/reliability-fixes-20261004/a01-a02-acceptance/04-reconciled-paused.png)
- [截图失败说明](../output/playwright/reliability-fixes-20261004/a01-a02-acceptance/07-missing-screenshot-detail.png)

隔离复跑（项目根目录 PowerShell，每次使用新目录）：

```powershell
npm --prefix workbench test
npm --prefix workbench run check
$qaPrevious = $env:QA_OUTPUT_DIR
$qaRoot = Join-Path (Get-Location) ('output/playwright/reliability-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
try {
    foreach ($suite in @('execution-scope-ui-qa', 'reconciliation-ui-qa', 'travel-os-ui-qa')) {
        $env:QA_OUTPUT_DIR = Join-Path $qaRoot $suite
        node "workbench/scripts/$suite.mjs"
        if ($LASTEXITCODE -ne 0) { throw "隔离检查失败：$suite" }
    }
} finally { $env:QA_OUTPUT_DIR = $qaPrevious }
```

## 【仍未完成】

正式网站进程切换、新关联流程在当前真实卖家页面的只读核验、真实发布/恢复、第二台实体电脑访问和长期内存增长均未验收。未推送 GitHub，未新增发布结果，未让原待核验任务自动继续。

## 【阻塞项】

要让正在运行的 4318 服务采用新后端，需要正常退出并重新启动。现有退出会关闭专用 Chrome，启动会重新打开专用 Chrome；这触及本次用户明确保留的正式会话边界，因此本轮尚未执行。单纯刷新网页或重复打开启动器会复用旧进程，不能替代后端更新。

## 【风险】

- 当前真实卖家 DOM 可能变化；无法准确匹配列、身份或时间时会阻塞，不能手动直接标成功。后台价格/库存若已变化，也会拒绝本次严格关联。
- 任务无提交时间记录、机器时间明显不准或创建时间无法对应时仍需人工排查，不能以放宽时间范围代替证据。
- 新旧服务混用期间，新页面可能提示重新启动以加载确认保护；不要把这当成已更新成功。服务切换前不应启动正式批次。
- 历史底层执行入口、长时间多客户端资源消耗和所有异常组合未全面验收，202 项通过不表示系统绝不会出问题。

## 【下一步】

完成受控服务重启后，刷新工作台，先检查加载的 13 文件冻结清单与新确认字段；不自动关联正式任务，也不自动执行剩余商品。真实核验另沿用明确的原店铺/商品授权与闸门，只有实际后台证据满足条件才可回写结果。

回退时依据本轮 `before/` 副本和 `change-*.diff` 精确撤回对应增量；先核对之后是否有新修改。新关联模块回退需连同接口、UI 入口和冻结清单一起处理，不能删除它依赖的历史任务、审计事件或回执。保留证据，重新生成源码摘要；禁止用 `git reset --hard` 覆盖本轮之前的成果。
