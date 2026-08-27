# 全店共享详情页 V1

生成日期：2026-08-26  
生成方式：Codex 内置 `image_gen`  
规格：1024 × 1536 PNG，竖版 2:3  
视觉系统：与共享副图一致；全店共享，不包含国家或城市变量。

## 建议上传顺序

1. `00-详情首图-01-境外中文旅行服务.png`
2. `00-详情首图-02-行程按需定制.png`
3. `01-八类服务.png`
4. `02-旅行陪同与语言服务.png`
5. `03-交通与商务服务.png`
6. `04-适用场景.png`
7. `05-服务流程.png`
8. `06-请提供这些信息.png`
9. `07-重要说明.png`

## 内容逻辑

```text
建立服务认知
→ 说明按需定制
→ 展示八类服务
→ 拆解旅行/语言服务
→ 拆解交通/商务服务
→ 匹配使用场景
→ 解释服务流程
→ 收集报价信息
→ 明确服务边界与咨询要求
```

## 共用提示约束

```text
Use case: ads-marketing
Asset type: shared vertical Taobao travel-service detail-page image
Style: polished Chinese ecommerce detail-page design with editorial clarity, photorealistic travel imagery and clean icons.
Palette: warm white, deep navy, restrained vermilion red, small teal accents.
Composition: vertical 2:3 mobile detail image, clear top-to-bottom hierarchy, generous safe margins, readable Chinese.
Typography: exact Simplified Chinese, bold clean sans-serif, every provided phrase exactly once.
Constraints: no country/city names, discounts, guarantees, QR code, phone number, external contacts, third-party logos, watermark, extra text or fake credentials.
```

生产自动化时应使用 Pillow 重建版式并确定性渲染中文文字，避免依赖 AI 生成文本。
