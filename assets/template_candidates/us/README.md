# 美国目的地主图模板候选

生成日期：2026-08-26  
用途：在正式批量生产目的地主图前，从 10 个视觉方向中人工选定 1 个全店统一模板。  
生成方式：Codex 内置 `image_gen`，`ads-marketing` 用例。  
画布：1254 × 1254 PNG，1:1。

## 固定文案

- `美国`
- `中文地陪｜导游翻译`
- `包车接送机 · 一日游 · 商务陪同`
- `行程按需定制｜下单前请先咨询`

所有候选均禁止价格、折扣、保证性用语、二维码、手机号、第三方 Logo、水印及额外文案。

## 候选方向

| 编号 | 文件 | 视觉方向 | 选型判断 |
| --- | --- | --- | --- |
| 01 | `us-main-01-cinematic.png` | 电影感目的地合成 | 冲击力强，画面较满 |
| 02 | `us-main-02-editorial.png` | 明亮旅行杂志 | 信息最清晰，风格稳健 |
| 03 | `us-main-03-luxury.png` | 深色高端礼宾 | 质感强，小图环境偏暗 |
| 04 | `us-main-04-modern-ecommerce.png` | 明亮现代电商 | 点击导向强，颜色活跃 |
| 05 | `us-main-05-minimal-poster.png` | 极简旅行海报 | 清爽耐用，适合长期统一 |
| 06 | `us-main-06-scrapbook.png` | 旅行手账拼贴 | 个性强，但模板替换复杂度较高 |
| 07 | `us-main-07-map-infographic.png` | 地图信息图 | 目的地认知直接，城市级复用需调整地图 |
| 08 | `us-main-08-night-glass.png` | 夜景玻璃面板 | 高端醒目，跨目的地适配受夜景限制 |
| 09 | `us-main-09-nature-city.png` | 自然与城市融合 | 旅游感强，整体平衡 |
| 10 | `us-main-10-conversion-poster.png` | 强转化淘宝海报 | 缩略图识别强，商业感最明显 |

## 提示词集合

十张图共用以下核心规格，仅替换视觉方向：

```text
Use case: ads-marketing
Asset type: square Taobao travel-service product main-image template candidate
Primary request: US destination custom travel service hero.
Scene/backdrop: realistic symbolic imagery of New York, Golden Gate Bridge and Grand Canyon.
Composition/framing: square 1:1; large destination title; service subtitle; three service labels; bottom consultation note; mobile-readable safe margins.
Text (verbatim): "美国" "中文地陪｜导游翻译" "包车接送机 · 一日游 · 商务陪同" "行程按需定制｜下单前请先咨询"
Typography: exact Simplified Chinese, bold clean sans-serif, render each phrase exactly once.
Constraints: no prices, discounts, guarantees, QR code, phone number, third-party logos, watermark, extra text or misspelled Chinese.
```

各候选的视觉方向依次为：电影感、旅行杂志、深色高端、明亮电商、极简海报、手账拼贴、地图信息图、夜景玻璃面板、自然城市融合、强转化电商海报。

## 推荐

优先进入下一轮的三个方向：

1. `02`：信息最清楚，跨国家和城市的适配成本最低。
2. `05`：视觉稳定、耐用，最适合作为长期统一模板。
3. `10`：淘宝缩略图环境下最醒目，适合测试点击表现。

最终模板确认后，应将 AI 图中的文字层改为 Pillow 确定性渲染，并以模板配置控制字号、位置、换行和安全边距。
