# 资料设置四步流程：实施与验证

日期：2026-10-06。授权：用户确认“固定模板 → 统一导入与存储 → 收敛登录入口 → 新电脑四步引导”实施。范围为产品层配置和导入流程；本轮没有发布商品、创建生产任务、迁移生产图片或改变执行许可。

## 实现

- 固定模板 ZIP 含空白商品 Excel、图片目录与填写说明。两版标题、选择标题、实际店铺设置明确；没有伪造价格、类目或供给默认值。标准资料不再另外准备热度 Excel。
- 主机原路径引用、局域网客户端整目录上传共用一个识别入口。上传先明确磁盘目录；分次目录隔离，失败不覆盖有效设置或自动转存C盘。
- 资料设置按存放位置、导入资料、连接店铺、准备检查分为四步。顶部重复登录操作收敛为导航，设置内只有一个连接动作；结果与错误直接展示。
- 登录失效/服务断连时撤下“准备通过”与进入任务的快捷入口。属性读取人工验证暂停提示保留；执行许可与随机规则留在第4步的进阶区域。
- 旧 Excel 格式兼容，旧任务和素材不重写；新导入仍走现有快照、防重与恢复逻辑。新增店铺不因此被宣称可自动执行。

## 修改范围

| 层 | 文件 |
|---|---|
| 模板与新格式适配 | `workbench/setup-template.json`、`workbench/setup-adapter.py`、`workbench/templates/travel-os-template-v1.zip` |
| 产品接口 | `workbench/setup-flow.mjs`、`workbench/product-api.mjs`、`workbench/travel-os-api.mjs` |
| 页面 | `workbench/setup-ui.js`、`workbench/setup-ui.css`、`workbench/travel-os.js`、`workbench/travel-os.html`、`workbench/static-files.mjs` |
| 隔离验证 | `workbench/scripts/setup-fixture.py`、`setup-fixture.mjs`、`setup-flow.test.mjs`、`setup-ui-qa.mjs`；相邻 UI 测试入口随新导航更新 |
| 交付 | `workbench/package.json`、`.gitignore`模板例外、`SOURCE_MANIFEST.json`及本指南/现行状态 |

现有未提交改动保留。`kernel-lock.json` 的13项冻结文件本轮没有改动，没有重新设定冻结基线。

## 实际验证

- `npm test`：220/220，通过；其中新配置专项18项。
- `node scripts/setup-ui-qa.mjs`：17项隔离浏览器检查，脚本错误0；实际上传到唯一D盘测试目录，测试后只清理该目录；桌面与390px排版检查通过。
- 发布规则相邻界面22项、完整工作台旅程29项在隔离服务复验通过；证据在 `output/setup-20261006/adjacent-ui/`。测试使用独立 Chrome、合成登录和临时数据库。
- 独立 QA 退回后修复并复核：新模板混入旧随机素材、A→B→A 导入默认指向旧资料、副图B单独变化未进入新摘要、登录失效仍显示通过。独立结论为产品层通过，无未解决P1/P2阻断。
- 旧 `project-audit-qa.mjs` 是诊断历史缺陷的复现脚本：运行在“旧截图仍被沿用=true”的历史断言处失败，因为该缺陷已在前轮修复；不把该脚本计为通过的当前回归。现行截图恢复回归包含在完整220项测试中。

主要截图：`output/playwright/setup-20261006/01-storage.png`、`03-check-failed.png`、`04-ready-desktop.png`、`05-ready-mobile.png`、`07-import-desktop.png`。模板预览：`output/setup-20261006/template-preview.png`。

## 生效与边界

确认 active=null、数据库无执行中的批次/商品、旧队列无运行项后，通过原服务正常退出并启动新版，进程14708→23044。前后15张业务表、执行设置及旧任务摘要完全一致，原批次仍暂停，没有新增任务或发布。专用Chrome仍显示需要登录，与重启前一致；未读取或迁移凭证。

当前 `http://192.168.1.3:4318/travel-os.html#settings` 已在本机经局域网IP复验：15项只读浏览器检查通过，修改请求0，脚本错误0；页面脚本与本机审阅版本字节相同，模板实际下载与源文件相同。证据 `output/setup-20261006/live-before.json`、`live-after.json`、`live-ui.json`及 `live-import.png`、`live-connect.png`、`live-mobile.png`。本次IP与旧报告不同，因此不复用旧地址。

安装文件核验通过：322个代码/资源文件的SHA-256与清单一致，13/13冻结文件不变，Node.js/Python/Chrome及锁定依赖匹配。记录在 `output/setup-20261006/installation.log`，模板ZIP纳入源码清单和Git例外，不包含业务资料。第二台实体电脑、新店铺内核适配、新模板真实淘宝发布、长时间运行仍不属于已验收结果。没有推送 GitHub。

本次调整不会自动迁移已有图片。切换新资料后，若随机规则仍指向旧目录，新任务预览/创建会明确拒绝，需重新配置或停用新任务随机；旧任务仍使用原快照。

## 回退

不删除资料、快照或历史。页面仍提供旧 Excel 兼容导入；若需代码回退，恢复本轮产品层文件及配套源码清单为修改前匹配版本，空闲时正常重启。不要单独回退源码清单或更新冻结哈希来掩盖差异；新任务已引用的资料目录要保留。
