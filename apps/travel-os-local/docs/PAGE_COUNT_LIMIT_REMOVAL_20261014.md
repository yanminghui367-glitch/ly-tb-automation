# 删除自有页面六张上限｜2026-10-14

## 22:46 正式网站已加载两条数量限制的删除

用户再次明确要求直接在网站执行后，完成业务库备份并通过原 `/api/program/shutdown` 与 `tools/start-workbench.mjs --no-open` 正常重载。正式PID4464→33524，健康接口报告加载版本 `20261014-page-count-limits-removed`；加载前后的 `page-ownership.mjs` 哈希一致，启动与创建两处均无数量限制。此次只要求加载页面数量规则，没有恢复发布。

全项目回归1058项中1057通过，唯一失败为已存在的冻结清单一致性检查，未掩盖为全部通过。新进程继续保留该执行阻塞，差异为 pool_adapter.py、product-api.mjs、round-windows.mjs、operations-api.mjs、round-selection.mjs、travel-os.js；没有给这些其他工作中的改动补写哈希放行。因此“两条数量限制已在运行服务删除”与“正式任务可以恢复”分开记录：前者已完成，后者仍须解决独立版本差异。

局域网 `http://192.168.1.3:4318/travel-os.html#tasks` 只读浏览器检查确认：新版健康接口、正式JS与磁盘字节哈希一致、页面说明无两张/六张限制及“/6”、零页面错误、零写请求。截图与结果：`output/playwright/page-count-limit-20261014/website-after-reload.png`、`live-check.json`。业务库25+4张表完整内容哈希重载前后一致，原round/window/counts/state不变，本轮仍91/100、85新增核验、6人工跳过、9待处理。证据与本地SQLite备份位于 `output/page-count-limit-20261014/deployment/`；不提交该运行数据。旧暂停原因作为历史记录保留，不代表新服务仍执行旧数量规则。

以下为正式重载前的实现与当时阻塞记录。

用户在确认自有页面的定义和上限影响后，明确要求删除此限制。本条接续此前删除“两张保留页暂停”规则的要求；此前记录保留其当时结论。

## 实现

- `workbench/page-ownership.mjs`：`assertCanStartTask()` 不再按自有页数量停止下一商品，`reserveCreation()` 不再按六张数量拒绝创建新页面。仍先核验台账可用、用途和归属；计数、峰值、创建预留、保留原因与关闭回执持续记录。
- `workbench/travel-os.js`：去掉“自有 N / 6”，说明改为页面数量不限制下一商品启动或新页面创建，成功核验后的关闭仍按原规则执行。
- 两张保留页限制仍处于删除状态。没有引入替代数量上限。自动关闭条件、验证码、登录、结果核验、防重复提交与人工保留条件未修改。

影响：页面积累不再因数量暂停；未满足自动关闭条件的页面可能继续积累，占用浏览器内存。本变更不主动关闭已有页面，不恢复或发布商品。

## 验证

页面归属、页面保护、发布页与 SourceWorkflow 集成 58/58 通过；`npm run check` 通过，属于当前执行者自验。新增边界覆盖：8个不确定创建预留仍记录；8个自有页面仍允许后续启动；人工保留页仍不能自动关闭；连续8条模拟商品因清理读取失败保留8页，全部通过核验且每条仅一次提交。既有持久化失败、页面身份及保护检查回归通过。

日志为 `output/page-count-limit-20261014/tests.log` 和 `syntax.log`；改动哈希与修改前UI快照位于同目录 `change-scope.json`、`travel-os.before.js`。均为隔离测试，不代表真实平台批量验收。

## 正式加载阻塞

磁盘版本 `20261014-page-count-limits-removed`，旧清单保存在 `docs/kernel-baselines/20261014-before-page-count-limit-removal.json`。仅更新本次页面归属内核哈希和页面数量政策字段。修改前 `travel-os.js` 已与其冻结值不一致，因此未给包含其他未核对改动的整个UI文件更新冻结哈希；此次修改前后快照可供统一整合。

最后磁盘核验仍有5处差异：`engine/v2/pool_adapter.py`、`workbench/round-windows.mjs`、`workbench/operations-api.mjs`、`workbench/round-selection.mjs`、`workbench/travel-os.js`。其中轮次/选择接口是在本次工作期间新增的差异，未覆盖他人改动。正式PID4464仍报告旧加载版本 `20261014-seller-table-overlay`；未重载，当前运行服务的页面数量规则尚未更新。

后续需统一核对其他进行中的改动及其验证证据，再经原维护入口加载。不会靠直接更新所有哈希绕过版本核对。原第四轮仍暂停，历史“两张异常页面”原因不改写。
