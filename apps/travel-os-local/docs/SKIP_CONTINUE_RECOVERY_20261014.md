# 跳过后继续原轮次与旧验证码记录复查｜2026-10-14

用户明确要求：“跳过是跳过后继续往后续的链接进行，不是跳过就不动了。”同时要求修正无实际人工处理内容时的异常提示，并保留跳过按钮。

## 原因与修复范围

威尼斯已有 MANUAL_SKIPPED 记录，但第三轮仍处于 SYSTEM_BLOCKED。轮次恢复入口检查整个固定清单中未结束的人工项；哈肯萨克保留 PAUSED_CAPTCHA 原因，程序维护后其原 run 已转 PAUSED。实时专用执行浏览器却已是 LOGGED_IN，没有可见验证挑战。这条历史记录使恢复请求仍要求人工勾选；前端又只为 WAITING_HUMAN 轮次提供勾选入口，因此从 SYSTEM_BLOCKED 继续被拦截。监控沿用跳过前的图片超时原因，并因当前项终态隐藏跳过按钮。

仅修改四个现有实现文件：

- `workbench/listing-round.mjs`：提取原人工项判断，提供小范围历史 CAPTCHA 复查。只有明确验证码原因、没有任何提交证据、结果、已知商品 ID，且原任务为 LIVE 的安全暂停状态，才允许复查；登录、身份、模式、其他人工项与内容保护保持。原始记录不被删改。
- `workbench/product-api.mjs`：原恢复请求先实时检查专用浏览器及目标店铺。仅依据服务端检查的 LOGGED_IN、运行中、无 stale、15 秒内有效时间，确认上述历史验证码已不再阻塞。客户端不能提供核验凭证，真实挑战、错误店铺仍拒绝恢复。
- `workbench/round-item-detail.js`：保留“已跳过此条”禁用状态，继续使用原幂等跳过和恢复请求；下一实际未结束商品显示“跳过此条”。响应丢失后沿用原请求核对。
- `workbench/travel-os.js`：当前已跳过且实时浏览器正常时显示“已跳过 · 等待继续”，旧错误收进“上一条暂停记录”；历史验证码数显示为“旧验证待复查”，保留真实数字。真实挑战仍明确提示人工验证。运行中保留跳过入口，执行器停稳后才允许跳过。

新恢复事件注明 `captchaVerification.source=fresh-browser-check`、检查时间和原商品键，不将系统检查伪称操作者已勾选 `humanVerified`。恢复后的原执行器仍检查实际页面、资料、提交及结果；已跳过商品不重发。没有改变固定清单、业务资料或原授权。

## 验证与安装

当前执行者自验：20 项跳过及复查定向测试、98 项轮次/窗口/人工恢复/历史候选回归、66 项 API/浏览器/提交边界回归通过，完整语法检查通过。23 项真实局域网 HTTP 隔离网页、36 项监控网页、21 项详情网页检查通过；使用临时 SQLite、模拟执行器和随机端口，不能作为淘宝发布结果。监控脚本的一次失败源于点击后立即读取异步展开状态；改为等待展开后复验通过，失败附件保留。

证据入口：

- `output/skip-continue-regression-20261014.log`、`output/skip-continue-api-regression-20261014.log`、`output/skip-continue-syntax-20261014.log`。
- `output/playwright/skip-continue-20261014/lan-final/result.json`、`monitor-verified/qa.json`、`detail/result.json` 及同目录截图。
- `output/skip-continue-20261014/production-recheck.json`：真实数据库副本确认仅有一条满足严格复查条件的哈肯萨克历史验证码项。

按原维护接口备份两份业务 SQLite 并正常重载，安装后 PID 36556，版本 `20261014-skip-continue`，45/45 冻结文件通过。维护前后 29 张业务表全部哈希一致，原第三轮范围、威尼斯跳过记录与计数不变。没有复制浏览器配置或凭证。旧冻结清单保存在 `docs/kernel-baselines/20261014-before-skip-continue.json`。

正式局域网页检查无脚本错误、无资源失败、零写请求；按钮为“已跳过此条”，监控呈现等待继续。证据为 `output/skip-continue-20261014/live-installed/result.json` 和 `desktop.png`。

## 实际恢复记录

核对原 700 条授权、原固定清单和当前第三轮；实时浏览器确认正确店铺已登录、无可见挑战，执行许可开启，内核有效。按用户本次继续后续链接的明确要求，01:01 调用一次原恢复接口：

- round：`d9a24f58-4df1-4af8-bdb4-671da2424bb5`。
- window：`5e2a2397-ad3e-4591-8e3a-db258c9ce01c`。
- manifest：`3503194b6999eb9358df46bedbc5ef1f5d49068e08118a21eca0da2b59e5f370`。
- 请求保存在 `output/skip-continue-20261014/live-resume-request.json`，回执 `live-resume-accepted.json`。

接口接受 RUNNING/active=true；当前商品从 MANUAL_SKIPPED 的威尼斯切换到原待处理哈肯萨克，沿用 run `e2b0ee9c-6285-4333-b3b7-bc451e0f3c18`。其原记录实际推进至 open-details、后续 region-restriction，WAITING_HUMAN 从 1 降为 0。威尼斯仍为人工跳过，没有重复恢复或提交。上述行为首先证明正式轮次已继续执行。随后真实账本确认哈肯萨克为 NEW_SUCCESS、同一原run为 VERIFIED，并保留平台商品ID及核验截图；当前商品已切换为亚庇，新增核验从273增至274，本轮进度66/100增至67/100。证据为 `output/skip-continue-20261014/live-hackensack-verified.json`；不能据此宣称700条已完成。

实际网页及事件证据：`output/skip-continue-20261014/live-resumed/`、`live-continuation-status.json`、`live-continuation-events.json`、`live-latest-status.json`。最后核对仍在运行，当前商品亚庇，新成功计数274，本轮已结束67/100；当前状态以网站和账本为准。维修前后表哈希一致仅适用于恢复请求之前，恢复后的正常执行会写入运行记录。
