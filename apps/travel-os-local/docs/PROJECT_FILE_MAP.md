# 项目文件导航｜标准化第 1 步

## 2026-10-15 公共素材单张换图

`workbench/material-replacement.mjs` 管理本店图片版本、完整解码、幂等和未来导入映射；`material-editor.js` 为选图/预览/保存交互，`travel-os.js` 在公共素材卡片接入。`material-library.mjs` 保持原目录分组，`source-store.mjs` 保留旧导入并创建派生资料版本，`publishing-rules.mjs` 接续新素材配置。使用范围与限制见 [单图替换](MATERIAL_REPLACEMENT_20261015.md)；临时合成测试位于 `scripts/material-replacement*.mjs`，验收/维护证据在 `output/material-replacement-20261015/`，不替换原700条固定快照。

## 2026-10-15 新店铺通用接入与防错店

`workbench/shop-identity.mjs` 统一ID与输入归属校验；`shop-execution.mjs` 按登记店铺提供隔离环境；`setup-files.js` 过滤标准上传正式源文件。接入流程见 `SHOP_ONBOARDING_20261015.md`，回归为 `scripts/shop-onboarding-http.test.mjs`、`shop-onboarding-independent.test.mjs` 与 `shop-onboarding-ui-qa.mjs`。生产保全、隔离UI和独立QA证据在 `output/shop-onboarding-20261015/`，不进入代码基线。

## 2026-10-15 总负责人 Persona 与可调用Skill

`docs/operations/DIRECTOR_PERSONA_20261015.md` 保存当前阶段盘点、负责人能力及后续交接规划；`tools/skills/travel-os-director/` 是可版本化Skill源码，包含角色指令、模块地图、交接模板和只读快照脚本。本机安装在Codex skills目录；验证及隔离演练位于 `output/director-persona-20261015/`。原 `operations/DIRECTOR.md`、`TASK_BOARD.md` 继续作为职责和管理入口，不新增淘宝执行队列或修改根AGENTS。

## 2026-10-14 局域网商品资料识别同步

`workbench/setup-adapter.py` 识别 v2 标准 Excel 的固定发货时效选项；`workbench/scripts/setup-current-label.test.mjs` 覆盖该选项的隔离导入回归。用户工作簿结构、识别范围与未完成资料边界见 [同步记录](SETUP_IMPORT_STANDARD_SYNC_20261014.md)。

## 2026-10-13 执行监控整合

`workbench/travel-os.js`、`tasks.css` 管理本轮监控与独立历史区；`round-item-detail.js` 同时提供原当前商品跳过控制，`round-current-skip.js` 保留兼容导出，避免旧服务静态路由使页面加载失败。`scripts/execution-monitor-ui-qa.mjs` 检查身份隔离与状态边界；原轮次浏览器回归更新布局定位。范围与证据见 [执行监控整合](EXECUTION_MONITOR_20261013.md)。

## 2026-10-13 导购标题焦点超时修复

workbench/taobao-publisher.mjs 在主图选择后关闭已验证的主图操作菜单，再恢复原标题字段焦点；scripts/main-image-click.test.mjs 增加菜单开关安全验证。正式安装状态与待人工身份确认边界见 [GUIDE_TITLE_FOCUS_20261013.md](GUIDE_TITLE_FOCUS_20261013.md)。

## 2026-10-12 网站商品总表与批量选择

`workbench/operations-catalog.mjs`、`operations-catalog-ui.js/css` 统一店铺/资料包状态和表格操作；`round-selection.mjs`、`operations-api.mjs` 在原轮次和执行窗口中持久化勾选范围、预检和幂等回执。`listing-round.mjs`、`round-windows.mjs` 继续复用原发布执行器，最多100条分窗。对应两组回归为 `scripts/operations-catalog.test.mjs`、`scripts/round-selection.test.mjs`。操作、安装、维护保全及尚未完成的真实验收见 [WEBSITE_OPERATIONS_20261011.md](WEBSITE_OPERATIONS_20261011.md)。

## 2026-10-11 主图素材面板诊断

