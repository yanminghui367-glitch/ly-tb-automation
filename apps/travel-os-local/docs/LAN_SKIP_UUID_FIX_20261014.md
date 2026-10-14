# 2026-10-14 局域网跳过按钮UUID兼容修复

用户点击“跳过此条”出现`crypto.randomUUID is not a function`。这是操作请求编号生成失败，发生在保存跳过请求和发送POST之前；与此前历史查重证据误判不同。

## 原因和改动

通过局域网HTTP地址访问时，当前Chrome页面isSecureContext=false，crypto.randomUUID未提供，但crypto.getRandomValues可用。前一轮只在localhost验证了点击链路，漏掉了实际局域网环境。

`workbench/task-view-model.mjs`已有支持局域网的requestId：支持randomUUID时使用该方法，否则以getRandomValues生成符合UUID v4格式的编号。本轮在`round-item-detail.js`导入并复用该方法，替换本轮跳过控制器和单条详情控制器的两个默认生成器，保留请求编号冻结、响应丢失重放、提交证据与人工验证保护。

测试脚本`round-current-skip-ui-qa.mjs`、`round-item-retry-ui-qa.mjs`支持绑定实际局域网地址；正式只读检查脚本支持指定局域网网站地址，保留旧输出目录与验收记录。

## 验证

- 使用192.168.1.3的随机本地测试端口，在修复前复现与用户截图完全相同的报错。原始失败记录保留在`output/lan-skip-uuid-20261014/before-lan/`。
- 修复后在同样的非安全HTTP环境中，20/20项本轮跳过网页检查、21/21项详情操作网页检查通过，包括实际POST到临时ProductApi、UUID v4格式、回执丢失后刷新核对及原请求重放。
- 19/19项跳过与视图模型检查通过；其中现有UUID测试验证缺少randomUUID时生成100个不同的合法v4编号。修改脚本语法通过。
- 正式`http://192.168.1.3:4318`只读核对：新脚本HTTP200且与磁盘SHA256相同；两个入口均使用兼容生成器，无直接randomUUID调用。页面无脚本错误或资源失败，检查浏览器未发送写请求。

均为当前执行者自验；隔离测试使用临时SQLite和合成执行器，不是淘宝发布验收。

## 生效与真实轮次边界

前端静态脚本直接由网站读取，本任务未重启服务或执行浏览器，未点击正式跳过、恢复或提交。冻结清单保留后台版本`20261014-candidate-skip-fix`，仅登记uiRevision=`20261014-lan-skip-uuid`与详情模块的新哈希；45/45校验通过。

00:34只读核对时，实际威尼斯已经存在00:23生成的MANUAL_SKIP记录，状态为MANUAL_SKIPPED，人工跳过数3；该真实操作不由本次前端修复执行。当前轮次仍SYSTEM_BLOCKED/inactive，哈肯萨克另有WAITING_HUMAN/PAUSED_CAPTCHA记录待处理。已跳过的威尼斯不再提供重复跳过按钮，当前商品名称仍可作为最近处理记录保留。

操作建议：Ctrl+F5强制刷新，查看最新“已手动跳过”状态；后续尚未提交商品的按钮可使用兼容编号。是否继续本轮仍按原人工处理与恢复条件判断，不把生成编号修复当作通过验证或已恢复任务。

源码备份、修复前复现、修复后两组局域网验证及正式只读证据保存在`output/lan-skip-uuid-20261014/`；旧冻结清单保存在`docs/kernel-baselines/20261014-before-lan-skip-uuid.json`。
