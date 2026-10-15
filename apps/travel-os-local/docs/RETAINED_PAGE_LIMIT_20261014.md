# 删除两张保留页面暂停限制｜2026-10-14

用户明确要求删除“保留待处理页面达到 2 张，就暂停下一商品”的限制。本次规则调整以该指令为依据，适用于页面归属管理的新商品启动检查；历史记录不改写。

`workbench/page-ownership.mjs` 的 `assertCanStartTask()` 已移除 `retained < 2` 断言。保留页仍计入自有页总数、保留原因仍落盘；自有页达到 6 张的总预算及台账落盘失败拦截保持。成功页关闭条件、登录/验证码、商品结果核验与防重复提交逻辑未修改。`workbench/travel-os.js` 同步更新页面管理说明。

验证：页面归属、页面保护、发布页及 SourceWorkflow 集成共 58 项测试通过；`npm run check` 通过，属于当前执行者自验。单元测试覆盖保留 2～4 张且自有页未满时可继续、满 6 张仍暂停；集成测试覆盖连续两次清理失败或结果文件写入失败后，第三条仍可核验完成，并保留原成功记录与三张页面。隔离测试没有访问真实淘宝商品。

证据：`output/retained-page-limit-tests-20261014.log`、`output/retained-page-limit-syntax-20261014.log`。本次仅更新 page-ownership.mjs 与 travel-os.js 两项文件哈希；变更前清单保存于 `docs/kernel-baselines/20261014-before-retained-page-limit-removal.json`。磁盘版本为 `20261014-retained-page-limit-removed`。

部署尚未完成：修改前正式 PID4464 的健康检查已有三个无关文件校验差异（pool_adapter.py、listing-round.mjs、product-api.mjs）。期间其他工作更新了后两项的清单；本次最终磁盘校验仍指出 `engine/v2/pool_adapter.py` 与冻结值不一致。该改动涉及目的地素材拦截，不属于本次删除页面数量限制的范围，不擅自给它更新哈希或撤销改动。正式服务仍加载旧版本，未重载、恢复或提交商品；原第四轮保持 SYSTEM_BLOCKED，91/100（85 新增核验、6 手动跳过、9 待处理）。

后续：由素材校验改动完成适用证据与版本核对后，通过原维护流程加载上述新版本。旧轮次保存的“两张异常页面”原因是历史事件，不能以删改历史状态代替正式加载与恢复检查。本次不构成真实批量发布验收。
