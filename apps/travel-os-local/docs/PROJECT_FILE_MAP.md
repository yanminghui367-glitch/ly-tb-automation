# 项目文件导航｜标准化第 1 步

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
