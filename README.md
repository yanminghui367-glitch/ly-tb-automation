# ly-tb-automation

AI 淘宝境外旅游服务商品批量上架自动化系统。

项目当前处于 **Phase 0：业务与字段确认**，以规则驱动、模板驱动、人工复核的商品生产流水线为核心方向。

## 项目文档

- [Phase 0 产品架构分析](docs/phase-0/product-architecture-analysis.md)
- [标准执行方案与分阶段验收](docs/phase-0/execution-plan.md)
- [Phase 0 决策记录](docs/phase-0/decision-log.md)
- [本地开发与检查](docs/development.md)

## 目标使用方式

系统面向两名异地协作用户，最终以私有中文浏览器管理后台呈现。第一版采用单台固定 Windows 主机集中运行应用、SQLite、素材、商品生成任务与淘宝 RPA；用户通过私有网络访问唯一一套数据。

项目开发与 Codex 协作约束见 [`AGENTS.md`](AGENTS.md)。

## 当前进度

Step 1 工程骨架已经建立，包括环境配置、FastAPI 应用工厂、SQLite 迁移、结构化日志、中文工作台、Windows 开发启动脚本和基础自动化测试。功能模块将按照执行方案逐步交付。
