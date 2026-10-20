# Step 1 候选独立 QA

**PASS：仅通过 Step 1 代码候选与隔离证据审查，不允许据此安装生产或重试商品。** 用户范围中的 §2.5 冷备份已独立核对；Step 2、尝试额度、轮次、提交行为及新增错误码不在本次变更中。真实淘宝序号 12 未由本 QA 复跑，不能据此宣称线上故障已解决。

复核者：`/root/step05_runbook_qa`；日期：2026-10-18。允许写入仅为本地 `output/step1-detail-ready-20261018/qa/`。本 QA 未改候选运行源码、正式源码、正式锁或业务数据库，未操作浏览器、调用生产 POST、安装或重启。

## 最终候选绑定

- manifest：`candidate/candidate-manifest.json`
- SHA-256：`9f547eeff65cbb46275098e3d57bff726d1288b7e3773daa4a9422171c1d1820`
- 候选 revision：`20261018-step1-detail-ready-r1`
- 正式原 revision：`20261017-single-item-direct-retry3`
- 候选锁 SHA-256：`17188e2e59a5bb791bef86ee12b8f32d62aaaeee0f582af7fe8fcc71f238e26a`

| 唯一允许变更的运行文件 | 基线 SHA-256 | 候选 SHA-256 |
|---|---|---|
| `workbench/taobao-publisher.mjs` | `20d575d7c119b91529d2d54af0295c3f707ccda873b4745d88aba84cdd335565` | `4abcb31f391e95a13355f97c1a023a52ca3c8abaad6065d87ec51e3db9e618ea` |
| `workbench/publishing-materials.mjs` | `a786dde96a3fba43858650d252498224d44a5718ed0455c80e0defd61799f5c3` | `735f652636ee65d200ab3b0528b25b468885cd751ee63213b56241f5c2971dc7` |

已逐项验证 manifest 的 2 个运行文件与全部 18 个附属证据哈希。候选包与 dev 中两源码字节一致；dev 中 382 项源码对照冷备，只有这两项不同。候选锁保留完整 84 项、只修改对应 2 个哈希、revision 和新 review，原元数据保留。QA 独立调用实际 `verifyKernel`，候选目录返回 `ok=true, files=84, changed=[]`。

## 独立验证与采用的执行者证据

QA 在最终冻结源码上独立运行 `qa/readiness-edge.test.mjs`：**5 项通过，0 失败、0 跳过**。测试文件本身在冻结后未修改，其哈希与 manifest 归档副本相同。

验证了：超过声明截止时间才返回的 ready 不被接受；验证码 guard 的原错误对象直接传播且不继续观察；诊断保存错误不替换主要 SYSTEM 超时；零宽、零高、未完成解码及无图片来源均不通过；正常可见并解码的图片通过且观察器不操作点击或上传。日志为 `qa/readiness-edge-final.log`，SHA-256 `6f7d23105f9f5404da83b54f62a53df66e883ba7645c52e0017e389fbdf7f96c`。

另审阅执行者证据，未将其冒称 QA 独立实跑，也未将重叠测试累加：

- `final-regression.log`：78 项通过，为最后一处 iframe 截止补丁前的综合回归。
- `final-deadline-regression.log`：最终候选相关的 17 项通过，包含 iframe 迟到就绪拒绝测试。
- `existing-regression-r2.log`：55 项既有路径回归通过。
- `isolated-reproduction.json`：使用原序号 12 图片字节并注入延迟的本地复现。原入口断言约 5.05 秒失败，新入口观察约 6.51 秒成功；这是合成场景对比，不能证明历史淘宝页面实际延迟相同。

未复跑整套浏览器测试，未启动任何浏览器或业务库。

## 代码范围与行为判断

1. 详情分支分别等待官方面板/iframe、上传入口、上传回执、可见且真实解码的缩略图。图片必须 `complete=true`、`naturalWidth>0`、`naturalHeight>0` 且有来源，不以节点存在替代图片就绪。
2. 入口 20 秒、上传面板 8 秒、单张回执 60 秒、缩略图 30 秒；iframe 保留 20 秒默认及 30 秒入参上限。观察器与 iframe 成功返回前均检查截止时间。guard 和截图取证本身有耗时，因此这些是就绪判断预算，不能宣传为整个商品严格在该秒数内返回。
3. 未引入 `SAFE_RETRY_*` 或其他新 error.code，也未修改分类器。新增就绪超时仍按现行 SYSTEM 处理；验证码、身份和原有页面来源/唯一性检查保留。没有把超时转换为自动重试额度或自动继续轮次。
4. 主图仍走原有默认上传分支；详情在原有“未选文件前最多一次重开面板”边界内等待。没有重试原生上传、修改最终提交逻辑或重写尝试账本。
5. 错误具有阶段、选择器、预期、实际状态、耗时/预算及结构化 DOM 证据；DOM 来源于真实节点结构的截断脱敏克隆，不含文本、URL、表单值。无法取得时可为 null，不伪造页面片段。
6. 素材库阶段失败使用 library 页面截图，结果回填 `materialReadiness` 并写入上传 checkpoint；详情面板/缩略图失败使用发布页。诊断和截图失败不覆盖主要业务错误。现有 ExecutionSteps 留痕继续复用，未改该文件或 source-workflow。
7. 未修改 attempts、max_attempts、轮次状态语义、验证码/未知结果保护、提交代码或商品内容。

## 初审问题的关闭情况

初审发现的无条件 `isEditable` 引入隐式等待、面板错误上下文缺失、错误页面截图/诊断丢失、合成 DOM 标签及晚到 ready 误通过均已修正。iframe 最终返回前的同类截止检查也已补齐，沿用原 `DETAIL_MATERIAL_FRAME_NOT_READY` 错误文本，不新增代码类别。最终未发现阻断该候选交付的问题。

旧 no-SKU 正例原本拦截所有图片请求，不能满足新增真实解码契约。隔离适配副本仅调整依赖路径、为精确的 `second.png` 返回本地有效 PNG、给 1px 测试图设置 80×60 点击区域；全部原断言保留，其他请求仍拦截。已复核 `no-sku-fixture.diff` 和 provenance 原文件哈希。此适配合理；未声称未经适配的旧正例通过。新测试仍保留破图/未解码拒绝验证。

## 冷备份与正式环境保持

冷备份 ZIP SHA-256 `f3b7c00a289409f46eb45480665923302c5265d5dede26f7061d765a9e008a5b` 匹配。QA 逐项读取 ZIP 校验 382 个源码哈希及 84 个冻结项；ZIP 实际共 383 个条目，其中额外一项为 `source-sha256.json`，不是新增源码。目录 ACL 仅系统、管理员组与当前管理员账户。

最终再次逐项计算正式 382 个源码文件，全部仍与冷备一致。正式锁 SHA-256 仍为 `1d21ba6d5d046376a9a4e285cb081593aee8041d1f17c7ff68794f3b539d46a2`；独立只读磁盘校验仍为原 revision、84 项、`ok=true`。执行者只读 HTTP 证据显示 PID 40776，本 QA 未另触发生产执行。

## 结论边界

可交付此冻结候选与审查报告，**部署许可仍为 false**。需要未来明确放行后才能按已审查维护流程安装、加载及现场验证；该步骤不可由本 PASS 隐含替代。候选或证据哈希变化需重新签验。真实淘宝商品 12 是否能继续上传尚待现场验证，本轮未进入 Step 2，也未解除或追加其尝试额度。
