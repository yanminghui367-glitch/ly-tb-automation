# 独立候选复核

结论：**PASS_CANDIDATE_ONLY**。仅表示本次候选代码、隔离测试与维护方案通过；未把它记作已安装或真实平台修复完成。

复核人：/root/step05_runbook_qa。时间：2026-10-18T12:55:18.475Z。

- 最终 14 项独立测试全部通过，失败/跳过均为 0。此前 8 项中的 5 项真实失败日志保留：受保护页、未知提交、未完成持久预约及新表单残留内容已改为明确保护故障，不再被当作普通商品失败继续。
- 检查同一 claim 内仅一次持久重填、迟到提交阻止新页、原回执保留、第二次缺回执不能再次重建、精确目标页绑定、三类新恢复码遇到提交或人工保护仍阻断。后续错误回执不会被前面的缺失回执掩盖。
- 候选与隔离源码逐项相同；仅 publisher、source-workflow、listing-round 三个运行文件变化。84 项路径不变，其余 81 项哈希不变；锁只改这 3 项哈希、revision 和本次 review。候选和当前正式源的各自锁均为 true / 84 / changed=[]。
- 安装清单及维护脚本只读复核未发现阻断：原锁快照、正常停服并等旧进程退出、三文件后换锁、九库备份/状态比对、原看守暂停与恢复、失败回退均有对应步骤。未入系统的成功页仅按用户对 1094088664955 的明确确认允许维护关闭，不增加成功数。维护实际执行时仍须重新满足这些门禁。
- 本轮独立只读核账：17–191 共 175 项，97 成功、4 失败、74 待执行；97 个成功 ID 唯一、均与原 VERIFIED 记录匹配，每条恰有 1 次提交意图和 1 次提交点击。当前绝对序号 118 未提交、结果无不明标记。未扩范围、未复活 4 条失败、未增额度。该核账时间为 2026-10-18T12:51:19.563Z。

## 字节绑定

- candidate-manifest.json：e7b6122cdc2e83c50ce4e30a1f38c9f4e1481320acbe28e798f193f669ba8bd9
- kernel-lock.candidate.json：8d76315c1d09abb28e29b1e684f76c4451bf88bc59abd7083e5dd73565ab3e9d
- 原锁：17345cf58209b4320d280cde9aefa1dff8c0ac6d8e9e60f3706a2bc9618909df
- 前驱版本：20261018-step3-main-stability-r1
- 候选版本：20261018-continuous-origin-refill-r1

- workbench/taobao-publisher.mjs：94011fc48bd782b281b52342318647177bdde647a8f1cdece772380e16ecdc61
- workbench/source-workflow.mjs：b5c48b87fe8548ed5735c228df07c5411b46bbc3409a469b1852d6521df817ec
- workbench/listing-round.mjs：c2b7c58460980b75fff527cb7b18d593e77cccf7178e81c80130bfe022d9ed6a

## 独立证据

- ../../qa/independent-final.log：da5b2ac6aa8b4a8ec47175ae2d4e18b429838e76746bd83bddc6857992855958
- ../../qa/independent-residual-before.log：9fb22ad8bff8b8484c0b0c8837decea56d037ad79bccd5402316842736d5c7a2
- ../../qa/independent-residual.test.mjs：daa72a35e6827d0d059da2624459e045cf03b8eee0426316fb3b6999c4b5d51e
- ../../qa/independent-publisher-round.test.mjs：bf255153a238c24a0ab587b950422ce82438c514bcc50b28d4921aec99928ce7
- ../../INSTALLATION-PLAN.md：b080cbfcb1db477a3feda4ddb545dbae0331dc7fc1c20d7d5479c2fb5df2617a
- ../../maintenance.mjs：a46fbb491d631b084dfa74b9b8efd5e9db9bfdeac6a08d4f9d257da387b92847
- ../../manual-page-confirmation.json：75b8d3731a9a32de7728c7f5e83a6b37cf3b0f4d1899fffe501a3ebcacf9f1f8

未重跑整套历史回归，未相加不同套件中可能重复的测试。父执行者的自验结果与本报告的 14 项独立测试分开记录。QA 未做生产 POST、浏览器控制、正式源码/锁/业务库修改或计划任务操作；安装后 health、运行恢复及平台结果由后续实际证据验收。
