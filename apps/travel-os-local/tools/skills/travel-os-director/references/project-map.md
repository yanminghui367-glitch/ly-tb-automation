# 项目定位与核验入口

以用户指定的项目根为准。旧导出常位于 `output/.../project` 或GitHub的 `apps/travel-os-local/`，它们不一定是当前运行服务源目录。下列路径均相对已确认的根。

## 信息与规则

| 需要判断的事 | 入口 | 注意 |
| --- | --- | --- |
| 用户目标与授权 | `AGENTS.md`、`docs/LY00_PROJECT_CHARTER.md`、本轮明确指令 | 管理权限不补足业务事实，历史授权核对对象与版本 |
| 当前阶段与未完成项 | `docs/PROJECT_STATUS.md`、最新适用专项报告、现有GET状态 | 顶部摘要也可能落后于并行改动 |
| 岗位/管理任务/原交接 | `docs/operations/{DIRECTOR,ROLES,TASK_BOARD,WORKFLOW_STANDARD}.md` | 这些管理任务不是网站淘宝发布队列 |
| 证据与QA | `docs/operations/QA_STANDARD.md`、`docs/knowledge/EVIDENCE_RULES.md`、`docs/RELEASE_GATES.md` | 自验、独立复核、生产与平台结果分别记录 |
| 全项目完整角色方案 | `docs/operations/DIRECTOR_PERSONA_20261015.md` | 2026-10-15快照仅作接管起点，不能当实时状态 |

## 工程与专项

| 范围 | 代码/数据入口 | 对应专项或测试定位 |
| --- | --- | --- |
| 启动、LAN、版本 | `tools/start-workbench.mjs`、`workbench/server.mjs`、`network-access.mjs`、`kernel-{integrity.mjs,lock.json}` | `docs/LAN_SERVICE.md`；健康接口缓存与磁盘核验区别 |
| 原任务、串行执行 | `workbench/{source-workflow,source-store,batch-workflow,batch-store}.mjs` | source/batch/恢复测试；勿构造生产协调器做“只读”审计 |
| 固定清单/窗口/勾选 | `listing-round.mjs`、`round-windows.mjs`、`round-selection.mjs`、`operations-api.mjs` | `ROUND700_20261008.md`、`WEBSITE_OPERATIONS_20261011.md`、`INDEPENDENT100_20261009.md` |
| 单条跳过/核验/重试 | `round-manual-skip.mjs`、`round-item-*.mjs`、`round-execution-attempts.mjs` | `SKIP_CONTINUE_RECOVERY_20261014.md`、`BATCH_RECHECK_20261014.md`及对应 scripts 测试 |
| 卖家页面与发布结果 | `taobao-publisher.mjs`、`listing-verification.mjs`、`round-verification.mjs`、`browser-environment.mjs`、`page-*.mjs` | `SELLER_TABLE_OVERLAY_20261014.md`、素材面板/身份/提交边界测试 |
| 素材/标准资料导入 | `engine/v2/{adapter,pool_adapter}.py`、`workbench/{setup-flow.mjs,setup-adapter.py,setup-template-v2.json}` | `PRODUCT_IDENTIFICATION_TEMPLATE_V2.md`、`SETUP_IMPORT_STANDARD_SYNC_20261014.md` |
| 内容与随机规则 | `publishing-{rules,materials,content-review,attributes}.mjs` | `RANDOM_PUBLISHING_RULES_20261004.md`、内容审核及文件/图片真实性分层 |
| 网站默认偏好 | `product-api.mjs` 的 settings/saveSettings、`listing-round.mjs` 的 create | `WEBSITE_LISTING_DEFAULT_20261014.md`；每店目录拆分后须复核网站默认是否仍为共享继承 |
| 八模块UI/列表 | `travel-os.{js,html,css}`、`operations-catalog*`、`round-item-detail*`、`ui-copy.js` | 模拟界面测试与LAN只读实站检查分开 |
| 多店接入 | `server.mjs` 的上下文路由、`travel-os-api.mjs`、`setup-flow.mjs`、新增店铺执行适配文件 | 不假定已有文件名；`rg --files workbench`定位。本轮正在变动，店铺下拉不是服务端隔离证据 |
| 标题 | `tools/rebuild_700_listing_titles.mjs`、`fill_global_heat_titles_minimal.py`、标准商品表 | 国家＋服务词；城市＋国家＋服务词。30/15按上限自然编排，最终遵循实际类目计数；两版商品标题与导购标题不同字段 |

## 可重复的只读检查

Skill附带 `scripts/project_snapshot.mjs`：输出文档/源码文件统计、Git状态计数、冻结清单实算、已有HTTP服务的版本/当前店铺/批次/能力摘要，不输出完整商品包、浏览器存储或账号配置。

需要手动定位时优先 `rg --files` 和 `rg -n`。检查某问题只读相关原件和有日期的产物，排除 `.runtime`、浏览器profile、依赖、旧隔离树及生成输出的重复内容；它们仍可按明确业务需要读取已脱敏证据，不递归复制。

正式服务常用只读入口：`http://127.0.0.1:4318/api/v1/health`、`/api/v1/state`、`/api/os/state`。局域网地址来自当前网络配置，不把历史 `192.168.1.3` 视为永久值。服务不可用时先报告，勿为盘点启动/重载或开启执行。

验证命令在 `workbench/package.json`。常规语法用 `npm --prefix workbench run check`；定位后挑相关 `node --test workbench/scripts/<专项>.test.mjs`。完整测试只在变更/整合确有必要时运行，不重复执行别人已留有适用版本证据的测试。

业务库位于 `workbench/.runtime/`，迁移和多店实现可能改变具体布局；检查时先查当前代码。不得为审计实例化 `ProductApi`、`ListingRound` 或导入有启动副作用的 server。必要直接SQL用只读连接、仅读相关字段，不读取浏览器profile/Cookie，不输出凭证。
