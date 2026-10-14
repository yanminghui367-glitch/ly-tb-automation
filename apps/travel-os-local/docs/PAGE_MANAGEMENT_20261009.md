# 执行浏览器页面管理｜2026-10-09

## 10:20 真实预算暂停及限定诊断恢复

拉辛 run `efee87dc-45dd-4ba9-b303-6c5aad63cada` 商品1091421636997于10:06:58核验出售中20/999999，10:07:07关闭检查返回PAGE_PROTECTION_UNKNOWN。与先前纳西克1090359669609合计两张保留，触发原预算，肯顿在run建立前停为SYSTEM_BLOCKED。正常保护生效，不能算肯顿商品失败。

当前原生CDP只读双向target关联检查显示两页均unpinned/inactive（26ms/20ms），但不能据此推断历史超时原因。原日志丢失细分原因，保留“根因未证实”。本次没有连接第二Playwright发布者、切换前台或读取凭证。

独立QA核对原session/window/key/taskHash/run/history/唯一click及后台截图；指定两页单次诊断脚本复核唯一成功ID、无未保存输入/人工验证、隐藏预取iframe，监听导航开始、同文档导航、导航完成与销毁，最终双次保护一致后仅关闭精确target。审查 `output/independent100-20261009/qa/retained-two-pages-cleanup-review.json`；脚本SHA256 `6c17e529c17cf1c31379d7a8f02b6218bb10cfac21551665853bba33e455145d`。

两次close命令均返回成功；第一次即时枚举仍包含第二个正在关闭的target，因此脚本最终断言失败。没有重复发送关闭。后续只读检查确认原16个page target仅移除这2个，余14个逐个保留；失败证据不抹除。`output/item-actions-r16/page-protection-recovery/cleanup-postcheck.json` 记录精确集合及live预算owned0/retained0/baseline14/faultnull。原两条retained行和事件保留，不改hold，不写自动close回执；这是人工式诊断清理，不是网站自动清理验收。

恢复前独立核对r21/PID37056、45源码hash、28内核、原授权/清单/第三窗/肯顿快照、零run/零提交及新鲜登录。`page-protection-recovery/resume-verdict.json` 放行绑定脚本一次原窗口恢复，10:20返回HTTP200并RUNNING。未重启或部署候选。下一步需补齐项目内部安全重查和诊断，避免依靠重复人工清理维持运行；本窗口不能称为独立100验收通过。

## 09:39 纳西克成功页保护状态未知：保留现场，补诊断候选

第三窗纳西克 run `85959c00-632c-4ace-894b-0357b2143078`，商品 `1090359669609` 已核验出售中、20/999999。09:22:05原 `VERIFIED_PAGE_CLEANUP` 返回 `closed:false / PAGE_PROTECTION_UNKNOWN`，所以当前会话保留该页；布莱尔港、沃思堡成功页已有关闭回执。此保留不能称为发布失败，也不能声称已清理。

原 `closeVerifiedOwnedPage` 将 `readPageProtection` 细分原因压成笼统代码。历史证据不能区分当时的超时、缺失信号或映射变化，**根因尚未查明**。只读记录 `output/item-actions-r16/retained-1791509821432.json`；未对执行浏览器再建发布连接、关闭页面或操作原任务。

独立单文件候选 `output/item-actions-r16/cleanup-diagnostic/publishing-pages.deploy.mjs` 仅为原关闭回执增加有限枚举 `protectionReason` 和 `first/final` 检查阶段。保留所有关闭判断、两次保护检查及次数，不增加重试、不把 unknown 放行；不记录URL、标题、原始错误或凭证。正式基线 SHA256 `382d323a3aad89a06f319c94c95749ca826d1cec3b18290334f484ccfc46621e`；候选 `08038408007fa9e2d53c020680e255cff78cb006f833f0d8d86697931a273ca7`。

作者7项针对性检查通过，包含首次/最终保护信号缺失、固定/活动标签、人工验证、异步导航与关闭失败。报告 `cleanup-diagnostic/targeted.log`。仅完成诊断候选，独立审查和正式部署未完成；不将其说成已解决底层保护读取失败。当前保留1页，原有限预算继续有效。

09:43独立审查通过7项：固定白名单不泄露合成敏感异常、final超时、固定/恢复现场、正常双采样，另9场景与原关闭判断一致。报告 `output/independent100-20261009/qa/cleanup-diagnostic-review-r1.json`，SHA256 `1290a61a3ddfdba8dcc11afcfa0cb9478fd44bda35f0b0bec8674aac62f2c982`。逆向去除诊断增量与正式源逐字节相同，45正式hash不变。细分信息将进入原 VERIFIED_PAGE_CLEANUP 事件，页面账本仍保留笼统保留原因。未部署，旧纳西克根因仍未证实。

