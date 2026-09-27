import { chromium } from 'playwright';
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SELLER_HOME = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';
export function projectProfile(shopId) {
  if (!/^[a-z0-9-]+$/.test(shopId)) throw new Error('INVALID_SHOP_ID');
  return resolve(PROJECT_ROOT, 'browser-profile', shopId);
}
const sellerHosts = new Set(['myseller.taobao.com', 'seller.taobao.com', 'item.upload.taobao.com', 'upload.taobao.com', 'qn.taobao.com', 'myseller.tmall.com', 'seller.tmall.com']);
export async function visibleChallenge(page) {
  for (const frame of page.frames()) {
    if (/\/punish|action=captcha|_____tmd_____/.test(frame.url())) return true;
    const overlay = frame.locator('.J_MIDDLEWARE_FRAME_WIDGET iframe, iframe[src*="/punish"], iframe[src*="action=captcha"]');
    if (await overlay.first().isVisible().catch(() => false)) return true;
    const text = await frame.locator('body').innerText({ timeout: 1200 }).catch(() => '');
    if (/验证码|验证失败|安全验证|请拖动滑块|人机验证|异常访问|滑动验证|拖动.*滑块|Please drag the slider|Please slide to verify|Verify to ensure normal access/i.test(text)) return true;
  }
  return false;
}
export async function inspectLogin(pages, shop) {
  let loggedIn = false, hasLogin = false, wrongShop = false;
  for (const page of pages) {
    if (page.isClosed()) continue;
    let u; try { u = new URL(page.url()); } catch { continue; }
    if (!/(^|\.)(taobao|tmall)\.com$/.test(u.hostname)) continue;
    if (await visibleChallenge(page)) return { loginState: 'PAUSED_CAPTCHA', loggedIn: false, reason: '出现验证码或滑块，任务已暂停；请在专用 Chrome 人工处理后恢复。' };
    if (/login|passport|signin/.test(u.hostname + u.pathname)) { hasLogin = true; continue; }
    if (!sellerHosts.has(u.hostname)) continue;
    const identity = page.locator('div.shopName--x6nyUylx');
    if (await identity.count() === 1 && await identity.isVisible()) {
      const name = (await identity.innerText()).trim();
      if (name === shop.name) loggedIn = true; else wrongShop = true;
    }
  }
  if (wrongShop) return { loginState: 'WRONG_SHOP', loggedIn: false, reason: '当前店铺与任务店铺不一致，已暂停。' };
  if (loggedIn) return { loginState: 'LOGGED_IN', loggedIn: true, reason: '已检测到目标店铺登录状态；所有任务复用此专用浏览器。' };
  return { loginState: hasLogin ? 'LOGIN_REQUIRED' : 'LOGIN_UNVERIFIED', loggedIn: false, reason: '请在专用 Chrome 人工登录目标店铺，并进入商家后台；登录状态由 Chrome 持久化保存。' };
}

