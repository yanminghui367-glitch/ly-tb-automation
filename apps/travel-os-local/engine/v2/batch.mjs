import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireThat, validateRelease } from './contract.mjs';
import { runOne } from './runner.mjs';

export async function runBatch(store, ids, page, options) {
  store.assertLock();
  requireThat(Array.isArray(ids) && [1, 5, 20, 50].includes(ids.length) && new Set(ids).size === ids.length, 'BATCH_SIZE_MUST_BE_1_5_20_50');
  if (ids.length > 1 && page.profile.environment === 'TAOBAO') requireThat(options.release?.p5Evidence && options.release?.batchQaEvidence, 'P6_GATE_REQUIRED');
  // Validate entire explicit selection before any page action; no implicit whole-sheet run.
  for (const id of ids) validateRelease(store.get(id).task, page.profile, options.release, store.get(id).mode);
  const report = { environment: page.profile.environment, selected: ids.length, startedAt: new Date().toISOString(), outcomes: [], stopped: false };
  await mkdir(options.output, { recursive: true });
  const reportPath = join(options.output, `batch-${Date.now()}.json`);
  const save = async () => {
    report.success = report.outcomes.filter(t => ['PUBLISHED', 'DRY_RUN_COMPLETE'].includes(t.state)).length;
    report.successRate = report.success / ids.length;
    report.updatedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  };
  try {
    for (const id of ids) {
      const task = store.get(id);
      if (['PUBLISHED', 'DRY_RUN_COMPLETE'].includes(task.state)) { report.outcomes.push({ id, state: task.state, skippedExisting: true }); continue; }
      if (task.state !== 'READY') { report.outcomes.push({ id, state: task.state, reason: 'EXPLICIT_RESUME_REQUIRED' }); report.stopped = true; break; }
      const started = Date.now();
      let result;
      try { result = await runOne(store, id, page, options); }
      catch (e) { report.outcomes.push({ id, state: store.get(id).state, reason: e.code || e.name }); report.stopped = true; break; }
      report.outcomes.push({ id, state: result.state, reason: result.reason, elapsedMs: Date.now() - started });
      await save();
      if (!['PUBLISHED', 'DRY_RUN_COMPLETE'].includes(result.state)) { report.stopped = true; break; }
    }
  } finally { await save(); }
  return { ...report, reportPath };
}
