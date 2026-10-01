import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const sourcePath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1).xlsx";
const outputDir = path.join(root, "outputs", "境外目的地链接池_700_国家优先");
const qaDir = path.join(outputDir, ".qa");
const countryTarget = 200;
const cityTarget = 500;

const sourceBook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const sourceSheet = sourceBook.worksheets.getItem("境外城市热度");
const sourceValues = sourceSheet.getUsedRange().values;
const headers = sourceValues[4].map((value) => String(value ?? "").trim());
const field = (name) => headers.indexOf(name);
const text = (value) => String(value ?? "").trim();
const number = (value) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const compareHeat = (a, b) => (b.heat - a.heat) || (a.rank - b.rank) || a.city.localeCompare(b.city, "zh-Hans-CN");

const cities = sourceValues.slice(5)
  .map((row) => {
    const country = text(row[field("国家/地区(中文)")]);
    const city = text(row[field("城市中文名")]);
    const heat = number(row[field("综合热度分")]);
    const rank = number(row[field("境外热度排名")]);
    if (!country || !city || heat === null || rank === null) return null;
    return {
      country,
      iso2: text(row[field("ISO2")]),
      city,
      cityEnglish: text(row[field("城市英文名")]),
      heat,
      rank,
      heatLevel: text(row[field("热度等级")]),
      nameStatus: text(row[field("中文名状态")]),
      hasStandardChineseName: text(row[field("中文名状态")]) === "GeoNames标准中文名",
    };
  })
  .filter(Boolean);

const countryKey = (row) => `${row.country}|${row.iso2}`;
const countries = new Map();
for (const city of cities) {
  const key = countryKey(city);
  const current = countries.get(key);
  if (!current || compareHeat(city, current.topCity) < 0) countries.set(key, { country: city.country, iso2: city.iso2, topCity: city });
}
const activeCountries = [...countries.entries()]
  .sort(([, a], [, b]) => compareHeat(a.topCity, b.topCity) || a.country.localeCompare(b.country, "zh-Hans-CN"))
  .slice(0, countryTarget)
  .map(([key, item], index) => ({ ...item, key, countryRank: index + 1 }));
if (activeCountries.length !== countryTarget) throw new Error("可用国家/地区数量不足 200。");

const activeKeys = new Set(activeCountries.map((row) => row.key));
const cityKeys = new Set();
const activeCities = [];
for (const city of [...cities].filter((row) => activeKeys.has(countryKey(row)) && row.hasStandardChineseName).sort(compareHeat)) {
  const key = `${countryKey(city)}|${city.city}`;
  if (cityKeys.has(key)) continue;
  cityKeys.add(key);
  activeCities.push(city);
  if (activeCities.length === cityTarget) break;
}
if (activeCities.length !== cityTarget) throw new Error("可用的标准中文高热度城市不足 500。");

const countryCutoff = activeCountries.at(-1).topCity.heat;
const cityCutoff = activeCities.at(-1).heat;
const countryRows = activeCountries.map((row, index) => ({
  order: index + 1,
  type: "国家链接",
  countryRank: row.countryRank,
  cityRank: null,
  country: row.country,
  iso2: row.iso2,
  countryHeat: row.topCity.heat,
  city: "",
  cityEnglish: "",
  cityHeat: null,
  heatLevel: row.topCity.heatLevel,
  nameStatus: "不适用",
  title: `${row.country}旅行服务咨询｜下单前请先咨询`,
  source: "国家热度前200",
  status: "候选-禁发",
}));
const cityRows = activeCities.map((row, index) => ({
  order: countryTarget + index + 1,
  type: "国家-城市链接",
  countryRank: null,
  cityRank: index + 1,
  country: row.country,
  iso2: row.iso2,
  countryHeat: null,
  city: row.city,
  cityEnglish: row.cityEnglish,
  cityHeat: row.heat,
  heatLevel: row.heatLevel,
  nameStatus: row.nameStatus,
  title: `${row.country}${row.city}旅行服务咨询｜下单前请先咨询`,
  source: "城市热度前500",
  status: "候选-禁发",
}));
const allRows = [...countryRows, ...cityRows];