`workbench/taobao-publisher.mjs` 的主图就绪等待、主图/详情iframe区分及图片点击结果核对，`publishing-attributes.mjs` 的自定义属性点击结果核对为本次有限修复范围。对应测试位于 `workbench/scripts/`：`main-material-frame.test.mjs`、`detail-material-frame.test.mjs`、`main-image-click.test.mjs`、`attribute-click.test.mjs`。当前安装与平台验收状态见 [MAIN_MATERIAL_FRAME_20261011.md](MAIN_MATERIAL_FRAME_20261011.md)，独立候选验证不等于真实发布结果。

后续 `batch-store.mjs`、`round-item-retry.mjs`、`round-item-retry-api.mjs` 与 `round-item-detail.js` 统一原重试预算的预检及原因展示，配套 `scripts/retry-budget.test.mjs`。这不增加恢复次数或改写历史；旧清单分别保留于 `docs/kernel-baselines/`。

## 2026-10-11 P0 / P1 正式安装与入口核对

`workbench/round-item-retry.mjs`、`round-item-retry-api.mjs` 及配套19文件已安装正式网站，更新下方10月9日“未安装”的历史状态。按钮盘点见 [P0_BUTTON_INVENTORY_20261011.md](P0_BUTTON_INVENTORY_20261011.md)，新千牛核验入口、部署与测试证据见 [P0_P1_20261011.md](P0_P1_20261011.md)。历史记录不回写，真实任务保持暂停。

`workbench/publishing-pages.mjs` 与 `listing-verification.mjs` 已增量兼容实测千牛商品管理入口，正式版本 `20261011-verification-origin`。两对应测试文件覆盖新旧来源及保护条件，旧内核清单存于 `docs/kernel-baselines/20261011-before-verification-origin.json`。

## 2026-10-09 单条重试候选

隔离候选 `output/item-actions-r16/table-response/manual-retry-1791517483795/project/workbench/round-item-retry.mjs` 和 `round-item-retry-api.mjs` 复用原发布者处理单个异常商品，详情页提供原请求核对与中断记录恢复。尚未安装到正式 `workbench/`；范围、测试与19项更新准备见 [ITEM_RETRY_20261009.md](ITEM_RETRY_20261009.md)。

## 2026-10-09 单条详情与实际处理记录

`round-execution-attempts.mjs` / `round-item-attempts.mjs` 在现有执行器内记录原任务的实际尝试及中断恢复；`round-item-api.mjs`、`round-item-host*.mjs`、`round-item-verify*.mjs`、`round-manual-skip.mjs` 接入原网站的详情、受控核验及手动跳过。`round-item-candidates.mjs` 读取原查重证据，`round-item-detail.js/css` 显示问题和关联历史。全部位于 `workbench/`，原队列与发布者保持；单条人工重试尚未接入。实际部署、恢复及当前故障见 `EXECUTION_ATTEMPTS_20261009.md` 和 `PROJECT_STATUS.md`，不能用隔离测试替代平台验收。

## 2026-10-09 执行轮次与页面保护

`workbench/round-windows.mjs` 管理父清单内持久执行轮次、范围、历史和导出；`page-ownership.mjs` 管理原生context内页面归属/预算/关闭回执；`page-protection.mjs` 读取真实标签固定状态并精确核对父子target。原执行入口仍为SourceWorkflow/BatchWorkflow，不新增发布者。专项回归在`workbench/scripts/round-windows.test.mjs`、`page-ownership.test.mjs`、`page-protection.test.mjs`、`page-source-integration.test.mjs`；范围与当前验收见`INDEPENDENT100_20261009.md`和`PAGE_MANAGEMENT_20261009.md`。

## 2026-10-07 上传页面稳定性

`workbench/publishing-pages.mjs` 管理同一执行浏览器内的后台新页、精确targetId绑定及素材/核验角色复用；`scripts/publishing-pages.test.mjs` 为绑定/失效回归，`scripts/publishing-pages-qa.mjs` 为隔离有界面 Chrome 专项。修改范围、证据与部署状态见 `BROWSER_STABILITY_20261007.md`，原冻结清单在 `kernel-baselines/20261007-before-stable-pages.json`。

