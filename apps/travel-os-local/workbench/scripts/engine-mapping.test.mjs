import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserEnvironment } from '../browser-environment.mjs';

process.env.WORKBENCH_NO_LISTEN = '1';
const { mappingSnapshot, mappingFingerprint, mappingSnapshotChanges, mappingValidation, createTask, executeNextDryRun } = await import('../server.mjs');

// Synthetic in-memory inputs isolate the mapping gate. They are not store data,
// product packages, real selectors, or evidence of platform readiness.
function fixture() {
  const fields = ['category', 'title', 'price', 'main_images', 'secondary_images', 'detail_images', 'inventory'].map(id => ({ id, source: `profile.${id}`, locator: { strategy: 'label', value: `TEST ONLY ${id}` }, interaction: 'fill', reviewed: true }));
  const mapping = { platform: 'taobao', version: 'TEST-ONLY-v1', verified_evidence: 'Synthetic test evidence; no seller verification', draft_url: 'https://example.taobao.com/test-only-never-open', fields };
  const job = { id: 'synthetic-job', destination: '测试国', status: 'READY', listing: { location_type: 'country', country: '测试国', destination: '测试国' }, profile: { shop_name: '合成测试店' }, assets: {}, reviewEvidence: {}, packageValidation: { valid: true }, releaseBlockers: [], automationMapping: mapping, mappingValidation: { valid: true } };
  const shop = { id: 'synthetic-shop', name: '合成测试店', port: 1 };
  const state = { jobs: [job], tasks: [] };
  return { mapping, job, shop, state };
}
const fingerprint = mapping => mappingFingerprint(mappingSnapshot(mapping));

test('snapshot includes every field in execution order and required semantics', () => {
  const { mapping } = fixture();
  const snapshot = mappingSnapshot(mapping);
  assert.deepEqual(snapshot.fields.map(field => field.id), mapping.fields.map(field => field.id));
  assert.equal(snapshot.fields.at(-1).required, true);
  assert.equal(snapshot.snapshotVersion, 2);
  assert.equal(fingerprint(mapping), fingerprint(structuredClone(mapping)));
  mapping.fields.at(-1).required = true;
  assert.equal(mappingFingerprint(snapshot), fingerprint(mapping));
});

const mutations = {
  'additional field source': m => { m.fields.at(-1).source = 'profile.changed'; },
  'additional field locator': m => { m.fields.at(-1).locator.value = 'TEST CHANGED'; },
  'additional field interaction': m => { m.fields.at(-1).interaction = 'manual'; },
  'additional field required flag': m => { m.fields.at(-1).required = false; },
  'base field required flag': m => { m.fields[1].required = false; },
  'execution order': m => { [m.fields[0], m.fields[1]] = [m.fields[1], m.fields[0]]; },
  'additional field removed': m => { m.fields.pop(); },
  'additional field added': m => { m.fields.push({ ...structuredClone(m.fields.at(-1)), id: 'other_attribute' }); },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`engine pauses before connecting when ${name} changes`, async t => {
    const f = fixture(), task = createTask(f.state, f.shop, [f.job.id]);
    task.state = 'RUNNING';
    const before = task.items[0].mappingSnapshot;
    const connect = t.mock.method(BrowserEnvironment.prototype, 'browser', async () => { throw new Error('TEST forbids browser connection'); });
    mutate(f.mapping);
    assert.notEqual(task.items[0].mappingFingerprint, fingerprint(f.mapping));
    assert.ok(mappingSnapshotChanges(before, mappingSnapshot(f.mapping)).length > 0);
    await executeNextDryRun(f.state, f.shop, task);
    assert.equal(task.state, 'PAUSED');
    assert.equal(task.currentStep, 'MAPPING_CHANGED_SINCE_REVIEW');
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(task.items[0].completedFields, undefined);
  });
}

test('all mapped fields, including optional and manual, require human review', () => {
  for (const interaction of ['fill', 'manual']) {
    const { mapping } = fixture();
    Object.assign(mapping.fields.at(-1), { reviewed: false, required: false, interaction });
    assert.equal(mappingValidation(mapping).valid, false);
    assert.match(mappingValidation(mapping).issues.join(), /inventory.*核验/);
  }
});
test('creation recomputes mapping validation instead of accepting a cached valid flag', () => {
  const f = fixture();
  delete f.mapping.fields.at(-1).reviewed;
  assert.throws(() => createTask(f.state, f.shop, [f.job.id]), /字段映射未就绪/);
  assert.equal(f.state.tasks.length, 0);
});
test('execution recomputes review validation before browser connection', async t => {
  const f = fixture(), task = createTask(f.state, f.shop, [f.job.id]);
  const connect = t.mock.method(BrowserEnvironment.prototype, 'browser', async () => { throw new Error('TEST forbids browser connection'); });
  f.mapping.fields.at(-1).reviewed = false;
  await executeNextDryRun(f.state, f.shop, task);
  assert.equal(task.currentStep, 'MAPPING_INVALID');
  assert.equal(connect.mock.callCount(), 0);
});
test('legacy snapshots cannot silently gain additional frozen fields', async t => {
  const f = fixture(), task = createTask(f.state, f.shop, [f.job.id]);
  const snapshot = structuredClone(task.items[0].mappingSnapshot);
  delete snapshot.snapshotVersion;
  snapshot.fields = snapshot.fields.slice(0, 6).sort((a, b) => a.id.localeCompare(b.id));
  snapshot.fields.forEach(field => { delete field.required; });
  task.items[0].mappingSnapshot = snapshot;
  task.items[0].mappingFingerprint = mappingFingerprint(snapshot);
  const connect = t.mock.method(BrowserEnvironment.prototype, 'browser', async () => { throw new Error('TEST forbids browser connection'); });
  await executeNextDryRun(f.state, f.shop, task);
  assert.equal(task.currentStep, 'MAPPING_CHANGED_SINCE_REVIEW');
  assert.equal(connect.mock.callCount(), 0);
});
test('snapshot is detached from the editable mapping', () => {
  const f = fixture(), task = createTask(f.state, f.shop, [f.job.id]);
  const before = JSON.stringify(task.items[0].mappingSnapshot);
  f.mapping.fields.at(-1).locator.value = 'TEST CHANGED';
  assert.equal(JSON.stringify(task.items[0].mappingSnapshot), before);
});
test('unchanged reviewed mapping reaches the mocked connection boundary', async t => {
  const f = fixture(), task = createTask(f.state, f.shop, [f.job.id]);
  const connect = t.mock.method(BrowserEnvironment.prototype, 'browser', async () => { throw new Error('TEST STOP: no real browser'); });
  await executeNextDryRun(f.state, f.shop, task);
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(task.currentStep, 'PAGE_OR_MAPPING_PAUSED');
  assert.match(task.events[0].message, /TEST STOP/);
});
test('required flag accepts only boolean values or the omitted default', () => {
  const { mapping } = fixture();
  mapping.fields.at(-1).required = 'false';
  assert.equal(mappingValidation(mapping).valid, false);
  mapping.fields.at(-1).required = false;
  assert.equal(mappingValidation(mapping).valid, true);
});
