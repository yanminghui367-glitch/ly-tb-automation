# LY V2 发布引擎（P0）

独立命令行引擎，复用原项目的浏览器归属检查；不启动或修改工作台。Node.js 24+、Python 3.10+、Google Chrome、Playwright 1.62.1。部署时在本目录 `npm install`；本机复用已有依赖。本轮未安装或升级全局工具。

## 数据与执行边界

`adapter.py → PublishTask JSON → SQLite → runner → PublishPage → checkpoint / screenshot / result`

Excel只读。Python使用ZIP/XML标准库，保留物理行号、精确单元格、源文件及商品包SHA-256；只有适配层按热度排序。执行层不读热度、不生成文案、不计算价格。导购标题不充当第二个商品标题。无链接标题的行统计后排除，不自行生成。

按国家+城市匹配指定商品包；主图按“序号-城市-目的地”候选匹配。副图和详情严格采用商品包顺序，多套候选不擅选。源包与Excel标题不一致、主图缺失/歧义、选题/业务证据不足进入BLOCKED；原文件不改写。

## 1. 只读转换与导入

从项目根目录执行，替换实际路径和已确认店铺ID：

```powershell
python engine/v2/adapter.py --workbook "真实源.xlsx" --sheet "境外城市热度" --assets "素材目录" --packages "商品包目录" --shop "已确认店铺ID" --limit 1 --output "output/v2-prepared/tasks.json"
node engine/v2/cli.mjs import --tasks "output/v2-prepared/tasks.json" --db "output/v2-state/tasks.sqlite"
node engine/v2/cli.mjs status --db "output/v2-state/tasks.sqlite"
```

适配器拒绝覆盖已有输出。导入默认DRY_RUN，精确相同任务幂等；同店同目的地不同版本拒绝替换。修复BLOCKED资料后可重新生成新JSON并使用 `import ... --replace-blocked true`，旧版本成为SUPERSEDED，事件历史保留；执行中、成功和结果不明的任务不能借此替换。不要创建新数据库来规避去重；每店持续使用同一库。

## 2. 页面配置与执行

将 `profile.template.json`、`release.template.json` 复制到被Git忽略的 `output/v2-config/`，从当前真实卖家页填写并审核。模板故意不能执行，不内置猜测的淘宝定位器或旧价格库存。

页面配置集中管理定位器与逻辑，基本支持fill、原生select、文件upload及manual。每字段必须配置回读后置条件（value/text/uploadedNames）；图片上传核验平台回显的文件名和顺序，不以setInputFiles成功作为上传成功。iframe字段可设置 `frame` 选择器。自定义类目、素材库弹窗、富文本等不满足现有原语时暂设manual并校验结果；须基于真实页面再实现组件适配，不使用坐标或脚本点击绕过。

发布配置必须覆盖页面全部必填项；七个基础字段只是最低结构。`formErrors` 可绑定页面错误摘要。结果需同时满足成功状态、数字商品ID、匹配的商品链接和标题；真实结果链接限定为 `https://item.taobao.com/...?...id=...`。若平台提供不同结果结构，应先核验再局部扩展解析器。

release记录审核人与证据引用、店铺、任务完整hash、profile的hash、有效期及阶段准入。hash算法是 `contract.mjs` 中的canonical JSON SHA-256；CLI新增 `inspect` 可输出任务与配置hash。审核记录是操作者的可追溯声明，不是系统对供给真实性的证明。

操作者在专用Chrome手动登录。引擎只连接明确的本机端口，复用归属验证，不读取或导出Cookie/密码/配置内容；页面店铺名称必须与已审核配置匹配。仅保留一个对应卖家域名页面。

```powershell
node engine/v2/cli.mjs run --db "output/v2-state/tasks.sqlite" --id "任务ID" --profile "output/v2-config/profile.json" --release "output/v2-config/release.json"
```

默认DRY_RUN结束为DRY_RUN_COMPLETE，不提交。真实P4证据和P5放行齐备后，`authorize-live`（与run相同参数）把同一任务升级为LIVE，保留任务内容与表单checkpoint，再执行run。不能仅修改模板开关代替真实QA。真实发布尚未验收。

## 3. 暂停、重启与结果不明

```powershell
node engine/v2/cli.mjs recover --db "output/v2-state/tasks.sqlite"
node engine/v2/cli.mjs resume --db "output/v2-state/tasks.sqlite" --id "任务ID" --note "人工处理情况与证据位置"
```

recover持有数据库互斥锁后，将进程中断的RUNNING转为PAUSED_REVIEW，将SUBMITTING转为RESULT_UNKNOWN。确认旧进程确实退出才回收锁；跨主机锁不自动处理。验证码触发时落盘checkpoint、截图并输出提示，不发后续动作。当前已经发出的浏览器动作有超时上限并等其结束，不尝试绕过验证。人工完成后resume，再run同一ID；重新检查身份、源/素材hash、映射版本与所有字段，已正确回显的字段不重复填写。部分上传回显不符转人工处理，避免重复堆叠素材。

RESULT_UNKNOWN只能用 `reconcile`（与run相同参数）在当前真实结果页只读核验；禁止resume或自动重新点击发布。平台尚无明确结果则继续待核验。恢复总尝试上限3次，耗尽后先查原因，不自动无限循环。进程重启时不自动导航覆盖人工处理现场。

## 4. 批次与测试

`batch --db ... --ids ids.json --profile ... --release ...` 接受明确JSON任务ID数组，数量为1/5/20/50。真实多条批次还要求P5成功证据及批次QA。串行执行，任一暂停/失败停止整批并保存汇总；恢复后跳过库内成功项，保留待处理项。不自动扩大到700条。

```powershell
python engine/v2/tests/adapter_test.py
node --test engine/v2/tests/engine.test.mjs
node engine/v2/tests/stress.mjs "output/v2-stress-新目录"
```

测试打开本机合成卖家页并使用真实Chrome/Playwright；不会访问淘宝。压测报告区分LOCAL_FIXTURE与平台成绩，真实商品成功数量不能从测试PUBLISHED状态推导。SQLite使用WAL、FULL同步、事务事件和单进程执行锁；数据库文件在本机磁盘，不部署在共享盘上。运行数据、截图和会话不得提交Git。
