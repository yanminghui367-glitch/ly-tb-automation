import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const sourcePath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1).xlsx";
const outputDir = path.join(root, "outputs", "境外目的地链接池_500");
const qaDir = path.join(outputDir, ".qa");
const targetCount = 500;

const sourceBlob = await FileBlob.load(sourcePath);
const sourceWorkbook = await SpreadsheetFile.importXlsx(sourceBlob);
const sourceSheet = sourceWorkbook.worksheets.getItem("境外城市热度");
const sourceValues = sourceSheet.getUsedRange().values;
const headers = sourceValues[4].map((value) => String(value ?? "").trim());
const dataRows = sourceValues.slice(5);

function get(row, name) {
  return row[headers.indexOf(name)];
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

const candidates = dataRows
  .map((row) => {
    const country = text(get(row, "国家/地区(中文)"));
    const city = text(get(row, "城市中文名"));
    const heat = number(get(row, "综合热度分"));
    const rank = number(get(row, "境外热度排名"));
    const iso2 = text(get(row, "ISO2"));
    const nameStatus = text(get(row, "中文名状态"));
    if (!country || !city || heat === null || rank === null) return null;
    return {
      country,
      iso2,
      countryKey: `${country}|${iso2}`,
      city,
      cityEnglish: text(get(row, "城市英文名")),
      nameStatus,
      heat,
      rank,
      heatLevel: text(get(row, "热度等级")),
      hasStandardChineseName: nameStatus === "GeoNames标准中文名",
    };
  })
  .filter(Boolean);

if (candidates.length === 0) throw new Error("未从“境外城市热度”读取到有效城市记录。");

function comparePriority(a, b) {
  if (a.hasStandardChineseName !== b.hasStandardChineseName) {
    return Number(b.hasStandardChineseName) - Number(a.hasStandardChineseName);
  }
  if (a.heat !== b.heat) return b.heat - a.heat;
  return a.rank - b.rank;
}

function compareHeat(a, b) {
  if (a.heat !== b.heat) return b.heat - a.heat;
  return a.rank - b.rank;
}

const countryGroups = new Map();
for (const candidate of candidates) {
  if (!countryGroups.has(candidate.countryKey)) countryGroups.set(candidate.countryKey, []);
  countryGroups.get(candidate.countryKey).push(candidate);
}

const countryCoverage = [];
for (const [countryKey, rows] of countryGroups) {
  const best = [...rows].sort(comparePriority)[0];
  countryCoverage.push({ ...best, countryKey, selectionLogic: "国家/地区保底" });
}

if (countryCoverage.length > targetCount) {
  throw new Error(`国家/地区保底数量 ${countryCoverage.length} 超过目标链接数 ${targetCount}。`);
}

const selected = [...countryCoverage];
const selectedCityKeys = new Set(selected.map((row) => `${row.countryKey}|${row.city}`));
const sortedHighHeat = [...candidates]
  .filter((row) => row.hasStandardChineseName)
  .sort(compareHeat);

for (const candidate of sortedHighHeat) {
  if (selected.length >= targetCount) break;
  const cityKey = `${candidate.countryKey}|${candidate.city}`;
  if (selectedCityKeys.has(cityKey)) continue;
  selected.push({ ...candidate, selectionLogic: "高热度补充" });
  selectedCityKeys.add(cityKey);
}

if (selected.length !== targetCount) {
  throw new Error(`仅生成 ${selected.length} 条候选，未达到目标 ${targetCount} 条。`);
}

selected.sort(compareHeat);
selected.forEach((row, index) => {
  row.listingOrder = index + 1;
  row.linkTitle = `${row.country}${row.city}旅行服务咨询｜下单前请先咨询`;
  row.listingStatus = "候选-禁发";
});

const standardChineseCount = selected.filter((row) => row.hasStandardChineseName).length;
const fallbackNames = selected.filter((row) => !row.hasStandardChineseName);
const minHeat = Math.min(...selected.map((row) => row.heat));
const maxHeat = Math.max(...selected.map((row) => row.heat));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("使用说明");
const listing = workbook.worksheets.add("上架候选500");
const coverage = workbook.worksheets.add("国家地区覆盖");
const namesToFix = workbook.worksheets.add("待补中文名");

const navy = "#102A43";
const teal = "#0F766E";
const green = "#166534";
const amber = "#92400E";
const red = "#B91C1C";
const lightBlue = "#EAF3F8";
const paleAmber = "#FEF3C7";
const paleRed = "#FEE2E2";
const paleGreen = "#DCFCE7";
const white = "#FFFFFF";
const border = "#D8E2DC";

function setTitle(sheet, title, endColumn) {
  sheet.mergeCells(`A1:${endColumn}1`);
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${endColumn}1`).format = {
    fill: navy,
    font: { bold: true, color: white, size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange("A1").format.rowHeight = 30;
  sheet.showGridLines = false;
}

function setNote(sheet, note, endColumn) {
  sheet.mergeCells(`A2:${endColumn}2`);
  sheet.getRange("A2").values = [[note]];
  sheet.getRange(`A2:${endColumn}2`).format = {
    fill: paleRed,
    font: { color: red, italic: true },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange("A2").format.rowHeight = 34;
}

function setHeader(range) {
  range.format = {
    fill: teal,
    font: { bold: true, color: white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
}

function setLabel(range) {
  range.format = {
    fill: lightBlue,
    font: { bold: true, color: navy },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
}

function setOutput(range) {
  range.format = {
    fill: "#F8FAFC",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  };
}

setTitle(summary, "境外旅游目的地城市链接池｜500 条候选（人工发布闸门）", "F");
setNote(summary, "本文件仅按来源研究表的热度与中文名状态生成候选链接池，不证明供给、类目、资质、价格或可发布资格。所有链接默认“候选-禁发”。", "F");
summary.getRange("A4:B10").values = [
  ["目标链接数", targetCount],
  ["实际候选链接数", null],
  ["来源国家/地区覆盖数", null],
  ["标准中文城市名数量", null],
  ["标准中文城市名占比", null],
  ["保底覆盖链接数", null],
  ["热度范围", `${minHeat.toFixed(1)} - ${maxHeat.toFixed(1)}`],
];
summary.getRange("A4:A10").format = {
  fill: lightBlue,
  font: { bold: true, color: navy },
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: border },
};
summary.getRange("B4:B10").format = {
  fill: "#F8FAFC",
  font: { bold: true, color: navy },
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: border },
};
summary.getRange("B5").formulas = [["=COUNTA('上架候选500'!A5:A504)"]];
summary.getRange("B6").formulas = [["=COUNTA('国家地区覆盖'!A5:A221)"]];
summary.getRange("B7").formulas = [["=COUNTIF('上架候选500'!F5:F504,\"GeoNames标准中文名\")"]];
summary.getRange("B8").formulas = [["=B7/B5"]];
summary.getRange("B8").format.numberFormat = "0.0%";
summary.getRange("B9").formulas = [["=COUNTIF('上架候选500'!I5:I504,\"国家/地区保底\")"]];
summary.getRange("D4:F10").values = [
  ["来源文件", "全球城市服务需求热度_中国客群筛选版(1).xlsx", "来源页：境外城市热度"],
  ["覆盖规则", "来源表中每个国家/地区至少保留 1 个城市", "优先来源表已有标准中文名"],
  ["补足规则", "在保底之外，按综合热度补至 500 条", "仅补标准中文城市名；同国家/地区-城市去重"],
  ["链接粒度", "国家/地区 + 城市", "不使用“美国/欧洲通用服务”等泛目的地链接"],
  ["链接标题", "城市级咨询标题草案", "需按淘宝实际类目和字数限制人工复核"],
  ["发布规则", "先核验供给、资质、价格和售后", "最终发布必须人工确认"],
  ["名称缺口", `${fallbackNames.length} 条未有来源标准中文城市名`, "见“待补中文名”页，补齐后再制作链接"],
];
summary.getRange("D4:D10").format = {
  fill: lightBlue,
  font: { bold: true, color: navy },
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: border },
};
summary.getRange("E4:F10").format = {
  fill: "#F8FAFC",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: border },
};
summary.getRange("A12:F18").values = [
  ["使用顺序", "", "", "", "", ""],
  ["1", "先筛“上架候选500”的国家/地区和城市，不直接发布", "", "", "", ""],
  ["2", "逐城市填写真实服务范围、资源编号、可履约日期、报价和退改规则", "", "", "", ""],
  ["3", "真实淘宝类目、完整属性、首图、标题、SKU、详情页必须与同一城市一致", "", "", "", ""],
  ["4", "未有真实供给/资质的服务，继续保持“候选-禁发”", "", "", "", ""],
  ["5", "由实际发布人检查平台预览后，人工完成最终发布", "", "", "", ""],
  ["说明", "“国家/地区保底”可能含热度较低的城市，是为了满足每个来源国家/地区至少一个城市的目标；该字段不代表应优先发布。", "", "", "", ""],
];
summary.mergeCells("A12:F12");
summary.getRange("A12").format = { fill: navy, font: { bold: true, color: white }, verticalAlignment: "center" };
summary.mergeCells("B13:F13");
summary.mergeCells("B14:F14");
summary.mergeCells("B15:F15");
summary.mergeCells("B16:F16");
summary.mergeCells("B17:F17");
summary.mergeCells("B18:F18");
summary.getRange("A13:A18").format = { fill: lightBlue, font: { bold: true, color: navy }, borders: { preset: "all", style: "thin", color: border } };
summary.getRange("B13:F18").format = { fill: "#F8FAFC", wrapText: true, borders: { preset: "all", style: "thin", color: border } };
summary.getRange("A13:F18").format.rowHeight = 34;
summary.getRange("A:A").format.columnWidth = 18;
summary.getRange("B:B").format.columnWidth = 24;
summary.getRange("C:C").format.columnWidth = 10;
summary.getRange("D:D").format.columnWidth = 16;
summary.getRange("E:E").format.columnWidth = 36;
summary.getRange("F:F").format.columnWidth = 28;

setTitle(listing, "上架候选链接池｜按综合热度降序（500 条）", "K");
setNote(listing, "城市链接名优先使用来源表的 GeoNames 标准中文名；仅 8 条保底覆盖记录暂缺来源标准中文名，需先在“待补中文名”页人工核验。所有记录默认禁止发布。", "K");
const listingHeaders = [["上架序号", "国家/地区", "ISO2", "城市链接名", "城市英文名", "中文名状态", "综合热度分", "热度等级", "选入逻辑", "建议链接标题（草案）", "上架状态"]];
listing.getRange("A4:K4").values = listingHeaders;
setHeader(listing.getRange("A4:K4"));
listing.getRange("A5:K504").values = selected.map((row) => [
  row.listingOrder,
  row.country,
  row.iso2 || "待补",
  row.city,
  row.cityEnglish,
  row.nameStatus,
  row.heat,
  row.heatLevel,
  row.selectionLogic,
  row.linkTitle,
  row.listingStatus,
]);
setOutput(listing.getRange("A5:K504"));
listing.getRange("A5:A504").format.numberFormat = "0";
listing.getRange("G5:G504").format.numberFormat = "0.0";
listing.getRange("G5:G504").conditionalFormats.add("colorScale", { colors: ["#FEE2E2", "#FEF3C7", "#DCFCE7"] });
listing.getRange("F5:F504").conditionalFormats.add("containsText", { text: "英文回退", format: { fill: paleAmber, font: { color: amber, bold: true } } });
listing.getRange("K5:K504").conditionalFormats.add("containsText", { text: "候选-禁发", format: { fill: paleRed, font: { color: red, bold: true } } });
listing.getRange("K5:K504").dataValidation = { rule: { type: "list", values: ["候选-禁发", "资料待补", "可制作商品包", "人工待发布", "已发布", "下架"] } };
listing.getRange("A4:K504").format.verticalAlignment = "center";
listing.getRange("A4:K504").format.wrapText = true;
listing.freezePanes.freezeRows(4);
listing.tables.add("A4:K504", true, "DestinationListingPool");
for (const [column, width] of [["A:A", 10], ["B:B", 18], ["C:C", 9], ["D:D", 20], ["E:E", 24], ["F:F", 20], ["G:G", 12], ["H:H", 11], ["I:I", 16], ["J:J", 44], ["K:K", 15]]) {
  listing.getRange(column).format.columnWidth = width;
}

setTitle(coverage, "国家/地区覆盖校验｜每个来源国家/地区至少保留 1 个城市", "H");
setNote(coverage, "本页是覆盖校验，不是优先发布顺序；城市选择优先来源表已有标准中文名，其次才按热度选择。", "H");
coverage.getRange("A4:H4").values = [["国家/地区", "ISO2", "保底城市", "城市英文名", "中文名状态", "综合热度分", "热度等级", "覆盖状态"]];
setHeader(coverage.getRange("A4:H4"));
const sortedCoverage = [...countryCoverage].sort((a, b) => a.country.localeCompare(b.country, "zh-Hans-CN"));
coverage.getRange(`A5:H${4 + sortedCoverage.length}`).values = sortedCoverage.map((row) => [
  row.country,
  row.iso2 || "待补",
  row.city,
  row.cityEnglish,
  row.nameStatus,
  row.heat,
  row.heatLevel,
  "已保留",
]);
setOutput(coverage.getRange(`A5:H${4 + sortedCoverage.length}`));
coverage.getRange(`F5:F${4 + sortedCoverage.length}`).format.numberFormat = "0.0";
coverage.getRange(`E5:E${4 + sortedCoverage.length}`).conditionalFormats.add("containsText", { text: "英文回退", format: { fill: paleAmber, font: { color: amber, bold: true } } });
coverage.getRange(`H5:H${4 + sortedCoverage.length}`).conditionalFormats.add("containsText", { text: "已保留", format: { fill: paleGreen, font: { color: green, bold: true } } });
coverage.freezePanes.freezeRows(4);
coverage.tables.add(`A4:H${4 + sortedCoverage.length}`, true, "CountryCoverageCheck");
for (const [column, width] of [["A:A", 22], ["B:B", 10], ["C:C", 22], ["D:D", 26], ["E:E", 21], ["F:F", 12], ["G:G", 12], ["H:H", 12]]) {
  coverage.getRange(column).format.columnWidth = width;
}

setTitle(namesToFix, "待补中文城市名｜8 条保底覆盖记录", "G");
setNote(namesToFix, "来源表未给出 GeoNames 标准中文名。请在制作城市链接或主图前，按可追溯来源补齐并复核中文名；不要把英文回退名直接当成最终上架中文地址。", "G");
namesToFix.getRange("A4:G4").values = [["国家/地区", "ISO2", "来源城市名", "城市英文名", "综合热度分", "建议动作", "状态"]];
setHeader(namesToFix.getRange("A4:G4"));
const nameRows = fallbackNames.sort(compareHeat);
if (nameRows.length) {
  namesToFix.getRange(`A5:G${4 + nameRows.length}`).values = nameRows.map((row) => [
    row.country,
    row.iso2 || "待补",
    row.city,
    row.cityEnglish,
    row.heat,
    "补齐中文名并人工复核来源",
    "待补中文名",
  ]);
  setOutput(namesToFix.getRange(`A5:G${4 + nameRows.length}`));
  namesToFix.getRange(`E5:E${4 + nameRows.length}`).format.numberFormat = "0.0";
  namesToFix.getRange(`G5:G${4 + nameRows.length}`).conditionalFormats.add("containsText", { text: "待补中文名", format: { fill: paleAmber, font: { color: amber, bold: true } } });
}
namesToFix.freezePanes.freezeRows(4);
namesToFix.tables.add(`A4:G${4 + nameRows.length}`, true, "NamesToValidate");
for (const [column, width] of [["A:A", 24], ["B:B", 10], ["C:C", 24], ["D:D", 28], ["E:E", 12], ["F:F", 30], ["G:G", 16]]) {
  namesToFix.getRange(column).format.columnWidth = width;
}

const inspectListing = await workbook.inspect({
  kind: "table",
  range: "上架候选500!A4:K12",
  include: "values,formulas",
  tableMaxRows: 9,
  tableMaxCols: 11,
});
console.log(inspectListing.ndjson);
const inspectCoverage = await workbook.inspect({
  kind: "table",
  range: `国家地区覆盖!A4:H${Math.min(12, 4 + sortedCoverage.length)}`,
  include: "values,formulas",
  tableMaxRows: 9,
  tableMaxCols: 8,
});
console.log(inspectCoverage.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(qaDir, { recursive: true });
for (const sheetName of ["使用说明", "上架候选500", "国家地区覆盖", "待补中文名"]) {
  const image = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(qaDir, `${sheetName}.png`), new Uint8Array(await image.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "境外旅游目的地城市链接池_500.xlsx");
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
console.log(JSON.stringify({ targetCount, actualCount: selected.length, countryCoverage: countryCoverage.length, standardChineseCount, fallbackNameCount: fallbackNames.length }));