const workbook = Workbook.create();
const main = workbook.worksheets.add("Sheet1");
const instructions = workbook.worksheets.add("使用说明");
const countryPool = workbook.worksheets.add("国家池200");
const cityPool = workbook.worksheets.add("城市池500");

const navy = "#102A43";
const teal = "#0F766E";
const red = "#B91C1C";
const green = "#166534";
const paleRed = "#FEE2E2";
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

title(main, "境外旅游目的地链接池｜国家优先 200 + 高热度国家-城市 500", "O");
note(main, "上架顺序固定为两段：第 1–200 条是国家链接（不含城市）；第 201–700 条是国家-城市链接，按城市旅游热度全局降序。国家池剔除来源表热度最低的 17 个国家/地区。所有条目默认“候选-禁发”。", "O");
main.getRange("A4:O4").values = [["上架序号", "链接类型", "国家热度序号", "城市热度序号", "国家/地区", "ISO2", "国家旅游热度分", "城市链接名", "城市英文名", "城市旅游热度分", "热度等级", "中文名状态", "建议链接标题（草案）", "选入规则", "上架状态"]];
header(main.getRange("A4:O4"));
main.getRange("A5:O704").values = allRows.map((row) => [row.order, row.type, row.countryRank, row.cityRank, row.country, row.iso2 || "待补", row.countryHeat, row.city, row.cityEnglish, row.cityHeat, row.heatLevel, row.nameStatus, row.title, row.source, row.status]);
data(main.getRange("A5:O704"));
main.getRange("A5:D704").format.numberFormat = "0";
main.getRange("G5:G704").format.numberFormat = "0.0";
main.getRange("J5:J704").format.numberFormat = "0.0";
main.getRange("B5:B204").conditionalFormats.add("containsText", { text: "国家链接", format: { fill: paleGreen, font: { bold: true, color: green } } });
main.getRange("B205:B704").conditionalFormats.add("containsText", { text: "国家-城市链接", format: { fill: "#EAF3F8", font: { bold: true, color: navy } } });
main.getRange("J205:J704").conditionalFormats.add("colorScale", { colors: ["#FEE2E2", "#FEF3C7", "#DCFCE7"] });
main.getRange("O5:O704").conditionalFormats.add("containsText", { text: "候选-禁发", format: { fill: paleRed, font: { bold: true, color: red } } });
main.getRange("O5:O704").dataValidation = { rule: { type: "list", values: ["候选-禁发", "资料待补", "可制作商品包", "人工待发布", "已发布", "下架"] } };
main.freezePanes.freezeRows(4);
main.tables.add("A4:O704", true, "TwoStageDestinationPool");
for (const [column, width] of [["A:A", 10], ["B:B", 15], ["C:D", 13], ["E:E", 22], ["F:F", 9], ["G:G", 15], ["H:H", 20], ["I:I", 24], ["J:J", 15], ["K:K", 12], ["L:L", 20], ["M:M", 44], ["N:N", 17], ["O:O", 15]]) main.getRange(column).format.columnWidth = width;

