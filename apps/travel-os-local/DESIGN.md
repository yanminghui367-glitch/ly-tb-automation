---
name: "星途 Travel OS 工作台"
description: "仅适用于 /travel-os.html 的八模块运营界面；原地球首页保持独立样式"
colors:
  gold: "#dfc391"
  cyan: "#87d5f5"
  bad: "#ffb4af"
  navy: "#071421"
  surface: "#0d2032"
  ink: "#eff3f7"
  muted: "#a9becd"
  line: "#7899b32b"
  button: "#142b3e"
  button-hover: "#203d52"
  input: "#091a29"
  primary-ink: "#102333"
typography:
  headline:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-.02em"
  title:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  badge: "5px"
  control: "8px"
  panel: "12px"
  destination: "16px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  panel: "20px"
  section: "24px"
  page: "30px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.button}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: 星途 Travel OS 工作台

## Overview

**Creative North Star: "有据可查的目的地控制台"**

深海军蓝承载密集操作，香槟金强调当前选择与主要动作。地球提供空间定位，工作面板提供可核对的事实；字体、表格和状态提示保持克制、清晰。

适用范围只有 `/travel-os.html` 的八模块。根路径 `/` 保持原星途地球首页，经“打开工作台”进入本界面；`/index.html` 保留原操作台。两者不继承本文件令牌，旧规则继续见 `.interface-design/system.md` 的对应日期章节。

**Key Characteristics:**

- 深蓝工作面、香槟金主动作、浅青链接。
- 地球与目的地详情联动，操作区采用紧凑原生控件。
- 中文状态、真实证据和明确禁用原因优先于装饰指标。

提取日期：2026-09-23。依据：`PRODUCT.md`、`.interface-design/system.md` 最新分层规则、`workbench/travel-os.css`、`travel-os.html`、`travel-os.js` 与导入的 `travel-globe-ui.css`；`travel-home.css` 仅核对首页边界。产品层验收见 `output/travel-os-product-20260923/reviewer/FINAL_REVIEW.md`。本文记录实现，不新增发布权限或业务验收结论。

## Colors

Primary：香槟金用于主按钮、选中状态、关键事实。Secondary：浅青用于可访问的详情链接。状态错误使用暖红文字；成功、待处理、异常徽标各有专用底色和中文标签，精确组合保存在 sidecar 组件中。

Neutral：海军蓝为页面底色，深层面板与细透明边界区分工作区域；星光白为正文，蓝灰为说明。前置令牌保留 CSS 原值；sidecar 的八阶色带仅供设计预览，为合成色阶，不是新增运行时色值。

**The Surface Boundary Rule.** 新工作台令牌不得覆盖原首页；原首页的星空蓝、航线青和城市夜灯金继续由 `travel-home.css` 管理。

## Typography

离线系统字体按前置令牌顺序回退。主标题在 850px 及以下缩为 24px；目的地标题为 30px，事实数值为 22px，在 850px 及以下缩为 19px。正文 14px，表格和控件辅助文案多为 12px，日志和次要元信息多为 11px；时间使用等宽数字。

窄屏连接状态为 11px；检查按钮、徽标和目的地事实标签为 12px。品牌小字与地球次级标注仍有更小字号，不把它们推广为业务控件字号。

## Layout

桌面为 208px 侧栏和弹性主区，页边距使用 page 间距；总览为地球与 330px 目的地面板。任务区按队列 / 节点和日志 / 状态与介入排列，默认列宽为 250px / 弹性 / 270px，列间距 16px。

| 视口 | 已实现的变化 |
| --- | --- |
| ≥1600px | 页边距 35px 40px；目的地面板 370px；任务列为 270px / 弹性 / 300px |
| ≤1200px | 侧栏 178px；页边距 24px；任务改两列，介入面板位于执行区下方 |
| ≤850px | 侧栏变顶部横向滚动导航；页边距 22px 18px；设置区单列 |
| ≤620px | 地球与详情上下排列；任务三部分顺序堆叠；表单与店铺卡单列；表格保持 620px 最小宽并在容器内横滚 |

间距以 4px 节奏为参考，保留现有控件的局部光学调整。表格长文本折行，弹窗和素材条独立滚动，不把局部溢出传递给页面。共享地球组件另在 550px 调整标注与全屏控制。

## Elevation & Depth

普通工作面依靠底色与细边界分层。搜索建议、通知和弹窗使用阴影，精确值见 sidecar。目的地面板使用半透明背景与 14px 模糊；弹窗背景遮罩使用 6px 模糊；共享地球工具也保留既有 8px 模糊。不要把玻璃效果扩散到任务表格。

全屏地球在独立覆盖层中显示，隔离背景交互，保留可见退出按钮及 Esc 返回。普通控件无额外动效；共享地球的 reduced-motion 样式关闭相关过渡。

## Shapes

控件使用 control 圆角，工作面和表格外框使用 panel 圆角，目的地卡及弹窗使用 destination 圆角。店铺卡为 14px，徽标采用较小圆角；圆形只用于地球点位与步骤节点。

## Components

- **按钮：** 常规最小高度 38px；主按钮金底、深色文字、650 字重，hover 变浅金。次按钮深蓝底，hover 提亮并加强边界。表格、地图和状态栏存在紧凑例外，不把其尺寸推广为主要操作。
- **焦点与禁用：** 常规键盘焦点为金色 2px 外框、3px 偏移；地球画布使用共享组件的青色焦点。禁用按钮 50% 不透明度并显示禁止光标；断线、动作处理中或显式锁定时禁用标记为写操作的按钮。
- **输入与对话框：** 深色输入框配可见标签；错误显示在表单内并提供提示。原生 dialog 保留键盘关闭行为；保存失败保留表单与错误信息。
- **导航与筛选：** 当前页面使用 `aria-current=page`；筛选用 `aria-pressed`，选中项有金色文字与独立底色。窄屏保留全部入口，允许横向浏览。
- **状态与节点：** 成功、待处理、异常同时提供文字与颜色；步骤节点只按实际事件显示完成或当前状态。暂停请求与已保存断点、待核验与已核验必须区分。
- **空态与连接：** 无选择、无结果和无记录给出可执行下一步。断线提示明确数据来自上次读取，提供重连；恢复后重新读取状态，不显示推测成功。
- **目的地事实：** 产品、报价、店铺、执行记录为可点击的关联入口；所选目的地贯穿后续列表。氛围图片只用于匹配的目的地。

## Do's and Don'ts

### Do:

- Do 保留原地球首页与八模块工作台的路由、视觉边界。
- Do 用实际状态、中文标签和证据入口解释每个操作结果。
- Do 保留可见焦点、窄屏入口、局部横滚和断线提示。

### Don't:

- Don't 把新工作台的颜色或侧栏套到原首页或原操作台。
- Don't 用进度百分比、模拟成功或无依据的经营指标装饰页面。
- Don't 将资料预检、界面验收或准备单显示成正式发布成功。
