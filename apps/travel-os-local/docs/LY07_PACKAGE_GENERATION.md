# LY｜07 商品包自动化生成

日期：2026-09-12。当前交付为 P3 的一个子模块：指定旧商品包生成当前契约的审核副本。Excel 直读生成完整新包、工作台生成按钮和真实发布均不属于本轮已完成范围。

## 已核实的问题

旧脚本 `tools/build_new_image_release.mjs` 把四张副图写入 `assets.secondary_image_set.files`；当前工作台校验读取 `assets.secondary_images`。抽查旧英国包还缺少两个标题版本及人工选题下标。历史报告的 READY 不能作为当前工作台准入证据。

## 使用

在项目根目录执行，输出目录的父目录须已存在，输出目录本身必须是全新目录：

```powershell
node tools/generate_review_packages.mjs `
  --source output/batch-004-new-desktop-images-700 `
  --file 0004-英国.json `
  --output output/ly07-review-next
```

通过重复 `--file` 明确指定多条商品，单批最多 300 条。不扫描或自动处理整个历史目录；不覆盖已存在的输出目录。

输出为同名商品包、`preflight-report.json` 和 `preflight-report.md`。用工作台已有的文件或目录导入入口审核；本工具不会自动改写队列。报告含本机路径，仅供本地使用。

## 规则

- 复用工作台实际的导入与强校验函数；导入服务模块时禁用监听，不启动 HTTP 或 Chrome。
- 副图优先保留现行 `secondary_images`，仅当它不存在时迁移旧 `secondary_image_set.files`。不排序、不猜图，不把显式空数组替换为旧图。
- 主图、副图、详情图相对路径按原包所在目录解析为绝对路径，详情顺序逐项保留；检查非空文件与工作台支持的后缀。没有执行图片解码、OCR 或内容识别，内容与目的地一致性必须人工核验。
- 保留已有两版标题和人工选择；旧单标题放入第一版，第二版留空，选择下标不自动补齐。所有标题的服务内容和类目字数仍须人工确认。
- 业务字段仅从原包转录，未知字段沿用空白模板，不补价格、库存、类目、物流或供给。原包 SHA-256 与路径记录在 `generation` 中，便于追溯；转录不代表核实。
- 所有输出固定 `NEEDS_REVIEW`，审核证据与页面映射重新留空，必须按现有审核流程重新核验。结构完整也不会提升到 READY。
- 拒绝重复文件、源目录外的商品包、同店同类型目的地重复、SKU，以及已有执行或发布结果的源包。重复检查仅限本批，不替代工作台队列和淘宝线上核对。
- 先完成全部输入解析和校验，再创建输出目录。写盘阶段若失败，目录可能不完整；检查报告齐全后才导入，重试使用新的输出目录。

## 本机验收

- `node --test tools/generate_review_packages.test.mjs`：7 项通过，包括实际工作台导入校验。测试素材只是临时测试字节，不是业务图片或平台验收证据。
- `npm --prefix workbench run check`：现有服务端与前端语法检查通过。
- 使用旧包 `output/batch-004-new-desktop-images-700/0004-英国.json` 生成 `output/ly07-review-20260912/0004-英国.json`，得到 1 条 NEEDS_REVIEW、0 条 READY。主图、4 张副图、9 张详情的本机文件检查无报错；双标题及人工选题仍缺失，五项发布证据仍阻塞。
- 生成前后原英国包与 `workbench/.runtime/jobs.json` 的 SHA-256 一致，未改原包或运行队列。
- 完整输出见 `output/ly07-review-20260912/preflight-report.md`；可重复测试日志见 `output/ly07-review-20260912/verification.txt`。

## 下一小模块

明确 Excel 标题池的实际双标题列、人工选择列、素材来源与固定顺序契约后，将表格行适配到当前商品包结构。真实业务缺项未补齐前，仍只生成待审核资料；不进入 P4/P5/P6。
