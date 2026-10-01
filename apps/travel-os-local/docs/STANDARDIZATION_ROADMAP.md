# 全生命周期标准化推进清单

更新日期：2026-09-13。用户已要求继续第2—16步并在项目对话内拆分执行。第1步沿用；第17步未安排。

**管理交付：第2—16步分别有任务卡与产物；第14步自动化扩大BLOCKED，其余步骤完成对应管理建设。侧栏对话派发因接口缺失仍BLOCKED，实际由当前任务内协作代理完成。**

任务卡、执行者、验收与交接统一见 [第2—16步索引](standardization/INDEX.md)。产品状态独立见 [PROJECT_STATUS](PROJECT_STATUS.md)：P3部分完成，真实P4/P5/P6未通过，LIVE关闭。文档建设完成不能提升产品阶段。

## 1—6：基础与判断依据

| 步骤 | 当前交付 | 状态 |
| --- | --- | --- |
| 1. 项目文件夹 | [文件导航](PROJECT_FILE_MAP.md)，既有目录归属 | 已完成 |
| 2. 宪法制度 | [AGENTS](../AGENTS.md)、[发布门槛](RELEASE_GATES.md) | 制度完成，未平台放行 |
| 3. 项目状态 | [现行状态](PROJECT_STATUS.md)、旧状态原样归档 | 已完成 |
| 4. 知识库 | [资料/经验/结论](knowledge/INDEX.md) | 索引完成，未凭空补业务事实 |
| 5. 信息源管理 | [固定来源规则](knowledge/SOURCES.md) | 规则完成，外部来源未做本轮核验 |
| 6. 证据与验证规则 | [分层与验收规则](knowledge/EVIDENCE_RULES.md) | 已完成 |

## 7—12：岗位与交付

| 步骤 | 当前交付 | 状态 |
| --- | --- | --- |
| 7. Agents岗位 | [岗位与交接](operations/ROLES.md) | 制度完成，不等于常驻代理或侧栏对话已创建 |
| 8. Skills | [岗位SOP及Skill映射](operations/SKILL_SOPS.md) | 入口核验/SOP完成，未安装新Skill |
| 9. 工具 | [最小工具与验证层级](operations/TOOL_ACCESS.md) | 分配规则完成，不冒称技术权限隔离 |
| 10. Workflow | [管理与生产交接](operations/WORKFLOW_STANDARD.md)，沿用现有产品WORKFLOW | 已完成 |
| 11. 任务 | [任务总表](operations/TASK_BOARD.md)及15张任务卡 | 本地完成，侧栏派发BLOCKED |
| 12. QA | [质量标准与本轮离线结果](operations/QA_STANDARD.md) | 制度及离线复核完成，平台QA未通过 |

## 13—17：监督与持续运行

| 步骤 | 当前交付 | 状态 |
| --- | --- | --- |
| 13. 总负责人 | [协调与决策规则](operations/DIRECTOR.md) | 已完成，不替代QA |
| 14. 自动化 | [准入与扩大规则](operations/AUTOMATION_READINESS.md) | 规则完成；扩大BLOCKED，手动/安全/真实资料未闭环 |
| 15. 数据指标 | [指标定义与本地基线](operations/METRICS.md) | 已完成；无平台/收益/节时实测 |
| 16. 复盘和版本 | [版本规则](operations/VERSIONING.md)、[本轮复盘](history/RETROSPECTIVE_2026-09-13.md) | 本地基线f855cd2已验证；未建立远端备份 |
| 17. 定时任务 | 无 | 未开始，不在本轮范围 |

## 下一步

N01静态资源访问边界已修复并独立QA通过，N02会话归属与店铺身份工程已通过，真实平台待验收。N03英国样本资料盘点已完成；下一项是取得明确首条对象和真实供给资料来源，完整证据包仍阻塞。缺少对话工具时继续可执行本地任务；接口恢复后复用已完成交付，避免重复跑各步骤。
