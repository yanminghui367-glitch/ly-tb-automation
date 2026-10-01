# 外部 Skills 与开源组件清单

更新日期：2026-09-12。仅记录已下载、已安装或经审查排除的组件；不等同于已接入工作台或已通过淘宝页面验收。

## 已安装／下载

| 组件 | 状态与位置 | 用途 | 接入边界 |
| --- | --- | --- | --- |
| ComfyUI | 已下载官方源码：`third_party/ComfyUI`；官方归档保留为 `third_party/ComfyUI-source.zip` | LY｜04 的本地 AI 生图后端候选。可用工作流和本地 API，为同一商品生成两套可追溯候选素材。 | 当前未安装模型、未启动服务、未接入工作台。采用本机 HTTP 服务边界，不复制其 GPL-3.0 源码进现有 Node 工作台。 |
| `security-threat-model` | 已安装到 `C:\Users\Administrator\.codex\skills\security-threat-model` | 为 LY｜08／LY｜09 设计浏览器会话、静态资源、商品素材路径、任务接口和日志的威胁模型与缓解方案。 | 下一轮会话起可调用；先用于修复已知静态资源访问边界，不读取或导出账号凭据。 |
| Python 3.12.10 | 当前用户范围安装：`C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe` | 运行官方 Codex Skill 安装器，也满足 ComfyUI 后续 Python 运行时的基础前提。 | 未安装任何 ComfyUI 依赖、模型或自定义节点。 |

### ComfyUI 来源与校验

- 官方来源：`https://github.com/Comfy-Org/ComfyUI`
- 下载时的 `master` 提交：`c75d8c966c29cb0392259af791f43373315b72db`
- 许可证：GPL-3.0。
- `README.md` SHA-256：`8F2ED48355215E83333EE05798B58CE6E813625736ED5ED416FB935EF6A29A54`
- 归档 SHA-256：`48E5CA0A2E6A33EF4C81336FA1F9B899BB45006F1DEB6A0E664E0F7D5CE90861`

## 已有且可直接复用的 Skills

| Skill | 适用模块 | 用途 |
| --- | --- | --- |
| `taobao-travel-listing-batch` | LY｜03／05／06 | 从标题池和本地素材准备、校验并在授权浏览器会话中填写旅游服务商品包。 |
| `playwright` | LY｜06／08／09 | 对本地工作台与授权浏览器流程做可复跑的页面验证、截图和错误定位。 |
| `gpt-image-2-prompts-search` | LY｜04 | 为统一模板、目的地背景与两套候选视觉方案检索和组织生成提示词。 |
| `imagegen` | LY｜04 | 在确定视觉规范后生成或编辑候选图片。 |

## 审查后暂不安装

| 候选 | 原因 |
| --- | --- |
| Writ | 虽有任务录制、调度、SQLite 审计功能，但需要 Docker（本机未安装），并将登录凭据、TOTP 和会话作为产品功能管理；这与当前“不保存账号密码、Cookie 或敏感凭证”的项目边界冲突。 |
| ClawBridge | 具备桌面／浏览器任务编排和审计日志，但包含 anti-bot avoidance 路径，且引入多套模型与自动路由。当前项目应先验证现有确定性 Playwright／RPA 流程，不能把它作为规避平台风控的手段。 |
| 通用 RAG 平台（Dify、RAGFlow、Qdrant 等） | LY｜02 的数据来源、问答范围、权限和更新规则尚未定义；先建项目知识库与可追溯引用，再决定是否引入额外服务，避免在 C 盘剩余空间有限的情况下提前部署大体量服务。 |

## 本机运行前置条件

- 发现的 GPU：NVIDIA GeForce RTX 5060 Ti；系统报告可用显存约 4 GB。
- 当前项目位于 C 盘，C 盘剩余约 7.6 GB；D 盘剩余约 115 GB。
- 因此 ComfyUI 的模型、输出和缓存不可默认下载到项目目录或 C 盘。后续若启用，须把模型与生成输出设到 D 盘的明确项目子目录，并先做单图显存／磁盘验收。

## 推荐接入顺序

1. 用 `security-threat-model` 处理工作台静态资源和登录态边界。
2. 为 LY｜04 定义一张模板的尺寸、禁止元素、目的地变量和验收规则。
3. 在 D 盘单独配置一个轻量 ComfyUI 工作流，先生成 1 条商品的两套候选图并校验。
4. 只有通过素材审核后，才把 ComfyUI 的队列接口接入商品包生成器；生成失败不能阻塞已有资料的审核与任务恢复。
