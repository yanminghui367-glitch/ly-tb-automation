import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = "D:/桌面文件迁移/全球城市服务需求热度_中国客群筛选版(1).xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));

const sheetInfo = await workbook.inspect({
  kind: "workbook,sheet",
  include: "id,name",
  maxChars: 6000,
});
console.log(sheetInfo.ndjson);

for (const sheetName of workbook.worksheets.items.map((sheet) => sheet.name)) {
  const range = workbook.worksheets.getItem(sheetName).getUsedRange();
  console.log(JSON.stringify({ sheetName, usedRange: range.address }));
  const preview = await workbook.inspect({
    kind: "table",
    range: `${sheetName}!A1:Z12`,
    include: "values,formulas",
    tableMaxRows: 12,
    tableMaxCols: 26,
    tableMaxCellChars: 80,
    maxChars: 10000,
  });
  console.log(preview.ndjson);
}
