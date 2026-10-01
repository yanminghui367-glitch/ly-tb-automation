# N01 / B01 静态资源访问边界独立 QA

日期：2026-09-13。QA：本任务协作代理 `static_qa`，与实现代理分工复核；不是独立机构或人工平台审核。范围仅 B01。

**结论：PASS。当前版本静态文件白名单、路径隔离与必要资源兼容性通过独立合成 HTTP 复验，可关闭 B01；B02、B03、B04 不因此解除，LIVE 继续关闭。**

## 冻结对象与证据

| 对象 | SHA-256 |
| --- | --- |
| workbench/static-files.mjs | 993a228f25254d33dcf1f0e714cfe7c19d426d000cd7c66ebd35ebe377bd6db0 |
| workbench/server.mjs | 60d4c006796ca4a4b515a52f53eb61a0d30b56cdcaa56fdaa7db8616e4692fe3 |

代码审查包含 `index.html`、`app.js` 的资源/证据链接、服务端截图命名和静态路由调用，以及实现方 `workbench/scripts/static-files.test.mjs` 的 11 项用例源码。独立执行命令：

```powershell
node output/static-resource-20260913/qa/independent-check.mjs
```

命令退出码 0；29/29 个独立 HTTP 断言通过。准确时间、Node 版本、代码哈希、每个路径的预期/实际状态见 [independent-results.json](../output/static-resource-20260913/qa/independent-results.json)，可复验脚本见 [independent-check.mjs](../output/static-resource-20260913/qa/independent-check.mjs)。每次执行创建独立 synthetic 目录，全部文件为显式合成内容；证据不证明真实商品或平台截图已验收。

## 检查结果

| 检查 | 状态 | 依据 |
| --- | --- | --- |
| 必要公开资源集合 | PASS（代码审查） | 首页、JS、四份 CSS、favicon、空白商品包模板覆盖当前 HTML 本地引用；无任意目录或源码放行 |
| 基础 HTTP 行为 | PASS | 查询串、编码后的合法资源、HEAD、缺文件；OPTIONS/POST 返回 405；结果含 no-store/nosniff |
| 截图兼容性 | PASS | 实际格式映射截图名、含中文/空格的任务目录与字段截图，返回字节精确一致 |
| 路径绕过与私有文件 | PASS | 合成 .runtime 私有哨兵、点段、双编码、分隔符、ADS、尾空格、控制字符、无效 UTF-8、扩展名/层级不匹配均 404 |
| 符号链接与目录联接 | PASS | 独立验证截图文件 symlink，以及 tasks 和 mapping-evidence 中间目录 junction；结合实现方用例源码覆盖 output 顶层和任务目录联接 |
| 文件读取失败处理 | PASS（代码审查＋缺文件用例） | lstat、realpath、readFile 位于同一 try/catch，外部只返回通用 404，不回显路径或异常 |
| 真实运行队列与浏览器 | NOT_TESTED（本 QA 不接触） | 未读取实际 .runtime 数据/凭证，未请求 API，未启动或连接平台浏览器；队列哈希证明由总负责人证据负责 |
| 平台阶段放行 | BLOCKED | 会话身份、资料、真实 P4/P5 等原阻塞仍在，离线静态 QA 不形成发布许可 |

## 适用边界

1. 当前服务仅按既有设置绑定本地回环地址。白名单 PNG 证据对能够访问本地 HTTP 服务的客户端可读；本轮未增加用户认证或店铺级访问控制。
2. 本检查验证静态读取策略和现存链接，不验证 PNG 图像真实性、平台规格、供给或用户授权。
3. 校验与读取为多步文件系统操作；没有声称能抵抗拥有本机并发文件替换权限的攻击者，也未做并发文件替换竞态实验。
4. 增加公开资源、移动截图目录或修改上述代码后，需重新复核白名单兼容性与相关边界；不得把历史 PASS 自动用于新版本。

无发现需退回的 B01 范围阻断缺陷。下一步由总负责人更新 B01 状态，按现有任务顺序处理 B02。
