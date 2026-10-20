# 同步版本验证｜2026-10-20

本次同步当前正式源码与 UI 快照，版本 `20261019-success-target-r1`。这是源码归档，不是新的业务发布放行。

## 本次验证结果

- 隔离目录按锁文件安装 workbench 与 engine/v2 依赖成功；`npm run check` 通过。
- 全量 `npm test`：1523项，1508通过、15失败，0取消、0跳过。未改代码或测试期望消除失败，不宣称全量通过。
- 87项正式内核全部一致；最新独立QA候选16项文件SHA逐项与本次源码一致，复用该版本101项独立检查及19项隔离UI通过记录，不与全量测试相加。
- 5个正式服务UI文件实际HTTP200，字节与隔离副本相同：travel-os.html、travel-os.js、travel-os.css、tasks.css、execution-orb.js。
- 导出排除规则、常见凭证模式、源码清单和远端Git对象逐项核验；原始业务数据及81份测试artifacts不上传。

## 全量回归未通过项

| 测试文件 | 失败数 | 涉及范围 |
| --- | ---: | --- |
| scripts/batch-recheck.test.mjs | 8 | 重新核对范围、旧窗口、原请求重放与事务回滚 |
| scripts/content-review-integration.test.mjs | 2 | 内容审核状态与原任务处理 |
| scripts/detail-material-frame.test.mjs | 1 | 详情素材来源或路径拒绝 |
| scripts/listing-round.test.mjs | 1 | 未知故障首条停止断言 |
| scripts/no-sku-verification.test.mjs | 1 | 部分详情前缀复用 |
| scripts/round-selection.test.mjs | 1 | 单条失败后继续与暂停边界 |
| scripts/workflow-efficiency.test.mjs | 1 | 待核验执行提示断言 |

其中 listing-round 的旧断言在既有未修改版本也失败，已由原QA单独记录；其余14项本次未定位根因，不能统一称为旧测试问题或环境问题。完整用例名称、断言与日志留在本机 `output/github-sync-20261020/test-summary.json` 和 `full-tests.log`。这些失败应在后续独立修复中处理，不用源码同步替代质量验收。

此前旧全流程UI脚本的新店跳转等待超时仍是历史已知缺口，本次未重跑该脚本。未操作生产浏览器、重启工作台、开始/恢复上架、增加额度或迁移业务数据；真实连续成功目标未由本次同步验证。

同步范围见 [本次同步记录](docs/GITHUB_SYNC_20261020.md)，源文件SHA-256见 `SOURCE_MANIFEST.json`；安装完整性检查使用 `node tools/verify-installation.mjs`。

---

## 2026-10-16 历史同步验证

本文件记录源码与 UI 快照的核验边界，不代表淘宝发布或 700 条批次完成。同步范围见 [同步说明](docs/GITHUB_SYNC_20261016.md)。

## 已完成验证

- 隔离副本使用锁定依赖执行 `npm ci --offline --ignore-scripts --no-audit --no-fund`，workbench 与 engine/v2 均成功。缓存缺失包从锁文件指定 npm 地址下载，逐包校验锁文件完整性后入缓存；未复制生产依赖目录。
- 在隔离 workbench 执行 `npm run check` 通过；`npm test` 共 1276 项，全部通过，无跳过。
- `scripts/shop-onboarding-ui-qa.mjs` 共 8 项通过，无页面错误，包含新增店铺、隔离上传、资料归属、执行默认关闭及 390px 布局；生产请求为 0。
- `20261016-monitor-status-position` 的 80 项冻结文件一致。12 项 UI 与构建文件逐项匹配既有独立 QA 的最终哈希。
- 本机正式服务实际返回的 `travel-os.html`、`travel-os.js`、`tasks.css`、`execution-orb.js` 全部 HTTP 200，字节与同步副本一致。
- 本次重新核对源文件排除规则和常见凭证模式；未纳入业务库、登录资料、原始业务素材、依赖目录或输出目录。

## 已知验证缺口

旧 `scripts/travel-os-ui-qa.mjs` 未通过：新增店铺后仍等待 `.shops-table tbody tr` 的第二行，10 秒超时。该脚本此前完成 6 项检查，无页面未捕获错误；新版新增店铺流程自动进入资料设置，已由上述新版接入脚本覆盖。旧脚本尚未适配此次路由行为，后续步骤未执行，不能写成全流程 UI 全部通过。本次按源码同步范围保留原脚本，不顺带修改产品或测试。

本次没有在第二台实体电脑启动验证，没有恢复业务包、操作生产浏览器或执行真实上架。新电脑应按 README 安装并自行登录；默认执行许可保持关闭。

## 完整性与证据

`SOURCE_MANIFEST.json` 保存源码与资源的路径、字节数和 SHA-256；清单本身由远端 Git 对象校验。安装完整性检查入口为 `node tools/verify-installation.mjs`，成功结果写入本机 `.runtime/install/verification.json`。

完整测试、UI 截图、安装记录、PR 和远端逐文件复核留在操作者本地 `output/github-sync-20261016/`，不上传原始运行输出。同步使用独立分支与 PR，只更新 `apps/travel-os-local/`，保留仓库其他应用。
