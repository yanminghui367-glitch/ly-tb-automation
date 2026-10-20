# Step 2 r2 候选独立 QA

**PASS_CANDIDATE_ONLY：本次预算拒绝处理修正通过隔离复核；未部署，未授权安装、加额或真实商品发布。**

复核者：`/root/step05_runbook_qa`；日期：2026-10-18。本 QA 只在 `output/step2-safe-retry-20261018-r2/qa/` 写测试与证据，未修改运行源码、正式锁、业务数据库或 r1 历史证据。测试使用内存数据库与 mock 发布执行器，无浏览器、生产 HTTP、重启、真实提交操作。

## 纠正上一轮 QA 结论

r1 独立测试第 12 项将 `assertClaimBudget` 拒绝继续恢复、继而阻塞整轮视为通过。这是 QA 验收边界判断错误：对于已经被明确判定为提交前详情故障、且没有保护证据的当前商品，预算耗尽应结束这一失败项并继续其余商品；不能只验证“未增加额度”，遗漏“其余商品继续”。本次承认并纠正该期望，不修改 r1 报告或旧日志来倒改历史。

采用同一份冻结测试分别验证两个候选：r1 为 **13 通过、8 失败**，r2 为 **21 通过、0 失败、0 跳过**。两个网站执行窗口用例在 r1 实得 `SYSTEM_BLOCKED`，r2 实得 `COMPLETED`。这里的成功商品均为模拟结果，不是淘宝真实上架证据。

## 冻结文件与候选链

- r2 manifest SHA-256：`1067814049314bfbd0133dc817389160930f9898cbf3f9797a265c3f63ea6b5e`。
- r2 revision：`20261018-step2-safe-retry-r2`。
- r2 候选锁 SHA-256：`bac37aedc5eff14be3284d9b4b5edc3c21c618758504728f44f233589c362aea`。
- 安装前驱仍为已审 Step 1 候选 `20261018-step1-detail-ready-r1`，锁 `17188e2e59a5bb791bef86ee12b8f32d62aaaeee0f582af7fe8fcc71f238e26a`；Step 2 r1 是被替代、未安装的候选，不进入安装链。

| 运行文件 | r2 SHA-256 |
|---|---|
| `workbench/taobao-publisher.mjs` | `0cac2402fb1112c53e22883c4daaf04b59330a15d817934488deecd66159bd66` |
| `workbench/publishing-materials.mjs` | `304500f53f12f18a08bba327e8d77ca1985c3316c97e94719977708acbd6ea29` |
| `workbench/listing-round.mjs` | `658da87504bc6fc7637c0243e0744b8050367613d8e0a4810c8d08ecb8a41dc9` |

逐项复算 3 个运行文件与 24 项 artifacts 均符合 manifest，dev 与包内运行文件字节一致。所有 Step 1 基线哈希、当前生产旧哈希、前驱锁、amendment-binding 及 Step 1 补跑绑定均匹配原始证据。按冷备的 382 项源码清单比较，r2 相对 r1 只改变 `listing-round.mjs`；另两个运行文件不变。

候选锁保留 84 个键和 Step 1 review；相对 Step 1 仅三个源码哈希、revision、新增 Step 2 review 变化。实际调用 `verifyKernel`：候选 r2 与正式旧版本各自 `ok=true, files=84, changed=[]`。

## 独立验证结果

冻结测试 `qa/independent-round-r2.test.mjs` SHA-256：`5a758cedde315c1f76bcf26c23282ee148c7534d40ba8228d68dcad74bd33e08`。没有在最终冻结后修改测试。