// This owner lives with the workbench, never with a product task. No storageState,
// cookies or credentials are read/exported; Chrome manages its own profile.
export class BrowserEnvironment {
  constructor({ launch = (...args) => chromium.launchPersistentContext(...args), portAvailable, checkpointRoot = resolve(PROJECT_ROOT, 'workbench/.runtime/browser-checkpoints'), profilePath = projectProfile } = {}) {
    this.launch = launch; this.portAvailable = portAvailable; this.checkpointRoot = checkpointRoot;
    this.sessions = new Map(); this.pending = new Map(); this.closing = false;
    this.profilePath = profilePath;
  }
  async start(shop, executablePath) {
    if (this.closing) throw new Error('BROWSER_OWNER_SHUTTING_DOWN');
    if (this.sessions.has(shop.id)) return this.status(shop);
    if (this.pending.has(shop.id)) return this.pending.get(shop.id);
    const opening = this.open(shop, executablePath);
    this.pending.set(shop.id, opening);
    try { return await opening; } finally { this.pending.delete(shop.id); }
  }
  async open(shop, executablePath) {
    const profileDir = this.profilePath(shop.id);
    if (resolve(shop.profileDir) !== profileDir) throw new Error('PROJECT_PROFILE_REQUIRED');
    await this.portAvailable(shop.port);
    // Refuse a profile redirected to another browser directory by a junction.
    for (const path of [resolve(profileDir, '..'), profileDir]) {
      await mkdir(path, { recursive: true });
      if ((await lstat(path)).isSymbolicLink()) throw new Error('PROFILE_LINK_FORBIDDEN');
    }
    const context = await this.launch(profileDir, { executablePath, headless: false, viewport: null,
      args: [`--remote-debugging-port=${shop.port}`, '--remote-debugging-address=127.0.0.1', '--restore-last-session', '--enable-automation'] });
    const session = { context, profileDir, generation: Date.now(), last: null, checking: null, timer: null };
    this.sessions.set(shop.id, session);
    context.on('close', () => { clearInterval(session.timer); if (this.sessions.get(shop.id) === session) this.sessions.delete(shop.id); });
    const check = () => this.status(shop).catch(() => {});
    session.timer = setInterval(check, 5000); session.timer.unref();
    // Preserve any restored publishing tab. A separate seller home provides a
    // fresh login check and leaves task recovery to its checkpoint verifier.
    const pages = context.pages();
    const page = pages.find(p => p.url().startsWith(SELLER_HOME)) || pages.find(p => p.url() === 'about:blank') || await context.newPage();
    await page.goto(SELLER_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.bringToFront();
    return this.status(shop);
  }
  async status(shop) {
    const s = this.sessions.get(shop.id);
    if (!s) return { running: false, persistent: true, loggedIn: false, loginState: 'STOPPED', profileDir: this.profilePath(shop.id) };
    if (s.checking) return s.checking;
    s.checking = (async () => {
      let state;
      try { state = await inspectLogin(s.context.pages(), shop); }
      catch { state = { loginState: 'LOGIN_UNVERIFIED', loggedIn: false, reason: '页面暂时无法核验，自动化保持暂停。' }; }
      const result = { running: true, persistent: true, profileDir: s.profileDir, generation: s.generation, checkedAt: new Date().toISOString(), ...state };
      if (s.last?.loginState !== result.loginState) {
        await mkdir(this.checkpointRoot, { recursive: true });
        const record = { shopId: shop.id, at: result.checkedAt, state: result.loginState, taskMayResume: result.loggedIn, resumeRequiresRevalidation: true };
        if (!result.loggedIn) {
          const pages = s.context.pages();
          const page = pages.find(p => /taobao|tmall/.test(p.url()));
          if (page) { const path = join(this.checkpointRoot, `${shop.id}-paused.png`); await page.screenshot({ path }).catch(() => {}); record.screenshot = path; }
        }
        await writeFile(join(this.checkpointRoot, `${shop.id}.json`), JSON.stringify(record, null, 2));
      }
      s.last = result; return result;
    })();
    try { return await s.checking; } finally { s.checking = null; }
  }
  browser(shop) {
    const browser=this.sessions.get(shop.id)?.context.browser();
    if(!browser?.isConnected())throw Error('专用浏览器未运行，请启动项目浏览器');
    // Legacy status/identity checks share the native owner. A second CDP
    // Playwright connection can race to dismiss the same JavaScript dialog.
    return browser;
  }
  async close(shop) {
    const s = this.sessions.get(shop.id); if (!s) return;
    clearInterval(s.timer); if (s.checking) await s.checking.catch(() => {});
    await s.context.close(); this.sessions.delete(shop.id);
  }
  async focus(shop) {
    const s=this.sessions.get(shop.id);if(!s)return;
    const pages=s.context.pages().filter(p=>!p.isClosed() && /^https:\/\/[^/]*\.(taobao|tmall)\.com\//.test(p.url()));
    let target=pages.find(p=>/login|passport/.test(new URL(p.url()).hostname));
    if(!target)for(const p of pages){if(await visibleChallenge(p)){target=p;break;}}
    target ||= pages.find(p=>p.url().startsWith(SELLER_HOME));
    if(target)await target.bringToFront();
  }
  async closeAll() { this.closing = true; await Promise.allSettled([...this.pending.values()]); for (const s of [...this.sessions.values()]) { clearInterval(s.timer); await s.context.close(); } this.sessions.clear(); }
}
