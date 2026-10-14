# 亚洛瓦库存稳定检查｜2026-10-09

## 实际故障与边界

07:04 原700轮次 `d9a24f58-4df1-4af8-bdb4-671da2424bb5` 的第二100窗在原位置495亚洛瓦暂停。run `e535d314-46fb-46ed-8331-9c7bec2fb7ca`，原task hash `a0a50669dfe7385291309b0f5e8ce821e01f1688e5b42631624ad243c5a989c5`。步骤 inventory 耗时9999ms；报错期望值/最后读取值均999999，未进入提交、未取得商品ID。此时窗口61新增核验、18提交前隔离、21未完。

07:09 对原保留页面只读检查：店铺五洲畅游、原亚洛瓦标题、价格20；库存8次采样均999999且唯一可编辑，未发现可见验证文本。3次原浏览器状态GET耗时873/172/1727ms。未改页面、未重填、未点击提交。截图和结构化字段见 `output/item-actions-r16/inventory-timing/retained.png`、`inspection.json`。

这些是暂停后观测，不是故障时逐次guard耗时；不能据此断言当时库存从未短暂回滚。

## 确认的代码缺陷与候选

原 `fillStableInventory` 在第一次完整guard之前建立2000ms期限，但第一次读取正确值后才建立500ms稳定计时。完整guard包含当前登录、页面风险、店铺及标题核查；若第一次guard耗尽观察期限，每轮只有一个正确样本，仍报UNSTABLE。独立精确函数虚拟时钟反例和作者独立Chrome测试均复现。

最小候选把观察期限移到第一次受guard保护的实际采样后建立。后续采样仍逐次执行guard，仍须正确值跨越稳定窗口；不增加固定timeout，不改变库存业务值、500ms默认阈值、最多2次原值填写及后续提交前完整核对。独立审核另发现继承的I-T1：末次guard期间控件禁用或只读仍可返回正确值。已补每次guard后唯一控件和可编辑校验，不接受失效控件。

候选仅涉及 `workbench/taobao-publisher.mjs`，另补 `workbench/scripts/inventory-timing.test.mjs` 定向回归。保持其他候选（单条核验HTTP/UI）未部署。

## 当前验证

- 作者最终独立Chrome 8/8：旧函数复现、慢guard正确值、慢guard回滚、终次风险/身份/暂停、默认500ms观察、错误值最多两次填写、末次禁用/只读、重复控件。`author-tests-final.log`。其中旧版复现1项仅在诊断脚本，正式保留7组回归。
- 首次作者测试有fixture计数未重置和测试timeout等于轮询间隔两处问题，失败日志保留；修正测试后重跑，不改断言掩盖失败。
- 独立初审确认原run无提交且原task不变；`output/independent100-20261009/qa/yalova-inventory-initial-review.json`。
- 独立10/10通过；原失败10项中8过2失败的记录保留，不放宽原断言。`output/independent100-20261009/qa/inventory-timing-review-r2.json`，SHA256 `9e1a64d6b77ddecf01d3b9f183ceb49ee2998e62ea943c21852c87522b5d2c48`。
- 07:17 待部署r20正式全量676/676、语法通过，见 `output/item-actions-r16/inventory-timing/test-result.json`、`full-tests-final.log`。测试与独立定向检查存在重叠，不累计为唯一数量。
- 独立release通过后07:18正常加载r20/PID20036，28项内核通过。双库备份检查通过，重启前后24表全部行及schema、设置、旧任务一致；jobs仅原正常shutdown的唯一updatedAt时间戳变化，已逐字节验证，其余原样。保活配置原字节恢复。`activation-result.json`及独立 `qa/r20-activation-preservation-independent.json`。
- 首次自动Chrome初始化180秒超时，原PID24756随后由Playwright清理，服务保持原断点；没有因为观察等待超时而另启。确认原PID与9222端点均已退出后，只通过原 `/api/chrome/launch` 有限重试一次，07:22:06返回200且原五洲畅游LOGGED_IN。`browser-retry-intent.json`、`browser-retry-result.json`；此为恢复事实，不证明原启动超时根因已修复。
- 07:22:18原恢复预检通过，仍未提交；恢复请求及平台结果单独记录，不能把启动或预检通过当上架成功。

修复后仍从原任务、原轮次恢复。此次100窗继续计为诊断运行，不作为独立100条验收。

## 原任务实际恢复结果

07:24:16一次原 `/api/v1/rounds/resume` 接受，requestId `9b083dcc-32a3-4224-b273-e246efef41b6`，独立许可绑定原run、窗口、r20/PID20036及恢复脚本。执行前再次检查fresh登录、原task/hash、无提交和44项源码，无其他任务控制请求。

网站重做查重后，07:27:28库存STEP_VERIFIED，耗时6001ms。随后自行完成后续填写、唯一一次最终提交与结果核验，商品 **1090342989298**、出售中、价格20/库存999999。原run/key/task/hash不变，原尝试1→2、extra0；原失败与全部部署前run事件逐行保留，run/父项/队列/历史/结果文件一致。根检查器首次对比SQLite无原型对象与JSON普通对象报类型差异，修正为同字段对象后逐字段严格复核通过，未修改数据或删断言。

恢复页是重启还原的原页面，cleanup明确 `closed:false / UNVERIFIED_OR_RESTORED_PAGE`；没有关闭回执，不能称“自动关页成功”。新建成功页的原归属清理规则保持。

保存截图已目视核对店铺、标题、商品ID、状态、20/999999、源主图与平台缩略图；表单可见5张主副图、8张详情。素材逐项顺序/源hash另由回执检查，截图不等于远端图片字节核验。`recovered-result.json`、`visual-review.json`。

07:29网站自动进入北九州市，本100窗62新增核验/18隔离/20未完；原700为69历史核验、193新增核验、109预检跳过、126待核验/隔离、1待人工、202待处理。完整独立100、原700一轮以及单条操作集成仍未完成，未同步GitHub。

最终独立QA通过：`output/independent100-20261009/qa/yalova-recovered-independent.json`，SHA256 `8400f75c0e8009ef9735f7f16372c936dd753b67bfeee6e52eed81529a15e7b5`。独立核对13份素材源hash/对象/顺序、5+8回执、唯一提交意图/点击/回执及历史保全，并目视三份保存图片。只放行本条诊断结果，不作为完整100验收。
