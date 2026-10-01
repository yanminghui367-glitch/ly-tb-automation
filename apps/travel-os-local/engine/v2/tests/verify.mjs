import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { hash } from '../contract.mjs';

const output = resolve(process.argv[2] || `output/v2-verification-${Date.now()}`);
await mkdir(output, { recursive: true });
const checks = [
  ['adapter', 'python', ['engine/v2/tests/adapter_test.py']],
  ['engine', process.execPath, ['--test', 'engine/v2/tests/engine.test.mjs']],
  ['legacy', process.execPath, ['--test', 'workbench/scripts/engine-mapping.test.mjs', 'workbench/scripts/static-files.test.mjs', 'workbench/scripts/session-guard.test.mjs', 'tools/generate_review_packages.test.mjs']],
  ['stress', process.execPath, ['engine/v2/tests/stress.mjs', join(output, 'stress')]]
];
const results = [];
for (const [name, bin, args] of checks) {
  const started = Date.now(); let log = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    child.stdout.on('data', b => { log += b.toString(); if (name === 'stress') process.stdout.write(b); });
    child.stderr.on('data', b => { log += b.toString(); });
    child.on('error', reject); child.on('exit', resolve);
  });
  await writeFile(join(output, `${name}.log`), log);
  results.push({ name, code, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(results.at(-1)));
  if (code !== 0) { process.exitCode = 1; break; }
}
const hashes = {};
for (const name of await readdir('engine/v2')) if (/\.(mjs|py|json)$/.test(name)) hashes[name] = hash(await readFile(join('engine/v2', name)));
await writeFile(join(output, 'verification.json'), JSON.stringify({ at: new Date().toISOString(), node: process.version, playwright: createRequire(import.meta.url)('playwright/package.json').version, environment: 'LOCAL_FIXTURE', realTaobaoRuns: 0, results, hashes }, null, 2));
if (process.exitCode) console.error(`Verification failed; see ${output}`);
