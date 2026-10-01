import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const sourcePath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1).xlsx";
const basePath = "D:/桌面文件迁移/境外旅游目的地城市链接池_500.xlsx";
const outputDir = path.join(root, "outputs", "境外目的地链接池_700");
const qaDir = path.join(outputDir, ".qa");
const targetCount = 700;
const baseTarget = 500;

function cellText(value) {
  return String(value ?? "").trim();
}

function cellNumber(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(cellText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareHeat(a, b) {
  if (a.heat !== b.heat) return b.heat - a.heat;
  return a.rank - b.rank;
}

function cityKey(row) {
  return `${row.country}|${row.iso2}|${row.city}`;
}

const sourceBook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const sourceSheet = sourceBook.worksheets.getItem("境外城市热度");
const sourceValues = sourceSheet.getUsedRange().values;
const sourceHeaders = sourceValues[4].map(cellText);
const sourceIndex = (name) => sourceHeaders.indexOf(name);

const sourceCities = sourceValues.slice(5)
  .map((row) => {
    const country = cellText(row[sourceIndex("国家/地区(中文)")]);
    const city = cellText(row[sourceIndex("城市中文名")]);
    const heat = cellNumber(row[sourceIndex("综合热度分")]);
    const rank = cellNumber(row[sourceIndex("境外热度排名")]);
    if (!country || !city || heat === null || rank === null) return null;
    return {
      country,
      iso2: cellText(row[sourceIndex("ISO2")]),
      city,
      cityEnglish: cellText(row[sourceIndex("城市英文名")]),
      nameStatus: cellText(row[sourceIndex("中文名状态")]),
      heat,
      rank,
      heatLevel: cellText(row[sourceIndex("热度等级")]),
      hasStandardChineseName: cellText(row[sourceIndex("中文名状态")]) === "GeoNames标准中文名",
    };
  })
  .filter(Boolean);

const sourceByCity = new Map();
for (const city of sourceCities) {
  const key = cityKey(city);
  if (!sourceByCity.has(key) || compareHeat(city, sourceByCity.get(key)) < 0) sourceByCity.set(key, city);
}

const baseBook = await SpreadsheetFile.importXlsx(await FileBlob.load(basePath));
const baseSheet = baseBook.worksheets.getItem("上架候选500");
const baseValues = baseSheet.getUsedRange().values;
const baseHeaders = baseValues[3].map(cellText);
const baseIndex = (name) => baseHeaders.indexOf(name);
const baseRows = baseValues.slice(4)
  .map((row) => {
    const country = cellText(row[baseIndex("国家/地区")]);
    const city = cellText(row[baseIndex("城市链接名")]);
    const iso2 = cellText(row[baseIndex("ISO2")]).replace("待补", "");
    if (!country || !city) return null;
    const raw = sourceByCity.get(`${country}|${iso2}|${city}`);
    if (raw) return { ...raw, selectionSource: "原500保留" };
    return {
      country,
      iso2,
      city,
      cityEnglish: cellText(row[baseIndex("城市英文名")]),
      nameStatus: cellText(row[baseIndex("中文名状态")]),
      heat: cellNumber(row[baseIndex("综合热度分")]),
      rank: Number.MAX_SAFE_INTEGER,
      heatLevel: cellText(row[baseIndex("热度等级")]),
      hasStandardChineseName: cellText(row[baseIndex("中文名状态")]) === "GeoNames标准中文名",
      selectionSource: "原500保留",
    };
  })
  .filter(Boolean);

if (baseRows.length !== baseTarget) throw new Error(`500条候选池读取到 ${baseRows.length} 条，不符合预期。`);

const selected = [];
const selectedKeys = new Set();
for (const row of baseRows) {
  const key = cityKey(row);
  if (selectedKeys.has(key)) continue;
  selected.push(row);
  selectedKeys.add(key);
}
if (selected.length !== baseTarget) throw new Error("原500条候选池存在重复国家/地区-城市记录。");

for (const row of [...sourceCities].filter((item) => item.hasStandardChineseName).sort(compareHeat)) {
  if (selected.length >= targetCount) break;
  const key = cityKey(row);
  if (selectedKeys.has(key)) continue;
  selected.push({ ...row, selectionSource: "新增高热度" });
  selectedKeys.add(key);
}
if (selected.length !== targetCount) throw new Error(`只能生成 ${selected.length} 条，未达到 ${targetCount} 条。`);

const countryStats = new Map();
for (const row of sourceCities) {
  const key = `${row.country}|${row.iso2}`;
  const current = countryStats.get(key);
  if (!current || compareHeat(row, current.topCity) < 0) countryStats.set(key, { country: row.country, iso2: row.iso2, topCity: row });
}
const sortedCountries = [...countryStats.entries()]
  .sort(([, a], [, b]) => compareHeat(a.topCity, b.topCity) || a.country.localeCompare(b.country, "zh-Hans-CN"));
const countryOrder = new Map(sortedCountries.map(([key], index) => [key, index + 1]));

selected.sort((a, b) => {
  const aKey = `${a.country}|${a.iso2}`;
  const bKey = `${b.country}|${b.iso2}`;
  const groupDifference = countryOrder.get(aKey) - countryOrder.get(bKey);
  if (groupDifference !== 0) return groupDifference;
  return compareHeat(a, b) || a.city.localeCompare(b.city, "zh-Hans-CN");
});

const countryInnerOrder = new Map();
selected.forEach((row, index) => {
  const key = `${row.country}|${row.iso2}`;
  const next = (countryInnerOrder.get(key) || 0) + 1;
  countryInnerOrder.set(key, next);
  row.listingOrder = index + 1;
  row.countryOrder = countryOrder.get(key);
  row.countryHeat = countryStats.get(key).topCity.heat;
  row.cityOrderInCountry = next;
  row.titleDraft = `${row.country}${row.city}旅行服务咨询｜下单前请先咨询`;
  row.listingStatus = "候选-禁发";
});

const standardChineseCount = selected.filter((row) => row.hasStandardChineseName).length;
const fallbackNames = selected.filter((row) => !row.hasStandardChineseName);
const countryCoverage = sortedCountries.map(([key, stat], index) => {
  const cities = selected.filter((row) => `${row.country}|${row.iso2}` === key);
  return {
    countryOrder: index + 1,
    country: stat.country,
    iso2: stat.iso2,
    countryHeat: stat.topCity.heat,
    topCity: stat.topCity.city,
    selectedCount: cities.length,
    status: cities.length ? "已覆盖" : "未覆盖",
  };
});

const workbook = Workbook.create();
const listing = workbook.worksheets.add("Sheet1");
const instructions = workbook.worksheets.add("使用说明");
const countrySheet = workbook.worksheets.add("国家覆盖");
const namesSheet = workbook.worksheets.add("待补中文名");

const navy = "#102A43";
const teal = "#0F766E";
const red = "#B91C1C";
const green = "#166534";
const amber = "#92400E";
const paleRed = "#FEE2E2";
const paleAmber = "#FEF3C7";
const paleGreen = "#DCFCE7";
const lightBlue = "#EAF3F8";
const white = "#FFFFFF";
const border = "#D8E2DC";

function title(sheet, value, end) {
  sheet.mergeCells(`A1:${end}1`);
  sheet.getRange("A1").values = [[value]];
  sheet.getRange(`A1:${end}1`).format = { fill: navy, font: { bold: true, color: white, size: 16 }, verticalAlignment: "center" };
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.showGridLines = false;
}
function note(sheet, value, end) {
  sheet.mergeCells(`A2:${end}2`);
  sheet.getRange("A2").values = [[value]];
  sheet.getRange(`A2:${end}2`).format = { fill: paleRed, font: { color: red, italic: true }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange("A2").format.rowHeight = 34;
}
function header(range) {
  range.format = { fill: teal, font: { bold: true, color: white }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: border } };
}
function data(range) {
  range.format = { fill: "#F8FAFC", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: border } };
}
function label(range) {
  range.format = { fill: lightBlue, font: { bold: true, color: navy }, verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: border } };
}