## 2026-10-07 批次故障隔离与100条上限

`workbench/batch-policy.mjs` 统一批次上限；`batch-workflow.mjs` 首故障暂停与整批预检；`batch-store.mjs` 持久化有限重试范围；`publishing-materials.mjs` 上传弹窗、唯一文件控件与新回执核对；`publishing-attributes.mjs` 真实选中文字回读。隔离回归为 `scripts/batch-workflow.test.mjs`、`publishing-controls.test.mjs`、`batch100-ui-qa.mjs`，实施说明 `BATCH_RECOVERY_20261007.md`。

## 2026-10-01 GitHub 安装与业务迁移

`安装工作台.cmd` → `tools/install-workbench.ps1` 与 `verify-installation.mjs`：锁文件安装与 SHA-256 检查；`恢复业务数据.cmd` → `tools/migration-data.mjs` / `migration-archive.py`：白名单业务备份/全新目录恢复与路径重定位；`tools/sync-source.mjs` → `SOURCE_MANIFEST.json`：完整代码和 UI 资源导出。`migration-data.test.mjs` 验证防重键/历史/报价/原字节、路径、执行关闭与拒绝覆盖。使用说明 `GITHUB_INSTALL_MIGRATION_20261001.md`。本地业务包独立传输，禁止进入公开 GitHub。

## 2026-09-25 报价库

`travel-os.js` 的 `renderQuotes` 与报价专用动作、`travel-os.css` 报价作用域实现参考图；`workbench/scripts/quotes-ui-qa.mjs` 隔离检查、`quotes-ui-capture.mjs` 正式服务只读截图。说明 `docs/UI_QUOTES_20260925.md`；证据 `output/playwright/quotes-20260925/`。

## 2026-09-25 目的地中心

`workbench/travel-os.js` 的 `renderDestinations` 与目录辅助函数、`travel-os.css` 的目的地作用域样式实现参考图页面；`workbench/scripts/destination-ui-qa.mjs` 为只读专项浏览器检查，`destination-ui-capture.mjs` 为截图辅助。说明 `docs/UI_DESTINATION_CENTER_20260925.md`，证据 `output/destination-ui-20260925/`。

## 2026-09-24 内部局域网保活

`workbench/network-access.mjs` 管理局域网来源校验；`tools/start-workbench.mjs` 读取本机 `.runtime/launcher/service.json`；`tools/keep-workbench-running.vbs` 供 Windows 登录/分钟级保活任务隐藏运行。测试 `workbench/scripts/network-access.test.mjs`；使用说明 `docs/LAN_SERVICE.md`；恢复实测 `output/lan-service-20260924/recovery.json`。本机任务、防火墙与配置不属于商品发布定时任务。

## 2026-09-23 Travel OS 产品层

- `/` → `workbench/travel-home.html`：保留原地球首页；“打开工作台” → `travel-os.html#overview`。
- `workbench/travel-os.html/.css/.js`：八模块原生 Web 页面；`travel-globe-ui.css` 复用已有地球控件样式，地球渲染继续使用 `travel-globe.js`。
- `travel-os-api.mjs`：产品关系投影、店铺管理及原队列外围适配；`travel-os-store.mjs`：报价历史、准备单、移除管理标识和请求回执，存于 `workbench/.runtime/travel-os/product.sqlite`。
- `tools/scan-travel-os.mjs`：只读文件索引；`scripts/travel-os.test.mjs` / `travel-os-ui-qa.mjs`：隔离 API、持久化及浏览器模拟验证。
- `PRODUCT.md` / `docs/TRAVEL_OS_V1_QUICKSTART.md`：产品事实与本机简明说明。本轮证据 `output/travel-os-product-20260923/`，不提交运行资料。

## 2026-09-21 interface-design 增量文件

`workbench/product-state.mjs` 负责产品状态、异常类型和脱敏投影，`product-api.mjs` 增加外围恢复检查与 `product_actions` 请求回执表（沿用既有状态库，不改变内核任务标识/状态机）。`.interface-design/system.md` 保存界面规则；`docs/WORKBENCH_V1_QUICKSTART.md` 为操作者说明；`scripts/product-contract-ui.mjs` / `product-state.test.mjs` 验证隔离状态与 UI。最新证据为 `output/interface-v1-20260921/`，旧证据保留。