## 范围与状态

在原SourceWorkflow/同一原生Chrome context内补页面归属、固定标签保护、预算和成功后清理。未增加发布者、改变商品、价格、库存或登录资料。r15已于01:58经独立审核与正常入口加载，真实100验收尚未进行。

## 已实现规则

- `page-ownership.mjs`：先持久化创建意图，再精确绑定CDP target。记录shop/run/task hash/父清单/执行窗口/用途；借用常驻页不取得关闭权。新增3张page_owner表，仅存归属及原因代码，不保存URL、网页正文或凭证。
- 原有页、手动页、重启恢复页不自动取得关闭权。历史数据库只能审计，不能在重启后认领旧页。
- `page-protection.mjs`：从当前原生context读取Chrome标签的tabPinned/tabActive元数据，精确父子target关联，不根据URL、标题或顺序猜测。缺失、超时、超过候选上限、关联变化或CDP失败都保留；固定页及当前活动页保留。
- 本会话自有页面上限6张（包括创建未确认的预留）；保留异常达到2张时不启动下一个新商品。提交已点击时仍核验原商品，禁止因页面台账故障重投。
- 只有本执行器新建的发布页，商品ID/后台结果/证据先落盘、身份及人工验证检查通过、双次固定/活动状态确认后才能关闭。关闭意图及一次性回执落盘失败会阻止后续发布。
- 商品已经VERIFIED但result.json写入失败，保留页面并记入异常预算；不把已经成功的商品降级为可重发。保留记录再写失败仍保持故障闭锁。
- 网站自动化任务页折叠显示总页数、自有数量/预算、保留原因；不增加“关闭所有页”按钮。

## 独立审查发现与修复

初候选被发现：父子target关联已失效仍可返回未固定、关闭回执失败后可重复使用、结果附件写入失败未计入保留预算。全部保留失败日志并修复；未通过扩大白名单或移除断言放行。正式回归包含`page-source-integration.test.mjs`的10个原工作流/真实SQLite故障场景。

## 已有验证与边界

- 页面管理原子/故障专项、Source真实接线、暂停边界、固定保护反例由独立QA复验。逐项结果在`output/independent100-20261009/qa/`。
- 隔离真实Chrome连续100次创建→本地成功页核对→关闭：最高自有1张、总页3张、结束总页2张；原手动/恢复页保留；100份关闭意图及回执对应。此处网页为本地测试路由，**不是100条淘宝发布验收**。
- 1440及390像素网站检查39/39通过：页面数量、原因显示、隐藏内部target ID、手机无整页横向溢出。截图见`output/page-management-r15/ui/09-page-budget-desktop.png`及`10-page-budget-mobile.png`。模拟状态不证明真实浏览器数量。
- Chrome157隔离固定/取消固定实验，以及36/64/65页候选上限检查通过；65页超限返回未知并保留。性能数字只属于本地轻量标签，不代表淘宝复杂页面。

限制：Chrome标签元数据并非跨版本承诺；未知版本或缺字段时保留而非猜测。最终状态读取与page.close不是浏览器原子操作，已做双次核对及导航监视，但不能声称消除了用户同一瞬间固定标签的全部竞态。原有大量恢复页保持保护，本模块不会批量清掉旧页。

## 回退与后续

先安全停止执行和旧服务，再恢复保全源码；不删除新增台账或原数据库，不重置任务和登录资料。后续还需网站固定清单单条动作闭环、真实100条及剩余700处理；本模块通过不代表整个目标完成。

## 01:58 部署证据

最终全量620/620、语法检查exit0；独立80项及UI39项通过。独立release绑定37个源文件/测试哈希。正常停服前确认原700暂停，无Source/Batch运行；双库真实SQLite备份通过integrity_check与21表逐行核对。

停服使用原owner生命周期，会正常关闭空闲专用Chrome并保留Profile，不是标签整理测试。先保存并禁用managed keepalive，失败不恢复；审核通过后正常入口启动PID31800→12044，r15内核27/27，21表全行/schema、原700与审核、设置及任务不变，jobs仅updatedAt正常24字节变化，随后恢复keepalive原字节。新增3张页面表在首次绑定真实context/任务时才创建，未通过部署伪造页面台账。

本次维护未启动商品任务。服务健康不单独证明执行Chrome已重新登录。证据目录`output/page-management-r15/`：`release-verdict.json`、`full-tests-final.log`、`activation-result.json`、前后完整快照及双库备份；运行证据不进入GitHub源码。