title(listing, "境外旅游目的地城市链接池｜700 条（按国家分组，国家内按旅游热度排序）", "N");
note(listing, "排序规则：先按国家/地区最高城市热度确定国家顺序；再在同一国家/地区内按城市综合热度降序。原500条全部保留，新增200条为未重复且有来源标准中文名的高热度城市。所有记录默认“候选-禁发”。", "N");
listing.getRange("A4:N4").values = [["链接序号", "国家排序", "国家/地区", "ISO2", "国家旅游热度分", "国家内序号", "城市链接名", "城市英文名", "城市旅游热度分", "热度等级", "中文名状态", "来源方式", "建议链接标题（草案）", "上架状态"]];
header(listing.getRange("A4:N4"));
listing.getRange("A5:N704").values = selected.map((row) => [
  row.listingOrder, row.countryOrder, row.country, row.iso2 || "待补", row.countryHeat, row.cityOrderInCountry,
  row.city, row.cityEnglish, row.heat, row.heatLevel, row.nameStatus, row.selectionSource, row.titleDraft, row.listingStatus,
]);
data(listing.getRange("A5:N704"));
listing.getRange("A5:B704").format.numberFormat = "0";
listing.getRange("E5:E704").format.numberFormat = "0.0";
listing.getRange("F5:F704").format.numberFormat = "0";
listing.getRange("I5:I704").format.numberFormat = "0.0";
listing.getRange("I5:I704").conditionalFormats.add("colorScale", { colors: ["#FEE2E2", "#FEF3C7", "#DCFCE7"] });
listing.getRange("K5:K704").conditionalFormats.add("containsText", { text: "英文回退", format: { fill: paleAmber, font: { color: amber, bold: true } } });
listing.getRange("L5:L704").conditionalFormats.add("containsText", { text: "新增高热度", format: { fill: paleGreen, font: { color: green, bold: true } } });
listing.getRange("N5:N704").conditionalFormats.add("containsText", { text: "候选-禁发", format: { fill: paleRed, font: { color: red, bold: true } } });
listing.getRange("N5:N704").dataValidation = { rule: { type: "list", values: ["候选-禁发", "资料待补", "可制作商品包", "人工待发布", "已发布", "下架"] } };
listing.freezePanes.freezeRows(4);
listing.tables.add("A4:N704", true, "DestinationLinkPool700");
for (const [col, width] of [["A:A", 10], ["B:B", 10], ["C:C", 18], ["D:D", 9], ["E:E", 14], ["F:F", 11], ["G:G", 20], ["H:H", 24], ["I:I", 14], ["J:J", 12], ["K:K", 20], ["L:L", 14], ["M:M", 44], ["N:N", 15]]) listing.getRange(col).format.columnWidth = width;

