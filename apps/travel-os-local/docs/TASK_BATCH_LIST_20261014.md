# 自动化任务当前批次列表与历史选择｜2026-10-14

用户要求将截图中的原批次列表改为正在进行的一批任务列表，每页20条，并通过“此店铺已进行的批次”下拉框查看第一批、第二批等日期及内容。

本次仅改 `workbench/travel-os.js`、`workbench/tasks.css` 的展示与只读数据绑定。当前固定清单使用已有 `round.window` / `windowHistory` 及 `GET /api/v1/rounds/window?id=...`，默认跟随最新执行窗口，历史按原窗口sequence编号，日期取started或at并按Asia/Shanghai显示。当前实际四个窗口分别为第一批10月9日、第二批10月9日、第三批10月9日、第四批10月14日；没有把原批次14条或整份700条清单冒充本批100条。历史是当前店铺、当前固定清单保存的执行窗口，不合并旧清单或其他店铺。无固定清单时兼容原批次记录。

表格每页20条，跨页搜索与状态筛选；切换批次清除搜索、分类和页码。默认模式自动跟随下一窗口，主动选择历史后保持选择。历史读取不替换上方实时监控，详情和日志绑定原窗口、商品和run；尚未开始的商品禁用日志。读取失败清空该次内容并显示重试；店铺和窗口身份核对、请求代次防止迟到响应串批次。结束批次使用“历史批次任务列表”或“最近一批任务列表”，不虚称正在执行。

验证为本执行者自验，不代替独立QA放行或淘宝发布验收：

- `scripts/task-batch-list-ui-qa.mjs`：30项隔离浏览器检查通过，包括20条分页、序号、历史切换、UTC跨日日期、搜索、分类、空状态、日志、异步竞态、读取失败恢复、切店铺、SSE更新、自动续批展示、历史选择保持、旧批次兼容、390px无整页溢出、无写请求和脚本错误。
- `scripts/task-view-model.test.mjs`、`scripts/static-files.test.mjs`：18项回归通过；主脚本语法检查通过。
- `scripts/task-batch-list-live-check.mjs`：实际 `http://192.168.1.3:4318` 只读核验7项通过。当前第4批100条、每页20条共5页；切第一批显示其1条历史；脚本/样式字节哈希与本地一致；无脚本错误、无写请求，390px无整页溢出。
- 证据：`output/playwright/task-batch-list-20261014/qa.json`、`live-check.json`、`live-desktop.png`、`live-history.png`、`live-mobile.png`。改前脚本、样式、清单也保存在该目录便于区分本次增量与原有未提交修改。

仅更新冻结清单中的 `workbench/travel-os.js` 哈希和UI版本说明，旧清单保存为 `docs/kernel-baselines/20261014-before-task-batch-list-ui.json`。检查时另有 `engine/v2/pool_adapter.py`、`workbench/listing-round.mjs`、`workbench/product-api.mjs` 与冻结哈希不同，它们不属于本次改动，未重新计算或代为放行。因此不能宣称整体45项冻结校验通过。

正式静态服务直接读取文件，刷新自动化任务页即可看到；未重启服务、操作执行Chrome、修改任务状态或发出暂停、跳过、恢复、发布请求。当前真实批次仍按原执行状态显示，本次界面完成不代表批次已完成。

收尾复核时存在并行写入：保留了他人对页面数量说明的改动及新的内核版本号，复核实际网页后仅合并已验证的travel-os.js哈希。最后快照中尚未匹配的是 `engine/v2/pool_adapter.py`，以 `final-integrity.json` 为本次收尾证据；其他会话继续工作后可能再变动。本次不对并行内核改动作验收结论。一次重复截图导航达到20秒超时后，改为等待DOM就绪重跑，7项实际网页检查再次通过。
