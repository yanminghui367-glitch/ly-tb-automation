# Step 3a / 3d 主图稳定性修复与同类断言审计

状态：仅隔离候选，未安装、未发布、未 claim 商品额度。生产现场只读核验由总负责人另行记录；下述延迟复现是隔离证据，不声称重放了真实平台延迟。

## 改动及复现

生产候选只修改 `workbench/taobao-publisher.mjs` 的 `clickMainImageAndVerify`。

- 原来背靠背两次读取，2 张 → 3 张就抛 `MAIN_IMAGE_STATE_CHANGED`。现在每 100ms 观察，连续两次一致才返回。
- 观察默认截止 5 秒；点击之后的等待及最终检查共用同一个截止，不嵌套叠加每轮 5 秒。
- 图片仍处于点击前的合法前缀时继续观察。持续不稳定、或新增图片一直不出现，截止抛带 `code: SAFE_RETRY_MAIN_IMAGE_STATE` 的错误。
- 稳定但内容、顺序或数量错误，仍抛硬错误 `MAIN_IMAGE_STATE_CHANGED`。点击前的错误前缀保持原 `MAIN_IMAGE_PREFIX_CHANGED`。
- 点击动作仍在观察循环之外，只点一次；原点击 TimeoutError 仅保留诊断，不重点击、不上传、不提交。
- 每次观察前后保留原 guard / 原表单 URL / CDN 身份校验；这些错误原样透传。Step 1 五类预算常量未修改。
- 初始观察和点击后观察各有最多 5 秒预算；5 秒是观察截止，不是把异步 guard 或正在进行的 DOM 读取强行取消的硬抢占计时器。

证据：

| 证据 | 结果 |
| --- | --- |
| `before-main-image.log`，新增 9 用例对原 r2 | 4 通过、5 失败，明确复现 `MAIN_IMAGE_STATE_CHANGED` 的 2 → 3 差异 |
| `after-main-image-final.log`，最终候选字节 | 26 / 26 通过；包含新增 9 条、原 16 条、追加原生 DOM 异步渲染 1 条，不能重复相加 |
| 新增第 3 张在第一次/第二次读取之间到达 | 新判据观察到 3 张稳定，通过；点击数为 1 |
| 原生隔离 DOM 第 3 张延迟 180ms 插入 | 通过；顺序完整；点击数为 1 |
| 稳定但顺序错误 | 抛 `MAIN_IMAGE_STATE_CHANGED`，不是 SAFE_RETRY |
| 持续 2 / 3 振荡、稳定 2 张但无新增 | 有限截止，SAFE_RETRY_MAIN_IMAGE_STATE；点击数为 1 |
| 验证码 / 表单切换 / 非官方 CDN | 维持原错误，不转换为成功或安全重试 |

隔离测试允许短 `stabilityTimeout` 用于验证截止行为，生产默认仍为 5000ms。测试中 500ms 点击后预算还会包含初始约 100ms 采样时间；不得把该测试时长当作生产 P50/P90。

## 3d 普查清单

扫描 `workbench`、`engine`、`tools` 中 110 个 JS/MJS 源文件，得到 202 行词法候选，逐类判别；202 是候选匹配行数，不是缺陷数。排除依赖、生成 bundle、运行数据、测试与历史 qa-candidate；历史 qa-candidate 另外核对调用关系。源文件清单及命中在 `audit-search.json`，可用 `audit-main-read-patterns.mjs` 复核。