title(instructions, "使用说明｜700 条国家-城市链接池", "F");
note(instructions, "本工作簿合并“全球城市服务需求热度”原始研究表和“500条城市链接池”。热度仅用于选品排序，不代表真实订单、供给、价格、资质或可发布资格。", "F");
instructions.getRange("A4:B11").values = [
  ["目标链接数", targetCount],
  ["实际链接数", null],
  ["来源国家/地区数", null],
  ["原500条保留数", null],
  ["新增高热度城市数", null],
  ["标准中文城市名数量", null],
  ["待补中文名数量", null],
  ["发布总开关", "禁止发布"],
];
label(instructions.getRange("A4:A11"));
data(instructions.getRange("B4:B11"));
instructions.getRange("B5").formulas = [["=COUNTA('Sheet1'!A5:A704)"]];
instructions.getRange("B6").formulas = [["=COUNTA('国家覆盖'!A5:A221)"]];
instructions.getRange("B7").formulas = [["=COUNTIF('Sheet1'!L5:L704,\"原500保留\")"]];
instructions.getRange("B8").formulas = [["=COUNTIF('Sheet1'!L5:L704,\"新增高热度\")"]];
instructions.getRange("B9").formulas = [["=COUNTIF('Sheet1'!K5:K704,\"GeoNames标准中文名\")"]];
instructions.getRange("B10").formulas = [["=B5-B9"]];
instructions.getRange("B11").conditionalFormats.add("containsText", { text: "禁止发布", format: { fill: paleRed, font: { bold: true, color: red } } });
instructions.getRange("D4:F11").values = [
  ["合并来源", "全球城市服务需求热度_中国客群筛选版(1).xlsx", "境外城市热度"],
  ["", "境外旅游目的地城市链接池_500.xlsx", "上架候选500"],
  ["国家排序", "每个国家/地区最高城市的综合热度降序", "同分按国家/地区名称"],
  ["城市排序", "同一国家/地区内的城市综合热度降序", "不做全局城市热度混排"],
  ["补足规则", "完整保留原500条，再新增200条", "新增条目需不重复且有标准中文名"],
  ["链接粒度", "国家/地区 + 城市", "标题为咨询草案，需适配淘宝实际类目"],
  ["发布边界", "先核验供给、资质、价格、退改和售后", "人工检查预览并点击发布"],
  ["中文名缺口", "来源未提供标准中文名的城市单列处理", "不可直接用英文回退名制作中文链接"],
];
label(instructions.getRange("D4:D11"));
data(instructions.getRange("E4:F11"));
instructions.getRange("A13:F19").values = [
  ["使用顺序", "", "", "", "", ""],
  ["1", "在 Sheet1 先按国家排序查看；同一国家的“国家内序号”从 1 开始。", "", "", "", ""],
  ["2", "优先处理国家内序号靠前、且“来源方式”为新增高热度或原500保留的城市。", "", "", "", ""],
  ["3", "每个城市独立核验服务范围、资源、价格、退改、售后和淘宝类目属性。", "", "", "", ""],
  ["4", "标题、主图、SKU、详情页不得跨城市使用；未验真服务继续保持禁发。", "", "", "", ""],
  ["说明", "来源国家/地区覆盖包含低热度城市，以保证每个来源国家/地区至少有 1 个城市；该记录不代表应优先上架。", "", "", "", ""],
  ["发布", "最终发布仍由实际发布人完成，不执行自动点击发布。", "", "", "", ""],
];
instructions.mergeCells("A13:F13");
instructions.getRange("A13").format = { fill: navy, font: { bold: true, color: white } };
for (let row = 14; row <= 19; row += 1) instructions.mergeCells(`B${row}:F${row}`);
label(instructions.getRange("A14:A19"));
data(instructions.getRange("B14:F19"));
instructions.getRange("A14:F19").format.rowHeight = 32;
for (const [col, width] of [["A:A", 18], ["B:B", 27], ["C:C", 10], ["D:D", 16], ["E:E", 37], ["F:F", 30]]) instructions.getRange(col).format.columnWidth = width;

