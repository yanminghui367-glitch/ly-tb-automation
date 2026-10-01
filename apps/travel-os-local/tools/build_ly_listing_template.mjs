import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const outputDir = `${root}/outputs/LY_listing_package`;
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const navy = "#102A43";
const teal = "#0F766E";
const red = "#C62828";
const gold = "#C69C3C";
const lightBlue = "#EAF3F8";
const inputFill = "#FFF4CC";
const gray = "#F1F5F9";
const white = "#FFFFFF";

function title(sheet, text, lastCol) {
  sheet.mergeCells(`A1:${lastCol}1`);
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${lastCol}1`).format = {
    fill: navy,
    font: { bold: true, color: white, size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.showGridLines = false;
}

function note(sheet, text, lastCol) {
  sheet.mergeCells(`A2:${lastCol}2`);
  sheet.getRange("A2").values = [[text]];
  sheet.getRange(`A2:${lastCol}2`).format = {
    fill: "#FDE8E7",
    font: { color: red, italic: true },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange("A2").format.rowHeight = 34;
}

function header(range) {
  range.format = {
    fill: teal,
    font: { bold: true, color: white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D8E2DC" },
  };
}

function label(range) {
  range.format = {
    fill: lightBlue,
    font: { bold: true, color: navy },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D8E2DC" },
  };
}

function input(range) {
  range.format = {
    fill: inputFill,
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D8E2DC" },
  };
}

function output(range) {
  range.format = {
    fill: gray,
    font: { bold: true, color: navy },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D8E2DC" },
  };
}

const product = wb.worksheets.add("商品包");
title(product, "旅游服务商品包｜美国中文旅行服务（上架前人工确认版）", "Q");
note(product, "黄色单元格为待填内容；任何一项硬性确认缺失，均不得点击最终发布。此文件不是平台类目导入模板。", "Q");

const meta = [
  ["商品名称", "美国中文旅行服务｜地陪导游翻译包车接送机｜按需定制", "服务目的地", "美国（具体城市待询盘确认）", "平台实际类目", "待人工确认", "上架账号", "待人工确认"],
  ["目标客群", "赴美自由行、家庭出行、商务及展会客户", "咨询入口", "旺旺", "展示价格", "待人工确认", "发布状态", "待审核"],
  ["主图建议", "主图10选1/us-main-10-conversion-poster.png", "详情页", "详情页/00-详情首图-01 至 07-重要说明.png", "素材范围", "仅用于美国商品；不可与其他国家混用", "报价口径", "展示价非最终报价，以双方确认结果为准"],
  ["核心卖点", "中文沟通；可按目的地、日期、人数和服务需求询价", "风险提示", "导游、车辆、翻译等服务须逐项核验供给与资质", "资质状态", "待人工确认", "最终发布人", "待人工确认"],
];
product.getRange("A4:H7").values = meta;
for (const r of [4, 5, 6, 7]) {
  label(product.getRange(`A${r}`)); input(product.getRange(`B${r}`));
  label(product.getRange(`C${r}`)); input(product.getRange(`D${r}`));
  label(product.getRange(`E${r}`)); input(product.getRange(`F${r}`));
  label(product.getRange(`G${r}`)); input(product.getRange(`H${r}`));
  product.getRange(`A${r}:H${r}`).format.rowHeight = 48;
}
product.getRange("B4:H7").format.wrapText = true;
product.getRange("A9:Q9").merge();
product.getRange("A9").values = [["可售服务单元（每行对应一个准备发布或报价的服务 SKU；请勿将未确认服务写为可售）"]];
product.getRange("A9:Q9").format = { fill: navy, font: { bold: true, color: white }, verticalAlignment: "center" };
product.getRange("A9").format.rowHeight = 24;
const productHeaders = [["商品编码", "目的地城市", "服务日期/时段", "服务类型", "人数", "服务语言", "时长", "车辆/规格", "展示价", "成本预估", "供给确认", "商品状态", "类目属性完整", "图片匹配", "资质确认", "备注", "发布闸门"]];
product.getRange("A10:Q10").values = productHeaders;
header(product.getRange("A10:Q10"));
const skuRows = [
  ["USA-CUSTOM-001", "待询盘确认", "待询盘确认", "按需定制咨询", "待询盘确认", "中文", "待询盘确认", "待确认", "待人工确认", "待人工确认", "待确认", "待发布", "待确认", "待确认", "待确认", "不可直接发布", null],
  ["", "", "", "", "", "", "", "", "", "", "待确认", "待发布", "待确认", "待确认", "待确认", "", null],
  ["", "", "", "", "", "", "", "", "", "", "待确认", "待发布", "待确认", "待确认", "待确认", "", null],
  ["", "", "", "", "", "", "", "", "", "", "待确认", "待发布", "待确认", "待确认", "待确认", "", null],
  ["", "", "", "", "", "", "", "", "", "", "待确认", "待发布", "待确认", "待确认", "待确认", "", null],
];
product.getRange("A11:Q15").values = skuRows;
product.getRange("Q11").formulas = [["=IF(AND(K11=\"已确认\",L11=\"待发布\",M11=\"已确认\",N11=\"已确认\",O11=\"已确认\"),\"可进入人工发布\",\"禁止发布\")"]];
product.getRange("Q11:Q15").fillDown();
input(product.getRange("A11:P15"));
output(product.getRange("Q11:Q15"));
product.getRange("I11:J15").format.numberFormat = "#,##0.00";
product.getRange("K11:O15").dataValidation = { rule: { type: "list", values: ["待确认", "已确认", "不适用"] } };
product.getRange("L11:L15").dataValidation = { rule: { type: "list", values: ["待发布", "已发布", "下架", "禁用"] } };
product.getRange("A10:Q15").format.borders = { preset: "all", style: "thin", color: "#D8E2DC" };
product.getRange("Q11:Q15").conditionalFormats.add("containsText", { text: "禁止发布", format: { fill: "#FDE8E7", font: { bold: true, color: red } } });
product.getRange("Q11:Q15").conditionalFormats.add("containsText", { text: "可进入人工发布", format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } } });
product.freezePanes.freezeRows(10);
for (const [col, width] of [["A:A", 17], ["B:B", 26], ["C:C", 15], ["D:D", 25], ["E:E", 14], ["F:F", 24], ["G:G", 14], ["H:H", 25], ["I:J", 12], ["K:O", 12], ["P:P", 18], ["Q:Q", 16]]) product.getRange(col).format.columnWidth = width;

const service = wb.worksheets.add("服务SKU字典");
title(service, "服务 SKU 字典｜只保留已可核验供给的服务", "H");
note(service, "此页列出素材中出现的服务方向，不代表已获授权或已具备供给能力；每项均须按实际目的地、日期与人员/车辆资源复核。", "H");
service.getRange("A4:H4").values = [["服务类型", "面向客户的描述", "关键询盘字段", "服务边界", "供给/资质确认", "默认状态", "定价依据", "审核备注"]];
header(service.getRange("A4:H4"));
service.getRange("A5:H12").values = [
  ["中文地陪", "按确认行程提供当地陪同沟通服务", "城市、日期、人数、时长", "不替代法定导游或交通服务", "待人工确认", "禁用", "待人工确认", "确认当地合规与人员身份"],
  ["中文导游", "按确认行程提供讲解与陪同服务", "城市、日期、人数、景点", "须与当地导游执照及服务范围一致", "待人工确认", "禁用", "待人工确认", "不可把无证陪同写为导游"],
  ["翻译服务", "按确认场景提供口译协助", "语种、场景、时长、专业领域", "不承诺法律、医疗等专业资质", "待人工确认", "禁用", "待人工确认", "专业场景必须确认资格"],
  ["包车", "按确认路线和人数匹配车辆", "城市、路线、人数、行李、时长", "车辆/司机/保险均以确认单为准", "待人工确认", "禁用", "待人工确认", "不可保证特定车型"],
  ["接送机", "按航班和人数确认接送安排", "机场、航班、人数、行李、时间", "以落地资源及航班变动为准", "待人工确认", "禁用", "待人工确认", "确认夜间/延误规则"],
  ["一日游", "按确认线路安排当日服务", "日期、人数、路线、集合点", "门票、餐食、交通范围须写清", "待人工确认", "禁用", "待人工确认", "不可使用固定行程承诺"],
  ["商务陪同", "按确认商务场景提供陪同协助", "城市、日期、场景、语言", "不代表客户签约或作专业承诺", "待人工确认", "禁用", "待人工确认", "确认合规边界"],
  ["行程定制", "按出行信息提供行程建议", "目的地、日期、偏好、预算", "建议不等同于代订或保障", "待人工确认", "禁用", "待人工确认", "列明交付形式与次数"],
];
input(service.getRange("A5:H12"));
service.getRange("E5:E12").dataValidation = { rule: { type: "list", values: ["待人工确认", "已确认", "不适用"] } };
service.getRange("F5:F12").dataValidation = { rule: { type: "list", values: ["禁用", "可报价", "可发布"] } };
service.getRange("A4:H12").format.borders = { preset: "all", style: "thin", color: "#D8E2DC" };
service.freezePanes.freezeRows(4);
for (const col of ["A:A", "B:B", "C:C", "D:D", "E:F", "G:G", "H:H"]) service.getRange(col).format.columnWidth = 19;

const assets = wb.worksheets.add("素材清单");
title(assets, "素材清单与使用边界", "F");
note(assets, "图片适配性只按文件名与画面初审；商用权利、人物/地标/商标风险及平台要求仍需人工复核。", "F");
assets.getRange("A4:F4").values = [["素材类别", "文件/范围", "建议用途", "可用于美国商品", "当前状态", "人工复核项"]];
header(assets.getRange("A4:F4"));
assets.getRange("A5:F11").values = [
  ["主图", "主图10选1/us-main-10-conversion-poster.png", "美国服务商品主图候选", "是", "待人工选择", "图中文字、地标/肖像权、平台主图规范"],
  ["其他主图", "主图10选1/us-main-01 至 09", "备选；需逐张复核", "部分可能适用", "未逐张验收", "目的地是否为美国、是否与商品名一致"],
  ["副图", "副图两套/secondary-01 至 04", "服务说明、适用场景、流程、咨询字段", "是（通用）", "可作补充", "文字准确性、平台尺寸与数量限制"],
  ["详情页", "详情页/00-详情首图-01", "服务认知", "是（通用）", "可作补充", "标题/宣传是否与商品一致"],
  ["详情页", "详情页/00-详情首图-02 至 06", "定制、服务、场景、流程、询盘信息", "是（通用）", "可作补充", "不得暗示未确认服务或价格"],
  ["详情页", "详情页/07-重要说明", "报价与服务边界提示", "是（通用）", "建议保留", "不替代实际退改、履约及售后规则"],
  ["城市热度表", "全球城市服务需求热度_中国客群筛选版.xlsx", "选品研究参考", "间接", "仅作假设", "非店铺需求、非销量、非供给证明"],
];
input(assets.getRange("A5:F11"));
assets.getRange("A4:F11").format.borders = { preset: "all", style: "thin", color: "#D8E2DC" };
for (const col of ["A:A", "B:B", "C:C", "D:D", "E:E", "F:F"]) assets.getRange(col).format.columnWidth = 22;

const checklist = wb.worksheets.add("发布前检查");
title(checklist, "最终发布前检查｜所有硬性项通过后，仅由人工点击发布", "E");
note(checklist, "请将每项改为“已确认”并在证据栏填写可追溯位置。任何“待确认/不通过”都禁止最终发布。", "E");
checklist.getRange("A4:E4").values = [["检查项", "结果", "责任人", "证据/链接/文件位置", "说明"]];
header(checklist.getRange("A4:E4"));
const checks = [
  ["平台实际类目与完整属性已核对", "待确认", "", "", "不可用其他类目截图推断"],
  ["店铺/经营主体具备相应经营与平台准入资格", "待确认", "", "", "以实际主体和平台要求为准"],
  ["每个可售服务已有真实可履约供给", "待确认", "", "", "目的地、日期、人员/车辆均可核验"],
  ["导游、翻译、车辆等资质与当地合规边界已核验", "待确认", "", "", "不得宣传未确认资质"],
  ["展示价、收费范围、税费和最终报价规则清晰", "待确认", "", "", "展示价非最终报价需与订单规则一致"],
  ["退改、履约、售后与投诉处理规则已确认", "待确认", "", "", "写入平台要求的对应位置"],
  ["主图、商品标题、SKU、详情页的目的地和服务一致", "待确认", "", "", "美国主图不可与其他国家商品混用"],
  ["图片及文字的商用权利、肖像/商标/地标风险已复核", "待确认", "", "", "保留授权或来源证明"],
  ["不存在保证性、夸大性或无法证明的表述", "待确认", "", "", "含人员、车辆、时效、价格等"],
  ["旺旺询盘话术、订单备注与人工报价流程已测试", "待确认", "", "", "保留测试记录"],
  ["最终发布人已审阅商品包与平台预览", "待确认", "", "", "此项必须由实际发布人确认"],
  ["发布后监测和下架/修正责任人已确定", "待确认", "", "", "首次上架建议人工复盘"],
];
checklist.getRange("A5:E16").values = checks;
input(checklist.getRange("A5:E16"));
checklist.getRange("B5:B16").dataValidation = { rule: { type: "list", values: ["待确认", "已确认", "不通过", "不适用"] } };
checklist.getRange("A4:E16").format.borders = { preset: "all", style: "thin", color: "#D8E2DC" };
checklist.getRange("A18").values = [["已确认项目数"]]; label(checklist.getRange("A18"));
checklist.getRange("B18").formulas = [["=COUNTIF(B5:B16,\"已确认\")"]]; output(checklist.getRange("B18"));
checklist.getRange("C18").values = [["发布结论"]]; label(checklist.getRange("C18"));
checklist.getRange("D18:E18").merge();
checklist.getRange("D18").formulas = [["=IF(B18=COUNTA(A5:A16),\"可进入人工发布\",\"禁止发布\")"]]; output(checklist.getRange("D18:E18"));
checklist.getRange("D18:E18").conditionalFormats.add("containsText", { text: "禁止发布", format: { fill: "#FDE8E7", font: { bold: true, color: red } } });
checklist.getRange("D18:E18").conditionalFormats.add("containsText", { text: "可进入人工发布", format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } } });
for (const [col, width] of [["A:A", 34], ["B:B", 12], ["C:C", 13], ["D:D", 32], ["E:E", 32]]) checklist.getRange(col).format.columnWidth = width;
checklist.freezePanes.freezeRows(4);

const inquiry = wb.worksheets.add("询盘收集");
title(inquiry, "旺旺询盘收集模板｜先确认需求，再人工报价", "D");
note(inquiry, "此页用于复制至旺旺沟通或内部记录。未确认前不要承诺最终价格、人员、车辆或服务时效。", "D");
inquiry.getRange("A4:D4").values = [["需收集字段", "客户填写/确认", "用于报价", "提醒话术"]];
header(inquiry.getRange("A4:D4"));
inquiry.getRange("A5:D14").values = [
  ["目的地国家/城市", "", "确认资源与服务区域", "请告知具体城市和活动范围。"],
  ["服务日期与时段", "", "确认人员/车辆排期", "请提供日期、开始结束时间及是否可能变动。"],
  ["人数与行李/儿童情况", "", "匹配人员与车辆规格", "如需用车，请说明人数、行李和儿童座椅需求。"],
  ["需要的服务类型", "", "确定服务包边界", "可说明地陪、翻译、接送机、包车、行程建议等实际需求。"],
  ["语言与场景", "", "匹配服务人员", "如涉及商务/展会/专业场景，请提前说明。"],
  ["路线/航班/集合点", "", "核算距离、等待与附加规则", "接送机请提供航班号和预计抵达/出发时间。"],
  ["预算或报价偏好", "", "形成可比报价", "页面展示价非最终报价，按确认服务内容报价。"],
  ["特殊需求", "", "识别无法承诺事项", "请说明无障碍、宠物、设备或其他特殊需求。"],
  ["客户确认的服务清单", "", "生成订单备注/报价单", "以双方旺旺确认的清单为准。"],
  ["报价有效期与变更规则", "", "锁定报价条件", "请在报价后明确有效期和变更处理方式。"],
];
input(inquiry.getRange("A5:D14"));
inquiry.getRange("A4:D14").format.borders = { preset: "all", style: "thin", color: "#D8E2DC" };
for (const [col, width] of [["A:A", 25], ["B:B", 26], ["C:C", 25], ["D:D", 42]]) inquiry.getRange(col).format.columnWidth = width;

const guide = wb.worksheets.add("使用说明");
title(guide, "使用说明与审查结论", "B");
guide.getRange("A3:B3").values = [["结论", "压缩包包含一套美国定向主图、通用副图/详情页和城市热度研究表；未包含实际平台类目、店铺准入资料、具体供应商/履约证明、价格规则或可直接运行的上架代码。"]];
label(guide.getRange("A3")); output(guide.getRange("B3"));
guide.getRange("A5:B5").values = [["操作顺序", "1. 核对平台实际类目与属性；2. 确认可履约供给及资质；3. 填写“商品包”和“服务SKU字典”；4. 完成“发布前检查”；5. 由人工核对平台预览并点击最终发布。"]];
label(guide.getRange("A5")); output(guide.getRange("B5"));
guide.getRange("A7:B7").values = [["素材一致性", "主图候选含美国文字与地标，故本商品包先按美国服务设置；通用详情页不可自动证明任何具体服务可售。其他国家/城市应另建商品包并单独选择匹配素材。"]];
label(guide.getRange("A7")); output(guide.getRange("B7"));
guide.getRange("A9:B9").values = [["城市热度表", "表内“热度”是研究模型参考，不等同于真实订单、市场规模、转化率或供应能力；不能直接作为上架或扩品决策的唯一依据。"]];
label(guide.getRange("A9")); output(guide.getRange("B9"));
guide.getRange("A11:B11").values = [["发布边界", "本模板故意保留人工发布闸门，不执行自动点击发布，也不替代平台审核、资质审查、合同/订单及售后规则。"]];
label(guide.getRange("A11")); output(guide.getRange("B11"));
guide.getRange("A3:B11").format.wrapText = true;
for (const r of [3, 5, 7, 9, 11]) guide.getRange(`A${r}:B${r}`).format.rowHeight = 52;
guide.getRange("A:A").format.columnWidth = 18;
guide.getRange("B:B").format.columnWidth = 95;

for (const sheetName of ["商品包", "服务SKU字典", "素材清单", "发布前检查", "询盘收集", "使用说明"]) {
  const sheet = wb.worksheets.getItem(sheetName);
  sheet.getUsedRange().format.verticalAlignment = "center";
}

const check = await wb.inspect({ kind: "table", range: "商品包!A9:Q15", include: "values,formulas", tableMaxRows: 8, tableMaxCols: 17 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(errors.ndjson);

for (const sheetName of ["商品包", "服务SKU字典", "素材清单", "发布前检查", "询盘收集", "使用说明"]) {
  const png = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${sheetName}.png`, new Uint8Array(await png.arrayBuffer()));
}
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(`${outputDir}/美国中文旅行服务_上架商品包模板.xlsx`);
console.log(`OUTPUT=${outputDir}/美国中文旅行服务_上架商品包模板.xlsx`);
