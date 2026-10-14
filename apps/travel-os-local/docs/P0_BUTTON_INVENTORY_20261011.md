# P0 按钮与入口清单｜2026-10-11

## 检查范围与证据

独立 Chrome、8 个工作台默认页面，只允许同源 GET，未连接执行 Chrome。页面错误 0，发出的修改请求 0。截图及机器清单位于 `output/playwright/p0-p1-1791708758651/`。以下相同操作可能因不同商品或店铺重复出现；表中按文本、动作和链接去重，不把行数当作功能通过数。

这不是所有状态的点击验收：弹窗、提交、运行中、断线、历史及兼容旧操作台仍需对应场景验证。禁用状态不等于缺陷，须区分合理保护与未接入。

## P0 已确认问题与处置

下表记录维护前发现。后续19文件已正式安装，单条详情不再返回 NOT_CONNECTED，网页已显示“重新检查并重试此条”；执行 Chrome 经用户人工登录后已确认五洲畅游。正式网页只读证据为 `output/playwright/p1-live-1791709154522/result.json`，发布能力不能由按钮外观推定。安装与后台核验入口的最新进展见 [本轮记录](P0_P1_20261011.md)。

|项目|证据|处理范围|
|---|---|---|
|正式代码未含单条重试|round-item-api.mjs 返回 NOT_CONNECTED；正式37核|P1复用已审核19项候选，维护后复验|
|查询失败展示原上传断点|当前轮次reason为列表响应未成功，step为选择详情图1|候选已有独立查询失败stage；历史原快照保留|
|批次与轮次按钮并列|tasks.png 上下均有继续按钮|先核对路由保护，后续统一入口，不绕过归属|
|新增店铺非执行准入|travel-os-api.mjs selectedPreview与setup-flow适配约束|保留P3，不称多店铺全部可执行|
|单目的地仅填写|selected-create 强制 DRY_RUN|保留P2统一单条/批量，不偷偷改LIVE|
|执行Chrome未运行|GET v1/state STOPPED，9222拒绝，无匹配专用进程|新启动后核对登录；不冒充已经可发布|

## 默认页面中的实际入口

### 总览

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|产品总数 700 已导入产品 · 按店铺去重 ›|overview-products|可用外观|实际渲染；未触发业务写入|
|已核验上架 292 已通过平台核验的产品 ›|overview-verified|可用外观|实际渲染；未触发业务写入|
|执行中 0 当前无正在执行的批次 ›|overview-running|可用外观|实际渲染；未触发业务写入|
|待处理 137 执行事项 134 · 资料待补 3 ›|overview-attention|可用外观|实际渲染；未触发业务写入|
|待开始 / 继续批次 已确认有待执行商品，需人工开始或继续 1|overview-pending|可用外观|实际渲染；未触发业务写入|
|待处理提醒 结果待核验 133 · 暂停待检查 1 · 资料待补充 3 137|overview-attention|可用外观|实际渲染；未触发业务写入|
|进入店铺管理 ›|#shops|可用外观|实际渲染；未触发业务写入|
|产品与素材 管理产品与素材|#products|可用外观|实际渲染；未触发业务写入|
|目的地中心 查看全球目的地|#destinations|可用外观|实际渲染；未触发业务写入|
|报价管理 维护成本与售价|#quotes|可用外观|实际渲染；未触发业务写入|
|任务队列 查看执行队列|#tasks|可用外观|实际渲染；未触发业务写入|
|›|#destinations|可用外观|实际渲染；未触发业务写入|
|北美洲|overview-region|可用外观|实际渲染；未触发业务写入|
|南美洲|overview-region|可用外观|实际渲染；未触发业务写入|
|欧洲|overview-region|可用外观|实际渲染；未触发业务写入|
|非洲|overview-region|可用外观|实际渲染；未触发业务写入|
|亚洲|overview-region|可用外观|实际渲染；未触发业务写入|
|大洋洲|overview-region|可用外观|实际渲染；未触发业务写入|
|查看全部|overview-records|可用外观|实际渲染；未触发业务写入|
|韦拉克鲁斯|record-detail|可用外观|实际渲染；未触发业务写入|
|布鲁塞尔|record-detail|可用外观|实际渲染；未触发业务写入|
|新山|record-detail|可用外观|实际渲染；未触发业务写入|
|麦尔兹堡|record-detail|可用外观|实际渲染；未触发业务写入|
|加斯托尼亚|record-detail|可用外观|实际渲染；未触发业务写入|