title(countrySheet, "国家/地区排序与覆盖｜按国家最高城市热度排序", "G");
note(countrySheet, "国家顺序使用原始热度表中该国家/地区最高城市的综合热度；“入选城市数”是本次700条中该国家/地区保留的城市数量。", "G");
countrySheet.getRange("A4:G4").values = [["国家排序", "国家/地区", "ISO2", "国家旅游热度分", "代表城市", "入选城市数", "覆盖状态"]];
header(countrySheet.getRange("A4:G4"));
countrySheet.getRange(`A5:G${4 + countryCoverage.length}`).values = countryCoverage.map((row) => [row.countryOrder, row.country, row.iso2 || "待补", row.countryHeat, row.topCity, row.selectedCount, row.status]);
data(countrySheet.getRange(`A5:G${4 + countryCoverage.length}`));
countrySheet.getRange(`A5:A${4 + countryCoverage.length}`).format.numberFormat = "0";
countrySheet.getRange(`D5:D${4 + countryCoverage.length}`).format.numberFormat = "0.0";
countrySheet.getRange(`F5:F${4 + countryCoverage.length}`).format.numberFormat = "0";
countrySheet.getRange(`G5:G${4 + countryCoverage.length}`).conditionalFormats.add("containsText", { text: "已覆盖", format: { fill: paleGreen, font: { bold: true, color: green } } });
countrySheet.freezePanes.freezeRows(4);
countrySheet.tables.add(`A4:G${4 + countryCoverage.length}`, true, "CountryOrderAndCoverage");
for (const [col, width] of [["A:A", 11], ["B:B", 23], ["C:C", 10], ["D:D", 15], ["E:E", 22], ["F:F", 13], ["G:G", 12]]) countrySheet.getRange(col).format.columnWidth = width;

