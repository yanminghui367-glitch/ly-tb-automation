import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "D:/桌面文件迁移/境外旅游目的地链接池_700_国家优先城市热度.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const sheets = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 3000 });
console.log(sheets.ndjson);
for (const [sheetName, range] of [
  ["Sheet1", "A1:O12"],
  ["Sheet1", "A202:M210"],
  ["国家池200", "A1:I12"],
  ["城市池500", "A1:L12"],
]) {
  const check = await workbook.inspect({ kind: "table", range: `${sheetName}!${range}`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 15, maxChars: 9000 });
  console.log(check.ndjson);
}
