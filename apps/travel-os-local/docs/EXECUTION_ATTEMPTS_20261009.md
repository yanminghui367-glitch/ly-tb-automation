# 实际处理尝试与记录恢复候选｜2026-10-09

## 11:15 正式安装、原任务恢复与实际响应失败

本模块已经上线；以下10:52及更早“未部署”描述各自当时状态。最终程序版本 `20261009-execution-attempts`，PID24352，37项内核。原r21/PID37056已正常退出，未并行启动发布者。

维护证据目录：`output/item-actions-r16/attempt-candidate/execution-maintenance-r22/`。`procedure-review.json`批准原网站pause与备份；`activation-review.json`绑定脚本、专用snapshot工具、47项overlay与实际暂停快照，批准正常安装。安装后独立报告 `output/independent100-20261009/qa/execution-activation-result-independent.json` SHA256 `0dbefb0f04fb3b745feec21f64e86e1fba58b15f2ab3a4a3853d124a3a216b8c` 确认24旧表全行/schema对象保持，仅增加9个attempt对象且初始为空，37内核及84源hash吻合，jobs唯一updatedAt字节变化，保活设置原字节恢复。原数据库没有恢复覆盖或重置。

维护检查本身修复两项问题：旧计数校验不接受新增MANUAL_SKIPPED:0；旧table-only schema不能发现索引/触发器丢失。新工具只允许旧API零手动跳过缺省，其他计数精确对账；对照sqlite_master完整对象，并要求新对象等同已审RoundItemAttempts内存构造。原失败复现3项、新反例11项和语法检查保留于独立QA目录。没有据此更改任务计数或放宽非零差异。

原浏览器通过正常网站入口启动并核验LOGGED_IN；旧页面历史不赋予新context关闭权限。`resume-review.json` SHA256 `a15e38e9404fc5616c8bfe1e22500dba45f2d1e333ed27f2b31bec2e1066128d`批准一次原范围恢复；11:13:13请求 `56185738-36df-4f51-b556-027ad6d23743` 成功接受。新RESUME关联原韦拉克鲁斯run `40faca1c-a349-4c61-8eb9-9ae5251db6f0`，未另建run，旧快照和队列保持。

11:13:24后台完整库存查询外层ret失败，HTTP200、unknownRetCount1、result缺失，原run仍PAUSED/select-detail-1、0提交。新记录已封存，系统SYSTEM_BLOCKED，其余167项待处理，第三窗13/2/85。此证据证明恢复尝试记录实际落盘，不证明该商品发布成功。原生查询诊断进行中，具体返回原因尚未知。

真实LAN只读截图：`output/playwright/practice100-live-1791515499743/running-round.png`（安装后暂停状态）；`output/playwright/installed-item-detail-1791515696195/detail.png`（实际失败详情/处理记录1条）。均独立Chrome、仅GET、0页面异常/写请求。首版截图断言误写“处理尝试”而实际文案为“处理记录”，仅修正观察脚本，不改网页或业务判断。

本轮属于实际进展（正式安装、迁移验收、新记录真实使用及暴露具体响应问题）；前一用户状态答复只核对运行，不算额外实现进展。未通过独立100，完整单条人工重试及Codex断开仍未完成。

## 10:52 EA10修复、独立候选准入与整合清单

独立真实网页复验发现EA10：验证码发生在建立run/queue之前，补存记录回到WAITING_HUMAN后，即使人工确认，旧ensureQueue仍只接收PENDING，executeItem无队列直接return，导致反复建立空尝试。隔离旧现场保留1 INITIAL和358 RESUME、0 runs；该异常只在测试数据发生，未触碰正式任务。失败证据 `output/independent100-20261009/qa/ea10-no-run-failure.json` 及其 `addendum` 说明旧/修复版本hash。

修复只针对显式humanVerified、原窗口内、无run/无queue且非内容隔离的原WAITING_HUMAN项：持有原执行锁，核对完整提交证据、内容及文件，异步检查后再次比较原记录版本，事务转为PENDING；隐含提交、内容待确认或记录变化均不放行。无队列且仍非终态时改为明确SYSTEM_BLOCKED，禁止空转。原任务、快照、尝试与已有结果不改写。

EA10后 `execution-full-r5.log` 864/864，`execution-syntax-r5.log` exit0，进程回执 `execution-r5-exit.json`。新增6项反例修前4失败、修后6通过；独立核心与真实server派发22通过；有run/无run人工恢复两场隔离真实Chrome各16检查通过。检查数存在重叠，不累加。所有测试只使用隔离执行器，不能代替淘宝结果。

独立最终准入 `output/independent100-20261009/qa/execution-attempts-final-review-r4.json`，SHA256 `15d02adbb95bd98dcb33c66c6b567c797555e244d1f8b72fdf568e6b87101c51`：candidateAccepted=true，productionDeploymentApproved=false。18项本模块清单/37内核与45正式r21文件hash一致。

