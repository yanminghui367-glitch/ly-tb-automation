# 后台查重响应故障｜2026-10-09

## 11:36 韦拉克鲁斯：单次原生查询诊断与阶段提示候选

正式服务为 `20261009-execution-attempts` / PID24352；11:13原范围恢复时，韦拉克鲁斯在发布前库存查重遇到HTTP200、外层ret失败、result缺失。原run `40faca1c-a349-4c61-8eb9-9ae5251db6f0` 保留PAUSED/select-detail-1，无新增提交、无商品history；新RESUME记录已封存。其他699条未因本次诊断改动。原失败记录的unknownRetCount=1不能证明具体返回码、登录失败、网络故障或SDK重试。

11:29在原后台仅执行一次原生搜索，没有改筛选或发起任务。12秒内观察到一条匹配请求：SUCCESS、result.success=true，第1页20个唯一商品ID，总数548，前后DOM商品ID一致。期间存在frameStartedLoading和navigatedWithinDocument事件，诊断按原规则以FINAL_PAGE_SCOPE_CHANGED失败，未放宽事件门槛、未再次搜索。事件未记录归属frame，不能断言来自隐藏工具frame或主页面；首分页成功不等于完整库存查重通过，也不证明韦拉克鲁斯不存在。

诊断只允许精确的不可见公开静态存储iframe，跨源内容保持unknown；不读取存储、Cookie或凭证。主要证据：

- `output/item-actions-r16/table-response/veracruz/native-search-result-1791516595090.json`
- `output/independent100-20261009/qa/veracruz-native-series-independent.json`（SHA256 `38d12c26be8fa6556f1034ab4350f18a79611f8174c7a2f65857bd8dd0a98212`）

另见后台“发货异常提醒”，已询问操作者是否处理。尚未确认它对发布的影响，不能把它归为本次ret失败原因；按照既定风险暂停要求，真实发布保持暂停，技术诊断继续。

确认一个独立代码问题：本次查询失败的failure_stage被旧上传checkpoint覆盖。已在隔离候选 `output/item-actions-r16/table-response/failure-stage-1791516681563/project` 修正，仅修改listing-round.mjs、travel-os.js及定向测试。查询故障用existing-listing-query/known-listing-query两个明确阶段，避免与existing-listing-check的候选隔离语义混用；原断点、暂停逻辑、分类和重试计数不改。旧代码复现2项阶段错误；最终定向125/125及两文件语法通过。独立控制反例8/8通过，覆盖提交未知有/无ID均不得跳过、原候选继续隔离、未提交查询故障可手动跳过、人工验证及暂停保护；首次3项夹具构造未满足原队列权限的失败日志保留，修正夹具后才得到8/8。日志 `output/independent100-20261009/qa/failure-stage-controls-r2.log`。候选**未部署**，不能称列表故障根因已解决。

## 千叶市历史诊断

本轮按“局域网实际运行 → 具体故障 → 有限诊断 → 原任务恢复”处理，不改商品资料、发布规则或历史状态。它属于第二100窗口诊断，不是独立100条验收。

## 已确认现场

06:37:01，原700清单 `d9a24f58-4df1-4af8-bdb4-671da2424bb5`、窗口 `89a13f35-6e9a-4dc5-8558-024ac161999f` 在第490项千叶市提交前查重暂停。稳定key `5d6f792c4c76c071dd7def751e4200615fa4e59d91eff3c93ddb02356f6f89a6`，taskHash `ade6624191f61408c7b26e570d749d6df9031098e6fac5dec19e634e16ce7583`，没有run、尝试、进入发布或提交。其余待处理保留。

后台请求HTTP 200，外层ret校验失败，result缺失；不能把页面零行当作商品不存在。脱敏记录的 `unknownRetCount=1` 还可能指ret元素类型/分隔格式不符合约定，并不一定是一个未知错误码。没有保存原ret或凭证，故无法追溯其具体业务错误。不能归因为网络、登录或风控中的任何一项。

原失败证据：`workbench/output/tasks/rounds/d9a24f58-4df1-4af8-bdb4-671da2424bb5/verification/5d6f792c4c76c071dd7def751e4200615fa4e59d91eff3c93ddb02356f6f89a6/table-failure-261aaeb8-2f84-4ecf-b556-c8f34eecaa84.json`。

## 原页诊断