title(namesSheet, `待补中文名｜${fallbackNames.length} 条来源回退记录`, "G");
note(namesSheet, "这类记录因“每个来源国家/地区至少一个城市”的覆盖规则被保留，但原始研究表未提供标准中文城市名。补齐并人工复核中文名后，才可制作城市级淘宝链接。", "G");
namesSheet.getRange("A4:G4").values = [["国家/地区", "ISO2", "来源城市名", "城市英文名", "城市热度分", "建议动作", "状态"]];
header(namesSheet.getRange("A4:G4"));
if (fallbackNames.length) {
  namesSheet.getRange(`A5:G${4 + fallbackNames.length}`).values = fallbackNames.map((row) => [row.country, row.iso2 || "待补", row.city, row.cityEnglish, row.heat, "补齐中文名并人工复核来源", "待补中文名"]);
  data(namesSheet.getRange(`A5:G${4 + fallbackNames.length}`));
  namesSheet.getRange(`E5:E${4 + fallbackNames.length}`).format.numberFormat = "0.0";
  namesSheet.getRange(`G5:G${4 + fallbackNames.length}`).conditionalFormats.add("containsText", { text: "待补中文名", format: { fill: paleAmber, font: { bold: true, color: amber } } });
}
namesSheet.freezePanes.freezeRows(4);
namesSheet.tables.add(`A4:G${4 + fallbackNames.length}`, true, "NamesToComplete700");
for (const [col, width] of [["A:A", 24], ["B:B", 10], ["C:C", 24], ["D:D", 28], ["E:E", 14], ["F:F", 30], ["G:G", 16]]) namesSheet.getRange(col).format.columnWidth = width;

const check = await workbook.inspect({ kind: "table", range: "Sheet1!A4:N20", include: "values,formulas", tableMaxRows: 17, tableMaxCols: 14 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(errors.ndjson);

await fs.mkdir(qaDir, { recursive: true });
for (const [sheetName, range, fileName] of [["Sheet1", "A1:N26", "sheet1-top.png"], ["使用说明", "A1:F19", "instructions.png"], ["国家覆盖", "A1:G24", "country-coverage-top.png"], ["待补中文名", "A1:G12", "names.png"]]) {
  const image = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
  await fs.writeFile(path.join(qaDir, fileName), new Uint8Array(await image.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const exportFile = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "境外旅游目的地城市链接池_700_国家分组.xlsx");
await exportFile.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
console.log(JSON.stringify({ targetCount, baseRetained: baseRows.length, newCities: targetCount - baseRows.length, countryCoverage: countryCoverage.length, standardChineseCount, fallbackNameCount: fallbackNames.length }));