历史维护备份副本迁移 `output/item-actions-r16/attempt-candidate/execution-attempts-1791510480902/migration-1791513821858/report.json`：20旧表逐行及schema保留，仅新增空attempt表及其索引/触发器；重复构造幂等，零网络调用。此证据是历史暂停快照，仍需实际维护时对当前库再备份和核对。

整合清单 `output/item-actions-r16/attempt-candidate/execution-overlay-1791514275216/overlay.json` 包含23程序/界面文件、20新增测试、4份内核历史，涵盖此前已审的详情/跳过/核验/候选证据及本轮记录恢复。after与候选逐字节一致，before保存原文件；测试SQLite、运行输出、Profile和凭证排除。第一次准备因product-state原hash依据不在旧45清单而拒绝，核实候选创建前baseline与当前正式文件同为60850cb0…后补齐证据，未绕过漂移校验。清单仍只用于维护准备，尚未停服、覆盖正式文件或恢复发布。

下一步在独立整合及部署审核后准备一次安全维护；保留现有真实运行，不能把候选准入当作上线完成。单条人工重试、独立100和完整700仍未完成。

以下保留前轮证据及原失败，不倒改历史结论。

## 10:34 回归失败分类及修正

上一轮20失败中，product API两项确为运行时缺陷：blocked为null且未传id时，`b?.roundId===id`两边均undefined误入恢复分支。现先要求b存在，新增无ID及其他轮次的回归检查；未更改恢复权限或发布逻辑。

其余18项：17项手工跳过与1项V4核验重启测试在暂停后仍假定无INITIAL记录。保留自动生成的原段，注入后继段时准确指定RESUME/VERIFY_ONLY及父ID，恢复/失败后的零增量用完整账本deepEqual。原业务拒绝、事务回滚和不新增提交断言保持，未删旧记录或降低安全条件。独立修复报告 `output/independent100-20261009/qa/execution-skip-fixture-repair-review.json`，三组33/33、额外空值及V4两项2/2；完整差异 `execution-skip-fixtures-repair.diff` 同目录。

候选 `execution-targeted-r4.log` 40/40；`execution-full-r4.log` 858/858，exit0；`execution-syntax-r4.log` exit0。这些日志在本页下述隔离project根目录。候选manifest现在包括17文件、37内核项。该结果修复了上轮完整回归阻塞，但不代表已经部署、已通过真实100或人工分支浏览器验收。正式45源哈希未改，r21继续推进第三窗口。

以下为前轮保留记录，原失败日志不覆盖。

## 当前边界

本模块仍在 `output/item-actions-r16/attempt-candidate/execution-attempts-1791510480902/project` 隔离副本，未部署。正式服务仍为 r21/PID37056，45源文件未变。单条人工重试尚未实现；这里先记录原执行器每次实际处理，不另建队列或发布者。

新段区分 INITIAL、同一次运行内的 AUTO_RETRY、操作者或中断后的 RESUME。每段绑定原任务、窗口、店铺、快照和 run；失败/暂停段封存后，新段关联旧段，旧记录不覆盖。旧历史不倒造为新尝试。

## 本轮修复

- 记录写入、原 run 关联或结果投影失败时保留原执行锁，不能继续下一商品。
- 补存前按原身份严格对账。已核验成功的原 run 不重发，未完成投影不能作为普通 PENDING 完成封存。
- 停止意图保留到原窗口收口；明确预检并创建的新窗口才解除已完成旧停止，不把旧停止套到新窗口。
- 当前段的物理提交与观察到提交证据分别记录；自动重试来源不跨越暂停、停止和新一次启动。
- 实际 server 派发只允许已结束执行且存在原记录恢复标识的窄恢复请求通过 active 闸门；网络、Origin、互斥、店铺移除、权限及原范围验证仍保留。
- 恢复记录接口只补存原记录。状态及请求回执在同一事务提交，失败保持原锁；成功后由现有“检查并继续本轮”明确续跑，已停止时不续跑。
- 原验证码/人工处理、结果未知语义在补存后保留。网页不再把保留记录锁误显示为持续执行。

## 证据与未通过项

独立局部审核 `output/independent100-20261009/qa/execution-attempts-review-r3.json`：16核心反例及6个真实 server 派发场景，22/22通过。EA1—EA9均保留原失败和修复证据。此结论不是完整候选放行。

作者 HTTP/核心12项通过；隔离真实浏览器 `output/playwright/execution-attempts-resume-r3` 与 `execution-attempts-stop-r3` 各12检查通过，使用真实网页/API和模拟执行器，外部流量阻断。它们不证明淘宝发布，也未覆盖后续EA9人工分支的浏览器操作。

完整回归 `execution-full-r3.log`（EA9修复前版本）857项中837通过、20失败。多数旧 skip 测试夹具在暂停后假定没有处理段；新的真实段记录使其前提失效。但另有 product API 两项、核验恢复V4及其余断言仍须逐项查清，不能统称测试过时或直接更新期望。完整回归未通过，候选不得上线。

候选清单 `candidate.json` 已刷新EA9源哈希；37项内核清单及13文件变更清单只标识候选，不作为上线批准。下一步先保持真实队列推进，再解决上述回归与单条重试接入。