06:42只读检查原后台列表，五洲畅游、千叶市查询、空商品ID、无可见验证或登录提示，未导航/切页。DOM和截图位于 `output/item-actions-r16/table-response/chiba-1791499340870.json` 及同名 `-0.png`。

06:44:17仅点击一次原生“搜索”。只接收此次页面请求中all/page1/千叶市/空商品ID及空其他筛选的响应，保存协议白名单投影，不保存请求头、Cookie、令牌或完整响应。返回SUCCESS、result.success=true、rows=[]、total=0、pageSize=20；前后店铺、查询、验证状态一致。证据 `table-response/native-search-result.json` / `.png`。第一次诊断脚本因URL存在查询参数而在连接和点击前拒绝，修正准确origin/path唯一匹配后才执行上述一次查询；没有重复点击。

这证明当前这次查询已恢复，不证明原始失败根因，也不替代完整库存及“千叶市/千叶”的原查重流程。不加入未知错误自动重试，不放宽SUCCESS或列表完整性检查。

## 恢复条件和范围

正式r19/PID37048保持；此前独立放行的43份源码哈希、28项内核相同，无生产代码修改或服务重启。原店fresh登录、原清单/授权/窗口/hash固定，无活动run，同key无run/history，58新增核验/16隔离/26未完。

通过独立审核后只允许一次原网站 `/api/v1/rounds/resume`，由产品API重置库存缓存并重跑完整查重；不手工填表或发布，不修改数据库。原失败保留。恢复请求、回执与实际结果分别记录，不能把请求接受当作发布成功。

06:45素材记录审计覆盖58条完成任务和75份源文件，未发现回执顺序、源哈希、标题/店铺/商品ID差异；16隔离项均无run/提交。证据 `output/item-actions-r16/practice-material-audit-1791499556928.json`。不代表远程图片字节和全部图像内容目视核验。

尚未完成：本窗口剩余处理、独立100条验收、700全量结果、单条操作完整接入、Codex实际断开验证。未同步GitHub。

## 06:47 原窗口恢复

独立审核 `output/independent100-20261009/qa/chiba-native-query-resume-independent.json` 放行一次恢复，最终脚本SHA256 `f6513ed123761770fa0393521400e6520bec09276c45e8e649f412a5d8738a58`，放行文件SHA256 `8ae12c039845189b79da444f5a867140561f2bfac2dd639b1e8492387bfbb0b8`。06:47:45原API接受恢复，requestId `81a96c6b-0e92-487d-9195-730eaffa3b37`，响应200；未启动第二个执行器。具体记录 `table-response/resume-request.json` 与 `resume-response.json`。

06:47:58原服务RUNNING/active，千叶市正在existing-listing-check。独立浏览器只读检查真实局域网页面显示同一轮次及58/100，0页面错误、0写请求，截图 `output/playwright/practice100-live-1791499676969/running-desktop.png`。实际千叶市发布结果待后续核验。

## 06:53 千叶市结果及自动推进

06:53:50千叶市核验商品 `1088355119076` 出售中，原价20、库存999999。恢复后06:50:08重新核对完整库存514条，随后分别查“千叶市”和“千叶”，两次有效响应均0行，原查询缓存没有被直接沿用。新run `f9e7137c-acb4-42f8-ae57-e535ea2b7b0a` 是此key唯一run；原任务/hash及窗口分配保持，attempt 0→1、extra0，仅一次提交。原失败事件1730/1731及原脱敏文件保留。

run、父任务、队列、history、结果附件及VERIFIED事件一致；后台、提交前表单、源主图已目视抽查，店铺/标题/ID/价格/库存/状态与主图缩略图对应，表单5张主副图槽、8张详情缩略图。没有把缩略图抽查当作所有素材真实性审核。成功页按642→643→644保存后关闭，页面归属精确对应同run/key/hash/window。

只读检查 `table-response/verify-recovered.mjs` 首版误读round_items不存在的attempts列；按实际schema改为读取batch_items.attempts，未改生产状态或数据。独立审核另行读库对照先前快照，结果通过：`output/independent100-20261009/qa/chiba-recovered-independent.json`，SHA256 `2e06ba2182b1f2d80db0c6fff498c3ee13282d84e4c13d1bfe9c156a14be4ef5`。

网站随后自行完成约翰内斯堡并进入特拉克帕克；07:00本窗口60新增核验、16隔离、24未完。没有追加逐条继续请求。本次是故障后的恢复验证，原ret失败根因仍未知，也不构成独立100条验收。
