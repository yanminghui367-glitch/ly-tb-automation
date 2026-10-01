# N01｜静态资源访问边界修复

日期：2026-09-13。范围：B01 / N01，仅修复静态 HTTP 文件读取；没有变更业务字段、发布门槛、队列、会话身份或最终提交能力。

## 问题与修复

旧 `serveFile` 允许读取工作台根目录下任何已知普通文件，使用字符串前缀判断边界，没有区分前端资源、源码和 `.runtime`。本轮先把原策略抽取到可注入临时根目录的模块，使用合成文件复现，再替换读取策略。

- 新模块 [static-files.mjs](../workbench/static-files.mjs) 只允许首页、前端 JS/CSS/图标、商品包模板八个固定文件，以及 `output/tasks/<任务>/<文件>.png`、`output/mapping-evidence/<文件>.png` 两类截图。
- 原始请求路径在 URL 点段规范化前检查；拒绝目录穿越、重复或编码分隔符、反斜杠、Windows数据流冒号、异常转义及二次编码。保留正常查询参数和中文截图文件名。
- 逐层 `lstat` 拒绝符号链接和Windows目录联接，再用 `realpath` 与相对路径核对实际目标；文件缺失、目录伪装成文件或不可读取时返回统一404，不输出本机路径。
- 静态请求只接受GET/HEAD，其它方法405；截图为image/png，响应带no-store和nosniff。通用历史output目录不再公开，审核人员仍可从本机文件打开历史证据。
- 服务端以await调用新模块，让异步异常进入原路由处理链。导出已有HTTP server供测试绑定随机本机端口；没有新增生产API或启动权限。

## 验证

测试 [static-files.test.mjs](../workbench/scripts/static-files.test.mjs) 使用操作系统临时目录，`.runtime`及“私有数据”均为测试哨兵。符号链接和Windows目录联接测试实际执行，未跳过；清理只针对本次创建并校验过路径的临时目录。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原策略首批回归 | 9项中2通过、7失败，复现私有文件和链接暴露等缺口 | [before-tests.log](../output/static-resource-20260913/before-tests.log) |
| 新策略首批验证 | 9/9通过 | [after-tests.log](../output/static-resource-20260913/after-tests.log) |
| 完整联合回归 | 11项静态 + 16项映射引擎 + 7项商品包，共34/34通过 | [regression.log](../output/static-resource-20260913/regression.log) |
| 语法 | 服务端、前端及新模块通过 | [syntax.log](../output/static-resource-20260913/syntax.log) |
| 运行队列 | jobs.json测试前后SHA-256相同 | [verification.json](../output/static-resource-20260913/verification.json) |

实际server集成用例只请求首页、前端脚本、模板和源码拒绝路径，不调用生产 `/api`、读取生产浏览器配置、启动Chrome或访问淘宝。页面引用的全部本地资源已用HTTP验证；没有以此声称完整浏览器界面或平台验收通过。

复跑命令（根目录，使用新日志目录保留历史）：

```powershell
npm --prefix workbench run check
npm --prefix workbench run test:static
node --test workbench/scripts/static-files.test.mjs workbench/scripts/engine-mapping.test.mjs tools/generate_review_packages.test.mjs
```

## 独立复验与限制

独立QA由本任务另一协作代理执行，结论及覆盖范围见 [QA报告](STATIC_RESOURCE_QA_2026-09-13.md)。制作者的34项测试不替代独立复验。

本修复针对静态HTTP入口的文件选择与链接边界，不是操作系统隔离或对具有本机文件写权限的并发恶意进程的防护。API访问、CDP归属、真实店铺身份和发布准入仍是各自模块，不能因B01修复而认为全系统安全或LIVE可用。

下一模块：N02会话归属和店铺身份核验，仍需单独实现与验证。
