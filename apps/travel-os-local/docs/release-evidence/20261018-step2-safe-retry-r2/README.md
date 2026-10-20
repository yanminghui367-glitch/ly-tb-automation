# Step 2 r2：历史额度耗尽时结束当前详情失败项

候选版本：`20261018-step2-safe-retry-r2`。本包替代尚未安装的 Step 2 r1；安装前驱仍是已通过的 Step 1 `20261018-step1-detail-ready-r1`。**未部署，未操作生产任务、浏览器或额度。用户复核本次 diff 和测试后才放行安装。**

## 本次修复

相对 r1 仅改 `workbench/listing-round.mjs` 中的新详情故障分支。`taobao-publisher.mjs`、`publishing-materials.mjs` 与 r1 字节完全一致。

旧路径只检查安全恢复次数是否少于两次，随后调用会抛异常的 `assertClaimBudget`。历史 attempts 可能已耗尽，但 retry_counts 仍为 0/1；该预算拒绝会逃到协调器，使整轮 SYSTEM_BLOCKED。上一轮 QA 对此要求“继续阻塞”的断言不符合业务要求，本次明确纠正，保留旧报告作为历史。

新路径只捕获原预算检查的三种明确拒绝：`ITEM_RETRY_BUDGET_EXHAUSTED`、`ITEM_RETRY_BUDGET_EXTRA_UNSAFE`、`ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED`。捕获后沿用既有耗尽分支：队列和轮次商品均 FAILED、保留失败原因和完成时间，记录 `SAFE_STEP_RECOVERY_EXHAUSTED`（`cause=CLAIM_BUDGET`、`budgetCode`、`budgetReason`、`continued=true`），继续其余商品。

不增加额度，不清零次数，不修改 retry_counts；不再为该条安排安全恢复。事件的 `max=2` 指安全步骤恢复上限，不能当作 attempts 上限；两类耗尽由 cause 区分。未知异常、数据库读取故障、未识别的预算码仍按原规则阻塞，不被当作普通耗尽吞掉。

该处理仅在原有五个详情错误白名单、原详情步骤、PAUSED、已进入填写且无保护证据的检查通过后生效。RESULT_UNKNOWN、验证码/登录、提交证据、保留页面保护的优先级和处理仍保留。非详情错误、旧 SAFE_RETRY_UPLOAD、禁止恢复或操作者暂停不获得本次继续权限。

没有修改 pump、认领顺序、提交、状态枚举、API/前端额度、原预算算法或 Step 1 超时数值。本次修复使该预算拒绝不再导致泵异常退出；台账记录 FAILED、autoRetryScheduled=false，FINISHED 对应实际已完成的失败处理。没有声称修复所有其他未预期底层异常的台账路径。

## 新增复现与最终验证

[本次最小差异](evidence/r1-to-r2.diff)只含上述分支；完整 Step 1 → Step 2 三文件差异仍在 evidence/diffs/。

[新增用例](evidence/tests/budget-exhaustion.test.mjs)使用真实轮次协调器、队列、网站执行窗口和台账，仅发布执行器为 mock。三种历史夹具分别为 attempts 3/3＋安全恢复 0、3/3＋安全恢复 1、已有一次加额被用完后 4/4＋安全恢复 0。历史计数只在隔离测试库构造，生产和运行实现没有写入这些计数。

- [修复前日志](evidence/budget-before.log)：3 项全失败，实得 SYSTEM_BLOCKED。
- [修复后日志](evidence/budget-after.log)：同样 3 项全通过，每种均 4 条 mock 成功、1 条 FAILED、轮次及窗口 COMPLETED。
- [新增用例结果](evidence/budget-outcomes.json)：记录 failure 前后 attempts 相等、max_attempts 不变、extra_attempts 不变、retry_counts 不变、预算拒绝事件及正确台账结果。
- [最终完整相关回归](evidence/final-mock-regression.log)：132/132 通过、0 失败、0 跳过。以最终三文件字节运行原五套相关测试、Step 2 测试、新增历史用例及独立 QA 测试；不代表全项目全部 UI 或真实平台验收。
- [独立 QA 报告](qa/independent-qa.md)与[结果](qa/result.json)：由原复核者独立出具，绑定本候选 manifest 和最终源码。执行者综合回归包含独立测试，不重复相加计数。

Step 1 最终字节 120/120 补跑证据及其 manifest 绑定原样带入，未改变 Step 1 字节，不重复宣称本次重新跑过。旧 r1 候选及报告未改写。

## 包与安装链

候选 manifest SHA-256：`1067814049314bfbd0133dc817389160930f9898cbf3f9797a265c3f63ea6b5e`。三个运行文件各有 Step 1 的 baselineSha256 与 r2 的 sha256，另保留旧生产哈希。Step 2 r1 只是被替代的未安装候选，不能先安装 r1 再安装 r2。

候选锁保留 84 项冻结键及 Step 1 review；前驱锁仍为 `17188e2e59a5bb791bef86ee12b8f32d62aaaeee0f582af7fe8fcc71f238e26a`。r2 基线快照落点为 `docs/kernel-baselines/20261018-before-step2-safe-retry-r2.json`。正式旧锁保持 `1d21ba6d5d046376a9a4e285cb081593aee8041d1f17c7ff68794f3b539d46a2`；[完整性结果](kernel-check.json)区分生产与候选。

[联合安装清单](INSTALLATION-PLAN.md)保留一次停服、看守暂停、现场保护判断、中途不开跑、两份基线快照和分别验锁。此清单尚未执行；deploymentAllowed=false。

用户放行安装后，才依清单执行 Step 1 → Step 2 r2，随后按原授权确认加额一次、5 条真实小样本。只读耗时采集工具原样保留，第一次获准复跑后即可统计五类 stage；目前仍无生产 P50/P90。工具具备不等于真实分布已验收。预算保持原值，ready 诊断落盘优化仍留 P3。

归档测试保留原相对导入，实际运行位置见 manifest.testsExecutionRoot；不要在缺少依赖的压缩包内直接运行。包不含依赖、浏览器配置、凭证、业务数据库或商品素材。后置 QA、候选锁和说明由 PACKAGE_SHA256SUMS.txt 绑定。