- 历史 attempts/max_attempts 为 3/3、retry_counts 分别为 0/1：调用失败处理后当前商品和队列均 FAILED，其余 4 条继续完成；失败处理不修改 attempts、max_attempts、baseline_attempts、extra_attempts、retry_counts。
- 已加额后耗尽 4/4，以及原安全额外恢复已经耗尽的 5/3、extra_attempts=2：不加额、不清零、不增加安全恢复次数，当前项结束。
- 三个明确预算拒绝码分别覆盖；真实 `assertClaimBudget` 的 EXTRA_UNSAFE 与 SYSTEM_UNCONFIRMED 路径均验证，EXHAUSTED 用显式拒绝注入验证精确分支。原详情原因保留，另有包含正确预算拒绝码的耗尽事件。
- 实际 `ListingRound`、`BatchWorkflow`、`RoundWindows` 配合内存数据库：3/3、retry 0/1 两种场景均为 4 NEW_SUCCESS、1 FAILED，分配的 3 个窗口均 COMPLETED；原窗口 outcome 为 FAILED，次数为 3，不再调度当前商品安全恢复。
- 未知预算码、SQLITE_BUSY 和无 code 底层异常不被吞掉，仍为 SYSTEM_BLOCKED；旧 SAFE_RETRY_UPLOAD 恢复语义不变。
- RESULT_UNKNOWN、SUBMITTING、验证码/登录/身份、提交事件/ID/结果、已保存的提交标记及页面账本故障不会进入预算耗尽继续分支。`allowRecovery=false` 保留原阻塞路径。

独立日志：

- 修复前同测试：`qa/independent-round-r1-regression.log`，SHA-256 `293642c22ea15d7f5680bc09dce308f876eece9fc52ce116e4a6055c3c103d2a`。
- 修复后同测试：`qa/independent-round-r2-final.log`，SHA-256 `143540232cbcf2c00016f876302fb64d619256d7598686ee80f8794813aaf394`。

执行者另有 3 项网站窗口及执行尝试台账用例，已审其源码与最终证据：attempt outcome 为 FAILED、autoRetryScheduled=false、submittedByThisAttempt=false、disposition=FINISHED。此部分为执行者实跑证据复核，不冒称由 QA 重新执行。QA 自身窗口测试另验证窗口结果、发起次数、恢复事件和自动衔接。

执行者最终完整相关回归 132/132、0 失败、0 跳过；日志 SHA-256 `0624f6bb6df9b2dd558ebb5216086ee92ccfa3943a6afd3b82e150a4e63b2848`。这 132 项包含独立 21 项，不能相加。Step 1 最终字节 120/120 的原日志及哈希绑定复核通过，不冒称本次又重跑 Step 1 或真实平台。

## 代码审查与边界

相对 r1 的唯一源码差异位于新详情失败分支：仅捕获 `ITEM_RETRY_BUDGET_EXHAUSTED`、`ITEM_RETRY_BUDGET_EXTRA_UNSAFE`、`ITEM_RETRY_BUDGET_SYSTEM_UNCONFIRMED`，沿既有耗尽路径结束该项；未知异常继续抛出。耗尽事件新增 `cause=CLAIM_BUDGET`、budgetCode、budgetReason，原两次步骤恢复耗尽由 `cause=STEP_RECOVERIES` 区分。事件 `max=2` 是步骤恢复上限，不是总尝试额度。

五个详情码白名单、原步骤、PAUSED、已进入填写及无保护证据的前置条件保留。没有修改 pump、提交、批量认领、状态枚举、API/前端额度或原预算算法。该结论只适用于这个明确详情失败分支，不承诺所有预算错误、未知底层异常或尚未进入该分支的旧任务都能继续。

README 与安装清单准确说明 r1 被替代、Step 1 → Step 2 r2 的候选链、单一维护窗口及物理标签页不能保证保留。当前生产 382 项源码仍与冷备完全一致；正式锁仍为 `1d21ba6d5d046376a9a4e285cb081593aee8041d1f17c7ff68794f3b539d46a2`、旧 revision `20261017-single-item-direct-retry3`。r1 报告与结果的原哈希不变。

没有遗留的本范围候选阻断问题。用户审阅本次差异和日志后方可放行安装；本报告不表示网站已加载、不放行任何真实商品重试或批量运行。候选字节或范围改变须重新核验。
