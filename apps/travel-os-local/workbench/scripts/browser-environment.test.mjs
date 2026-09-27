import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserEnvironment, inspectLogin, projectProfile, SELLER_HOME } from '../browser-environment.mjs';

function page({ name = '测试店', login = false, challenge = false, english = false } = {}) {
  const p = { isClosed: () => false, url: () => login ? 'https://loginmyseller.taobao.com/' : 'https://myseller.taobao.com/home.htm', goto: async () => {}, bringToFront: async () => {}, screenshot: async () => {},
    locator: selector => ({ count: async () => selector.includes('shopName') && !login ? 1 : 0, isVisible: async () => selector.includes('shopName') && !login, innerText: async () => selector.includes('shopName') ? name : english ? 'Please slide to verify' : '', first() { return { isVisible: async () => challenge }; } }), frames() { return [p]; } };
  return p;
}
test('login requires visible exact shop, not URL or an old success flag', async () => {
  const shop = { name: '测试店' };
  assert.equal((await inspectLogin([page()], shop)).loginState, 'LOGGED_IN');
  assert.equal((await inspectLogin([page({ login: true })], shop)).loginState, 'LOGIN_REQUIRED');
  assert.equal((await inspectLogin([page({ name: '另一店' })], shop)).loginState, 'WRONG_SHOP');
});
test('CAPTCHA overlay and English slider take priority over a logged-in tab', async () => {
  for (const bad of [page({ challenge: true }), page({ english: true })]) assert.equal((await inspectLogin([page(), bad], { name: '测试店' })).loginState, 'PAUSED_CAPTCHA');
});
test('shop identifier cannot escape dedicated project directory', () => {
  for (const id of ['../Default', 'C:\\Chrome', '', 'a/b']) assert.throws(() => projectProfile(id));
});

test('login button focuses the owned login page and ignores workbench CAPTCHA instructions', async () => {
  const manager=new BrowserEnvironment();let focused='';
  const local=page({challenge:true});local.url=()=> 'http://127.0.0.1:4318/';local.bringToFront=async()=>{focused='local';};
  const login=page({login:true});login.bringToFront=async()=>{focused='login';};
  manager.sessions.set('test',{context:{pages:()=>[local,login]}});await manager.focus({id:'test'});assert.equal(focused,'login');
  const home=page();home.url=()=>SELLER_HOME;home.bringToFront=async()=>{focused='home';};
  manager.sessions.set('test',{context:{pages:()=>[local,home]}});await manager.focus({id:'test'});assert.equal(focused,'home');
});
test('concurrent starts and multiple tasks reuse one context; close and reopen retain same path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ly-browser-test-'));
  const shop = { id: 'test-shop', name: '测试店', port: 19998, profileDir: join(root, 'profile/test-shop') };
  let launches = 0, closed = 0;
  const manager = new BrowserEnvironment({ profilePath: () => shop.profileDir, checkpointRoot: join(root, 'checkpoints'), portAvailable: async () => {}, launch: async (path, options) => {
    launches++; assert.equal(path, shop.profileDir); assert.equal(options.headless, false); assert(options.args.includes('--restore-last-session'));
    assert.equal(options.storageState, undefined); assert.equal(options.ignoreDefaultArgs, undefined);
    const c = new EventEmitter(); c.pages = () => [page()]; c.newPage = async () => page(); c.close = async () => { closed++; c.emit('close'); }; return c;
  } });
  await Promise.all([manager.start(shop, 'test-chrome'), manager.start(shop, 'test-chrome')]);
  assert.equal(launches, 1); assert.equal((await manager.status(shop)).loggedIn, true);
  await manager.start(shop); assert.equal(launches, 1); assert.equal(closed, 0);
  await manager.close(shop); assert.equal((await manager.status(shop)).running, false);
  await manager.start(shop); assert.equal(launches, 2);
  await manager.closeAll(); assert.equal(closed, 2);
  await assert.rejects(manager.start(shop), /SHUTTING_DOWN/);
});
test('foreign profile/occupied port never starts or takes over Chrome', async () => {
  let launches = 0;
  const m = new BrowserEnvironment({ launch: async () => { launches++; }, portAvailable: async () => { throw Error('PORT_IN_USE'); } });
  await assert.rejects(m.start({ id: 'test', profileDir: 'C:/daily-chrome', port: 19999 }), /PROJECT_PROFILE/);
  await assert.rejects(m.start({ id: 'test', profileDir: projectProfile('test'), port: 19999 }), /PORT_IN_USE/);
  assert.equal(launches, 0);
});

test('legacy session checks reuse the owned browser and cannot attach an external browser',()=>{
  const manager=new BrowserEnvironment(),shop={id:'test'},browser={isConnected:()=>true};
  assert.throws(()=>manager.browser(shop),/未运行/);
  manager.sessions.set(shop.id,{context:{browser:()=>browser}});
  assert.equal(manager.browser(shop),browser);
  browser.isConnected=()=>false;assert.throws(()=>manager.browser(shop),/未运行/);
});
test('paused status persists checkpoint without credentials and resumes only after fresh verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ly-pause-test-'));
  const shop = { id: 'test', name: '测试店', port: 19997, profileDir: join(root, 'profiles/test') }; let current = page({ challenge: true });
  const manager = new BrowserEnvironment({ profilePath: () => shop.profileDir, checkpointRoot: root, portAvailable: async () => {}, launch: async () => { const c = new EventEmitter(); c.pages = () => [current]; c.newPage = async () => current; c.close = async () => c.emit('close'); return c; } });
  await manager.start(shop); const cp = JSON.parse(await readFile(join(root, 'test.json'), 'utf8'));
  assert.equal(cp.state, 'PAUSED_CAPTCHA'); assert.equal(cp.taskMayResume, false);
  assert.equal('cookies' in cp, false); current = page(); assert.equal((await manager.status(shop)).loggedIn, true); await manager.closeAll();
});
