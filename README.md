# ly-tb-automation

AI 淘宝境外旅游服务商品批量上架自动化系统。

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
