# 导出验证 · 2026-09-27

结论是实现者本轮自验，不是新增真实发布验收，也不替代此前独立QA。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| 原工作区 `npm test --prefix workbench` | 167/167 | 临时数据库与模拟执行器 |
| 导出副本 `npm ci --prefix workbench --ignore-scripts` | 通过 | 按锁文件全新安装 |
| 导出副本 `npm run check --prefix workbench` | 通过 | 现有静态语法检查 |
| 导出副本 `npm test --prefix workbench` | 167/167 | 验证筛选后未漏运行依赖 |
| Python适配器与资料诊断 | 14/14 | adapter 2、pool 3、heat 2、rescan 7 |
| 全新导出目录只读启动检查 | 8/8 | 首页及总览/产品/任务/设置、零生产数据、零活动任务、冻结内核 |
| 冻结文件校验 | 10/10 | 原始源文件与kernel-lock一致 |
| 上传范围 | 136个原文件，36,784,939 bytes，另加说明与检查脚本 | 无运行数据/商品资料/登录Profile；常见Token及私钥模式扫描无匹配，不等同全面安全审计 |

只读启动检查使用现有 `WORKBENCH_NO_LISTEN=1` 导入服务器，再绑定临时端口，明确跳过生产启动时打开Chrome的回调。前端用全新headless Chrome检查，不连接9222、不复用卖家Profile，非GET请求被拦截。初次测试脚本误等首页不存在的状态元素造成超时，修正测试选择器后在另一全新目录重测通过；未修改业务代码来迁就测试。

独立执行 `node workbench/scripts/check-clean-export.mjs` 仅限全新且没有 `.runtime`、`browser-profile` 的本目录副本；有现存运行资料会拒绝。正常生产启动仍使用双击入口，不能把此检查当作专用Chrome登录验证。

历史专项记录（已读原始资料，原始账号截图/明细保留本地）：

- 单品：`output/p0-new-uk-20260918/result.json`，状态 `VERIFIED_NEW_ITEM`，存在平台商品ID、结果链接及列表证据。
- 浏览器持久化：`output/browser-persistence-20260920/session-restore-result.json`，重启后记录为 `LOGGED_IN`。
- 五条：`output/workbench-five-20260921/batch-result.json`，requested=5、verified=5、active=null；法国、俄罗斯由人工完成验证后恢复。
- 二十条：`output/batch20-20260921/REPORT.md` 与 `batch-result.json`，最终20/20、商品ID唯一、提交意图不重复，输入哈希未变；期间有修复、重试、人工暂停和程序中断，不是无人干预。
- 总览：`output/overview-reference-20260925-FVj8N5/browser-qa.json`，52项隔离检查及独立复核；不作为当前全站新增发布证明。
- 资料诊断：`output/material-audit-20260926/live-verification.json`，6项现场检查通过；只写诊断报告，不修改源资料/素材关联或解除发布阻塞。

以上 `output/...` 路径是本地证据索引，按用户要求不上传原始运行记录，因此不能在本仓库直接点击下载。历史成功数只是各次验收时点，不是2026-09-27的全店实时累计数。
