# 侧栏执行状态球｜2026-10-18

最终独立生产只读QA通过，候选40项界面检查、生产7项检查与4项HTTP内容核对均通过。最终验收见`output/sidebar-execution-orb-20261018/acceptance.json`及`qa/production-review.md`。

正式加载：用户明确等待自然暂停、不主动打断。确认八店均idle后静态加载，服务PID44380不变，84项`20261018-sidebar-execution-orb`通过，只更新5个审查运行hash；没有重启网站/Chrome，没有发送原任务暂停或恢复动作。实际桌面/390px/跨页等7只读检查及4项HTTP字节核对通过，刷新网站即可加载新UI。

保全边界：安装后另一次原生rounds/resume请求产生原当前商品的有界恢复审计，严格全表相等首检未通过，原失败证据保留。逐行比较备份：8库全表相等；环球7表仅增加原scope的page借用1、动作1、RESUME尝试1及轮次事件10，三个投影行只变updated/repair_version。旧审计行、所有run/queue、700任务快照、设置均保留，没有新增提交。该恢复请求的操作者身份未独立确认，本聊天没有发送它；不覆盖或回退该请求。具体证据为`data-preservation-audit.json`、`qa/production-data-audit.json`及`production-after.json`，不将此情况描述成9库全表字节完全不变。

用户要求：在截图左侧导航下方红框内增加一个与执行监控球体相同的着色球，具有同样功能，保留原位置。

沿用原SHDR-12组件、110px尺寸、配色、动画参数、DPR上限1.5及WebGL静态备用球。原球功能是显示执行状态，没有任务按钮或声音采集；新球保持相同边界。当前店铺原轮次RUNNING且active、服务连接正常时两处均为speaking，其余状态idle。侧栏跨页面持续接收状态，展开后显示，收起或移动端未打开导航时隐藏。

`execution-orb.tsx`原单实例改为每个位置各保留一个画布，跨SSE复用；WebGL/备用球观察器各自绑定本实例。`travel-os.html`在导航后增加位置，`travel-os.css`处理展开/窄屏布局，`travel-os.js`复用现有状态流，不增加API请求。`execution-orb.js`由原构建脚本生成；未改上架执行器、商品规则、图片、任务次数或平台操作。

候选在`output/sidebar-execution-orb-20261018/dev/`，6个文件精确哈希见同目录`candidate-manifest.json`，5个原冻结运行文件。`ui-test.log`29个本地浏览器检查通过，包括两个真实WebGL画布、尺寸/DPR、状态切换、SSE复用、跨页面、断线重连、侧栏收起、390px、单实例context丢失互不影响、隐藏暂停绘制及无业务修改请求。

正式更新只在所有店铺执行器空闲时进行，避免正在执行的每步冻结核验因中途换静态文件而触发暂停。采用纯静态同步，不重启网站或Chrome，保留其他并行成果。更新时机答复保存在本轮输出目录`update-timing-authorization.json`，独立QA与实际安装、HTTP/数据保全证据在同一目录，候选与实际加载分别验收。