title(instructions, "使用说明｜国家优先上架顺序", "F");
note(instructions, "热度仅用于来源研究表的选品顺序，不代表真实订单、履约供给、价格、资质或可发布资格。最终发布须以实际淘宝类目和人工审核为准。", "F");
instructions.getRange("A4:B12").values = [
  ["总链接数", countryTarget + cityTarget],
  ["国家链接数", null],
  ["国家-城市链接数", null],
  ["国家池热度阈值", countryCutoff],
  ["城市池热度阈值", cityCutoff],
  ["被剔除低热国家/地区", countries.size - countryTarget],
  ["城市标准中文名数量", null],
  ["城市英文回退名数量", null],
  ["发布总开关", "禁止发布"],
];
label(instructions.getRange("A4:A12"));
data(instructions.getRange("B4:B12"));
instructions.getRange("B5").formulas = [["=COUNTIF('Sheet1'!B5:B704,\"国家链接\")"]];
instructions.getRange("B6").formulas = [["=COUNTIF('Sheet1'!B5:B704,\"国家-城市链接\")"]];
instructions.getRange("B7:B8").format.numberFormat = "0.0";
instructions.getRange("B10").formulas = [["=COUNTIF('Sheet1'!L205:L704,\"GeoNames标准中文名\")"]];
instructions.getRange("B11").formulas = [["=B6-B10"]];
instructions.getRange("B12").conditionalFormats.add("containsText", { text: "禁止发布", format: { fill: paleRed, font: { bold: true, color: red } } });
instructions.getRange("D4:F12").values = [
  ["来源文件", "全球城市服务需求热度_中国客群筛选版(1).xlsx", "来源页：境外城市热度"],
  ["第一段", "国家旅游热度前200", "仅保留国家/地区名，不放城市"],
  ["第二段", "国家-城市旅游热度前500", "城市热度全局降序"],
  ["国家筛选", `最高城市热度 ≥ ${countryCutoff.toFixed(1)}`, "删除最低热度17个国家/地区"],
  ["城市筛选", `标准中文名 + 热度 ≥ ${cityCutoff.toFixed(1)}`, "仅在第一段国家池内选取"],
  ["标题草案", "国家或国家-城市咨询标题", "必须按淘宝实际类目与字数限制复核"],
  ["发布边界", "供给、资质、价格、退改、售后均待核验", "人工检查平台预览并点击发布"],
  ["低热国家", "已从前200国家链接中剔除", "不再进入城市热度池"],
  ["中文名", "城市池全部采用来源标准中文名", "不含英文回退城市"],
];
label(instructions.getRange("D4:D12"));
data(instructions.getRange("E4:F12"));
instructions.getRange("A14:F19").values = [
  ["上架执行顺序", "", "", "", "", ""],
  ["1", "优先上 Sheet1 第1–200条国家链接，先承接国别层面的咨询。", "", "", "", ""],
  ["2", "再按第201–700条城市热度序号处理国家-城市链接。", "", "", "", ""],
  ["3", "每个链接都要单独核验服务范围、供给、价格、退改、售后和淘宝属性。", "", "", "", ""],
  ["4", "未经核验的条目必须保留“候选-禁发”；最终发布由人工完成。", "", "", "", ""],
  ["注意", "国家链接只代表国家维度的咨询入口，不应承诺已覆盖该国所有城市或服务。", "", "", "", ""],
];
instructions.mergeCells("A14:F14");
instructions.getRange("A14").format = { fill: navy, font: { bold: true, color: white } };
for (let row = 15; row <= 19; row += 1) instructions.mergeCells(`B${row}:F${row}`);
label(instructions.getRange("A15:A19"));
data(instructions.getRange("B15:F19"));
instructions.getRange("A15:F19").format.rowHeight = 32;
for (const [column, width] of [["A:A", 20], ["B:B", 28], ["C:C", 10], ["D:D", 16], ["E:E", 37], ["F:F", 30]]) instructions.getRange(column).format.columnWidth = width;

