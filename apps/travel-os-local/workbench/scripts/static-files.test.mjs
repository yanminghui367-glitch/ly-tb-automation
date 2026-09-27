import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createStaticHandler } from '../static-files.mjs';

const publicFiles = ['travel-os.html','travel-os.js','travel-os.css','travel-globe-ui.css','index.html', 'travel-home.html', 'travel-home.js', 'travel-home.css', 'legacy.html', 'product.js', 'product.css', 'app.js', 'source-workflow.js', 'source-workflow.css', 'batch-workflow.js', 'batch-workflow.css', 'styles.css', 'console.css', 'premium.css', 'ui-polish.css', 'favicon.svg', 'product-package-template.json'];
// Only synthetic files; no production runtime, profiles, browser or API calls.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH0sAAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'ly-static-'));
  const root = join(temp, 'workbench');
  await mkdir(root);
  t.after(async () => {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
    assert.ok(basename(temp).startsWith('ly-static-'));
    await rm(temp, { recursive: true, force: true });
  });
  for (const file of publicFiles) await writeFile(join(root, file), `synthetic ${file}`);
  for (const dir of ['.runtime/chrome-profile', 'scripts', 'node_modules', 'output/tasks/task-fixture', 'output/mapping-evidence', 'output/playwright']) await mkdir(join(root, dir), { recursive: true });
  for (const file of ['server.mjs', 'static-files.mjs', 'package.json', 'README.md', '.runtime/jobs.json', '.runtime/chrome-profile/test-only.txt', 'scripts/private.mjs', 'node_modules/test-only.txt', 'output/tasks/task-fixture/private.json', 'output/playwright/old.png']) await writeFile(join(root, file), 'synthetic private data');
  await writeFile(join(root, 'output/tasks/task-fixture/001-ready-for-review.png'), png);
  await writeFile(join(root, 'output/tasks/task-fixture/002-field-价格.png'), png);
  await writeFile(join(root, 'output/mapping-evidence/seller-page-fixture.png'), png);
  const handler = createStaticHandler(root);
  const server = createServer((req, res) => handler(req, res).catch(() => { res.writeHead(500); res.end('synthetic fixture error'); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function get(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.address().port, path, method, agent: false }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
  }
  return { root, temp, get };
}

test('homepage, every declared public asset and template stay readable; HEAD and query strings work', async t => {
  const { get } = await fixture(t);
  for (const file of ['', ...publicFiles]) {
    const res = await get(`/${file}?v=fixture`);
    assert.equal(res.status, 200, file);
    assert.equal(res.body.toString(), `synthetic ${file || 'travel-home.html'}`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  const head = await get('/app.js', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.match(head.headers['content-type'], /javascript/);
});

test('runtime, browser profile, server code, test code, dependencies and arbitrary outputs return 404', async t => {
  const { get } = await fixture(t);
  for (const path of ['/server.mjs', '/static-files.mjs', '/package.json', '/README.md', '/.runtime/jobs.json', '/.runtime/chrome-profile/test-only.txt', '/scripts/private.mjs', '/node_modules/test-only.txt', '/output/tasks/task-fixture/private.json', '/output/playwright/old.png', '/output/tasks', '/output/mapping-evidence/']) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.toString().includes('synthetic private data'), path);
  }
});

test('task and mapping PNG screenshots retain exact bytes and image MIME, including Unicode field names', async t => {
  const { get } = await fixture(t);
  for (const path of ['/output/tasks/task-fixture/001-ready-for-review.png', '/output/tasks/task-fixture/002-field-价格.png', '/output/mapping-evidence/seller-page-fixture.png']) {
    const res = await get(encodeURI(path));
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(res.body, png);
  }
});

test('raw and encoded traversal, Windows separators/streams, malformed escapes and repeated encodings are rejected', async t => {
  const { get } = await fixture(t);
  for (const path of ['/output/tasks/../../index.html', '/%2e/index.html', '/%2e%2e/index.html', '//index.html', '/output%2ftasks/task-fixture/001-ready-for-review.png', '/output%5ctasks/task-fixture/001-ready-for-review.png', '/output\\tasks\\task-fixture\\001-ready-for-review.png', '/%252e%252e/index.html', '/app.js::$DATA', '/app.js.', '/app.js%20', '/app.js%00', '/%zz', '/%c0%af', '/.runtime/../index.html']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('static methods cannot POST, PUT, PATCH or DELETE files', async t => {
  const { get } = await fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await get('/index.html', method);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.allow, 'GET, HEAD');
  }
});

test('missing assets, directories disguised as assets and removed screenshot files return bounded 404', async t => {
  const { root, get } = await fixture(t);
  await unlink(join(root, 'app.js'));
  await mkdir(join(root, 'app.js'));
  assert.equal((await get('/app.js')).status, 404);
  assert.equal((await get('/output/tasks/task-fixture/missing.png')).status, 404);
  await unlink(join(root, 'output/mapping-evidence/seller-page-fixture.png'));
  assert.equal((await get('/output/mapping-evidence/seller-page-fixture.png')).status, 404);
});

test('a file symlink cannot expose a synthetic runtime file through an allowed public name', async t => {
  const { root, get } = await fixture(t);
  await unlink(join(root, 'app.js'));
  await symlink(join(root, '.runtime/jobs.json'), join(root, 'app.js'), 'file');
  assert.equal((await get('/app.js')).status, 404);
});

test('screenshot junctions to runtime or sibling-prefix directories are rejected', async t => {
  const { root, temp, get } = await fixture(t);
  const sibling = join(temp, 'workbench-shadow');
  await mkdir(sibling);
  await writeFile(join(sibling, 'leak.png'), png);
  await writeFile(join(root, '.runtime/leak.png'), png);
  for (const [name, target] of [['runtime-link', join(root, '.runtime')], ['sibling-link', sibling]]) {
    await symlink(target, join(root, 'output/tasks', name), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await get(`/output/tasks/${name}/leak.png`)).status, 404, name);
  }
});

test('the public allowlist covers every local resource referenced by the actual page', async t => {
  const { get } = await fixture(t);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:[?#][^"]*)?"/g)) {
    assert.equal((await get(`/${match[1]}`)).status, 200, match[1]);
  }
});

test('links at the output root or screenshot leaf cannot bypass the policy', async t => {
  const { root, get } = await fixture(t);
  const leaf = join(root, 'output/mapping-evidence/seller-page-fixture.png');
  await unlink(leaf);
  await symlink(join(root, '.runtime/jobs.json'), leaf, 'file');
  assert.equal((await get('/output/mapping-evidence/seller-page-fixture.png')).status, 404);
  await rename(join(root, 'output'), join(root, 'output-original'));
  await symlink(join(root, 'output-original'), join(root, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await get('/output/tasks/task-fixture/001-ready-for-review.png')).status, 404);
});

test('the actual workbench server routes static requests through the restrictive handler', async t => {
  process.env.WORKBENCH_NO_LISTEN = '1';
  const { workbenchServer } = await import('../server.mjs');
  await new Promise(resolve => workbenchServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { workbenchServer.close(resolve); workbenchServer.closeAllConnections(); }));
  const base = `http://127.0.0.1:${workbenchServer.address().port}`;
  for (const path of ['/', '/app.js', '/product-package-template.json', '/server.mjs', '/static-files.mjs']) {
    const res = await fetch(base + path);
    await res.arrayBuffer();
    assert.equal(res.status, path.endsWith('.mjs') ? 404 : 200, path);
  }
  // No /api requests: this test never loads runtime state or connects a browser.
});
