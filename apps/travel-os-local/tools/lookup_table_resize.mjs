import { Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
const help = workbook.help("table.resize", { include: "index,examples,notes", maxChars: 4000 });
console.log(help.ndjson);
