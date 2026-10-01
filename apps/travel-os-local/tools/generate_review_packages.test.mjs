import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateReviewPackages } from './generate_review_packages.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ly-review-package-test-'));
  const source = path.join(root, 'source'), output = path.join(root, 'review');
  await mkdir(source);
  // Synthetic fixture files test local file handling only, never image semantics or platform readiness.
  for (const name of ['main.png', 's1.png', 's2.png', 's3.png', 's4.png', 'd2.png', 'd1.png']) await writeFile(path.join(source, name), 'TEST ONLY');
  const pkg = { package_version: 1, status: 'READY', source: { row: 4 }, listing: { location_type: 'country', country: '测试国', destination: '测试国', title: '测试国咨询' }, assets: { main_image: 'main.png', secondary_image_set: { files: ['s1.png', 's2.png', 's3.png', 's4.png'] }, detail_images: ['d2.png', 'd1.png'] }, release_profile: { shop_name: '测试店' }, review_evidence: { destination_assets: 'OLD TEST EVIDENCE' }, automation_mapping: { version: 'OLD' }, result: { state: 'not_started' } };
  const save = async (value = pkg, file = 'one.json') => writeFile(path.join(source, file), JSON.stringify(value));
  await save();
  return { source, output, pkg, save, run: files => generateReviewPackages({ source, output, files: files || ['one.json'] }) };
}
test('legacy assets migrate in exact order; source stays unchanged; review is never promoted', async () => {
  const f = await fixture(), before = await readFile(path.join(f.source, 'one.json'));
  const report = await f.run();
  const pkg = JSON.parse(await readFile(path.join(f.output, 'one.json'), 'utf8'));
  assert.equal(pkg.package_version, 2);
  assert.equal(pkg.status, 'NEEDS_REVIEW');
  assert.deepEqual(pkg.listing.title_versions, ['测试国咨询', '']);
  assert.equal(pkg.listing.selected_title_index, null);
  assert.deepEqual(pkg.assets.secondary_images.map(file => path.basename(file)), ['s1.png', 's2.png', 's3.png', 's4.png']);
  assert.deepEqual(pkg.assets.detail_images.map(file => path.basename(file)), ['d2.png', 'd1.png']);
  assert.ok(Object.values(pkg.review_evidence).every(value => value === ''));
  assert.equal(pkg.automation_mapping.version, '');
  assert.equal(pkg.release_profile.price_cny, null);
  assert.equal(report.packages[0].review_blockers.length, 5);
  assert.equal(report.ready, 0);
  assert.match(report.packages[0].issues.join(), /两个不重复/);
  assert.deepEqual(await readFile(path.join(f.source, 'one.json')), before);
});
test('complete city structure is accepted by real workbench importer but still needs review', async () => {
  const f = await fixture();
  f.pkg.listing = { location_type: 'city', country: '测试国', city: '测试城', destination: '测试城', title_versions: ['测试城咨询', '测试城行程咨询'], selected_title_index: 1, title: '测试城行程咨询' };
  await f.save();
  const report = await f.run();
  assert.equal(report.packages[0].structure_and_files_passed, true);
  assert.equal(report.packages[0].status, 'NEEDS_REVIEW');
});
test('missing files, duplicates, and destination mismatch remain visible blockers', async () => {
  const f = await fixture();
  f.pkg.listing.country = '另一个国家';
  f.pkg.assets.secondary_images = ['missing.png', 's2.png', 's2.png', 's4.png'];
  await f.save();
  const report = await f.run(), issues = report.packages[0].issues.join();
  assert.match(issues, /一致/);
  assert.match(issues, /不重复/);
  assert.match(issues, /无法在本机读取/);
});
test('an existing output is never overwritten', async () => {
  const f = await fixture();
  await f.run();
  const before = await readFile(path.join(f.output, 'one.json'));
  await assert.rejects(f.run(), /EEXIST/);
  assert.deepEqual(await readFile(path.join(f.output, 'one.json')), before);
});
test('explicit selection rejects duplicates and path traversal before output', async () => {
  const f = await fixture();
  await assert.rejects(f.run(['../one.json']), /文件名/);
  await assert.rejects(f.run(['one.json', 'one.json']), /重复选择/);
  await assert.rejects(f.run([]), /必须指定/);
  await assert.rejects(readFile(path.join(f.output, 'one.json')), /ENOENT/);
});
test('same-shop destination duplicates reject entire batch before writing', async () => {
  const f = await fixture();
  await f.save(f.pkg, 'two.json');
  await assert.rejects(f.run(['one.json', 'two.json']), /目的地重复/);
  await assert.rejects(readFile(path.join(f.output, 'one.json')), /ENOENT/);
});
test('published and SKU sources cannot become new pending listings', async () => {
  const f = await fixture();
  f.pkg.result.item_id = 'TEST-ONLY';
  await f.save();
  await assert.rejects(f.run(), /发布结果/);
  f.pkg.result = { state: 'not_started' };
  f.pkg.listing.skus = ['TEST-ONLY'];
  await f.save();
  await assert.rejects(f.run(), /SKU/);
});