### 自动化任务

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|打开浏览器|shop-browser|可用外观|实际渲染；未触发业务写入|
|导出总清单 ↓|/api/v1/rounds/results.csv?id=d9a24f58-4df1-4af8-bdb4-671da2424bb5|可用外观|实际渲染；未触发业务写入|
|检查并继续本轮|round-resume|可用外观|实际渲染；未触发业务写入|
|停止本轮|round-stop|可用外观|实际渲染；未触发业务写入|
|图标按钮|window-detail|可用外观|实际渲染；未触发业务写入|
|图标按钮|/api/v1/rounds/window.csv?id=5e2a2397-ad3e-4591-8e3a-db258c9ce01c|可用外观|实际渲染；未触发业务写入|
|图标按钮|/api/v1/rounds/window.csv?id=89a13f35-6e9a-4dc5-8558-024ac161999f|可用外观|实际渲染；未触发业务写入|
|图标按钮|/api/v1/rounds/window.csv?id=f9bf99a0-4573-4b13-821e-1241cebbfe89|可用外观|实际渲染；未触发业务写入|
|查看详情 ›|task-details|可用外观|实际渲染；未触发业务写入|
|已处理，检查并继续|continue|可用外观|实际渲染；未触发业务写入|
|永久跳过此项|skip|可用外观|实际渲染；未触发业务写入|
|打开执行 Chrome|engine-browser|可用外观|实际渲染；未触发业务写入|
|查看执行设置|#settings|可用外观|实际渲染；未触发业务写入|
|查看套图清单 ›|material-library|可用外观|实际渲染；未触发业务写入|
|主图 700 张 商品主图，不含候选模板|shop-products|可用外观|实际渲染；未触发业务写入|
|副图 8 张 4 张 + 4 张 · 2 套|material-library|可用外观|实际渲染；未触发业务写入|
|详情页 7 张 1 套正文 · 首页候选 2 张|material-library|可用外观|实际渲染；未触发业务写入|
|全部 100|queue-filter|可用外观|实际渲染；未触发业务写入|
|执行中 0|queue-filter|可用外观|实际渲染；未触发业务写入|
|等待 84|queue-filter|可用外观|实际渲染；未触发业务写入|
|已结束 13|queue-filter|可用外观|实际渲染；未触发业务写入|
|异常 3|queue-filter|可用外观|实际渲染；未触发业务写入|
|查看|select-task|可用外观|实际渲染；未触发业务写入|
|日志|task-logs|可用外观|实际渲染；未触发业务写入|
|上一页|task-prev|禁用|实际渲染；未触发业务写入|
|下一页|task-next|可用外观|实际渲染；未触发业务写入|

### 店铺管理

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|新增店铺|add-shop|可用外观|实际渲染；未触发业务写入|
|查看产品|shop-products|可用外观|实际渲染；未触发业务写入|
|查看任务|shop-tasks|可用外观|实际渲染；未触发业务写入|
|连接店铺|shop-browser|可用外观|实际渲染；未触发业务写入|
|图标按钮|shop-check|可用外观|实际渲染；未触发业务写入|
|图标按钮|remove-shop|可用外观|实际渲染；未触发业务写入|
|‹|shops-prev|禁用|实际渲染；未触发业务写入|
|›|shops-next|禁用|实际渲染；未触发业务写入|

### 产品库

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|店铺设置|#shops|可用外观|实际渲染；未触发业务写入|
|全部产品 (700)|library-tab|可用外观|实际渲染；未触发业务写入|
|主图 (700 张)|library-tab|可用外观|实际渲染；未触发业务写入|
|副图 (8 张)|library-tab|可用外观|实际渲染；未触发业务写入|
|详情页 (9 张)|library-tab|可用外观|实际渲染；未触发业务写入|
|待补资料 (28)|library-tab|可用外观|实际渲染；未触发业务写入|
|查看店铺套图|material-library|可用外观|实际渲染；未触发业务写入|
|导入产品|#settings|可用外观|实际渲染；未触发业务写入|
|1|material-detail|可用外观|实际渲染；未触发业务写入|
|4|material-detail|可用外观|实际渲染；未触发业务写入|
|8|material-detail|可用外观|实际渲染；未触发业务写入|
|查看|product-detail|可用外观|实际渲染；未触发业务写入|
|素材|material-detail|可用外观|实际渲染；未触发业务写入|
|‹|previous-page|禁用|实际渲染；未触发业务写入|
|1|library-page|可用外观|实际渲染；未触发业务写入|
|2|library-page|可用外观|实际渲染；未触发业务写入|
|35|library-page|可用外观|实际渲染；未触发业务写入|
|›|next-page|可用外观|实际渲染；未触发业务写入|
|＋ 新增店铺|add-library|可用外观|实际渲染；未触发业务写入|