## V1 产品层增量（2026-09-21）

- `启动上架工作台.vbs` / `打开旅行上架工作台.cmd` → `tools/start-workbench.mjs`：本机启动、服务复用、依赖检查、打开浏览器；启动日志 `.runtime/launcher/`。
- `workbench/index.html`、`product.js`、`product.css`：六模块 V1；原页面完整保留为 `legacy.html`。
- `workbench/product-api.mjs`：V1 API、实时状态、设置、记录导出与执行开关；设置 `workbench/.runtime/product-v1/settings.json`。执行仍调用既有队列与内核，数据库位置不变。
- `workbench/kernel-lock.json`、`kernel-integrity.mjs`：冻结基线与校验；`scripts/product-api.test.mjs` / `product-ui-qa.mjs`：产品层与 UI 验收。证据 `output/workbench-v1-20260921/`，不进入代码版本。

核对日期：2026-09-13。项目根目录：`C:\Users\Administrator\Documents\ChatGPT\旅游 上架自动化`。

本目录已经是项目主目录，继续沿用。此文件负责说明文件放在哪里；当前业务阶段仍查 `PROJECT_STATUS.md` 并结合日期较新的专项验收记录。标准化推进顺序查 `STANDARDIZATION_ROADMAP.md`。

## 现有文件归属

2026-09-21增量：`engine/v2/heat_queue_adapter.py` 将只读热度表与商品池按国家、城市精确关联；`workbench/batch-store.mjs`、`batch-workflow.mjs` 为持久队列和调度器，`batch-workflow.js/.css` 为批量入口。队列表与单条结果共用 `workbench/.runtime/source-workflow/state.sqlite`，批次报告在 `workbench/output/tasks/batches/<批次ID>/report.json`，UI 与重启核验在 `output/batch20-20260921/`。原始资料不写入、不改名。

2026-09-20增量：`engine/v2/pool_adapter.py` 为700池只读适配；`workbench/source-workflow.{mjs,js,css}` 为执行服务和首页入口，`source-store.mjs` 为状态数据库，`taobao-publisher.mjs` 为淘宝页面逻辑。运行状态和上传副本置于 `workbench/.runtime/source-workflow/`，步骤截图置于 `workbench/output/tasks/<任务ID>/`；Chrome 使用项目根目录 `browser-profile/<店铺ID>/`，不进入版本记录、不读取凭证。

2026-09-17增量：`engine/v2/` 存放用户本轮授权的独立V2命令行引擎、只读适配器、模板与测试；运行证据和SQLite统一放 `output/v2-*`。旧工作台与原商品素材保留；不将本机状态或账号会话纳入代码。

| 位置（相对项目根目录） | 内容与用途 | 后续存放规则 |
| --- | --- | --- |
| `README.md` | 项目总入口、启动方式和文档导航 | 新增主要入口在这里链接 |
| `AGENTS.md` | 方向、边界、权限、监督要求 | 沿用标准文件名 AGENTS.md，不另建 AGENT.md 造成两套制度 |
| `docs/` | 状态、产品、业务、UI、工作流、商品包契约、发布门槛和专项报告 | 现行规则用稳定文件名；历史验收报告保留日期和证据引用 |
| `workbench/` | 工作台代码、页面、依赖声明、模板及 `scripts/` 测试 | 功能修改和相关测试沿用此目录 |
| `tools/` | 标题池、素材与商品包生成脚本及测试 | 可复用的批处理脚本放此处 |
| `output/` | 批次商品包、模块验收日志、截图、验证输出 | 新增批次或验收产物默认放独立命名子目录；不覆盖旧批次 |
| `outputs/` | 已有标题池、目的地资料、图片及商品包成果 | 保留原位置和引用；新产物默认进入 output，已有工具固定写入此处时沿用并记录 |
| `workbench/output/` | 工作台本地截图及运行证据 | 保留工作台约定路径，不移动证据 |
| `LY_解压审查/` | 历史导入资料和审查结论 | 保留原始输入，不把旧包默认当作现行合格商品包 |
| `third_party/` | 第三方源码与归档，如 ComfyUI | 安装与接入状态查 EXTERNAL_COMPONENTS_INVENTORY；存在不等于已可运行 |
| `workbench/.runtime/` | 本机工作台状态及浏览器运行目录 | 属运行数据，不作为知识库、交付包或待提交源代码；本轮不读取会话内容 |
| `.playwright-cli/`、`workbench/.playwright-cli/` | 浏览器工具本地记录 | 保留现场，分享前单独审核内容 |
| `node_modules/` | 本机依赖链接 | 不搬动，不视为自有源码 |
| `.git/` | Git 元数据 | 本轮确认尚无提交；目录存在不代表已有版本基线 |
| `打开旅行上架工作台.cmd` | 本机启动入口 | 保留原路径 |
| `psforge_debug.log` | 本地调试日志 | 不作为业务结论或发布成功证据 |

