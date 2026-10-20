# 独立 QA：网站单条核验缺少原提交证据

结论：候选通过。仅证明本次一文件入口修复与隔离恢复行为；没有核验生产洪都拉斯商品，没有执行生产核验、继续、提交或服务重启。

复核者：`/root/submitted_recovery_qa`。精确字节绑定见 `binding.json`。

封包后复核：候选 revision 为 `20261018-website-verify-r1`。manifest SHA256=`1df94d274529e152992b3a6922d805a50a97ab1ff6c808cef060b44671be2e72`；候选锁 SHA256=`00e588aa8ded8cfeef63614d3c3fdd21a9ec9e9606e5a7ac25dc954d3b0f2336`。候选内两文件均重新计算并与 manifest 一致：运行文件 `3364bcc6ac5be7945479dc7df5e36d7f5da7d128db45008172a9fda568d36018`、开发方回归测试文件 `5628643ea6f3c9e2aaefb2242f3f7c3eed1f9595a6ebd045da6ea01f6f792f07`。本 QA 的 9 项绿灯覆盖该运行字节；独立测试来源另行绑定，不混算测试数量。

生产前驱为 `20261018-submit-receipt-r1`。该版普通轮次恢复已注入原提交事件及 ID 归属检查；网站 `RoundItemVerify.perform()` 仍缺这两项参数，因此无 ID 的已提交商品在 `submissionLookupWindow([])` 即失败。灰色跳过按钮是对已提交商品的正确保护，不应取消。

本次候选仅修改 `workbench/round-item-verify.mjs`：从当前受保护的原 store 读取原 run 事件，并注入现有 `assertUnclaimedSubmissionId`。84 个冻结文件对前驱逐文件比较，只有该文件不同。未修改任何跳过规则、额度、提交路径、其他 7 个刚安装的修复文件或并行 UI 成果。

独立用例结果：同一组 9 项，生产旧入口通过 2 项、失败 7 项；候选通过 9 项、失败 0 项。失败明确由原提交事件缺失触发，保留 `production-red.log`；绿灯日志为 `candidate-green.log`。这些 9 项为独立新增测试，不能把开发方报告的任何测试数重复相加。

已验证：

- 真正接通 `RoundItemVerify → RoundVerification → readSubmittedListing`，使用真实内存 SourceStore/BatchWorkflow/ListingRound；仅 seller table 和浏览器证据为 mock。
- 无 ID 的原已提交商品成功核验后，原 run 为 VERIFIED、queue 为 SUCCEEDED、round item 为 NEW_SUCCESS；轮次暂停待操作，其他任务逐字未变。
- 原 attempts、max_attempts 不变；没有新 launch 或 submit；原 SUBMIT_CLICKED 仍恰好 1 条。
- 请求中的伪造 submissionEvents/assertUnusedItemId 不生效；原 store 事件才是证据来源。
- 重放同一核验请求复用原回执，不再次查询或提交。
- 缺原点击证据、历史成功占用 ID、其他 run 已占用 ID、同标题但创建时间不符、同标题多匹配均保留 RESULT_UNKNOWN；不会误认领。
- CAPTCHA 保留 WAITING_HUMAN 与原 RESULT_UNKNOWN，不降级人工闸门；不允许通过跳过掩盖未知提交。
- 已知 ID 路径与未提交候选路径不注入无 ID 恢复能力，行为保持。

边界：修复入口不等于洪都拉斯平台结果已确认。现有后台恢复仍要求唯一冻结标题、价格库存、原实际点击后的精确创建时间、正确上架状态与未占用 ID；实际证据不足时仍应保护未知结果。安装后只能报告版本加载，真实核验是否成功须以原网站核验结果另行证明。维护授权不自动授予核验或恢复商品执行。

所有测试数据库均为内存，证据文件仅写在本 QA 目录的 artifacts 子目录；复核者没有写生产、控制生产浏览器或启停服务。
