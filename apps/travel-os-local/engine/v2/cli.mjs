import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { connectSeller } from './page.mjs';
import { runOne, reconcile } from './runner.mjs';
import { runBatch } from './batch.mjs';
import { hash, requireThat, validateRelease } from './contract.mjs';

const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) { requireThat(args[i].startsWith('--') && args[i + 1], 'EXPECTED_FLAG_VALUE'); options[args[i].slice(2)] = args[i + 1]; }
const load = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const help = `LY V2 (Node 24+). Commands:
  import --tasks <adapter.json> --db <state.sqlite> [--mode DRY_RUN|LIVE] [--replace-blocked true]
  status --db <state.sqlite>
  inspect --db <state.sqlite> --id <taskId> --profile <profile.json>
  run --db <state.sqlite> --id <taskId> --profile <verified-profile.json> --release <release.json>
  resume --db <state.sqlite> --id <taskId> --note <human-resolution>
  recover --db <state.sqlite>
  reconcile --db <state.sqlite> --id <taskId> --profile <profile.json> --release <release.json>
  authorize-live --db <state.sqlite> --id <taskId> --profile <profile.json> --release <release.json>
  batch --db <state.sqlite> --ids <JSON-array-file> --profile <profile.json> --release <release.json>
Optional --output <evidence-directory>. Production CLI refuses LOCAL_FIXTURE profiles.
No credentials are read/exported. User opens and logs into dedicated Chrome manually.`;
if (!command || command === 'help') { console.log(help); process.exit(0); }
requireThat(options.db, 'DATABASE_REQUIRED');
const store = new Store(resolve(options.db));
let connection;
try {
  if (command === 'import') {
    const input = await load(options.tasks);
    const results = [];
    for (const task of input.tasks) {
      try { const t = store.import(task, options.mode || 'DRY_RUN', { replaceBlocked: options['replace-blocked'] === 'true' }); results.push({ id: t.id, state: t.state, row: task.source?.row, reason: t.reason }); }
      catch (e) { results.push({ state: 'IMPORT_REJECTED', row: task.source?.row, reason: e.code || e.message }); }
    }
    const output = resolve(options.output || 'output/v2-import'); await mkdir(output, { recursive: true });
    await writeFile(resolve(output, `import-${Date.now()}.json`), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ count: results.length, states: results.reduce((a, t) => (a[t.state] = (a[t.state] || 0) + 1, a), {}), output }, null, 2));
  } else if (command === 'inspect') {
    const task = store.get(options.id), profile = await load(options.profile);
    console.log(JSON.stringify({ id: task.id, taskHash: task.hash, profileHash: hash(profile), state: task.state, reason: task.reason }, null, 2));
  } else if (command === 'status') {
    console.log(JSON.stringify(store.list().map(t => ({ id: t.id, city: t.task.listing.city, state: t.state, mode: t.mode, attempts: t.attempts, reason: t.reason, result: t.result })), null, 2));
  } else {
    store.acquire();
    if (command === 'recover') { store.recover(); console.log('Interrupted tasks checkpointed; resume is explicit.'); }
    else if (command === 'resume') { console.log(JSON.stringify({ id: options.id, state: store.resume(options.id, options.note).state })); }
    else if (['run', 'reconcile', 'authorize-live', 'batch'].includes(command)) {
      const profile = await load(options.profile), release = await load(options.release);
      requireThat(profile.environment === 'TAOBAO', 'CLI_REQUIRES_REAL_PROFILE');
      const ids = command === 'batch' ? await load(options.ids) : [options.id];
      const t = store.get(ids[0]);
      if (command !== 'batch') requireThat(command === 'run' ? t.state === 'READY' : command === 'authorize-live' ? t.state === 'DRY_RUN_COMPLETE' : t.state === 'RESULT_UNKNOWN', 'TASK_STATE_NOT_EXECUTABLE');
      for (const id of ids) { const item = store.get(id); validateRelease(item.task, profile, release, command === 'authorize-live' ? 'LIVE' : item.mode); }
      requireThat(!t.checkpoint.profileHash || t.checkpoint.profileHash === hash(profile), 'PROFILE_CHANGED_SINCE_CHECKPOINT');
      if (command === 'authorize-live') { console.log(JSON.stringify({ id: t.id, state: store.promoteToLive(t.id, release.p4Evidence).state })); }
      else {
      try { connection = await connectSeller(profile); }
      catch (error) {
        if (['CAPTCHA_OR_LOGIN', 'BROWSER_OWNER_UNAVAILABLE', 'BROWSER_OWNER_SHOP_MISMATCH'].includes(error.code) && t.state === 'READY') {
          store.move(t.id, error.code === 'CAPTCHA_OR_LOGIN' ? 'PAUSED_CAPTCHA' : 'PAUSED_REVIEW', { checkpoint: { ...t.checkpoint, browserPausedAt: new Date().toISOString(), browserRecovery: '人工登录或验证后，对原任务执行 resume；禁止重新创建商品。' }, reason: error.code });
        }
        throw error;
      }
      const params = { output: resolve(options.output || 'output/v2-runs'), release };
      const result = command === 'run' ? await runOne(store, t.id, connection.pageObject, params) : command === 'batch' ? await runBatch(store, ids, connection.pageObject, params) : await reconcile(store, t.id, connection.pageObject, params);
      console.log(JSON.stringify(command === 'batch' ? result : { id: result.id, state: result.state, reason: result.reason, result: result.result }, null, 2));
      if (command === 'batch' ? result.stopped : !['PUBLISHED', 'DRY_RUN_COMPLETE'].includes(result.state)) process.exitCode = 2;
      }
    } else throw new Error(help);
  }
} catch (e) { console.error(e.code || e.message); process.exitCode = 1; }
finally { if (connection) await connection.disconnect(); store.close(); }