### 目的地中心

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|重置|directory-reset|可用外观|实际渲染；未触发业务写入|
|列表视图|directory-view|可用外观|实际渲染；未触发业务写入|
|卡片视图|directory-view|可用外观|实际渲染；未触发业务写入|
|全部目的地 700|directory-region|可用外观|实际渲染；未触发业务写入|
|亚洲 188|directory-region|可用外观|实际渲染；未触发业务写入|
|欧洲 204|directory-region|可用外观|实际渲染；未触发业务写入|
|北美洲 204|directory-region|可用外观|实际渲染；未触发业务写入|
|南美洲 31|directory-region|可用外观|实际渲染；未触发业务写入|
|大洋洲 16|directory-region|可用外观|实际渲染；未触发业务写入|
|非洲 57|directory-region|可用外观|实际渲染；未触发业务写入|
|伦敦 英国 · 欧洲|directory-select|可用外观|实际渲染；未触发业务写入|
|1|destination-products|可用外观|实际渲染；未触发业务写入|
|0|destination-quotes|可用外观|实际渲染；未触发业务写入|
|1|destination-shops|可用外观|实际渲染；未触发业务写入|
|···|directory-more|可用外观|实际渲染；未触发业务写入|
|墨西哥城 墨西哥 · 北美洲|directory-select|可用外观|实际渲染；未触发业务写入|
|东京 日本 · 亚洲|directory-select|可用外观|实际渲染；未触发业务写入|
|马德里 西班牙 · 欧洲|directory-select|可用外观|实际渲染；未触发业务写入|
|柏林 德国 · 欧洲|directory-select|可用外观|实际渲染；未触发业务写入|
|华盛顿特区 美国 · 北美洲|directory-select|可用外观|实际渲染；未触发业务写入|
|巴黎 法国 · 欧洲|directory-select|可用外观|实际渲染；未触发业务写入|
|莫斯科 俄罗斯 · 欧洲|directory-select|可用外观|实际渲染；未触发业务写入|
|安卡拉 土耳其 · 亚洲|directory-select|可用外观|实际渲染；未触发业务写入|
|首尔特别市 韩国 · 亚洲|directory-select|可用外观|实际渲染；未触发业务写入|
|‹|directory-page|禁用|实际渲染；未触发业务写入|
|1|directory-page|可用外观|实际渲染；未触发业务写入|
|2|directory-page|可用外观|实际渲染；未触发业务写入|
|70|directory-page|可用外观|实际渲染；未触发业务写入|
|›|directory-page|可用外观|实际渲染；未触发业务写入|
|编辑|组件自身事件|禁用|实际渲染；未触发业务写入|
|产品 1|destination-products|可用外观|实际渲染；未触发业务写入|
|历史报价 0|destination-quotes|可用外观|实际渲染；未触发业务写入|
|已覆盖店铺 1|destination-shops|可用外观|实际渲染；未触发业务写入|

### 报价库

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|录入报价|add-quote|可用外观|实际渲染；未触发业务写入|
|录入第一条报价|add-quote|可用外观|实际渲染；未触发业务写入|
|查看更多|quote-show-all|可用外观|实际渲染；未触发业务写入|

### 上架记录

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|店铺连接|组件自身事件|可用外观|实际渲染；未触发业务写入|
|全部店铺 320|record-shop|可用外观|实际渲染；未触发业务写入|
|五洲畅游 320|record-shop|可用外观|实际渲染；未触发业务写入|
|GO 环球 0|record-shop|可用外观|实际渲染；未触发业务写入|
|国内旅译服务 0|record-shop|可用外观|实际渲染；未触发业务写入|
|洲际出行 0|record-shop|可用外观|实际渲染；未触发业务写入|
|全球出行优选 0|record-shop|可用外观|实际渲染；未触发业务写入|
|本土方舟 0|record-shop|可用外观|实际渲染；未触发业务写入|
|环球领航 0|record-shop|可用外观|实际渲染；未触发业务写入|
|境外旅游服务 0|record-shop|可用外观|实际渲染；未触发业务写入|
|重置|record-reset|可用外观|实际渲染；未触发业务写入|
|导出记录|record-export|可用外观|实际渲染；未触发业务写入|
|时间 ↓|record-sort|可用外观|实际渲染；未触发业务写入|
|查看|record-detail|可用外观|实际渲染；未触发业务写入|
|图标按钮|record-copy|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1088400479766|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1091433960911|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1088397331191|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1088395467022|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1088393427137|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1091421636997|可用外观|实际渲染；未触发业务写入|
|图标按钮|https://item.taobao.com/item.htm?id=1089289186383|可用外观|实际渲染；未触发业务写入|
|上一页|previous-page|禁用|实际渲染；未触发业务写入|
|下一页|next-page|可用外观|实际渲染；未触发业务写入|

