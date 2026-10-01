import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "D:/桌面文件迁移/境外旅游目的地链接池_700_国家优先城市热度.xlsx";
const outputDir = path.join(process.cwd(), "output", "700标题重做_20260916");
const outputPath = path.join(outputDir, "境外旅游目的地链接池_700_国家优先城市热度_标题及导购标题.xlsx");
const desktopOutputPath = "D:/桌面文件迁移/境外旅游目的地链接池_700_国家优先城市热度_标题及导购标题.xlsx";
const LINK_MAX = 30;
const GUIDE_MAX = 15;
const services = ["导游", "地陪", "包车", "翻译", "一日游", "接送机", "旅行", "定制行程", "地接", "商务"];
const cityTitleAliases = {
  "圣地亚哥-德孔波斯特拉": "圣地亚哥",
  "堪察加的彼得巴甫洛夫斯克": "彼得罗巴甫洛夫斯克",
};

const lengthOf = (value) => Array.from(value).length;

function orderedServices(index) {
  const offset = index % services.length;
  const rotated = [...services.slice(offset), ...services.slice(0, offset)];
  return Math.floor(index / services.length) % 2 === 0 ? rotated : rotated.reverse();
}

function buildTitle(location, index, maxLength) {
  const place = String(location ?? "").trim();
  if (!place || lengthOf(place) >= maxLength) throw new Error(`地点无法生成${maxLength}字标题：${place}`);
  let title = place;
  const priority = ["定制行程", ...orderedServices(index).filter((item) => item !== "定制行程")];
  for (const keyword of priority) {
    if (lengthOf(title) + lengthOf(keyword) <= maxLength) title += keyword;
  }
  if (!services.some((keyword) => title.includes(keyword))) throw new Error(`标题未包含服务关键词：${title}`);
  return title;
}

function assertTitles({ titles, guides, locations, label }) {
  const badTitlePrefix = titles.filter((title, index) => !title.startsWith(locations[index]));
  const badGuidePrefix = guides.filter((title, index) => !title.startsWith(locations[index]));
  const badTitleLength = titles.filter((title) => lengthOf(title) > LINK_MAX);
  const badGuideLength = guides.filter((title) => lengthOf(title) > GUIDE_MAX);
  const missingService = [...titles, ...guides].filter((title) => !services.some((keyword) => title.includes(keyword)));
  if (badTitlePrefix.length || badGuidePrefix.length || badTitleLength.length || badGuideLength.length || missingService.length) {
    throw new Error(`${label}标题校验失败：链接前缀${badTitlePrefix.length}，导购前缀${badGuidePrefix.length}，链接超长${badTitleLength.length}，导购超长${badGuideLength.length}，缺服务词${missingService.length}`);
  }
}

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const main = workbook.worksheets.getItem("Sheet1");
const countries = workbook.worksheets.getItem("国家池200");
const cities = workbook.worksheets.getItem("城市池500");

const countryNames = countries.getRange("B5:B204").values.map((row) => String(row[0] ?? "").trim());
const cityCountries = cities.getRange("B5:B504").values.map((row) => String(row[0] ?? "").trim());
const cityNames = cities.getRange("D5:D504").values.map((row) => String(row[0] ?? "").trim());
if (countryNames.length !== 200 || cityCountries.length !== 500 || cityNames.length !== 500 || countryNames.some((value) => !value) || cityCountries.some((value) => !value) || cityNames.some((value) => !value)) {
  throw new Error("国家或城市行数、名称不完整，未生成标题。");
}

const cityLocations = cityNames.map((city, index) => `${cityTitleAliases[city] ?? city}${cityCountries[index]}`);
const countryLinks = countryNames.map((country, index) => buildTitle(country, index, LINK_MAX));
const countryGuides = countryNames.map((country, index) => buildTitle(country, index + 37, GUIDE_MAX));
const cityLinks = cityLocations.map((location, index) => buildTitle(location, index + 101, LINK_MAX));
const cityGuides = cityLocations.map((location, index) => buildTitle(location, index + 211, GUIDE_MAX));
assertTitles({ titles: countryLinks, guides: countryGuides, locations: countryNames, label: "国家" });
assertTitles({ titles: cityLinks, guides: cityGuides, locations: cityLocations, label: "城市" });

// Main publish-order sheet already reserves adjacent title columns J/K.
main.getRange("J5:J204").values = countryLinks.map((title) => [title]);
main.getRange("K5:K204").values = countryGuides.map((title) => [title]);
main.getRange("J205:J704").values = cityLinks.map((title) => [title]);
main.getRange("K205:K704").values = cityGuides.map((title) => [title]);
main.getRange("J4:K704").format.wrapText = true;
main.getRange("J:J").format.columnWidth = 30;
main.getRange("K:K").format.columnWidth = 18;

// Keep country-pool title and guide fields adjacent; shift rule/status fields right one column.
countries.getRange("J1:J204").copyFrom(countries.getRange("I1:I204"), "all");
countries.getRange("I1:I204").copyFrom(countries.getRange("H1:H204"), "all");
countries.getRange("H1:H204").copyFrom(countries.getRange("G1:G204"), "all");
countries.getRange("G4:H4").values = [["链接标题", "导购标题"]];
countries.getRange("G5:G204").values = countryLinks.map((title) => [title]);
countries.getRange("H5:H204").values = countryGuides.map((title) => [title]);
countries.getRange("G4:H204").format.wrapText = true;
countries.getRange("G:G").format.columnWidth = 30;
countries.getRange("H:H").format.columnWidth = 18;

// Keep city-pool title and guide fields adjacent; shift rule/rank/status fields right one column.
cities.getRange("M1:M504").copyFrom(cities.getRange("L1:L504"), "all");
cities.getRange("L1:L504").copyFrom(cities.getRange("K1:K504"), "all");
cities.getRange("K1:K504").copyFrom(cities.getRange("J1:J504"), "all");
cities.getRange("J1:J504").copyFrom(cities.getRange("I1:I504"), "all");
cities.getRange("I4:J4").values = [["链接标题", "导购标题"]];
cities.getRange("I5:I504").values = cityLinks.map((title) => [title]);
cities.getRange("J5:J504").values = cityGuides.map((title) => [title]);
cities.getRange("I4:J504").format.wrapText = true;
cities.getRange("I:I").format.columnWidth = 30;
cities.getRange("J:J").format.columnWidth = 18;

workbook.recalculate();
const mainCheck = await workbook.inspect({ kind: "table", range: "Sheet1!A4:M12", include: "values,formulas", tableMaxRows: 9, tableMaxCols: 13 });
console.log(mainCheck.ndjson);
const cityCheck = await workbook.inspect({ kind: "table", range: "城市池500!A4:M12", include: "values,formulas", tableMaxRows: 9, tableMaxCols: 13 });
console.log(cityCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "标题重做公式错误扫描",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, fileName] of [
  ["Sheet1", "A1:M12", "主表标题预览.png"],
  ["国家池200", "A1:J12", "国家池标题预览.png"],
  ["城市池500", "A1:M12", "城市池标题预览.png"],
]) {
  const image = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await image.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
await fs.copyFile(outputPath, desktopOutputPath);
console.log(`OUTPUT=${desktopOutputPath}`);
console.log(JSON.stringify({
  countryTitles: countryLinks.length,
  cityTitles: cityLinks.length,
  maxLinkLength: Math.max(...[...countryLinks, ...cityLinks].map(lengthOf)),
  maxGuideLength: Math.max(...[...countryGuides, ...cityGuides].map(lengthOf)),
}));
