import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = process.cwd();
const sourcePath = "D:/桌面文件迁移/境外旅游目的地链接池_700_国家优先城市热度.xlsx";
const outputDir = path.join(root, "outputs", "标题优化_20260830");
const outputPath = path.join(outputDir, "境外旅游目的地链接池_700_国家优先城市热度_标题优化.xlsx");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const main = workbook.worksheets.getItem("Sheet1");
const countryPool = workbook.worksheets.getItem("国家池200");
const cityPool = workbook.worksheets.getItem("城市池500");

const lengthOf = (value) => Array.from(value).length;
const patterns = [
  ["定制行程", "翻译", "地接", "导游", "一日游", "商务", "展会", "包车", "地陪", "旅行观光服务"],
  ["定制行程", "地接", "导游", "翻译", "商务展会", "包车", "地陪", "一日游", "旅行观光服务"],
  ["定制行程", "包车地陪", "翻译", "导游", "一日游", "商务展会", "旅行观光服务"],
  ["定制行程", "导游翻译", "地接", "一日游", "商务展会", "包车地陪", "旅行观光服务"],
];

function buildTitle(location, index) {
  const pattern = patterns[index % patterns.length];
  let title = location;
  for (const phrase of pattern) {
    if (lengthOf(title) + lengthOf(phrase) <= 30) title += phrase;
  }
  if (!title.includes("定制行程")) throw new Error(`标题无法放入核心词：${location}`);
  if (lengthOf(title) > 30) throw new Error(`标题超过30字：${title}`);
  return title;
}

const countryNames = countryPool.getRange("B5:B204").values.map((row) => String(row[0] ?? "").trim());
const cityCountries = cityPool.getRange("B5:B504").values.map((row) => String(row[0] ?? "").trim());
const cityNames = cityPool.getRange("D5:D504").values.map((row) => String(row[0] ?? "").trim());
if (countryNames.length !== 200 || cityCountries.length !== 500 || cityNames.length !== 500) throw new Error("标题行数与700条链接池不一致。");
if (countryNames.some((name) => !name) || cityCountries.some((name) => !name) || cityNames.some((name) => !name)) throw new Error("存在空的国家或城市名称，无法生成标题。");

const countryTitles = countryNames.map((country, index) => buildTitle(country, index));
const cityTitles = cityNames.map((city, index) => buildTitle(`${city}${cityCountries[index]}`, index));

// Only title values change; all existing formatting, tables, filters and validation remain untouched.
main.getRange("M5:M204").values = countryTitles.map((title) => [title]);
main.getRange("M205:M704").values = cityTitles.map((title) => [title]);
countryPool.getRange("G5:G204").values = countryTitles.map((title) => [title]);
cityPool.getRange("I5:I504").values = cityTitles.map((title) => [title]);

const maxCountryLength = Math.max(...countryTitles.map(lengthOf));
const maxCityLength = Math.max(...cityTitles.map(lengthOf));
const countryPrefixErrors = countryTitles.filter((title, index) => !title.startsWith(countryNames[index]));
const cityPrefixErrors = cityTitles.filter((title, index) => !title.startsWith(`${cityNames[index]}${cityCountries[index]}`));
const coreKeywordErrors = [...countryTitles, ...cityTitles].filter((title) => !title.includes("定制行程"));
if (maxCountryLength > 30 || maxCityLength > 30 || countryPrefixErrors.length || cityPrefixErrors.length || coreKeywordErrors.length) {
  throw new Error("标题规则校验失败。");
}

const checkMain = await workbook.inspect({ kind: "table", range: "Sheet1!E4:O12", include: "values,formulas", tableMaxRows: 9, tableMaxCols: 11 });
console.log(checkMain.ndjson);
const checkCity = await workbook.inspect({ kind: "table", range: "城市池500!B4:L12", include: "values,formulas", tableMaxRows: 9, tableMaxCols: 11 });
console.log(checkCity.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const [sheetName, range, fileName] of [["Sheet1", "E1:O12", "after-sheet1-country.png"], ["Sheet1", "E200:O212", "after-sheet1-city.png"], ["国家池200", "A1:I12", "after-country-pool.png"], ["城市池500", "A1:L12", "after-city-pool.png"]]) {
  const image = await workbook.render({ sheetName, range, scale: 1.3, format: "png" });
  await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await image.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
console.log(JSON.stringify({ countryTitles: countryTitles.length, cityTitles: cityTitles.length, maxCountryLength, maxCityLength }));
