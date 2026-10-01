# 岗位标准操作方法与 Skill 映射｜第 8 步

日期：2026-09-13。状态：项目 SOP 已建立；未新建或安装全局 Skill，未执行生图或平台发布。

## 使用顺序

1. 接任务后读 AGENTS、当前状态、该岗输入与验收条件。
2. 只加载与实际动作有关的 SKILL.md；项目业务约束和用户明确授权优先，不能沿用旧 Skill 中未核验的店铺配置。
3. 按本文件该岗 SOP 输出证据；工具入口可见不代表运行成功。
4. 交下一岗位复核，通过后更新步骤卡和项目状态。

## 最小技能配置（本轮路径存在核验）

| 技能 | 已核验入口 | 岗位与本项目用法 | 当前验证层级 |
| --- | --- | --- | --- |
| i-have-adhd | C:/Users/Administrator/.codex/skills/i-have-adhd/SKILL.md | 全岗信息呈现，结论先行、步骤简明、保留完整证据；不推断用户诊断 | 文件存在并已读；输出规则适用 |
| taobao-travel-listing-batch | C:/Users/Administrator/.codex/skills/taobao-travel-listing-batch/SKILL.md | LY03/05/06/07；借鉴准备与逐包审核，执行以当前商品包契约和 LY07 生成器为准 | 文件存在并已读；本轮未运行 Skill 脚本或发布 |
| playwright | C:/Users/Administrator/.codex/skills/playwright/SKILL.md | LY06/08/10/11；新快照定位、截图、页面变化后重取引用 | 文件存在并已读；node/npm/npx 命令可发现；本轮未运行 CLI/浏览器 |
| imagegen | C:/Users/Administrator/.codex/skills/.system/imagegen/SKILL.md | LY04；内置生图工具优先，每商品最多两套，保存版本与审核 | 入口存在、已读模式规则；本轮工具可见但未调用，未接入工作台 |
| security-threat-model | C:/Users/Administrator/.codex/skills/security-threat-model/SKILL.md | LY08/09/10/11；仅明确启动威胁建模任务时加载，不把本次岗位配置冒称安全审计 | 只核验路径存在；未加载执行、未产生威胁模型 |

## SOP A：调研、知识与业务数据（LY01/02/03）

1. 写清问题、目标店铺/类目/目的地、需要何种证据，按知识库 SOURCES 查已登记渠道。
2. 先查 INDEX 和原始资料，记录来源、日期、适用范围；新旧冲突并列，不能仅按最新文件时间选真值。
3. 将资料、经验、结论分类；事实、用户意图、推断、待人工确认分别标识。
4. 输出双标题与业务字段时逐条关联证据；缺供给/价格/属性/线上去重就留空或 NEEDS_REVIEW。
5. 交 LY05/LY11 检查引用可追溯、一国/一城单链接、无 SKU、未知项未变成承诺。

## SOP B：视觉与内容（LY04/05）

1. 冻结商品、目的地、服务事实、模板来源及待核验规格；输入不够则只写素材需求单。
2. 有素材先复用审核版本；需要生图才加载 imagegen，最多两套候选，禁止自动无限重生。
3. 每套主图与 4 副图、详情首页候选和固定详情逐项记录顺序、路径与哈希。
4. 人工检查目的地、服务承诺、版权/商标/人物/地标和平台规格；没有真实审核人/时间不能填通过。
5. 交 LY07 已审核候选和 LY05 的选题/选图记录；失败素材留候选区，返工仍受两套上限约束，替换保留版本记录。

## SOP C：商品包（LY07）

1. 用 docs/LY07_PACKAGE_GENERATION.md 的现有命令，明确 source、file 和全新 output 目录；不默认跑全目录。
2. 复用 tools/generate_review_packages.mjs；源业务值只转录，不填默认类目、库存或第二标题。
3. 核对 preflight-report.md/json、包数量、源哈希及 NEEDS_REVIEW 状态；文件完整不等于素材内容审核通过。
4. 有代码修改时运行 node --test tools/generate_review_packages.test.mjs；只写文档时检查命令与现有脚本一致即可。
5. 把缺项、来源、交付版本交 LY05/LY11；审核后才能按现有工作台流程导入和复核。

## SOP D：引擎、会话与准入（LY06/08/09/10）

1. 先按 RELEASE_GATES、LY11 审计和当前状态确认准入；未修复安全或业务阻塞时仅做离线检查。
2. 代码任务只修一个可验收缺陷，运行相关现有测试；保留失败重现和通过结果。
3. 真实浏览器任务确认店铺身份、包/映射版本、当前页面证据；只在准入通过后开展 DRY_RUN。
4. 新快照定位；风险、映射/包变化、资料缺失即暂停。登录和验证码由人工处理，恢复前重新核验。
5. 到 FINAL_REVIEW_REQUIRED 停止，截图交 LY11；批量每条仍按当前实现人工核验，不能用 SOP 推定无人值守已实现。

## SOP E：协调与独立 QA（LY00/11）

1. LY00 先明确单轮交付、写入范围及独立复核者；不得并发改共同文件。
2. LY11 对照标准检查实际产物、证据和版本；区分文档就绪、离线测试、真实平台结果。
3. 缺证据或失败明确拒绝，交原执行岗修复；总负责人不能用进度目标覆盖 QA。
4. 复验通过后 LY00 更新状态、任务、决策与复盘；未执行检查不能填通过。
5. P5/P6 放行只按现行门槛、实际能力和明确范围授权处理；定时任务不在本轮启用。

知识入口：[INDEX](../knowledge/INDEX.md)、[SOURCES](../knowledge/SOURCES.md)、[EVIDENCE_RULES](../knowledge/EVIDENCE_RULES.md)。
