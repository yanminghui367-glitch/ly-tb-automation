# 成功页活动标签误拦截修复｜2026-10-13

## 问题与证据

2026-10-13 19:53（Asia/Shanghai）网站记录 `VERIFIED_PAGE_CLEANUP / ACTIVE_USER_PAGE`。当时当前商品威尼斯仍为 `PENDING`、`existing-listing-query`、0 次尝试、未提交；轮次与窗口进入 `SYSTEM_BLOCKED`，提示“已保留两张异常页面”。执行浏览器仍显示已登录，因此本次不是登录断开。

根因在 `workbench/publishing-pages.mjs`：在已经确认页面由本次执行创建、商品成功状态已持久化、成功页 URL 与唯一商品 ID 对得上、店铺/CAPTCHA 守卫通过之后，清理仍把 Chrome `tabActive` 当成用户控制页面并拒绝关闭。Playwright 创建的执行页可能自然成为当前标签；“标签被选中”不能单独证明有人正在使用。这项误判把已核验成功页记成保留异常，累计两页后触发预算暂停。

## 修复范围

`closeVerifiedOwnedPage` 不再仅因 `tabActive=true` 拒绝关闭本轮新建的成功页。仍需同时满足原有 `createdThisExecution`、持久化成功态、唯一商品 ID/成功 URL、店铺守卫、无验证码/挑战、未导航、精确 CDP 标签和页面身份匹配、双次非固定状态及关闭回执。固定页、保护读取未知、身份变化、人工挑战、恢复/旧页、素材辅助页、未验证或结果未知页面仍保留；页面保护其余功能不变。

## 验证

- 页面归属、页面保护、发布页清理及 SourceWorkflow 集成测试：43/43 通过；包含隔离真实 Chrome 标签实验。
- `npm run check` 通过。
- `npm test`：997/997 通过。
- `workbench/kernel-lock.json` 新版 `20261013-active-tab-cleanup`，锁定 `publishing-pages.mjs`；前版清单保留于 `docs/kernel-baselines/20261013-before-active-tab-cleanup.json`。

测试不触碰真实淘宝商品。正式局域网服务已在轮次暂停、无活跃执行时，通过原启动器维护重载：旧 PID 43156 → 新 PID 6728，版本 `20261013-active-tab-cleanup`，44 个冻结文件 `changed=[]`。重载前后轮次 ID、窗口 ID、批次 ID、状态与计数完全一致；没有恢复或提交商品。按正常生命周期关闭后重新建立了专用执行 Chrome；重载后首次瞬时检查为 `LOGIN_UNVERIFIED`，随后只读复查显示 `LOGGED_IN`。轮次仍暂停，登录检测不等于执行身份/恢复闸门通过。原 `SYSTEM_BLOCKED` 记录保留，不自动恢复；历史页面异常只留有原始审计记录，不回写旧结论。之后在网站恢复原轮次时，若出现 `RESULT_UNKNOWN` 或人工处理闸门，仍按原平台核验规则处理。
