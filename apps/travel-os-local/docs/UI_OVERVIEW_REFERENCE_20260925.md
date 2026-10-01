# 总览参考图实施与验收 · 2026-09-25

【当前阶段】工作台总览视觉调整。用户批准后实施；此次参考替代旧 `UI_OVERVIEW_TEMPLATE.md` 的风景横幅设计，不倒改旧验收记录。

【本轮目标】参考 `codex-clipboard-f0843d8d-c7ae-454c-b084-2011b51d1ff5.png`，在现有 `/travel-os.html#overview` 实现白蓝总览：八模块侧栏、顶部搜索与服务状态、四指标、中间两栏、底部三栏。根路径地球首页不在改动范围。

【检查到的现状】修改前有风景横幅、目的地图片卡和总览地球。现有数据接口、目的地关联、店铺列表、任务与记录入口可以复用。保留透明蓝星品牌，不复制参考的飞机标志、虚构用户或演示数字。

【本轮完成】

| 文件 | 本轮范围 |
| --- | --- |
| `workbench/travel-os.html` | 总览结构；连接提示增加可更新的文字容器 |
| `workbench/overview.css` | 仅总览的网格、卡片、控件、响应式；本地内嵌地图 |
| `workbench/travel-os.js` | 总览只读数据投影、筛选导航、查看店铺、异常明细、首次加载失败提示；总览与历史所选批次隔离 |
| `workbench/scripts/overview-view.test.mjs` | 12 项数据口径与状态边界测试 |
| `workbench/scripts/overview-ui-qa.mjs` | 隔离浏览器交互回归；测试 API 全拦截并明确标注测试模式 |
| `.interface-design/system.md` | 本轮总览设计规则追加 |

点击指标、地图、记录、快捷入口只查看数据或跳转，未新增自动发布行为。搜索继续支持真实国家/城市，并打开既有目的地产品、报价、店铺和记录关联面板。

统计口径：

- 产品按店铺＋现有目的地标识去重；已核验仅计当前 `VERIFIED` 产品，不累加历史重复运行。
- 执行中按实际占用执行器的批次；历史 `execution.state=PAUSED` 不单独当作当前运行。
- 待处理按受影响商品去重，区分资料待补、失败、验证码、普通暂停、结果待核验；不把聚合异常对象数当商品数。
- 批次处理进度区分成功、失败、仅填写、跳过；结果不明不当作已完成失败。20/20 不等于20条成功。
- 切换“查看店铺”不切换执行器；非执行店铺不继承当前批次进度；过期登录证据显示待检查。
- 全球目的地卡表示导入资料范围，不代表服务供给覆盖或平台准入。

最终只读截图时：700 产品、45 已核验、0 执行中、33 待处理（28 资料待补＋5 执行失败）。最近批次处理20/20，成功15、失败5。这是本地既有数据的时点展示，不是本轮新增上架结果。

【验证结果】

- `npm run check --prefix workbench`：通过，项目现有语法检查。
- `node --test workbench/scripts/overview-view.test.mjs workbench/scripts/records-view.test.mjs workbench/scripts/task-view-model.test.mjs`：25/25 通过。
- `node workbench/scripts/overview-ui-qa.mjs output/overview-reference-20260925-FVj8N5`：52 项通过、0 脚本错误；唯一模拟 POST 为被拦截的 `/api/v1/check`，未到达真实服务。
- 实际网页四视口只读截图：无脚本错误、无横向溢出、无写请求。1672×941 完整首屏；1920×1080 正常；1440×900 自然纵滚39px；390×844 单列正常滚动，不裁切内容。
- 10 个冻结内核/适配文件及7个首页/共享视觉文件共17个 SHA-256 与本轮开始一致，见 `frozen-files-check.json`。
- 子 Agent 独立审核发现并修复首次断网提示误导、普通人工等待误分类、历史批次污染、非执行店铺状态过期、快捷说明单字换行等问题；最终复核结论另保存在本轮证据目录。

证据目录：`output/overview-reference-20260925-FVj8N5/`。

- 修改前后：`before-1672x941.png` / `final-1672x941.png`。
- 参考并排：`reference-vs-actual.png`；透明叠加：`reference-overlay-50.png`。
- 可交互对照：`comparison.html`，可切换前后、参考并排、叠加透明度。
- 响应式：`final-1440x900.png`、`final-1920x1080.png`、`final-390x844.png`。
- 交互与异常：`browser-qa.json`、`qa-attention.png`、`qa-tokyo-relations.png`、`qa-empty.png`、`qa-offline.png`、`qa-captcha-unknown.png`。

【仍未完成】没有声称像素级完全一致：现有本地中文字体、线框图标、真实文案长度和地图投影与AI参考有差异；品牌、真实数字、店铺选择器、异常提示按产品需要保留。无多用户、虚构通知或全局跨业务搜索扩展。

【阻塞项】本轮总览交付无已知阻塞。原有资料与执行异常仍需在相关模块处理，本次不修改其生产状态。

【风险】服务断开时保留的数据可能过期，页面明确提示；首次失败则明确尚未读取数据。浏览器会话超过15秒未获得有效证据显示待检查。视觉/隔离测试通过不等于真实发布验收。

【下一步】刷新 `/travel-os.html#overview` 查看。真实开始、继续或重试仍由原任务页面按既有确认流程操作，不由本轮测试触发。

## 素材与可维护性

- 地图来自 [Natural Earth 1:110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson)，[使用条款](https://www.naturalearthdata.com/about/terms-of-use/)允许公有领域使用。原始文件 SHA-256：`9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`。生成可缩放 SVG 后本地内嵌，运行时无地图网络请求。六洲按钮是地区目录，不是假城市坐标或实时业务点。
- 17个线框图标来自 [Phosphor core](https://github.com/phosphor-icons/core)，复用仓库既有 MIT 许可记录 `docs/PHOSPHOR_QUOTES_LICENSE.txt`；本地内嵌，无新图标运行依赖。
- 页面仍为现有原生 HTML/CSS/JavaScript，文字、控件和数据保持可编辑，不用整张参考图覆盖网页。
- 本轮前的源文件备份在 `before-source/`；工作区已有其他未提交改动，不可用仓库级回退覆盖它们。
