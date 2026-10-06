# ly-tb-automation

## 当前版本同步（2026-10-06）

星途 Travel OS 当前源码与UI完整同步至 [`apps/travel-os-local/`](apps/travel-os-local/)，包含四步资料设置、固定模板、指定磁盘上传、统一店铺连接，以及原商品核验、执行范围确认、截图证据修复。入口见 [新电脑简易教程](apps/travel-os-local/docs/SETUP_GUIDE_20261006.md)。

程序和资源按SHA-256逐文件核对，13项冻结文件保持已验证版本；220项代码回归、17项设置界面检查和独立QA结果见 [同步说明](apps/travel-os-local/docs/GITHUB_SYNC_20261006.md)。业务资料、运行数据库和登录凭证留在本机；下载源码不会自动带入原店铺数据或启动发布。

## 新任务随机规则（2026-10-04）

已同步至 `apps/travel-os-local/`：两套副图整套随机、详情首页独立随机替换、固定品牌与经人工确认的属性候选随机；选择在预览和任务内固定，仅影响新任务。入口为“资料设置 → 发布随机规则”，默认未启用。

本轮 180 项回归、22 项隔离浏览器检查通过；没有真实上架。使用、授权内核增量及平台验证边界见 [随机规则说明](apps/travel-os-local/docs/RANDOM_PUBLISHING_RULES_20261004.md)。运行数据库、商品图片和登录资料继续只留本地。

AI 淘宝境外旅游服务商品批量上架自动化系统。

## 当前星途 Travel OS 完整版（2026-10-01）

本机现有 UI、功能代码、字体、图片、Three.js、内核、测试和项目文档完整保存在 [`apps/travel-os-local/`](apps/travel-os-local/)。下载默认 `main` 分支后，双击根目录 **`安装星途工作台.cmd`**；有本地业务迁移包时，在首次启动前进入该目录，将业务 ZIP 拖到 **`恢复业务数据.cmd`**，再双击 **`启动上架工作台.vbs`**。

安装要求 Windows、Node.js 24+、Python 3.10+ 和 Google Chrome；安装器按锁文件安装依赖并核对全部源文件/资源哈希。步骤、数据恢复与验证边界见 [跨电脑安装与迁移](apps/travel-os-local/docs/GITHUB_INSTALL_MIGRATION_20261001.md) 和 [本轮验证](apps/travel-os-local/docs/GITHUB_SYNC_VERIFICATION_20261001.md)。

业务 Excel、商品图片、报价、上架历史通过本地包传输，不进入这个公开仓库；登录在新电脑重新完成。迁移保留历史防重键并默认关闭执行，两个副本不会自动同步。下方原系统和此前记录保留。

## 已验证的本地工作台代码（2026-09-27）

- [实际有效成果总结](docs/TRAVEL_OS_EFFECTIVE_SUMMARY_20260927.md)：区分历史真实发布、本地测试、当前能力和未完成项。
- [星途 Travel OS 本地工作台](apps/travel-os-local/README.md)：只读Excel/图片适配、持久队列、专用Chrome、人工验证码恢复、八模块界面、报价与素材诊断。
- [导出验证与证据边界](apps/travel-os-local/VERIFICATION.md)：167项Node测试、14项Python测试及8项全新空目录检查；本次没有真实发布。

这份本地工作台以独立目录保存，未替换下方原有FastAPI商品生产系统，尚未打通两套应用的数据。源码不包含业务资料、生产状态库、登录Profile或凭证；新克隆不能当作原店铺历史防重库的替代。

## 原 FastAPI 商品生产系统

该实现当前已进入 **Step 3：商品任务与标题规则**，以规则驱动、模板驱动、人工复核的商品生产流水线为核心方向。

## 项目文档

- [Phase 0 产品架构分析](docs/phase-0/product-architecture-analysis.md)
- [标准执行方案与分阶段验收](docs/phase-0/execution-plan.md)
- [Phase 0 决策记录](docs/phase-0/decision-log.md)
- [本地开发与检查](docs/development.md)
- [商品任务与标题草稿](docs/product-tasks.md)

## 目标使用方式

系统面向两名异地协作用户，最终以私有中文浏览器管理后台呈现。第一版采用单台固定 Windows 主机集中运行应用、SQLite、素材、商品生成任务与淘宝 RPA；用户通过私有网络访问唯一一套数据。

项目开发与 Codex 协作约束见 [`AGENTS.md`](AGENTS.md)。

## 当前进度

Step 2 目的地数据中心已经建立，包括 3 国 15 城初始数据、八类服务、Excel 模板、逐行校验、幂等导入、导入审计和中文目的地页面。

Step 3 已建立 18 件国家/城市综合商品的批次任务、逐件失败隔离、断点重试、输入指纹、两个确定性标题候选、规则版本、人工草稿选择和防静默覆盖。当前 `PROVISIONAL_V1` 标题及八类服务覆盖均为待业务确认草稿，不代表淘宝合规或商品批准。