title(countryPool, "国家链接池｜前200条，仅国家名称", "I");
note(countryPool, `按每个国家/地区的最高城市旅游热度排序；仅保留热度 ≥ ${countryCutoff.toFixed(1)} 的前200个国家/地区。`, "I");
countryPool.getRange("A4:I4").values = [["国家热度序号", "国家/地区", "ISO2", "国家旅游热度分", "代表城市（仅作热度依据）", "热度等级", "建议链接标题（草案）", "选入规则", "上架状态"]];
header(countryPool.getRange("A4:I4"));
countryPool.getRange("A5:I204").values = activeCountries.map((row) => [row.countryRank, row.country, row.iso2 || "待补", row.topCity.heat, row.topCity.city, row.topCity.heatLevel, `${row.country}旅行服务咨询｜下单前请先咨询`, "国家热度前200", "候选-禁发"]);
data(countryPool.getRange("A5:I204"));
countryPool.getRange("A5:A204").format.numberFormat = "0";
countryPool.getRange("D5:D204").format.numberFormat = "0.0";
countryPool.getRange("I5:I204").conditionalFormats.add("containsText", { text: "候选-禁发", format: { fill: paleRed, font: { bold: true, color: red } } });
countryPool.freezePanes.freezeRows(4);
countryPool.tables.add("A4:I204", true, "CountryOnlyPool200");
for (const [column, width] of [["A:A", 13], ["B:B", 24], ["C:C", 10], ["D:D", 15], ["E:E", 25], ["F:F", 12], ["G:G", 42], ["H:H", 16], ["I:I", 15]]) countryPool.getRange(column).format.columnWidth = width;

title(cityPool, "国家-城市链接池｜后500条，按城市旅游热度降序", "L");
note(cityPool, `只从前200国家池中挑选，且仅保留来源标准中文名城市；热度 ≥ ${cityCutoff.toFixed(1)}，按城市综合热度全局降序。`, "L");
cityPool.getRange("A4:L4").values = [["城市热度序号", "国家/地区", "ISO2", "城市链接名", "城市英文名", "城市旅游热度分", "热度等级", "中文名状态", "建议链接标题（草案）", "选入规则", "来源热度排名", "上架状态"]];
header(cityPool.getRange("A4:L4"));
cityPool.getRange("A5:L504").values = activeCities.map((row, index) => [index + 1, row.country, row.iso2 || "待补", row.city, row.cityEnglish, row.heat, row.heatLevel, row.nameStatus, `${row.country}${row.city}旅行服务咨询｜下单前请先咨询`, "城市热度前500", row.rank, "候选-禁发"]);
data(cityPool.getRange("A5:L504"));
cityPool.getRange("A5:A504").format.numberFormat = "0";
cityPool.getRange("F5:F504").format.numberFormat = "0.0";
cityPool.getRange("F5:F504").conditionalFormats.add("colorScale", { colors: ["#FEE2E2", "#FEF3C7", "#DCFCE7"] });
cityPool.getRange("L5:L504").conditionalFormats.add("containsText", { text: "候选-禁发", format: { fill: paleRed, font: { bold: true, color: red } } });
cityPool.freezePanes.freezeRows(4);
cityPool.tables.add("A4:L504", true, "CityPool500");
for (const [column, width] of [["A:A", 13], ["B:B", 22], ["C:C", 10], ["D:D", 20], ["E:E", 25], ["F:F", 15], ["G:G", 12], ["H:H", 21], ["I:I", 44], ["J:J", 16], ["K:K", 14], ["L:L", 15]]) cityPool.getRange(column).format.columnWidth = width;

const check = await workbook.inspect({ kind: "table", range: "Sheet1!A4:O18", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 15 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(errors.ndjson);

await fs.mkdir(qaDir, { recursive: true });
for (const [sheetName, range, fileName] of [["Sheet1", "A1:O25", "sheet1-top.png"], ["使用说明", "A1:F19", "instructions.png"], ["国家池200", "A1:I23", "countries-top.png"], ["城市池500", "A1:L25", "cities-top.png"]]) {
  const image = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
  await fs.writeFile(path.join(qaDir, fileName), new Uint8Array(await image.arrayBuffer()));
}
await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = path.join(outputDir, "境外旅游目的地链接池_700_国家优先城市热度.xlsx");
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
console.log(JSON.stringify({ countryTarget, cityTarget, countryCutoff, cityCutoff, excludedCountries: countries.size - countryTarget }));
