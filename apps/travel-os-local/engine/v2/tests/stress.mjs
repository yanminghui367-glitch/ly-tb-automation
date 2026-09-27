import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Store } from '../store.mjs';
import { PublishPage } from '../page.mjs';
import { runBatch } from '../batch.mjs';
import { fixtureServer, profile, taskFixture } from './fixture.mjs';

const output = resolve(process.argv[2] || `output/v2-stress-${Date.now()}`);
await mkdir(output, { recursive: true });
const server = await fixtureServer(), browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage(), po = new PublishPage(page, profile(server.url));
const reports = [];
try {
  for (const count of [1, 5, 20, 50]) {
    const store = new Store(join(output, `stage-${count}.sqlite`)); store.acquire();
    const started = Date.now();
    try {
      const ids = [];
      for (let i = 1; i <= count; i++) {
        const task = await taskFixture(join(output, 'assets'), count * 1000 + i), imported = store.import(task, 'LIVE');
        ids.push(imported.id);
      }
      const batch = await runBatch(store, ids, po, { output: join(output, 'screenshots') });
      const outcomes = batch.outcomes.map(t => ({ ...t, itemId: store.get(t.id).result?.itemId }));
      const success = outcomes.filter(x => x.state === 'PUBLISHED').length;
      const report = { environment: 'LOCAL_FIXTURE', count, attempted: outcomes.length, success, firstAttemptSuccessRate: success / count,
        finalSuccessRate: success / count, failureReasons: outcomes.filter(x => x.state !== 'PUBLISHED'), elapsedMs: Date.now() - started, outcomes };
      reports.push(report);
      console.log(JSON.stringify({ stage: count, success, elapsedMs: report.elapsedMs }));
      await writeFile(join(output, `stage-${count}.json`), JSON.stringify(report, null, 2));
      if (success !== count) { process.exitCode = 1; break; }
    } finally { store.close(); }
  }
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'LOCAL_FIXTURE', realTaobaoRuns: 0, posts: server.posts(), reports }, null, 2));
  await browser.close(); await server.close();
}
