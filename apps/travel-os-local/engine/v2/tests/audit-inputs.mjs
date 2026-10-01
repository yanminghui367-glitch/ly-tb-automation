import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash, taskIssues } from '../contract.mjs';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const files = new Map(), issues = {};
for (const task of input.tasks) {
  files.set(task.source.workbook, task.source.sha256);
  if (task.source.package) files.set(task.source.package.path, task.source.package.sha256);
  for (const a of Object.values(task.assets).flat()) if (a.sha256) files.set(a.path, a.sha256);
  for (const issue of taskIssues(task, { verifyFiles: false })) issues[issue] = (issues[issue] || 0) + 1;
}
const verification = [];
for (const [path, expected] of files) {
  let actual = null; try { actual = hash(await readFile(path)); } catch { /* report missing */ }
  verification.push({ path, expected, actual, unchanged: actual === expected });
}
const result = { at: new Date().toISOString(), tasks: input.tasks.length, selection: input.selection, issues, files: verification.length, changed: verification.filter(f => !f.unchanged).length, verification };
await writeFile(resolve(process.argv[3]), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ tasks: result.tasks, uniqueSourceFiles: result.files, changed: result.changed }));
if (result.changed) process.exitCode = 1;