### 资料设置

|文本|动作或链接|当前状态|验证边界|
|---|---|---|---|
|新电脑简易教程 ↗|guide|可用外观|实际渲染；未触发业务写入|
|1 存放位置|step|可用外观|实际渲染；未触发业务写入|
|2 导入资料|step|可用外观|实际渲染；未触发业务写入|
|3 连接店铺|step|可用外观|实际渲染；未触发业务写入|
|4 准备检查|step|可用外观|实际渲染；未触发业务写入|

## 源码声明的按钮补充（包含非默认状态）

|源码|动作|文本|静态处理器|
|---|---|---|---|
|travel-os.js:82|destination-quotes|查看全部 ›|同文件case已找到；不是行为验收|
|travel-os.js:82|destination-records|查看全部 ›|同文件case已找到；不是行为验收|
|travel-os.js:82|prepare|创建任务|同文件case已找到；不是行为验收|
|travel-os.js:82|destination-quotes|查看报价|同文件case已找到；不是行为验收|
|travel-os.js:160|overview-product-detail|查看商品资料|同文件case已找到；不是行为验收|
|travel-os.js:160|record-detail|查看执行记录|同文件case已找到；不是行为验收|
|travel-os.js:167|retry|重试异常链接（|同文件case已找到；不是行为验收|
|travel-os.js:186|clear-shop-destination|查看全部店铺|同文件case已找到；不是行为验收|
|travel-os.js:188|shop-products|查看产品|同文件case已找到；不是行为验收|
|travel-os.js:188|shop-tasks|查看任务|同文件case已找到；不是行为验收|
|travel-os.js:188|shop-browser|连接店铺|同文件case已找到；不是行为验收|
|travel-os.js:188|shop-check|检查连接|同文件case已找到；不是行为验收|
|travel-os.js:188|remove-shop|移除|同文件case已找到；不是行为验收|
|travel-os.js:189|shops-reset|清除筛选|组件/动态分发需继续核对|
|travel-os.js:190|shops-prev|‹|组件/动态分发需继续核对|
|travel-os.js:190|shops-next|›|组件/动态分发需继续核对|
|travel-os.js:198|product-detail|打开 ›|同文件case已找到；不是行为验收|
|travel-os.js:199|previous-page|上一页|同文件case已找到；不是行为验收|
|travel-os.js:199|next-page|下一页|同文件case已找到；不是行为验收|
|travel-os.js:201|product-detail|查看|同文件case已找到；不是行为验收|
|travel-os.js:201|material-detail|素材|同文件case已找到；不是行为验收|
|travel-os.js:216|product-detail|查看商品资料|同文件case已找到；不是行为验收|
|travel-os.js:226|material-library|查看店铺套图|同文件case已找到；不是行为验收|
|travel-os.js:226|clear-product-destination|查看全部目的地|同文件case已找到；不是行为验收|
|travel-os.js:226|library-reset|清除筛选|同文件case已找到；不是行为验收|
|travel-os.js:226|previous-page|‹|同文件case已找到；不是行为验收|
|travel-os.js:226|next-page|›|同文件case已找到；不是行为验收|
|travel-os.js:226|add-library|＋ 新增店铺|同文件case已找到；不是行为验收|
|travel-os.js:464|directory-more|···|同文件case已找到；不是行为验收|
|travel-os.js:467|directory-retry|重试|同文件case已找到；不是行为验收|
|travel-os.js:477|directory-page|‹|同文件case已找到；不是行为验收|
|travel-os.js:477|directory-page|›|同文件case已找到；不是行为验收|
|travel-os.js:488|directory-more|···|同文件case已找到；不是行为验收|
|travel-os.js:491|directory-reset|重置|同文件case已找到；不是行为验收|
|travel-os.js:492|country-filter|清除|同文件case已找到；不是行为验收|
|travel-os.js:494|directory-reset|重置筛选|同文件case已找到；不是行为验收|
|travel-os.js:521|clear-quote-destination|查看全部目的地|同文件case已找到；不是行为验收|
|travel-os.js:522|quote-detail|详情|同文件case已找到；不是行为验收|
|travel-os.js:523|quote-reset|清除筛选|同文件case已找到；不是行为验收|
|travel-os.js:524|quote-show-all|查看更多 |同文件case已找到；不是行为验收|
|travel-os.js:538|window-preview|检查所选范围|同文件case已找到；不是行为验收|
|travel-os.js:543|window-detail|查看|同文件case已找到；不是行为验收|
|travel-os.js:550|round-resume|恢复原处理记录|同文件case已找到；不是行为验收|
|travel-os.js:550|round-stop|停止本轮|同文件case已找到；不是行为验收|
|travel-os.js:550|round-stop|停止本轮|同文件case已找到；不是行为验收|
|travel-os.js:550|window-configure|设置本轮任务|同文件case已找到；不是行为验收|
|travel-os.js:550|engine-browser|打开执行 Chrome|同文件case已找到；不是行为验收|
|travel-os.js:576|task-details|查看详情 ›|同文件case已找到；不是行为验收|
|travel-os.js:582|material-library|查看套图清单 ›|同文件case已找到；不是行为验收|
|travel-os.js:584|select-task|查看|同文件case已找到；不是行为验收|
|travel-os.js:584|task-logs|日志|同文件case已找到；不是行为验收|
|travel-os.js:584|task-prev|上一页|同文件case已找到；不是行为验收|
|travel-os.js:584|task-next|下一页|同文件case已找到；不是行为验收|
|travel-os.js:590|product-detail|查看源资料|同文件case已找到；不是行为验收|
|travel-os.js:595|pause|停止并保存断点|同文件case已找到；不是行为验收|
|travel-os.js:595|engine-browser|打开执行 Chrome|同文件case已找到；不是行为验收|
|travel-os.js:595|review-selected|核对此商品并入队|同文件case已找到；不是行为验收|
|travel-os.js:595|cancel-preparation|取消准备单|同文件case已找到；不是行为验收|
|travel-os.js:595|associate-result|关联原商品并核验|同文件case已找到；不是行为验收|
|travel-os.js:595|start|核对并开始批次|同文件case已找到；不是行为验收|
|travel-os.js:595|skip|永久跳过此项|同文件case已找到；不是行为验收|
|travel-os.js:595|engine-browser|打开执行 Chrome|同文件case已找到；不是行为验收|
|travel-os.js:599|previous-page|上一页|同文件case已找到；不是行为验收|
|travel-os.js:599|next-page|下一页|同文件case已找到；不是行为验收|
|travel-os.js:637|record-reset|重置|同文件case已找到；不是行为验收|
|travel-os.js:638|clear-record-destination|查看全部目的地|同文件case已找到；不是行为验收|
|travel-os.js:639|record-detail|查看|同文件case已找到；不是行为验收|
|travel-os.js:639|record-history|查看|同文件case已找到；不是行为验收|
|travel-os.js:639|record-copy|复制平台 ID|同文件case已找到；不是行为验收|
|travel-os.js:640|record-reset|清除筛选|同文件case已找到；不是行为验收|
|travel-os.js:655|prepare|保存准备结果|同文件case已找到；不是行为验收|
|travel-os.js:655|destination-quotes|查看报价|同文件case已找到；不是行为验收|
|travel-os.js:672|associate-result|关联原商品并核验|同文件case已找到；不是行为验收|
|travel-os.js:701|round-item-detail|详情|同文件case已找到；不是行为验收|
|travel-os.js:711|round-human-resume|检查并继续原轮次|同文件case已找到；不是行为验收|
|travel-os.js:735|product-detail|查看原资料|同文件case已找到；不是行为验收|
|travel-os.js:735|destination-products|关联产品|同文件case已找到；不是行为验收|
|travel-os.js:735|destination-quotes|历史报价|同文件case已找到；不是行为验收|
|travel-os.js:735|destination-records|执行记录|同文件case已找到；不是行为验收|
|travel-os.js:749|archive-quote|归档此报价（保留历史）|同文件case已找到；不是行为验收|
|travel-os.js:803|quote-retry|重新加载|同文件case已找到；不是行为验收|

## 启用动作的验收要求

开始/继续/停止/重试/跳过/核验需绑定原店铺、商品、范围及版本；请求重复、响应丢失和刷新后沿用原操作记录。成功必须有后台商品证据。导入、模板、连接、检查、随机规则、店铺增删、报价增归档、筛选、历史和导出按对应隔离旅程复用/补测。不得因按钮已绑定handler就勾选通过。
