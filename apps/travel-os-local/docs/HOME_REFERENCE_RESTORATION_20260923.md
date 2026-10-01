# 星途首页定向还原 · 2026-09-23

【当前阶段】P2 首页定向视觉还原。唯一目标为 `workbench/assets/travel-os/brand-reference.png`，1672×941。

【本轮目标】保持真实搜索、球体交互、资料和工作台入口，将构图、夜景材质、卡片和光效靠近原图；不增加业务功能、不发布商品。

【检查到的现状】原生 HTML/CSS/JS，首页 `travel-home.*`，Three.js 0.186.0 本地模块；八模块位于 `/travel-os.html`。此前球体过小同时受容器宽高与相机距离影响，材质采用日间自然影像，默认聚合过密；运营摘要影响首屏。用户未提交的8个 `tools/` 文件均保留。

【本轮完成】

| 分类 | 文件 | 范围 |
| --- | --- | --- |
| A 构图 | `workbench/travel-home.html`、`travel-home.css` | 大地球、左右比例、卡片/入口尺寸；运营区与来源移至首屏后，保留原数据和入口 |
| B 渲染 | `workbench/travel-globe.js` | 只为首页启用夜景分支、独立相机、薄云与大气；真实夜灯、少量标签、坐标弧线和飞机；保留现有旋转/缩放/定位/完整目录 |
| B 素材 | `workbench/assets/travel-os/earth-lights-2016.jpg`、`README.md` | NASA 2016 灰度夜灯原图与来源；原地表、云、星空、东京图复用 |
| C 控件 | `workbench/travel-home.css`、`travel-home.js` | 渐变标题、搜索/按钮光效、图片遮罩、精简资料卡、显式清除搜索 |
| 外围服务 | `workbench/static-files.mjs` | 仅新增该 JPEG 的精确静态白名单，无 API / 业务逻辑修改 |
| 验收 | `workbench/scripts/home-reference-visual.mjs`、`home-reference-interactions.mjs` | 固定状态截图、并排/叠加、坐标投影与操作证据；不写生产数据 |
| 既有测试 | `workbench/scripts/globe-premium-ui.mjs`、`travel-home-ui.mjs` | 初始镜头变化后按原2.2阈值连续缩放；原导入深链实际直达弹窗；用户要求运营区保留在首屏之后 |
| 规则 | `.interface-design/system.md`、本文件 | 记录最新目标覆盖旧视觉冲突、验证及局限 |

基准几何：以下参考边界为原图测量近似值，非像素差评分。

| 元素 | 图一 | 最终网页 |
| --- | --- | --- |
| 地球 | 可见宽约752，中心约365/450 | 球体约730宽、蓝色外气层约778；中心约368/450，左缘轻微出画 |
| 搜索 | x786 y270，671×64 | x786.9 y270.4，669.5×64 |
| 城市卡片 | x786 y404，830×243 | x786.9 y404.4，829.5×244 |
| 主入口 | x786 y675，289×69 | x786.9 y677.4，288×68 |
| 数据条 | 透视外缘约x92 y627–753 | x91.6 y628，477×112，水平板 |
| 运营摘要 | 首屏无 | y965开始，保留真实内容 |

【验证结果】

- **视觉：有限范围可交付。** 独立 QA 对照原图、并排和透明叠加，关闭提示压按钮及1440标签压工具栏两项P2；1440/1672/1920/390均复核。没有声称整页像素1:1。
- **功能：59项浏览器检查通过**（26地球、24首页、9本轮专项）。东京/巴黎定位，清除、候选键盘、同名隔离数据、无结果、缺坐标、拖转、缩放、触屏、全屏退出、资料/记录/工作台深链、断线/空数据及WebGL失败降级。
- 6种交互状态的可见标签与真实经纬度投影最大误差0.064 CSS px以内，背面标记检查通过；canvas缓冲与实际渲染区域一致。此值是交互几何校验，不是视觉相似度。
- 两张相隔40个实际动画帧的固定状态PNG逐字节相同；普通入口仍自动转动。截图等待字体、纹理及图片加载，不只停CSS动画。
- 语法检查通过；静态服务11项、目的地/地球11项单元测试通过。无构建打包步骤：当前原生栈直接由本地服务提供文件。
- impeccable布局扫描余下1条静态“左边框无内距”提示；实际1672页面逐个检查div计算样式，存在左边框且内距少于8px的元素为0。该提示来自样式层叠的静态推断，未为消警报改动已正确的布局。
- 写API被测试浏览器拦截，实际0写请求；30条原记录ID集合不变，active=null、executionEnabled=false。10个冻结内核文件哈希匹配，0新增发布。
- 中途一个旧测试命令使用了不存在的 `globe-layout.test.mjs`，随后运行真实 `globe.test.mjs`；首页旧断言预期先到设置页，实际原深链直接打开导入弹窗，按现有行为修正后24项全部通过。未改发布代码来迎合测试。

证据根目录：`output/playwright/home-reference-20260923/`（本地验收产物，不进入代码基线）。

| 证据 | 文件 |
| --- | --- |
| 修改前 / 修改后，同尺寸DPR1 | `before/desktop.png` / `final/desktop.png` |
| 原图左、网页右 | `final/side-by-side.png` |
| 原图底、网页50%透明度 | `final/overlay-50.png` |
| 每轮完整证据 | `round1-layout/`、`round2-night/`、`round3-detail/`，各含截图/并排/叠加/几何JSON |
| 响应式 | `final/viewport-1440x900.png`、`viewport-1920x1080.png`、`viewport-390x844.png` |
| 操作截图 | `interaction/03-tokyo-search.png`、`04-paris-search.png`、`05-no-results.png`、`06-drag.png`、`07-zoom.png`、`08-fullscreen.png`、`09-workspace-navigation.png` |
| 固定状态 / 投影 / 写入检查 | `interaction/checks.json`、`final/capture.json` |
| 回归结果 | `functional-globe/ui-qa.json`、`functional-home/ui-qa.json` |
| 独立视觉审核 | `independent-qa.md` |

重复验收：启动现有本地服务后，从仓库运行 `node workbench/scripts/home-reference-visual.mjs review --responsive`；专项交互为 `node workbench/scripts/home-reference-interactions.mjs`。新的截图名不会覆盖 `before`。固定状态访问 `http://127.0.0.1:4318/?visual=reference`；正常首页为 `/`，不带参数。所有真实执行维持关闭。

【仍未完成】没有整页像素1:1：原图AI字形不可直接作为字体；当前使用本机微软雅黑。东京原AI图的精确建筑图片未提供，复用已有标明AI的氛围图；统计板没有复制原图透视；地球云光更克制。伦敦/巴黎等背面城市不强制穿透显示，真实地理布局不复制AI参考的位置错误。原图次按钮为未实现视频，本轮不伪造，因此主按钮后留白较多。

【阻塞项】本轮无剩余有证据的功能或视觉交付阻塞。缺少精确字体/东京原素材限制进一步像素还原，不以临时替代品冒充同一素材。

【风险】NASA灯光是2016静态观测，云层非实时天气；三条弧线是装饰。全部材质本地加载。不同GPU/字体栅格可能有渲染差异，本轮只证明指定Chrome/DPR1环境；未测当前材质的设备帧率，不宣称固定60fps。

【下一步】用户在正常首页查看本轮结果。无需扩大真实发布验证。回退时只反向应用本次首页提交，不恢复整个仓库、不覆盖用户其他修改；旧贴图与原发布代码始终保留。若WebGL/贴图不可用，页面明确提示，目的地搜索、完整列表和工作台入口保留，不静默换成假地球。
