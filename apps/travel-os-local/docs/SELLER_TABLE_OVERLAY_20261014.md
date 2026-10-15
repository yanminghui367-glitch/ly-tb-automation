# 已上架商品核验被千牛介绍弹窗遮挡｜2026-10-14

用户报告名古屋链接已经上架，但网站反复“检查核验”仍停在待核验。此次范围为修复已提交商品的后台核验交互，并核验名古屋原商品；不重新发布、改价、改库存或更换商品资料。

## 真实原因

固定轮次 `d9a24f58-4df1-4af8-bdb4-671da2424bb5`、第四窗口 `7d842ec3-dee4-487f-a04a-213308c31e80` 中，名古屋市原 run 为 `92a60c7f-48e3-49f4-a51b-398f34914153`，稳定 key 为 `b4bc8fc89da66b9710a664c05be0b8f6692260597bc14384a7c9efaeb65b6390`。提交成功页及 checkpoint 已有商品 ID `1091957201598`，同时存在唯一 SUBMIT_CLICKED 和 SUBMIT_EVIDENCE，但尚无完整后台核验结果，因此保持 RESULT_UNKNOWN 是原安全保护。

核验日志明确显示：后台“搜索”按钮被 `.next-overlay-wrapper.opened` 中的 `.next-overlay-backdrop` 拦截，点击超时。只读原生 CDP 检查绑定的千牛核验页，截图确认是“SKU管理页重磅上线”介绍图片弹窗；原生按钮分别为 `关闭` 和 `立即体验，跳转SKU管理页`，不是验证码。商品 ID 筛选框已经填为上述原 ID，但搜索未完成。没有读取 Cookie、令牌或浏览器配置，没有连接第二 Playwright 发布者。

证据为 `output/nagoya-verification-20261014/live-overlay-909AFA0EB8A348FA21D28A93CE298164.json`、同名 PNG 及 `before-state.json`。检查了两张商品列表页，仅进行 DOM 和截图读取，未操作其他页面。

## 修复与检查

仅修改 `workbench/listing-verification.mjs` 的列表交互准备：在绑定列表控件、切换全部标签、输入筛选条件及原生搜索/分页动作之前检查遮挡；仅识别此次已观察的 SKU 介绍弹窗，通过唯一可见的原生“关闭”按钮正常点击关闭。不点击“立即体验”，不强制点击底层搜索。

识别要求包括：唯一遮挡层、dialog、精确的两个原生按钮标签及 Hotspot 类名前缀、按钮类型与可见性，没有表单、可编辑内容、链接、iframe 或额外操作。未知/多个弹窗保持原状并给出明确处理提示；关闭无响应只尝试一次并停止。关闭前后均复查专用页面、店铺身份及验证码。后台响应匹配、分页完整性、商品ID、标题、价格、库存和平台状态核验没有放宽。

当前执行者自验：42 项列表核验/响应诊断/轮次核验，46 项单条核验/源执行器恢复回归，23 项产品 API 回归通过，共111项。新增8项浏览器用例覆盖正常关闭、初次加载、输入时出现、未知/歧义/可编辑弹窗、验证码、身份变化、隐藏弹窗、关闭无响应；均使用模拟官方域名页面及临时数据，不能替代真实商品证据。完整语法检查及该修改文件单独语法检查通过。

日志：`verification-final-tests.log`、`recovery-regression.log`、`product-api-tests.log`、`syntax.log`，位于 `output/nagoya-verification-20261014/`。

## 安装与实际核验

经原维护接口备份两份业务 SQLite 并正常重载，PID33160，版本 `20261014-seller-table-overlay`，45/45 内核冻结通过，只更新上述一个内核文件；旧清单保存为 `docs/kernel-baselines/20261014-before-seller-table-overlay.json`。

维护比较发现29张表中27张完整哈希一致；原启动恢复机制修改了名古屋 round_item 的 reason、failure_stage、updated，并追加一个 RESULT_UNKNOWN 恢复事件。其状态、任务、次数、提交标志、清单、授权、窗口和统计未改变；原超时记录仍保存在 source run 及原事件中。已逐列核对并保留 `maintenance-compare.json` 与 `restart-recovery-diff.json`，不将该维护描述为29表完全不变。

通过原 `POST /api/v1/rounds/item-verify` 仅核验名古屋已有 ID，严格绑定原 round/window/key 与最新 revision。回执为 NEW_SUCCESS / VERIFIED，`submittedByThisAction=false`；官方后台读取的 ID1091957201598、冻结标题、价格20、库存999999及“出售中”状态均一致，完整原生列表响应和核验截图已保存。

核验后本轮新增核验82→83、待核验1→0、已结束88/100→89/100；总新增核验387→388。名古屋原run转换为 VERIFIED，提交意图、点击和成功页证据计数仍各为1，没有再次提交。证据为 `verify-request.json`、`verify-receipt.json`、`after-verify.json`、`no-repeat-submit.json`；平台截图位于回执中的 `verified-in-list.png`。

随后沿已授权原轮次/第四窗口恢复剩余任务，接口接受 RUNNING 并切换到圣保罗，已记录 `resume-request.json` 与 `resume-accepted.json`。圣保罗后来在 main-image-1 阶段因“上传文件”按钮数量为0暂停，尚未提交；这是独立的上传控件问题，本次未修复、未替操作者跳过，不能宣称整个轮次持续无故障或700条已完成。

最后只读局域网页检查无脚本错误、无失败资源、零写请求；名古屋仍为成功，当前网站显示圣保罗的独立暂停。最新现场及页面证据为 `live-website/` 和 `final-live-state.json`。
