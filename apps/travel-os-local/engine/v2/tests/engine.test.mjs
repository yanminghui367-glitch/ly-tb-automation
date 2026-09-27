import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { Store } from '../store.mjs';
import { PublishPage } from '../page.mjs';
import { runOne, reconcile } from '../runner.mjs';
import { runBatch } from '../batch.mjs';
import { hash, validateRelease, taskIssues } from '../contract.mjs';
import { fixtureServer, profile, taskFixture } from './fixture.mjs';

test('login pause before connection preserves task and retry budget across process restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-login-pause-')), file = join(dir, 'state.sqlite');
  const task = await taskFixture(dir), a = new Store(file); a.acquire();
  const r = a.import(task, 'DRY_RUN');
  a.move(r.id, 'PAUSED_CAPTCHA', { checkpoint: { currentField: 'title', browserPausedAt: new Date().toISOString() }, reason: 'CAPTCHA_OR_LOGIN' });
  assert.equal(a.get(r.id).attempts, 0); a.close();
  const b = new Store(file); b.acquire();
  assert.equal(b.get(r.id).checkpoint.currentField, 'title');
  b.resume(r.id, '人工登录已完成，重新核验当前页面');
  assert.equal(b.get(r.id).state, 'READY'); assert.equal(b.get(r.id).attempts, 0); b.close();
});

test('SQLite transaction, immutable destination, locking, restart and unknown-result safety', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-v2-db-')), file = join(dir, 'state.sqlite');
  const task = await taskFixture(dir), a = new Store(file), b = new Store(file);
  try {
    const r = a.import(task, 'LIVE'); assert.equal(a.import(task, 'LIVE').id, r.id);
    assert.throws(() => a.import({ ...task, business: { ...task.business, price_cny: 11 } }, 'LIVE'), /DESTINATION_ALREADY_RESERVED/);
    a.acquire(); assert.throws(() => b.acquire(), /ENGINE_ALREADY_RUNNING/);
    assert.throws(() => a.acquire(), /ENGINE_ALREADY_RUNNING/); a.assertLock();
    a.move(r.id, 'RUNNING'); a.release();
    b.acquire(); b.recover(); assert.equal(b.get(r.id).state, 'PAUSED_REVIEW');
    assert.throws(() => b.resume(r.id, ''), /HUMAN_RESUME/);
    b.resume(r.id, '已人工核验页面'); b.move(r.id, 'RUNNING'); b.move(r.id, 'SUBMITTING'); b.release();
    a.acquire(); a.recover(); assert.equal(a.get(r.id).state, 'RESULT_UNKNOWN');
    assert.throws(() => a.resume(r.id, '禁止盲目重新提交'), /TASK_NOT_RESUMABLE/);
    assert.throws(() => a.move(r.id, 'READY'), /ILLEGAL_TRANSITION/);
    assert.throws(() => a.move(r.id, 'PUBLISHED'), /VERIFIED_RESULT_REQUIRED/);
  } finally { a.close(); b.close(); }
});

test('business/asset/release gates reject mutated assets and synthetic approval on real shop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-v2-gate-')), task = await taskFixture(dir);
  assert.deepEqual(taskIssues(task), []);
  const real = { ...profile('https://myseller.taobao.com/draft'), environment: 'TAOBAO' };
  assert.throws(() => validateRelease(task, real, null, 'LIVE'), /RELEASE_SCOPE/);
  const release = { shopId: task.shopId, taskHashes: [hash(task)], profileHash: hash(real), expiresAt: '2999-01-01', reviewer: 'fixture', authorizationReference: 'fixture', onlineDuplicateEvidence: 'fixture', p4Ready: true, qaEvidence: 'fixture' };
  assert.throws(() => validateRelease(task, real, release, 'LIVE'), /P5_GATE/);
  const swapped = structuredClone(real); swapped.fields.find(f => f.id === 'title').source = 'business.price_cny';
  assert.throws(() => validateRelease(task, swapped, release, 'LIVE'), /WRONG_SOURCE_title/);
  await writeFile(task.assets.main[0].path, 'changed'); assert(taskIssues(task).includes('ASSET_HASH_CHANGED'));
});