## 重要入口

1. 了解现状：`PROJECT_STATUS.md`、`TAKEOVER_BASELINE_2026-09-12.md`，再看 `LY08_AUTOMATION_ENGINE.md` 与 `LY11_QUALITY_RELEASE_AUDIT_2026-09-12.md`。它们有不同核验范围，不能仅按文件名认定谁覆盖谁；统一状态口径安排在第 3 步。
2. 了解商品与流程：`BUSINESS_RULES.md`、`PRODUCT_PACKAGE_CONTRACT.md`、`PRODUCT_SPEC.md`、`WORKFLOW.md`。
3. 判断能否发布：`RELEASE_GATES.md` 和有证据的质量复验结果；整理目录不改变发布权限。
4. 查找工具：`EXTERNAL_COMPONENTS_INVENTORY_2026-09-12.md`；岗位、Skill 和工具权限在第 7—9 步核验。

## 后续归档层（2026-09-13 第2—16步更新）

知识库、信息源和证据规则现位于 `docs/knowledge/`；岗位、SOP、工具、管理流程、QA、指标、任务与版本规则位于 `docs/operations/`；第2—16步任务卡与交接位于 `docs/standardization/`；旧状态及复盘位于 `docs/history/`。新验证证据位于 `output/standardization-20260913/`。原有产品规格仍为对应业务规范入口，新增文件不替代真实平台验收。外部输入可保留原位置并在商品包中引用；“所有文件有归属”不要求复制全电脑资料或凭证到本目录。

## 本步验收记录

以下保留第1步当时快照；第2—16步更新及本地Git基线见 `PROJECT_STATUS.md` 和 `operations/VERSIONING.md`，不要把下面“Git无提交”等历史记录当作现状。

- 已核对根目录、docs 文件清单、工作台及脚本入口、各输出目录、Git 状态和已有专项记录。
- 根目录现有项目内容已在上表分类；README 已增加本导航和推进清单入口。
- 本轮仅新增两份 Markdown 并修改 README 导航；不移动素材，不修改代码、商品包、运行数据或发布门槛。
- 本步只验证目录和文档链接；未重跑功能测试、启动浏览器或执行淘宝操作。
- 发现但未在本步解决：Git 无提交；状态文档旧口径；历史审核报告的静态资源、会话身份、业务资料和平台验收阻塞。历史缺陷须后续复核，不视为本轮已复现或已修复。
# 星途首页增量（2026-09-23）

- `workbench/travel-home.html` / `.css` / `.js`：星途目的地首页及真实状态呈现。
- `workbench/destination-catalog.mjs`：只读资料/任务/历史聚合；沿用原商品 key。
- `workbench/assets/travel-os/`：首页品牌图片与 Phosphor 图标，来源和 prompt 同目录保留；不是商品素材。
- `workbench/scripts/destination-catalog.test.mjs`、`travel-home-ui.mjs`：隔离状态与浏览器验证。
- `docs/TRAVEL_OS_HOME.md`、`design-qa.md`：使用边界与视觉验收。

## 2026-09-23 首页 3D 增量

