# BASELINE-ROUND-FAULT-20261018：原版系统故障暂停断言

状态：独立待修项；不计入第4项提交回执修复，不修改期望值凑绿。来源：用户2026-10-18明确要求另开处理。

测试：`workbench/scripts/listing-round.test.mjs`中的`unrecognized recurring system fault pauses first item without failing rest`。原期望PENDING=7，未修改的原封版实际PENDING=4。独立QA以原`listing-round.mjs` SHA256 `c2b7c58460980b75fff527cb7b18d593e77cccf7178e81c80130bfe022d9ed6a`复现，不是本次提交回执候选引入。

证据：`output/submission-receipt-repair-20261018/baseline-existing-failure.log`、`qa/known-baseline-failure.log`、`qa/final-candidate-hashes.json`。第4项最终相关回归按完整测试名排除该一条，189项通过，排除事实已披露；候选保留原测试期望7。

独立修复顺序：先对照Step3现行“按商品计数的同类/连续失败熔断”业务约定、`classifyRoundFailure`及原测试fixture，确认该例究竟表示未识别系统故障应首条暂停，还是产品失败可继续。分别复现故障分类、商品状态和熔断；若实现偏离约定则修实现，若fixture不再触发其文字描述的故障则重构输入和覆盖，而不是仅把7改成4。验收需证明暂停时点、后续商品是否未派发、原提交/验证码/未知结果保护与原次数均符合约定。

本项未执行真实商品、不调整熔断参数、不重置次数。后续范围及证据独立记录。
