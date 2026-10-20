# 原批次实际上架采样｜2026-10-17

用户要求先沿原批次验证实际速度，再依结果优化。root 统一控制正式安装、重启和执行；复用原分析及独立 QA agent，没有新建 agent 或聊天。

当前：新增两条已在目标店铺后台核验为出售中；连续五条窗口因真实验证码未完成。素材细分计时仅在隔离副本开发，未加载正式网站，不能当作已实现的速度收益。

## 原范围及结果

- 店铺：环球领航 `shop-7949a469`。原700清单 `045fe9dc-b0fd-4101-998f-73ad1b75b99b`；manifest `4e71056effb75db1391db1f12a37a20523c61e367332302d6f2232aba9ee2a91`。
- 在同一原清单内依次限定1条、5条，均关闭自动衔接，没有重建商品包或700队列。五洲畅游仍有错店及待核验结果，本次未恢复。

| 原序号 | 商品 | 本次事实 | execute 单调耗时 | 淘宝商品 ID |
| --- | --- | --- | --- | --- |
| 6 | 美国 | 新增并核验出售中，差异为空 | 114.377秒 | 1090617055339 |
| 7 | 法国 | 新增并核验出售中，差异为空 | 108.455秒 | 1092617737626 |
| 8 | 俄罗斯 | 第2张主副图阶段验证码暂停，尚未提交 | 已执行片段27.889秒，非完整上架耗时 | 无 |
| 9—11 | 土耳其、韩国、意大利 | 未创建run、未执行 | 不计为0秒 | 无 |

首窗 `ccf2951d-151e-4397-b045-01223ecf4399` 已完成；五条窗 `9f456abf-6b01-4b96-a7e6-07e098e62635` 为 WAITING_HUMAN，保留俄罗斯原run `4a55e802-a923-4cf3-b304-8256b8bc6b78`，另三条仍待处理。已向用户请求在专用Chrome人工完成验证码；不代解、不跳过验证码继续其他商品、不重发两条成功商品。

两个完整成功attempt平均111.416秒；与旧审计相同的 RUNNING→VERIFIED 边界为114.185/108.224秒，平均111.2045秒。旧同店仅113.10/139.05秒两条，本次仍不足以证明稳定提速。程序执行耗时不含批次准备、人工等待和最终诊断文件全部写入，不能据此承诺每小时或700条持续吞吐。俄罗斯片段不混入成功耗时，导出状态complete仅表示证据采集齐全，不能表示五条窗口完成。

## 实际发现并修复的阻塞

旧日本已通过原接口人工跳过且未提交，原run为审计保留PAUSED_CAPTCHA。窗口停止、窗口预检和选择预检却仍将其作为现行验证码，导致原窗口无法封存。

仅对具备原round/window/key/taskHash/run绑定的已封存MANUAL_SKIP回执、匹配审计事件，且复用原全源检查确认未提交的历史记录排除此旧阻塞；保留原run、队列、次数、事件和跳过结果。当前验证码、错店、未知提交、返回ID、成功历史与attempt账本仍阻止继续。UNKNOWN判断优先于其他人工暂停。

3个运行文件及1个回归测试经root90项自验、既有独立QA126项复验通过后正常维护加载。正式PID58288，83项内核 `20261017-skipped-captcha-window` 一致。维护边界内9业务库逐表内容、8店原API任务/设置和2项实际设置文件严格保持，4项HTTP资源字节一致；随后才开始本次授权采样。原700任务/哈希始终保持，非采样694项和原5个run/事件、94个队列、既有attempts保留。

## 据实测继续推进的小模块

两成功条的首图阶段约15.317/14.872秒，均有真实上传工件；运费模板动作6.943/2.326秒不稳定，不能单凭第一条缩减等待。已选择一处被动素材细分计时：查找、缺图等待、素材库就绪、真实上传、上传取证、刷新、版本回执、选择面板和应用图片。复用E1内存计时并只写原attempt汇总，不新增DOM读取、截图或逐计时数据库事件，不变更guard、等待预算、素材版本及提交语义。

候选仅在 `output/listing-efficiency-sampling-20261017/dev/` 的source-workflow.mjs与taobao-publisher.mjs；相关121项回归及21项上传/控件自验已通过，独立QA112个不同用例通过并签署候选SHA，真实fillTask原/默认/计时轨迹和SourceWorkflow串接已核对。它增加诊断能力，尚无实际提速结论。新增子分类会将原action.selfMs重新归因，前后性能仍按完整elapsed或同口径事件比较，不能将action.self减少冒充提速。当前不重启网站打断验证码现场；人工处理后沿原窗口继续，并补齐剩余样本再决定素材检索或检查合并的具体改动。现场恢复准备脚本为本轮输出目录`resume-original-captcha.mjs`：仅在人工已处理且原生登录/验证码复核通过后，由root运行；固定原窗口、原俄罗斯run及原预算，不设置伪造的humanVerified标志，不自动重放不确定请求。

## 证据入口

`output/listing-efficiency-sampling-20261017/`：`sample-1/5-scope.json`、`sample-1/5-result.json`、`measure-1/5.json`、`collector.mjs`、`analysis-results.md`、`original-identities-verified.json`、`production-before/after.json`、`installed-files.json`、`installed-kernel.json`、`qa/independent-qa.md`、`qa/final-candidate-hashes.json`、`material-timing-candidate.json`、`qa/material-timing/independent-qa.md`及签署SHA、`acceptance.json`、`final-observation.json`和相关测试日志。官方结果及截图在各原run工件目录中。
