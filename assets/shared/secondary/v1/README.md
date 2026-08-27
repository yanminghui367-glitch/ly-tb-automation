# 全店共享副图 V1

生成日期：2026-08-26  
生成方式：Codex 内置 `image_gen`  
规格：1254 × 1254 PNG，1:1  
视觉系统：暖白、深蓝、少量红色与青绿色；杂志式信息层级；全店共享且不包含国家/城市变量。

## 图片方案

1. `secondary-01-services.png`：八类服务总览。
2. `secondary-02-scenarios.png`：自由行、家庭、商务与展会场景。
3. `secondary-03-process.png`：旺旺咨询、提交需求、确认报价、安排服务。
4. `secondary-04-order-guide.png`：目的地、日期、人数、服务需求及价格说明。

## 共用提示约束

```text
Use case: ads-marketing
Asset type: shared square Taobao travel-service secondary image
Style: polished Chinese ecommerce travel-service infographic with editorial magazine clarity, photorealistic travel accents and clean icons.
Palette: warm white, deep navy, restrained vermilion red, small teal accents.
Composition: square 1:1, strong mobile hierarchy, generous safe margins, no country or city name.
Typography: exact Simplified Chinese, bold clean sans-serif, every provided phrase exactly once.
Constraints: no discounts, guarantees, QR code, phone number, external contacts, third-party logos, watermark, extra text or fake credentials.
```

生产自动化时应使用 Pillow 渲染中文文字，生成图用于确认视觉方案和内容结构。
