import { chromium } from 'playwright';
import { mkdir, writeFile, appendFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import {readPageProtection} from './page-protection.mjs';

const require = createRequire(import.meta.url);
const ownedLaunchRuntime = () => ({
  playwrightVersion: require('playwright/package.json').version,
  coreVersion: require('playwright-core/package.json').version,
  platform: process.platform, env: process.env
});
// Exact Windows/headful/no-proxy Playwright 1.62.1 argv, observed with a new
// empty profile and checked against that installed version. The owner packet
// retains these defaults but does not request an extra blank startup tab:
// --restore-last-session already restores the previous seller page.
// Retaining the defaults while using the PUBLIC ignoreDefaultArgs:true avoids
// only Playwright's extra wait for the first restored page's complete load.
// Native persistent-context/page initialization, ownership and cleanup remain.
const ownedChromiumDefaults = Object.freeze([
  '--disable-field-trial-config',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-back-forward-cache',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--no-default-browser-check',
  '--disable-default-apps',
  '--disable-dev-shm-usage',
  '--disable-edgeupdater',
  '--disable-extensions',
  '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion',
  '--enable-features=CDPScreenshotNewSurface',
  '--allow-pre-commit-input',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-updater-scheduler',
  '--force-color-profile=srgb',
  '--metrics-recording-only',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  '--no-service-autorun',
  '--export-tagged-pdf',
  '--disable-search-engine-choice-screen',
  '--unsafely-disable-devtools-self-xss-warnings',
  '--edge-skip-compat-layer-relaunch',
  '--disable-infobars',
  '--disable-search-engine-choice-screen',
  '--disable-sync',
  '--enable-unsafe-swiftshader',
  '--no-sandbox'
]);

export function ownedPersistentLaunchOptions(profileDir, options, runtime = ownedLaunchRuntime()) {
  if (runtime.playwrightVersion !== '1.62.1' || runtime.coreVersion !== '1.62.1' || runtime.platform !== 'win32') throw Error('OWNED_BROWSER_UNSUPPORTED_RUNTIME');
  // These environment switches alter default argv, timeout or connection mode.
  if (['PLAYWRIGHT_LEGACY_SCREENSHOT', 'PWDEBUG', 'npm_config_pwdebug', 'npm_package_config_pwdebug', 'SELENIUM_REMOTE_URL', 'PW_CHROMIUM_ATTACH_TO_OTHER'].some(k => runtime.env?.[k])) throw Error('OWNED_BROWSER_UNSUPPORTED_ENV');
  if (!options || Object.keys(options).some(k => !['executablePath', 'headless', 'viewport', 'args', 'timeout'].includes(k))) throw Error('OWNED_BROWSER_UNSUPPORTED_OPTIONS');
  if (options.headless !== false || options.viewport !== null || typeof options.executablePath !== 'string' || !isAbsolute(options.executablePath)) throw Error('OWNED_BROWSER_UNSUPPORTED_OPTIONS');
  if (typeof profileDir !== 'string' || !isAbsolute(profileDir) || /[\r\n\0]/.test(profileDir)) throw Error('OWNED_BROWSER_PROFILE_REQUIRED');
  const args = options.args;
  if (!Array.isArray(args) || args.length !== 4 || !/^--remote-debugging-port=\d+$/.test(args[0]) || args[1] !== '--remote-debugging-address=127.0.0.1' || args[2] !== '--restore-last-session' || args[3] !== '--enable-automation') throw Error('OWNED_BROWSER_UNSUPPORTED_ARGS');
  const port = Number(args[0].split('=')[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || args[0] !== `--remote-debugging-port=${port}`) throw Error('OWNED_BROWSER_INVALID_PORT');
  if ('timeout' in options && (!Number.isFinite(options.timeout) || options.timeout <= 0)) throw Error('OWNED_BROWSER_INVALID_TIMEOUT');
  return { ...options, timeout: options.timeout ?? 180000, ignoreDefaultArgs: true,
    args: [...ownedChromiumDefaults, ...args, `--user-data-dir=${resolve(profileDir)}`, '--remote-debugging-pipe'] };
}

export function launchOwnedPersistentContext(profileDir, options) {
  return chromium.launchPersistentContext(profileDir, ownedPersistentLaunchOptions(profileDir, options));
}

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SELLER_HOME = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';
function sellerHome(page){
  try{
    const u=new URL(page.url());if(u.protocol!=='https:'||u.username||u.password)return false;
    return u.hostname==='myseller.taobao.com'&&/^\/home\.htm(?:\/QnworkbenchHome)?\/?$/.test(u.pathname);
  }catch{return false;}
}
function sellerList(page){
  try{
    const u=new URL(page.url());return ['https://myseller.taobao.com','https://qn.taobao.com'].includes(u.origin)&&!u.username&&!u.password&&/^\/home\.htm\/SellManage\/(?:all|on_sale|sold_out|warehouse)\/?$/.test(u.pathname);
  }catch{return false;}
}
function sellerEntry(page){
  if(sellerHome(page))return true;
  try{
    const u=new URL(page.url());return u.protocol==='https:'&&!u.username&&!u.password&&['loginmyseller.taobao.com','login.taobao.com','login.tmall.com'].includes(u.hostname);
  }catch{return false;}
}
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
  const identityEvidence = [];
  for (const page of pages) {
    if (page.isClosed()) continue;
    let u; try { u = new URL(page.url()); } catch { continue; }
    if (!/(^|\.)(taobao|tmall)\.com$/.test(u.hostname)) continue;
    let phase = 'challenge';
    try {
    if (await visibleChallenge(page)) return { loginState: 'PAUSED_CAPTCHA', loggedIn: false, reason: '出现验证码或滑块，任务已暂停；请在专用 Chrome 人工处理后恢复。' };
    if (/login|passport|signin/.test(u.hostname + u.pathname)) { hasLogin = true; continue; }
    if (!sellerHosts.has(u.hostname)) continue;
    phase = 'identity';
    const identity = page.locator('div.shopName--x6nyUylx');
    if (await identity.count() === 1 && await identity.isVisible()) {
      const name = (await identity.innerText()).trim();
      // A mounted shell can still have an empty shop label while loading.
      // It supplies no identity; only an explicit different name proves a mismatch.
      identityEvidence.push({ page: u.origin + u.pathname, name: name.slice(0, 120) });
      if (name && name === shop.name) loggedIn = true; else if (name) wrongShop = true;
    }
    } catch (error) {
      // A success page may close after this scan took its page snapshot.
      // Only an actually closed page can be discarded; a live unreadable page
      // still prevents publication. Previously observed wrong-shop or challenge
      // evidence is never replaced by a cached logged-in result.
      if (page.isClosed()) continue;
      const failure = new Error('LOGIN_PAGE_INSPECTION_FAILED');
      failure.inspectionFailure = { page: u.origin + u.pathname, phase, kind: /Execution context was destroyed|Cannot find context with specified id/i.test(String(error?.message || '')) ? 'NAVIGATION_INTERRUPTED' : 'PAGE_READ_FAILED' };
      throw failure;
    }
  }
  if (wrongShop) return { loginState: 'WRONG_SHOP', loggedIn: false, reason: '当前店铺与任务店铺不一致，已暂停。', identityEvidence };
  if (loggedIn) return { loginState: 'LOGGED_IN', loggedIn: true, reason: '已检测到目标店铺登录状态；所有任务复用此专用浏览器。' };
  return { loginState: hasLogin ? 'LOGIN_REQUIRED' : 'LOGIN_UNVERIFIED', loggedIn: false, reason: '请在专用 Chrome 人工登录目标店铺，并进入商家后台；登录状态由 Chrome 持久化保存。', identityEvidence };
}

// This owner lives with the workbench, never with a product task. No storageState,
// cookies or credentials are read/exported; Chrome manages its own profile.
export class BrowserEnvironment {
  constructor({ launch = launchOwnedPersistentContext, portAvailable, checkpointRoot = resolve(PROJECT_ROOT, 'workbench/.runtime/browser-checkpoints'), profilePath = projectProfile, readProtection = readPageProtection } = {}) {
    this.launch = launch; this.portAvailable = portAvailable; this.checkpointRoot = checkpointRoot;
    this.sessions = new Map(); this.pending = new Map(); this.closing = false;
    this.profilePath = profilePath;
    this.readProtection = readProtection;
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
    // Reuse the restored home/login entry. Native restore already opened it;
    // opening another blank and navigating it caused duplicate seller pages.
    // Publishing/material/result pages remain untouched for task recovery.
    const pages = context.pages();
    const restored = pages.find(sellerList) || pages.find(sellerEntry);
    const page = restored || pages.find(p => ['about:blank','chrome://newtab/','chrome://new-tab-page/'].includes(p.url())) || await context.newPage();
    if(!restored)await page.goto(SELLER_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    // Old sessions may already contain duplicate homes. Close only another
    // exact home after BOTH pages independently prove this shop and no challenge.
    // Login, unknown identity and task/material/result pages are never closed.
    if(sellerHome(page)||sellerList(page))for(const duplicate of pages.filter(p=>p!==page&&sellerHome(p))){
      try{
        const other=await inspectLogin([duplicate],shop),primary=await inspectLogin([page],shop);
        if(other.loggedIn&&primary.loggedIn){
          const protection=await this.readProtection(duplicate);
          if(protection.status==='unpinned'&&(sellerHome(page)||sellerList(page))&&sellerHome(duplicate))await duplicate.close({runBeforeUnload:false});
        }
      }catch{ /* Preserve any unreadable page for the normal status checker. */ }
    }
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
      catch (error) { state = { loginState: 'LOGIN_UNVERIFIED', loggedIn: false, reason: '页面暂时无法核验，自动化保持暂停。', inspectionFailure: error?.inspectionFailure || { phase: 'scan', kind: 'PAGE_READ_FAILED' } }; }
      const result = { running: true, persistent: true, profileDir: s.profileDir, generation: s.generation, checkedAt: new Date().toISOString(), ...state };
      if (s.last?.loginState !== result.loginState) {
        await mkdir(this.checkpointRoot, { recursive: true });
        const record = { shopId: shop.id, at: result.checkedAt, state: result.loginState, taskMayResume: result.loggedIn, resumeRequiresRevalidation: true };
        if (state.inspectionFailure) {
          record.inspectionFailure = state.inspectionFailure;
          await appendFile(join(this.checkpointRoot, `${shop.id}-inspection-anomalies.jsonl`), JSON.stringify(record) + '\n');
        }
        if (state.identityEvidence) {
          record.identityEvidence = state.identityEvidence;
          // Keep transient identity failures after the next successful status check.
          // Only visible shop names and origin/path are included, never query strings or credentials.
          await appendFile(join(this.checkpointRoot, `${shop.id}-identity-anomalies.jsonl`), JSON.stringify(record) + '\n');
        }
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
    target ||= pages.find(sellerList) || pages.find(sellerEntry);
    if(target)await target.bringToFront();
  }
  async closeAll() { this.closing = true; await Promise.allSettled([...this.pending.values()]); for (const s of [...this.sessions.values()]) { clearInterval(s.timer); await s.context.close(); } this.sessions.clear(); }
}