- `workbench/travel-globe.js`、`globe-layout.js`：地球渲染、控件、屏幕投影和缩放聚合；不执行商品操作。
- `workbench/globe-catalog.mjs`、`data/globe-coordinates.json`：当前导入目录的只读地理投影和独立坐标索引，GET `/api/v1/globe`。
- `tools/build-globe-coordinates.mjs`：离线地理匹配构建器；不写源 Excel / 上架库。来源与限制见 `workbench/data/README.md`。
- `workbench/scripts/globe.test.mjs`、`globe-ui.mjs`：坐标/聚合测试和隔离浏览器交互验收。
- `output/globe-20260923/`：当次截图与验证产物，不纳入代码版本基线。

## 2026-09-25 上架记录页局部改造

- 页面实现：`workbench/travel-os.js` 的 records view 与 `workbench/travel-os.css` 的 `#page-records` 样式；页面资源版本在 `workbench/travel-os.html`。
- 验证：`workbench/scripts/records-view.test.mjs`、`workbench/scripts/records-ui-qa.mjs`。
- 说明：`docs/UI_RECORDS_20260925.md`；证据：`output/records-ui-20260925/`，本地截图／导出样例不作为代码版本基线。

## 2026-10-06 首次设置与统一资料导入

- `workbench/setup-flow.mjs`：产品层目录选择、上传、识别与准备检查；`setup-adapter.py`：固定模板转原任务契约。
- `workbench/setup-template.json` / `templates/travel-os-template-v1.zip`：模板规范和可下载的空白模板。
- `workbench/setup-ui.js` / `setup-ui.css`：资料设置四步界面及新电脑引导。
- `scripts/setup-flow.test.mjs` / `setup-ui-qa.mjs`：隔离回归；证据存放在 `output/setup-20261006/` 和 `output/playwright/setup-20261006/`。
- `docs/SETUP_GUIDE_20261006.md` / `SETUP_IMPLEMENTATION_20261006.md`：使用与实际验收边界。

## 2026-10-09 库存稳定采样

- `workbench/taobao-publisher.mjs` 的 `fillStableInventory`：受保护首次采样后建立观察预算，每次核对唯一且可编辑的库存控件。
- `workbench/scripts/inventory-timing.test.mjs`：慢检查、回滚、控件失效、暂停和默认稳定窗口回归。
- `docs/INVENTORY_TIMING_20261009.md`：r20故障证据、范围、维护保全和原任务恢复边界；本地证据在 `output/item-actions-r16/inventory-timing/`，不纳入代码版本。


## 2026-10-13 当前商品跳过并继续

docs/ROUND_SKIP_CONTINUE_20261013.md记录范围、保护和隔离验收；工作台实现位于workbench/round-item-detail.js/css，在	ravel-os.js接入当前轮次，回归脚本为scripts/round-item-retry-ui-qa.mjs。复用已有API，不修改发布执行器。


## 2026-10-13 成功页活动标签误拦截修复

workbench/publishing-pages.mjs调整仅本轮新建且已核验成功页的活动标签误判；workbench/scripts/publishing-pages.test.mjs覆盖选中成功页继续关闭，其他保护保持。证据、安装状态和边界见docs/ACTIVE_TAB_CLEANUP_20261013.md。

## 2026-10-15 环球领航独立资料与执行范围

- `workbench/shop-execution.mjs`：按店铺隔离服务端执行上下文、数据库与设置；`shop-scope.js`：网页请求及切换的店铺归属。
- `workbench/material-library.mjs`：同时识别原套图结构和标准模板的副图/A、B、详情正文、详情首页；不混入归档候选。
- `workbench/scripts/shop-execution.test.mjs`、`shop-http.test.mjs`、`hqlh-independent.test.mjs`、`hqlh-scope-ui-qa.mjs`：隔离、反例、HTTP 与界面验证。
- `docs/HQLH_EXECUTION_ADAPTATION_20261015.md`：实现和实际验收边界。证据位于 `output/hqlh-adaptation-20261015/` 与 `output/toni-hqlh-20261015/`；实际业务数据和登录信息不进入代码基线。

