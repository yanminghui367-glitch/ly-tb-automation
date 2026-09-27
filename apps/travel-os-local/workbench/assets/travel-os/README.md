# 星途首页视觉素材

仅用于工作台品牌界面；没有加入商品资料包、源表或发布任务。

## 本次唯一参考还原增量（2026-09-23）

- `earth-lights-2016.jpg`：NASA Earth Observatory [Black Marble 2016 Grayscale 全球图](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/)，3600×1800 的等经纬球面贴图。[原 JPEG](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_01deg_gray.jpg) 原字节本地保存，SHA-256 `4d2158f59123dadf0696a1cf8909c45018a1de8d0daab40da04122a5aa7f27c6`。仅首页将真实观测亮度映射为暖金色；不是实时灯光、店铺覆盖或市场热度。原 `earth-night.jpg` 仍用于八模块工作台。
- 飞机：复用 Phosphor MIT 图标体系的 [airplane-fill SVG 路径](https://github.com/phosphor-icons/core/blob/main/assets/fill/airplane-fill.svg)，内置路径绘制至透明纹理；许可见 `icons/LICENSE`。弧线连接原目录的真实坐标，仅装饰，无航班数据含义。
- 原 `brand-reference.png` 是唯一构图验收目标。本轮未生成新背景或城市图；现有东京氛围图不是图一中的同一张建筑画面，已如实保留标注。
- 下文“自然植被绿、沙漠棕、白云”描述继续适用于工作台；本轮按用户最新要求为首页增加深蓝夜景分支，不覆盖旧贴图。

- `earth-scene.png`：内置 image_gen 依据用户参考图编辑，1672×941；完整提示词见 `ASSET_SOURCE.md`。装饰航线和地球不是精确地理数据。
- `tokyo-atmosphere.png`：内置 image_gen 生成，2172×724；完整提示词见 `tokyo-atmosphere.source.md`。界面标注“AI 城市氛围图”，仅东京展示，不用于商品发布。
- `icons/*.svg`：Phosphor Icons regular 图标，来源 https://github.com/phosphor-icons/core/tree/main/assets/regular ，下载于 2026-09-23；许可证保留在 `icons/LICENSE`。选用指南针、地图标记和细线操作图标，与旅行导航语义一致。
- 中文字体：使用本机 Microsoft YaHei，数字及英文使用 Segoe UI；评估过思源黑体官方项目 https://github.com/adobe-fonts/source-han-sans ，本轮未新增字体下载依赖。

首页没有远程字体、远程图片或第三方统计请求；用户商品图通过原有本地素材校验接口读取。

## 3D 首页增量

- `brand-reference.png`：用户提供的原图，未经重绘；CSS 仅展示原图左上星形区域，因此 Logo 图案与原图一致。
- `space-backdrop.png`：内置 Image Gen 编辑，移除静态地球和 UI，保留星空与右下露台；完整来源见 `space-backdrop.source.md`。不加入商品包。
- `earth-day.jpg`：当前为 [three-globe 的 Blue Marble 示例地表原图](https://github.com/vasturiano/three-globe/blob/master/example/img/earth-blue-marble.jpg)，4096×2048，本地保存原文件。2026-09-23 写实调整替换之前的 turban `2_no_clouds_4k.jpg`；旧版本保留在 Git 历史中。
- `earth-night.jpg`：[three-globe 示例夜景贴图](https://github.com/vasturiano/three-globe/blob/master/example/img/earth-night.jpg)，本地保存原文件。只做球体视觉底图。
- `vendor/`：Three.js 0.186.0 的 three.module.js、three.core.js 与 OrbitControls，MIT 原 LICENSE 保留；OrbitControls 的 bare import 改为相邻本地路径。版本在 package-lock.json 锁定，不在线加载 CDN。
- `icons/plus.svg` / `minus.svg`：同一 Phosphor regular 图标集，遵守现有 LICENSE。

## 沉浸地球材质增量（2026-09-23）

- `earth-bump.jpg`：https://github.com/turban/webgl-earth/blob/master/images/elev_bump_4k.jpg ，4096×2048，原文件保存，用于微地形法线。海平面灰度非零，不用于直接区分海陆。
- `earth-clouds.png`：当前为 [turban/webgl-earth 的 fair_clouds_4k.png 原文件](https://github.com/turban/webgl-earth/blob/master/images/fair_clouds_4k.png)，4096×2048，独立透明云层。2026-09-23 写实调整升级之前的 Three.js 1024×512 云层，未重绘或合成地理信息。并非实时天气。
- 海陆影像、夜灯、地形与云层均为本地 4K 贴图。自然植被绿、沙漠棕和雪白直接保留原影像颜色，深蓝海洋、适量暖色夜灯与日照共同构成写实视觉；太阳是视角相对的展示光照，不代表当前天文昼夜。所有资源由 localhost 提供，运行时不需要外部地图服务。
- 技术参考：[ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html)、[OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)、[背景 inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)。

本轮原文件 SHA-256：

- `earth-day.jpg`：`228deba2e4b600146bdcb6cfa359b8ead6aacc2b1c13550a29cd82824cfa1c01`
- `earth-clouds.png`：`35c46d8b29651a99e482401f33ed752bf4625837435fb3a89bb0032f72b88a3a`