| 位置 | 性质 | 处理 |
| --- | --- | --- |
| `taobao-publisher.mjs`，`clickMainImageAndVerify` 原 `stableRead` | 唯一现行执行路径中直接把两次渲染快照相等当硬断言的命中 | 本次统一为有截止的观察；终态内容检查仍严格 |
| `workbench/qa-candidate/main-image-reconcile-candidate.mjs:21–37` | 同一旧写法的历史候选副本；仅该目录内自己的测试 import，没有生产源 import | 保留原始候选证据，不覆写为“已修复”；不是生产第二处 |
| `taobao-publisher.mjs:91–115`，`fillStableInventory` | 已有值持续稳定窗口 / 有限等待 | 保持，非背靠背等值断言 |
| `taobao-publisher.mjs`，`fillPriceWithBlankRecovery` | 等待原冻结价格；最后一次值检查是业务值防变更 | 保持，不把非空异值自动接受 |
| `publishing-materials.mjs:17–44` | 已有 readiness 轮询、解码检查、guard 与截止 | 保持；不得借本次改变详情预算 |
| `taobao-publisher.mjs`，`waitDetailMaterialFrame` / `waitMainMaterialFrame` | 元素、frame 对象、官方 origin、当前可见面板身份 | 保持硬校验；不是渲染内容稳定性 |
| `taobao-publisher.mjs`，`assertPublishIdentity` / `readSubmissionReceipt` | 提交前后原页面 / 唯一平台商品 ID / 店铺及标题身份 | 保持；提交结果不能用两次一致替代凭据 |
| `taobao-publisher.mjs`，`reconcileMainImages` / 主图前序数量 / 详情回执比对 / `verifyForm` | 真实内容与原任务、素材回执的比对 | 保持；不是两次页面读取之间的相等要求 |
| `taobao-publisher.mjs`，`closeMainImageActionMenu` | 菜单名称须等于已确认的固定动作集合 | 保持；防止关闭不同控件，不是渲染前后比较 |
| `publishing-attributes.mjs`，原表单 URL、候选值 ID / text 检查 | 控件身份、已选冻结属性防变更 | 保持，不放宽为任意稳定值 |
| `listing-verification.mjs:130` | 后台 DOM ID 列表对官方响应 ID，已 `expect.poll`，15s 有限 | 保持；已使用轮询 |
| `listing-verification.mjs:151` | 跨页 total 一致性，保障读到同一集合 | 保持；这是真实数据快照一致性，不能把数据变化当渲染迟到 |
| `page-protection.mjs:88–100` / `publishing-pages.mjs:109–119` | 前后页签 / target / pinned / 导航身份比对 | 保持；既有保留页面保护闸门 |
| `session-guard.mjs:67–108` | 会话、店铺、页面及 revision 前后身份一致 | 保持；CAPTCHA / 登录 / 店铺变更不可轮询放行 |
| `assertTaskFiles` / `executionDetailImages` / `DETAIL_SOURCE_MISMATCH` 等 | 文件哈希、冻结素材版本、扩边尺寸及回执来源 | 保持；不可变输入，不属于 DOM 采样 |
| `tools/migration-data.mjs:71,95,100` | 导出前后 DB data_version / 设置 / 作业、还原后的计数一致 | 保持；迁移一致性，不是 UI 渲染 |
| `engine/v2/page.mjs:76–98` | 单次读取对固定期望；后续 verify 使用 Playwright 等待 | 保持；无背靠背两次页面快照硬等值 |
| `server.mjs` / `destination-catalog.mjs` / `material-replacement.mjs` 等 | 对比不同版本商品、mapping、导入对象并展示差异 | 保持；资料版本差异，不是渲染读取 |
| `listing-round.mjs` / `round-*.mjs` | 轮次、任务、操作请求、预算、身份与保护证明前后状态 | 本子任务不修改；安全边界保留，熔断由总负责人独立实现 |
| 前端 `travel-os.js` / `product.js` / `operations-catalog-ui.js` 等 | 异步返回与当前筛选/对象/弹窗版本绑定，避免旧响应覆盖新界面 | 保持；不参与平台 DOM 主图判据 |

本次未发现需要扩展到其他生产文件的同种背靠背页面快照等值断言。该结论只针对“读两次必须相等”模式；不代表其他单次控件断言、所有平台时序及所有异常均已被生产验证。

## 最终字节

`main-image-binding.json` 记录最终 publisher 与两份测试 SHA-256。publisher：`6eafc82f2b7236ef0b1b0c0b560b2b9227057303705267adaf2f472f6df1f9a3`。

本文件不授予安装、重建任务、加额或生产重试权限。安装及现场验收由总负责人按用户当前批准范围另行记录。
