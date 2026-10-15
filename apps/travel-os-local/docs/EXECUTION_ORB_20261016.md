# 执行监控状态球

按2026-10-16用户指定，在自动化任务的执行监控标题右侧加入110px Orbkit SHDR-12。使用官方registry的真实WebGL组件及原版idle/speaking参数，保留MIT许可。来源：https://github.com/zzzzshawn/orbkit ，registry：https://orbkit.zzzzshawn.cloud/r/shdr-12.json 。

只有服务连接正常、原轮次状态RUNNING且active为真时显示speaking；暂停、安全暂停中、停止、等待人工、执行异常、完成、断线及无活动轮次均为idle。只是动画状态，不采集声音、不执行或修改任务。

原生工作台保持原结构，仅给状态球单独打包React组件。`execution-orb.tsx`维护一个画布跨SSE重绘复用；原版运行库在视野外及隐藏标签停止动画，尊重减少动态效果偏好，DPR上限1.5。无法创建WebGL、失去context或shader编译失败时显示静态备用球。可见画面绘制完成后才隐藏备用球。

源码位于`workbench/components/orbkit/`；适配器`workbench/execution-orb.tsx`；可直接静态加载的构建产物`workbench/execution-orb.js`。重建运行`npm run build:execution-orb`（workbench目录）。组件不依赖第三方CDN，静态服务只新增该JS的精确白名单。

功能回归37项及语法检查通过；独立浏览器验收、截图、最终SHA和维护前后保全证据保存于`output/orbkit-20261016/`。本次维护不启动上架，也不改变原任务、跳过记录、重试次数或当前暂停原因。