test('actual child process exit recovers stale lock and durable submit intent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-v2-crash-')), file = join(dir, 'crash.sqlite');
  const store = new Store(file), record = store.import(await taskFixture(dir), 'LIVE'); store.close();
  const code = `import {Store} from './engine/v2/store.mjs'; const s=new Store(process.argv[1]);s.acquire();s.move(process.argv[2],'RUNNING');s.move(process.argv[2],'SUBMITTING');process.exit(73);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, file, record.id], { encoding: 'utf8' });
  assert.equal(child.status, 73);
  const recovered = new Store(file);
  try { recovered.acquire(); recovered.recover(); assert.equal(recovered.get(record.id).state, 'RESULT_UNKNOWN'); assert.equal(recovered.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
  finally { recovered.close(); }
});

test('blocked revision preserves history and does not bypass executable destination reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-v2-revision-')), task = await taskFixture(dir), store = new Store(join(dir, 'state.sqlite'));
  try {
    const blocked = store.import({ ...task, evidence: {} }); assert.equal(blocked.state, 'BLOCKED');
    assert.throws(() => store.import(task), /DESTINATION_ALREADY_RESERVED/);
    const fixed = store.import(task, 'DRY_RUN', { replaceBlocked: true }); assert.equal(fixed.state, 'READY'); assert.equal(store.get(blocked.id).state, 'SUPERSEDED');
    assert.throws(() => store.import({ ...task, source: { revision: 2 } }, 'DRY_RUN', { replaceBlocked: true }), /DESTINATION_ALREADY_RESERVED/);
  } finally { store.close(); }
});

test('real browser: full path, risk resume, checkpoint repair, unknown result, wrong shop, selector failure', { timeout: 180000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ly-v2-browser-'));
  const server = await fixtureServer(), browser = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await browser.newPage(), config = profile(server.url), po = new PublishPage(p, config, { timeout: 1200 });
  const store = new Store(join(dir, 'tasks.sqlite')); store.acquire();
  const options = { output: resolve('output/v2-20260917/browser-tests'), notify: () => {} };
  try {
    await t.test('LIVE verified success records ID URL and immutable evidence', async () => {
      const task = await taskFixture(dir, 1), r = store.import(task, 'LIVE');
      const result = await runOne(store, r.id, po, options);
      assert.equal(result.state, 'PUBLISHED'); assert.equal(server.posts(), 1);
      assert.equal(Object.keys(result.checkpoint.fields).length, 7);
      assert((await readFile(result.result.evidence)).length > 0);
      await assert.rejects(runOne(store, r.id, po, options), /TASK_NOT_READY/);
    });
    await t.test('DRY_RUN never submits', async () => {
      const r = store.import(await taskFixture(dir, 2)); const posts = server.posts();
      assert.equal((await runOne(store, r.id, po, options)).state, 'DRY_RUN_COMPLETE'); assert.equal(server.posts(), posts);
    });
    await t.test('verified DRY_RUN promotes same immutable task and then publishes once', async () => {
      const r = store.import(await taskFixture(dir, 8)); const posts = server.posts();
      assert.equal((await runOne(store, r.id, po, options)).state, 'DRY_RUN_COMPLETE');
      store.promoteToLive(r.id, 'SYNTHETIC P4 review');
      assert.equal((await runOne(store, r.id, po, options)).state, 'PUBLISHED'); assert.equal(server.posts(), posts + 1);
    });
    await t.test('CAPTCHA stops following fields and resumes current task; no repeated valid fields', async () => {
      const task = await taskFixture(dir, 3), r = store.import(task, 'LIVE');
      await p.goto(server.url); await p.evaluate(() => window.scenario = 'captcha');
      store.move(r.id, 'RUNNING', { checkpoint: { profileHash: hash(config), pageOpened: true } });
      store.move(r.id, 'PAUSED_REVIEW'); store.resume(r.id, '测试准备现场');
      const paused = await runOne(store, r.id, po, options); assert.equal(paused.state, 'PAUSED_CAPTCHA');
      assert.equal(await p.locator('#price').inputValue(), '');
      assert(paused.checkpoint.failureScreenshot);
      // Human completion is simulated only in the LOCAL_FIXTURE test page.
      await p.evaluate(() => { document.querySelector('#risk').textContent = ''; window.scenario = 'normal'; });
      store.resume(r.id, '测试模拟人工完成验证码');
      const final = await runOne(store, r.id, po, options); assert.equal(final.state, 'PUBLISHED');
      assert.equal(await p.evaluate(() => window.hits.title), 1);
    });
    await t.test('reload invalidates DOM despite old completed checkpoints, re-fills then succeeds', async () => {
      const task = await taskFixture(dir, 4), r = store.import(task, 'LIVE');
      await p.goto(server.url);
      store.move(r.id, 'RUNNING', { checkpoint: { profileHash: hash(config), pageOpened: true, fields: { title: { verifiedAt: 'old' } } } });
      store.recover(); store.resume(r.id, '已检查重载页面与身份');
      assert.equal((await runOne(store, r.id, po, options)).state, 'PUBLISHED');
    });
    await t.test('response uncertainty is reconciled read-only, never resubmitted', async () => {
      const task = await taskFixture(dir, 5), r = store.import(task, 'LIVE');
      await p.goto(server.url); await p.evaluate(() => window.scenario = 'unknown');
      store.move(r.id, 'RUNNING', { checkpoint: { profileHash: hash(config), pageOpened: true } }); store.move(r.id, 'PAUSED_REVIEW'); store.resume(r.id, '测试恢复现场');
      assert.equal((await runOne(store, r.id, po, options)).state, 'RESULT_UNKNOWN');
      const posts = server.posts(); assert.throws(() => store.resume(r.id, '结果未明禁止重试'), /TASK_NOT_RESUMABLE/);
      await p.evaluate(() => window.showResult(window.lastItem));
      assert.equal((await reconcile(store, r.id, po, options)).state, 'PUBLISHED'); assert.equal(server.posts(), posts);
    });
    await t.test('wrong shop halts before filling or submitting', async () => {
      const task = await taskFixture(dir, 6), r = store.import(task, 'LIVE');
      await p.goto(server.url); await p.locator('#shop').evaluate(el => el.textContent = '错误店铺');
      store.move(r.id, 'RUNNING', { checkpoint: { profileHash: hash(config), pageOpened: true } }); store.move(r.id, 'PAUSED_REVIEW'); store.resume(r.id, '测试错误店铺');
      const posts = server.posts(); assert.equal((await runOne(store, r.id, po, options)).state, 'PAUSED_REVIEW');
      assert.equal(await p.locator('#title').inputValue(), ''); assert.equal(server.posts(), posts);
    });
    await t.test('missing locator records retryable reason and no publish', async () => {
      const task = await taskFixture(dir, 7), r = store.import(task, 'LIVE');
      const bad = structuredClone(config); bad.fields[1].selector = '#missing-title';
      const posts = server.posts();
      const failed = await runOne(store, r.id, new PublishPage(p, bad, { timeout: 700 }), options);
      assert.equal(failed.state, 'FAILED_RETRYABLE'); assert.equal(server.posts(), posts);
      assert.equal(failed.reason, 'TimeoutError');
    });
    await t.test('five-task batch stops globally on risk then resumes without republishing successes', async () => {
      const ids = [];
      for (let i = 20; i < 25; i++) ids.push(store.import(await taskFixture(dir, i), 'LIVE').id);
      const original = po.prepare.bind(po); let opened = 0;
      po.prepare = async opts => { await original(opts); if (++opened === 3) await p.evaluate(() => window.scenario = 'captcha'); };
      const posts = server.posts();
      const first = await runBatch(store, ids, po, options);
      assert.equal(first.success, 2); assert.equal(first.stopped, true); assert.equal(store.get(ids[2]).state, 'PAUSED_CAPTCHA'); assert.equal(store.get(ids[3]).state, 'READY');
      await p.evaluate(() => { document.querySelector('#risk').textContent = ''; window.scenario = 'normal'; });
      store.resume(ids[2], '测试模拟人工完成验证');
      const final = await runBatch(store, ids, po, options);
      assert.equal(final.success, 5); assert.equal(final.stopped, false); assert.equal(server.posts(), posts + 5);
      po.prepare = original;
    });
  } finally { store.close(); await browser.close(); await server.close(); }
});
