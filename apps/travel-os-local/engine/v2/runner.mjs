import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, requireThat, validateRelease } from './contract.mjs';

export async function runOne(store, id, page, { output, release, notify = console.error } = {}) {
  store.assertLock();
  let record = store.get(id);
  requireThat(record.state === 'READY', 'TASK_NOT_READY');
  const profileHash = hash(page.profile);
  // Preflight is run before page navigation. Missing facts never cause browser actions.
  validateRelease(record.task, page.profile, release, record.mode);
  requireThat(!record.checkpoint.profileHash || record.checkpoint.profileHash === profileHash, 'PROFILE_CHANGED_SINCE_CHECKPOINT');
  requireThat(record.attempts < 3, 'RETRY_BUDGET_EXHAUSTED');
  const checkpoint = { ...record.checkpoint, profileHash, fields: record.checkpoint.fields || {} };
  record = store.move(id, 'RUNNING', { checkpoint });
  const dir = join(output, id, `attempt-${record.attempts}`);
  await mkdir(dir, { recursive: true });
  const saveShot = async name => { const file = join(dir, `${name}.png`); await page.screenshot(file); return file; };
  page.onRisk = async () => {
    const current = store.get(id);
    if (!['RUNNING', 'SUBMITTING'].includes(current.state)) return;
    checkpoint.riskDetectedAt = new Date().toISOString();
    const state = current.state === 'SUBMITTING' ? 'RESULT_UNKNOWN' : 'PAUSED_CAPTCHA';
    store.move(id, state, { checkpoint, reason: 'CAPTCHA_OR_LOGIN' });
    notify(JSON.stringify({ taskId: id, state, reason: 'CAPTCHA_OR_LOGIN', action: '已保存checkpoint，请人工处理，禁止绕过验证' }));
    try {
      checkpoint.failureScreenshot = await saveShot('risk-detected');
      store.move(id, state, { checkpoint, reason: 'CAPTCHA_OR_LOGIN' });
    } catch { /* browser closure cannot undo the durable risk checkpoint */ }
  };
  try {
    await page.prepare({ resume: !!checkpoint.pageOpened });
    checkpoint.pageOpened = true;
    store.move(id, 'RUNNING', { checkpoint });
    for (const [i, field] of page.profile.fields.entries()) {
      // Recheck current DOM even for previously completed fields. Stale checkpoints
      // are not evidence that a reloaded form still contains the expected values.
      await page.guard();
      checkpoint.currentField = field.id;
      store.move(id, 'RUNNING', { checkpoint });
      await page.apply(record.task, field);
      checkpoint.fields[field.id] = { verifiedAt: new Date().toISOString(), screenshot: await saveShot(`field-${i}`) };
      checkpoint.lastField = field.id;
      store.move(id, 'RUNNING', { checkpoint });
    }
    await page.guard();
    checkpoint.finalScreenshot = await saveShot('before-submit');
    if (record.mode === 'DRY_RUN') return store.move(id, 'DRY_RUN_COMPLETE', { checkpoint, reason: 'VERIFIED_FORM_NO_SUBMISSION' });
    validateRelease(record.task, page.profile, release, record.mode);
    checkpoint.submitIntentAt = new Date().toISOString();
    store.move(id, 'SUBMITTING', { checkpoint }); // Durable intent BEFORE external side effect.
    await page.submit(record.task);
    const result = await page.result(record.task);
    result.evidence = await saveShot('published');
    return store.move(id, 'PUBLISHED', { checkpoint, result });
  } catch (error) {
    let screenshot;
    try { screenshot = await saveShot('paused'); } catch { /* closed browser still gets DB checkpoint */ }
    checkpoint.failureScreenshot = screenshot || null;
    const current = store.get(id), code = error.code || error.name || 'UNKNOWN_ERROR';
    const state = ['SUBMITTING', 'RESULT_UNKNOWN'].includes(current.state) ? 'RESULT_UNKNOWN' : code === 'CAPTCHA_OR_LOGIN' ? 'PAUSED_CAPTCHA' : /MANUAL_FIELD|SHOP|ORIGIN|RESUME_PAGE/.test(code) ? 'PAUSED_REVIEW' : 'FAILED_RETRYABLE';
    const result = store.move(id, state, { checkpoint, reason: code });
    notify(JSON.stringify({ taskId: id, state, reason: code, screenshot: screenshot || null, action: state === 'RESULT_UNKNOWN' ? '先核验平台结果，禁止重新提交' : '人工处理后使用 resume 恢复同一任务' }));
    return result;
  } finally { page.onRisk = null; }
}

export async function reconcile(store, id, page, { output, release }) {
  const record = store.get(id);
  requireThat(record.state === 'RESULT_UNKNOWN', 'RECONCILE_ONLY_UNKNOWN');
  validateRelease(record.task, page.profile, release, record.mode);
  requireThat(record.checkpoint.profileHash === hash(page.profile), 'PROFILE_CHANGED_SINCE_CHECKPOINT');
  await page.guard();
  const result = await page.result(record.task);
  await mkdir(join(output, id), { recursive: true });
  result.evidence = join(output, id, `reconciled-${Date.now()}.png`);
  await page.screenshot(result.evidence);
  return store.move(id, 'PUBLISHED', { result, reason: 'READ_ONLY_RESULT_RECONCILIATION' });
}
