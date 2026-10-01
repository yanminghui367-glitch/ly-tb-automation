import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1).xlsx";
const outputDir = path.join(process.cwd(), "output", "标题补全_20260916");
const outputPath = path.join(outputDir, "全球城市服务需求热度_中国客群筛选版(1)_标题补全.xlsx");
const desktopOutputPath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1)_标题补全.xlsx";
const CITY_COUNT = 500;
const COUNTRY_COUNT = 200;
const LINK_MAX = 30;
const GUIDE_MAX = 15;
const services = ["导游", "地陪", "包车", "翻译", "一日游", "接送机", "旅行", "定制行程", "地接", "商务"];

function characterCount(value) {
  return Array.from(value).length;
}

function orderedServices(index) {
  const offset = index % services.length;
  const rotated = [...services.slice(offset), ...services.slice(0, offset)];
  return Math.floor(index / services.length) % 2 === 0 ? rotated : rotated.reverse();
}

function buildTitle(location, index, maxLength, requireCustomTrip = false) {
  const normalizedLocation = String(location ?? "").trim();
  if (!normalizedLocation) throw new Error(`第${index + 1}条缺少地点，无法生成标题。`);
  if (characterCount(normalizedLocation) >= maxLength) {
    throw new Error(`地点“${normalizedLocation}”长度已达${characterCount(normalizedLocation)}，无法生成${maxLength}字服务标题。`);
  }

  const ordered = orderedServices(index);
  const priority = requireCustomTrip
    ? ["定制行程", ...ordered.filter((item) => item !== "定制行程")]
    : ordered;
  let title = normalizedLocation;
  const used = [];
  for (const keyword of priority) {
    if (characterCount(title) + characterCount(keyword) <= maxLength) {
      title += keyword;
      used.push(keyword);
    }
  }
  if (used.length === 0) throw new Error(`地点“${normalizedLocation}”无法容纳服务关键词。`);
  if (characterCount(title) > maxLength) throw new Error(`标题超长：${title}`);
  return title;
}

function getTableByName(sheet, name) {
  const table = sheet.tables.items.find((item) => item.name === name);
  if (!table) throw new Error(`未找到表格：${name}`);
  return table;
}

console.log("正在导入源表...");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
console.log("源表导入完成。");

const citySheet = workbook.worksheets.getItem("境外城市热度");
const countrySheet = workbook.worksheets.getItem("所有国家");
const cityCountryNames = citySheet.getRange(`D6:D${5 + CITY_COUNT}`).values.map((row) => String(row[0] ?? "").trim());
const cityNames = citySheet.getRange(`G6:G${5 + CITY_COUNT}`).values.map((row) => String(row[0] ?? "").trim());
if (cityCountryNames.length !== CITY_COUNT || cityNames.length !== CITY_COUNT || cityCountryNames.some((value) => !value) || cityNames.some((value) => !value)) {
  throw new Error("境外城市热度前500条存在空国家或空城市。未写入任何标题。");
}

const countryNames = countrySheet.getRange("E5:E225").values.map((row) => String(row[0] ?? "").trim());
const countryRows = countryNames
  .map((country, index) => ({ country, row: index + 5 }))
  .filter((item) => item.country && item.country !== "中国")
  .slice(0, COUNTRY_COUNT);
if (countryRows.length !== COUNTRY_COUNT) throw new Error("可用境外国家不足200条。未写入任何标题。");

const cityLinkTitles = cityNames.map((city, index) => buildTitle(`${city}${cityCountryNames[index]}`, index, LINK_MAX, true));
const cityGuideTitles = cityNames.map((city, index) => buildTitle(`${city}${cityCountryNames[index]}`, index + 37, GUIDE_MAX, true));
const countryLinkTitles = countryRows.map((item, index) => buildTitle(item.country, index + 101, LINK_MAX, true));
const countryGuideTitles = countryRows.map((item, index) => buildTitle(item.country, index + 211, GUIDE_MAX, true));

