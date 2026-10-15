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

for(const mode of ['canonical-home','plain-home','login','challenge'])test('restored '+mode+' is the single entry, without opening or navigating another tab',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ly-single-entry-')),shop={id:'single-entry',name:'测试店',port:19996,profileDir:join(root,'profile')};
  const entry=page({login:mode==='login',challenge:mode==='challenge'}),url=mode==='canonical-home'?SELLER_HOME:mode==='login'?'https://loginmyseller.taobao.com/':'https://myseller.taobao.com/home.htm';
  entry.url=()=>url;let created=0,navigated=0,focused=0;
  entry.goto=async()=>{navigated++;};entry.bringToFront=async()=>{focused++;};
  const task=page({name:mode==='login'?'':'测试店'});task.url=()=> 'https://item.upload.taobao.com/sell/v2/publish.htm';task.goto=async()=>{throw Error('TASK_TAB_MUST_BE_PRESERVED');};
  const c=new EventEmitter();c.pages=()=>[task,entry];c.newPage=async()=>{created++;return page();};c.close=async()=>c.emit('close');
  const manager=new BrowserEnvironment({profilePath:()=>shop.profileDir,checkpointRoot:join(root,'checkpoints'),portAvailable:async()=>{},launch:async()=>c});
  try{
    const result=await manager.start(shop,'test-chrome');await manager.start(shop,'test-chrome');
    assert.equal(created,0);assert.equal(navigated,0);assert.equal(focused,1);assert.equal(c.pages().length,2);
    assert.equal(result.loginState,mode==='challenge'?'PAUSED_CAPTCHA':mode==='login'?'LOGIN_REQUIRED':'LOGGED_IN');
  }finally{await manager.closeAll();}
});

for(const url of ['about:blank','chrome://newtab/','chrome://new-tab-page/'])test('fresh '+url+' is reused as the only seller entry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ly-fresh-entry-')),shop={id:'fresh-entry',name:'测试店',port:19996,profileDir:join(root,'profile')};
  const entry=page();let current=url,navigated=0,created=0;entry.url=()=>current;entry.goto=async target=>{current=target;navigated++;};
  const c=new EventEmitter();c.pages=()=>[entry];c.newPage=async()=>{created++;return page();};c.close=async()=>c.emit('close');
  const manager=new BrowserEnvironment({profilePath:()=>shop.profileDir,checkpointRoot:join(root,'checkpoints'),portAvailable:async()=>{},launch:async()=>c});
  try{await manager.start(shop,'test-chrome');assert.equal(created,0);assert.equal(navigated,1);assert.equal(current,SELLER_HOME);}finally{await manager.closeAll();}
});

for(const mode of ['same-shop','wrong-shop','challenge','loading','pinned','unknown-protection'])test('historical duplicate home: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'ly-duplicate-entry-')),shop={id:'duplicate-entry',name:'测试店',port:19996,profileDir:join(root,'profile')};
  const primary=page(),duplicate=page({name:mode==='wrong-shop'?'其他店':mode==='loading'?'':'测试店',challenge:mode==='challenge'}),task=page();
  primary.url=()=>SELLER_HOME;task.url=()=> 'https://item.upload.taobao.com/sell/v2/publish.htm';
  let closed=0,created=0,all=[primary,duplicate,task];duplicate.close=async()=>{closed++;all=all.filter(p=>p!==duplicate);};
  task.close=async()=>{throw Error('TASK_TAB_MUST_BE_PRESERVED');};task.goto=task.close;
  const c=new EventEmitter();c.pages=()=>all;c.newPage=async()=>{created++;return page();};c.close=async()=>c.emit('close');
  const manager=new BrowserEnvironment({profilePath:()=>shop.profileDir,checkpointRoot:join(root,'checkpoints'),portAvailable:async()=>{},launch:async()=>c,readProtection:async()=>({status:mode==='pinned'?'pinned':mode==='unknown-protection'?'unknown':'unpinned'})});
  try{const result=await manager.start(shop,'test-chrome');assert.equal(closed,mode==='same-shop'?1:0);assert.equal(created,0);assert(all.includes(task));if(mode==='wrong-shop')assert.equal(result.loginState,'WRONG_SHOP');if(mode==='challenge')assert.equal(result.loginState,'PAUSED_CAPTCHA');}finally{await manager.closeAll();}
});

for(const mode of ['list-only','home-and-list','challenge-home'])test('seller list remains the main entry: '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'ly-list-entry-')),shop={id:'list-entry',name:'测试店',port:19996,profileDir:join(root,'profile')};
  const list=page(),home=page({challenge:mode==='challenge-home'});list.url=()=> 'https://myseller.taobao.com/home.htm/SellManage/on_sale';home.url=()=>SELLER_HOME;
  let all=mode==='list-only'?[list]:[home,list],created=0,homeClosed=0,focused=0;
  list.goto=async()=>{throw Error('EXISTING_LIST_MUST_BE_PRESERVED');};list.close=list.goto;list.bringToFront=async()=>{focused++;};
  home.close=async()=>{homeClosed++;all=all.filter(p=>p!==home);};
  const c=new EventEmitter();c.pages=()=>all;c.newPage=async()=>{created++;return page();};c.close=async()=>c.emit('close');
  const manager=new BrowserEnvironment({profilePath:()=>shop.profileDir,checkpointRoot:join(root,'checkpoints'),portAvailable:async()=>{},launch:async()=>c,readProtection:async()=>({status:'unpinned'})});
  try{const result=await manager.start(shop,'test-chrome');assert.equal(created,0);assert.equal(focused,1);assert.equal(homeClosed,mode==='home-and-list'?1:0);assert(all.includes(list));if(mode==='challenge-home')assert.equal(result.loginState,'PAUSED_CAPTCHA');else assert.equal(all.length,1);}finally{await manager.closeAll();}
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
