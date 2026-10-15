import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserEnvironment, ownedPersistentLaunchOptions, launchOwnedPersistentContext, inspectLogin } from '../browser-environment.mjs';

const profile = resolve('output/test-only-profile');
const options = () => ({ executablePath: resolve('test-chrome.exe'), headless: false, viewport: null,
  args: ['--remote-debugging-port=19991', '--remote-debugging-address=127.0.0.1', '--restore-last-session', '--enable-automation'] });
const runtime = overrides => ({ playwrightVersion: '1.62.1', coreVersion: '1.62.1', platform: 'win32', env: {}, ...overrides });

test('pinned public launch preserves defaults and ownership without a second startup tab', () => {
  const input = options(), before = structuredClone(input), actual = ownedPersistentLaunchOptions(profile, input, runtime());
  assert.deepEqual(input, before);
  assert.equal(actual.ignoreDefaultArgs, true);
  assert.equal(actual.timeout, 180000);
  assert.equal(actual.args.length, 44);
  const normalized = actual.args.map(a => a === `--user-data-dir=${profile}` ? '--user-data-dir={{PROFILE}}' : a === '--remote-debugging-port=19991' ? '--remote-debugging-port={{PORT}}' : a);
  assert.equal(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'), '4843a0ca92ffed6503916f2fb3b4c5f6f1ad990aa5edd6657e7f5f6c63a8806e');
  assert.deepEqual(actual.args.slice(-6), [...input.args, `--user-data-dir=${profile}`, '--remote-debugging-pipe']);
  assert(!actual.args.includes('about:blank'));
  assert.equal(actual.args.filter(a => a.startsWith('--user-data-dir=')).length, 1);
  assert.equal(actual.args.filter(a => a === '--remote-debugging-pipe').length, 1);
  assert.equal(actual.storageState, undefined);
  assert.equal(new BrowserEnvironment().launch, launchOwnedPersistentContext);
});

test('unknown installed version/platform or argv-changing environment is rejected before launch', () => {
  for (const bad of [{ playwrightVersion: '1.62.2' }, { coreVersion: '1.62.0' }, { playwrightVersion: '' }, { platform: 'linux' }])
    assert.throws(() => ownedPersistentLaunchOptions(profile, options(), runtime(bad)), /UNSUPPORTED_RUNTIME/);
  for (const key of ['PLAYWRIGHT_LEGACY_SCREENSHOT', 'PWDEBUG', 'npm_config_pwdebug', 'npm_package_config_pwdebug', 'SELENIUM_REMOTE_URL', 'PW_CHROMIUM_ATTACH_TO_OTHER'])
    assert.throws(() => ownedPersistentLaunchOptions(profile, options(), runtime({ env: { [key]: '1' } })), /UNSUPPORTED_ENV/);
});

test('unsupported launch/context options cannot silently change defaults or safety', () => {
  for (const extra of [{ headless: true }, { viewport: { width: 100, height: 100 } }, { chromiumSandbox: true }, { proxy: { server: 'http://proxy.invalid' } }, { channel: 'chrome' }, { args: [...options().args, '--disable-web-security'] }, { ignoreDefaultArgs: true }, { storageState: {} }, { ignoreHTTPSErrors: true }, { env: {} }, { executablePath: 'relative-chrome' }])
    assert.throws(() => ownedPersistentLaunchOptions(profile, { ...options(), ...extra }, runtime()), /UNSUPPORTED/);
  for (const path of ['', 'relative-profile', profile + '\nother'])
    assert.throws(() => ownedPersistentLaunchOptions(path, options(), runtime()), /PROFILE_REQUIRED/);
  for (const first of ['--remote-debugging-port=0', '--remote-debugging-port=65536', '--remote-debugging-port=019991'])
    assert.throws(() => ownedPersistentLaunchOptions(profile, { ...options(), args: [first, ...options().args.slice(1)] }, runtime()), /INVALID_PORT/);
  for (const args of [[], ['--remote-debugging-pipe'], ['--remote-debugging-port=19991', '--remote-debugging-address=0.0.0.0', '--restore-last-session', '--enable-automation']])
    assert.throws(() => ownedPersistentLaunchOptions(profile, { ...options(), args }, runtime()), /UNSUPPORTED_ARGS/);
  for (const timeout of [0, -1, Infinity, '1000']) assert.throws(() => ownedPersistentLaunchOptions(profile, { ...options(), timeout }, runtime()), /INVALID_TIMEOUT/);
  assert.equal(ownedPersistentLaunchOptions(profile, { ...options(), timeout: 1234 }, runtime()).timeout, 1234);
});

function fixturePage({ name = '测试店', login = false, challenge = false } = {}) {
  const p = { isClosed: () => false, url: () => login ? 'https://loginmyseller.taobao.com/' : 'https://myseller.taobao.com/home.htm',
    locator: selector => ({ count: async () => selector.includes('shopName') && !login ? 1 : 0, isVisible: async () => selector.includes('shopName') && !login,
      innerText: async () => selector.includes('shopName') ? name : challenge ? '请拖动滑块' : '', first() { return { isVisible: async () => false }; } }), frames() { return [p]; } };
  return p;
}
test('unloaded/unknown identity, login, wrong shop and challenge continue to block', async () => {
  const shop = { name: '测试店' };
  for (const [config, state] of [[{ name: '' }, 'LOGIN_UNVERIFIED'], [{ login: true }, 'LOGIN_REQUIRED'], [{ name: '另一店' }, 'WRONG_SHOP'], [{ challenge: true }, 'PAUSED_CAPTCHA']]) {
    const result = await inspectLogin([fixturePage(config)], shop);
    assert.equal(result.loggedIn, false); assert.equal(result.loginState, state);
  }
  assert.equal((await inspectLogin([fixturePage(), fixturePage({ challenge: true })], shop)).loginState, 'PAUSED_CAPTCHA');
});

test('failed native launch never registers a session or an alternate owner', async () => {
  let calls = 0;
  const manager = new BrowserEnvironment({ launch: async () => { calls++; throw Error('controlled native startup timeout'); }, profilePath: () => profile, portAvailable: async () => {} });
  const shop = { id: 'fixture', name: '测试店', profileDir: profile, port: 19991 };
  const result = await Promise.allSettled([manager.start(shop, options().executablePath), manager.start(shop, options().executablePath)]);
  assert.equal(calls, 1); assert(result.every(x => x.status === 'rejected'));
  assert.equal(manager.pending.size, 0); assert.equal(manager.sessions.size, 0);
  assert.throws(() => manager.browser(shop), /未运行/);
  await manager.closeAll();
});