// Move existing city fields right one column before placing 导购标题 directly after 链接标题.
for (let sourceColumn = 21; sourceColumn >= 11; sourceColumn -= 1) {
  const source = citySheet.getRangeByIndexes(0, sourceColumn - 1, 27800, 1);
  const destination = citySheet.getRangeByIndexes(0, sourceColumn, 27800, 1);
  destination.copyFrom(source, "all");
}
citySheet.getRange("J5:K5").values = [["链接标题", "导购标题"]];
citySheet.getRange(`J6:J${5 + CITY_COUNT}`).values = cityLinkTitles.map((title) => [title]);
citySheet.getRange(`K6:K${5 + CITY_COUNT}`).values = cityGuideTitles.map((title) => [title]);
citySheet.getRange(`J6:K${5 + CITY_COUNT}`).format.wrapText = true;
citySheet.getRange("J:J").format.columnWidth = 30;
citySheet.getRange("K:K").format.columnWidth = 18;

// Recreate the affected table so the shifted city fields remain inside the filterable table.
getTableByName(citySheet, "OverseasCityDemandTable").delete();
const cityTable = citySheet.tables.add("A5:V27800", true, "OverseasCityDemandTable");
cityTable.style = "TableStyleMedium2";

// Add matching columns to the country table; selected country rows retain country-first title order.
countrySheet.getRange("AN4:AO4").values = [["链接标题", "导购标题"]];
countrySheet.getRange("AN5:AO225").clear({ applyTo: "contents" });
for (let index = 0; index < countryRows.length; index += 1) {
  countrySheet.getRange(`AN${countryRows[index].row}:AO${countryRows[index].row}`).values = [[countryLinkTitles[index], countryGuideTitles[index]]];
}
countrySheet.getRange("AN:AO").format.wrapText = true;
countrySheet.getRange("AN:AN").format.columnWidth = 30;
countrySheet.getRange("AO:AO").format.columnWidth = 18;
getTableByName(countrySheet, "AllCountriesTable").delete();
const countryTable = countrySheet.tables.add("A4:AO225", true, "AllCountriesTable");
countryTable.style = "TableStyleMedium2";

const allTitles = [...cityLinkTitles, ...countryLinkTitles];
const allGuides = [...cityGuideTitles, ...countryGuideTitles];
const cityPrefixErrors = cityLinkTitles.filter((title, index) => !title.startsWith(`${cityNames[index]}${cityCountryNames[index]}`));
const countryPrefixErrors = countryLinkTitles.filter((title, index) => !title.startsWith(countryRows[index].country));
const linkLengthErrors = allTitles.filter((title) => characterCount(title) > LINK_MAX);
const guideLengthErrors = allGuides.filter((title) => characterCount(title) > GUIDE_MAX);
const emptyTitleErrors = [...allTitles, ...allGuides].filter((title) => !title || !services.some((service) => title.includes(service)));
if (cityPrefixErrors.length || countryPrefixErrors.length || linkLengthErrors.length || guideLengthErrors.length || emptyTitleErrors.length) {
  throw new Error(`标题规则校验失败：城市前缀${cityPrefixErrors.length}，国家前缀${countryPrefixErrors.length}，链接超长${linkLengthErrors.length}，导购超长${guideLengthErrors.length}，空关键词${emptyTitleErrors.length}。`);
}

workbook.recalculate();
const cityCheck = await workbook.inspect({
  kind: "table",
  range: "境外城市热度!D5:M12",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 10,
});
console.log(cityCheck.ndjson);
const countryCheck = await workbook.inspect({
  kind: "table",
  range: "所有国家!E4:AO12",
  include: "values,formulas",
  tableMaxRows: 9,
  tableMaxCols: 37,
});
console.log(countryCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "标题补全后公式错误扫描",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, fileName] of [
  ["境外城市热度", "D1:M14", "境外城市标题预览.png"],
  ["所有国家", "A1:AO12", "国家标题预览.png"],
]) {
  const image = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await image.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.copyFile(outputPath, desktopOutputPath);
console.log(`OUTPUT=${desktopOutputPath}`);
console.log(JSON.stringify({
  countryTitles: countryLinkTitles.length,
  cityTitles: cityLinkTitles.length,
  maxLinkLength: Math.max(...allTitles.map(characterCount)),
  maxGuideLength: Math.max(...allGuides.map(characterCount)),
}));
