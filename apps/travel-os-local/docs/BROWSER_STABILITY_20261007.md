# 上传期间页面稳定性修复（2026-10-07）

范围：用户反馈自动化上传频繁切换界面，担心验证和页面识别出错。本轮在已完成的100条首故障暂停版本上作增量修复，不执行真实上传、提交、重试，不更改旧任务快照和业务资料。

## 检查到的问题

- 每条任务开始会 `setViewportSize` 和 `bringToFront`；每张缺失素材上传结束又会 `bringToFront` 商品页。
- 素材页按完整 URL 匹配，跟踪参数不同便新开页；创建发布页、核验页用普通 `newPage`，也可能激活新标签。
- 既有定时登录检查没有主动切页。此前定位器大多已经绑定具体 Page，不能把“用户当前看到的标签”误认为程序正在操作的页面。
- 真实浏览器只读计数为35个页面，其中19个发布表单、12个素材页，见 `output/browser-stability-20261007/tabs-before.json`。保留历史表单、素材页及恢复证据，没有批量关页。
- 尚无证据证明切页就是淘宝验证码的触发原因，也不能承诺修复后不出现平台验证。

## 最小实现

| 文件 | 改动 |
| --- | --- |
| `workbench/publishing-pages.mjs` | 在现有 owner/context 内后台创建页面，使用 Chrome 返回的 targetId 精确绑定 Page；不支持或无法绑定就停止，不退回普通前台新页。素材、核验页按店铺/用途保持引用。 |
| `workbench/taobao-publisher.mjs` | 删除每任务/每素材自动聚焦、改尺寸；使用固定辅助页；上传和结果核验继续检查实际页面、店铺、验证码、真实字段与回执。 |
| `workbench/source-workflow.mjs` | 持续核对发布页标题与原任务，发现其他商品或清空标题时停止填写。原提交一次、未知结果只核验、断点规则保留。 |
| `workbench/result-reconciliation.mjs` | 人工关联原商品时复用相同核验页机制，不新增提交能力。 |
| `workbench/server.mjs` | 旧 DRY_RUN 路径删除一处自动聚焦；保留身份检查和用户主动打开 Chrome。 |
| `workbench/scripts/publishing-pages.test.mjs` / `publishing-pages-qa.mjs` | 页面绑定、角色复用、失败停止及独立有界面 Chrome 验证。 |
| `workbench/scripts/task-screenshot.test.mjs` / `product-api.test.mjs` | 将原模拟新页入口适配为后台目标创建；保留截图失败和旧证据不覆盖断言；新页面模块加入冻结校验。 |
| `workbench/package.json` | 增加专项检查命令与语法检查。 |

同用途旧页唯一时先验证后使用；有多个旧页时不猜测、不覆盖，后台建立一个本会话辅助页并持续复用。固定页被手工导航走会停止，不强制导航回来；被关闭后下一次请求重新创建并检查。新商品表单仍按原断点与标题恢复；不跨商品复用已填写表单。

旧15个冻结文件修改3个、增加1个，共16个。旧清单在 `docs/kernel-baselines/20261007-before-stable-pages.json`；候选版本 `20261007-stable-background-pages`。原100条上限、串行、首错即停、有限重试、防重及人工验证保持。

## 已执行的验证

- 定向回归54项通过；完整源码隔离副本248项通过，包含候选16文件冻结校验；语法检查通过。
- 独立有界面 Chrome 专项11项：后台开发布页及恢复、12次原生文件控件合成上传、100次不同跟踪参数素材页复用、结果核验与人工关联复用、错误店铺、验证码、辅助页导航/关闭、同标题表单冲突。
- 测试所有网络请求均由合成页面承接，不连接正式9222、不读取登录资料、不请求淘宝。12次上传仅写合成DOM，不是真实素材上传。
- 用 Windows 的 Chrome 主窗口标题确认当前选中标签，配合浏览器窗口尺寸前后对照。Playwright默认模拟页面焦点，各页 `visibilityState` 都可能为 visible，不能据此证明当前选中标签；早期探针发现后改用上述证据。未验证另一应用处于 Windows 前台时的完整焦点行为，不宣称系统级零抢焦点。
- 全量第一次在错误工作目录启动，18项资料测试找不到相对路径脚本；另1项旧截图模拟器仍使用已删除的改尺寸入口。已更正运行目录和模拟入口，原失败输出保留，最终248项全部通过；没有放宽测试断言。

证据：`output/browser-stability-20261007/{targeted-tests.txt,full-tests.txt,full-tests-initial.txt,syntax-check.txt}`、`output/playwright/browser-stability-20261007/result.json` 及同目录截图。

## 生效与独立审核

- 独立QA `/root/batch100_qa` 亲自复跑49项通过，核阅全量248项及有界面专项11项，验候选冻结16/16及测试副本/当前代码一致，批准本地代码与隔离验证范围进入空闲部署。没有平台发布放行或免验证码结论。
- 确认无运行任务后，经原有正常关闭/启动入口切换服务，PID 29760 → 34692，内核16项通过。首轮专用Chrome恢复旧页面超时：Playwright启动会等待所有恢复页初始化，12个素材页只读Runtime请求超时与此一致，但没有定位到具体阻塞协议命令。正常启动接口重试一次后恢复 `LOGGED_IN`；没有杀进程、删除旧标签、清理登录或修改浏览器启动规则。
- 部署前后15张业务表逐表记录数及内容SHA-256、执行设置SHA-256、旧任务SHA-256完全一致；`active=null`，原失败批次未重试、没有新增提交。正式服务源码与候选冻结一致，浏览器已连接、店铺已登录。
- 部署及保全证据：`output/browser-stability-20261007/deployment.json`、`live-before.json`、`live-after.json`。首次浏览器启动超时不是新页面机制运行失败（本轮未运行任务）；旧标签大量恢复的启动稳定性仍需继续观察，不能归为已根治。
- 部署后独立QA再次核阅保全与局域网证据、复算334个源文件SHA和16项冻结，确认已安装锁与候选一致、仅原3项变化和新增1项，给予本地代码及部署范围最终放行。没有新增阻塞；原真实平台和系统级焦点验证边界保持。

## 使用与边界

日常从工作台检查状态、核对批次后执行。程序按绑定页面操作，操作者看到的标签不决定程序的目标。不要在运行中的原商品页手工改标题、导航或替换素材；需要介入先暂停。验证码出现后通过“打开执行 Chrome”人工处理，再检查条件恢复，不绕过验证。

没有自动清理历史标签；本轮也没有验证100条真实平台连续发布。若平台页面限制后台上传/加载，会按原规则停止，而不是自动轮流激活页面重试。后台创建基于标准 [Chrome Target.createTarget](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createTarget) 与 [Playwright CDP session](https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session)。

回退时需先确认服务空闲、正常停止，再从本轮 `output/browser-stability-20261007/before-source/` 恢复对应源文件与原冻结清单一起重启；不可只换锁文件。运行数据、原任务和登录资料不参与回退。未同步 GitHub。
