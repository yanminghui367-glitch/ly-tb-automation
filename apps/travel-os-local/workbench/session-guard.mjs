import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

export class SessionError extends Error {
  constructor(message) { super(message); this.code = "SESSION_REVALIDATION_FAILED"; this.statusCode = 409; }
}
const fail = message => { throw new SessionError(message); };
export async function bounded(promise, ms = 3000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new SessionError("会话核验超时，请重新核验。")), ms); })]); }
  finally { clearTimeout(timer); }
}
export function sellerPageUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && ["myseller.taobao.com", "seller.taobao.com"].includes(u.hostname) && !/login|signin|passport|captcha|verify|risk/i.test(u.pathname + u.search + u.hash); } catch { return false; }
}
const fingerprint = shop => JSON.stringify([shop.id, shop.name, shop.port, shop.profileDir]);
function pathKey(value) { return resolve(value).replace(/[\\/]+$/, "").toLowerCase(); }
export function verifyCommandLine(args, shop) {
  if (!Array.isArray(args) || !args.every(arg => typeof arg === "string")) return false;
  const profiles = args.filter(arg => arg.startsWith("--user-data-dir="));
  const ports = args.filter(arg => arg.startsWith("--remote-debugging-port="));
  return typeof shop.profileDir === "string" && isAbsolute(shop.profileDir) && Number.isInteger(shop.port) && shop.port > 0 && shop.port < 65536 &&
    profiles.length === 1 && ports.length === 1 && isAbsolute(profiles[0].slice(16)) && pathKey(profiles[0].slice(16)) === pathKey(shop.profileDir) && ports[0].slice(24) === String(shop.port) && args.includes("--enable-automation");
}

// In-memory only: no profile, Cookie, password or command-line contents are persisted.
export function createSessionGuard({ connector, risk, now = Date.now, ttlMs = 600000 }) {
  const sessions = new Map(), pending = new Map();
  let activeFingerprint = "", epoch = 0;
  function invalidate(session, reason) { session.identity = null; session.reason = reason; session.revision++; }
  function select(shop) {
    const key = fingerprint(shop);
    if (activeFingerprint !== key) { activeFingerprint = key; epoch++; for (const s of sessions.values()) invalidate(s, "店铺或配置已变化，请重新核验身份。"); }
  }
  function invalidateAll(reason = "会话已变化，请重新核验身份。") { epoch++; for (const s of sessions.values()) invalidate(s, reason); }
  function current(s, shop) { return sessions.get(shop.id) === s && s.browser.isConnected() && s.fingerprint === fingerprint(shop) && activeFingerprint === s.fingerprint; }
  function attach(s, page) {
    if (s.watched.has(page)) return;
    s.watched.add(page);
    page.on("close", () => invalidate(s, "页面已关闭，请重新核验身份。"));
    page.on("framenavigated", () => invalidate(s, "页面发生导航，请重新核验身份。"));
  }
  async function connect(shop) {
    select(shop);
    const key = fingerprint(shop), turn = epoch;
    let s = sessions.get(shop.id);
    if (!s || !s.browser.isConnected() || s.fingerprint !== key) {
      let request = pending.get(key);
      if (!request) { request = bounded(connector(shop)); pending.set(key, request); }
      let browser;
      try { browser = await request; } finally { if (pending.get(key) === request) pending.delete(key); }
      if (epoch !== turn || activeFingerprint !== key) fail("连接期间店铺已切换，请重新核验。");
      s = sessions.get(shop.id);
      if (!s || s.browser !== browser || s.fingerprint !== key) {
        s = { browser, fingerprint: key, sessionId: randomUUID(), identity: null, ownershipVerified: false, revision: 0, watched: new Set(), reason: "请核验当前页面店铺身份。" };
        sessions.set(shop.id, s);
        browser.on("disconnected", () => { invalidate(s, "浏览器断开，请重新启动并核验身份。"); if (sessions.get(shop.id) === s) sessions.delete(shop.id); });
        for (const ctx of browser.contexts()) ctx.on("page", page => { attach(s, page); invalidate(s, "新标签页已打开，请重新核验身份。"); });
      }
    }
    const revision = s.revision;
    let cdp;
    try {
      cdp = await bounded(s.browser.newBrowserCDPSession());
      const result = await bounded(cdp.send("Browser.getBrowserCommandLine"));
      if (!verifyCommandLine(result.arguments, shop)) fail("专用浏览器归属不匹配；请人工关闭旧专用窗口后重新启动，勿关闭其他浏览器。");
      if (!current(s, shop) || epoch !== turn || s.revision !== revision) fail("核验期间会话发生变化，请重新核验。");
      s.ownershipVerified = true;
    } catch (error) { s.ownershipVerified = false; invalidate(s, "无法证明浏览器归属；请人工关闭旧专用窗口后重新启动。"); throw new SessionError(error.code === "SESSION_REVALIDATION_FAILED" ? error.message : s.reason); }
    finally { if (cdp) await bounded(cdp.detach(), 1000).catch(() => {}); }
    if (!current(s, shop) || epoch !== turn || s.revision !== revision) fail("会话发生变化，请重新核验。");
    const pages = s.browser.contexts().flatMap(ctx => ctx.pages());
    if (s.identity && (pages.length !== s.identity.pages.length || pages.some(page => !s.identity.pages.includes(page)))) invalidate(s, "标签页集合已变化，请重新核验身份。");
    pages.forEach(page => attach(s, page));
    return { session: s, browser: s.browser, pages };
  }
  async function readIdentity(page, selector, name) {
    if (page.isClosed() || !sellerPageUrl(page.url())) fail("请在已核验的 HTTPS 卖家后台页面确认身份。");
    if (await bounded(risk(page), 7000)) { const error = new SessionError("页面出现登录或风控信号，请人工处理并重新核验。"); error.riskDetected = true; throw error; }
    const locator = page.locator(`css=${selector}`);
    if (await bounded(locator.count(), 2000) !== 1 || !await bounded(locator.isVisible(), 2000)) fail("店铺身份定位器必须唯一且可见。");
    if ((await locator.innerText({ timeout: 2000 })).trim() !== name) fail("页面店铺名称与目标店铺不一致。");
  }
  async function confirm(shop, input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["sessionId", "shopName", "identitySelector", "reviewed"].includes(k)) || input.reviewed !== true || typeof input.sessionId !== "string" || input.sessionId.length > 80 || input.shopName !== shop.name || typeof input.identitySelector !== "string" || !input.identitySelector.trim() || input.identitySelector.length > 500 || /[\r\n\0]|>>/.test(input.identitySelector)) fail("请明确人工核验、目标店铺、当前会话及唯一 CSS 身份定位器。");
    const { session: s, pages } = await connect(shop);
    invalidate(s, "身份核验尚未通过。");
    if (s.sessionId !== input.sessionId) fail("会话编号已失效，请刷新后重新核验。");
    const candidates = pages.filter(p => sellerPageUrl(p.url()));
    if (candidates.length !== 1) fail("请仅保留一个待核验卖家后台标签页。");
    const page = candidates[0], url = page.url(), revision = s.revision, turn = epoch;
    try { await readIdentity(page, input.identitySelector, shop.name); }
    catch (error) { invalidate(s, error.code === "SESSION_REVALIDATION_FAILED" ? error.message : "身份定位器读取失败，请重新核验。"); throw new SessionError(s.reason); }
    if (!current(s, shop) || epoch !== turn || s.revision !== revision || page.url() !== url) fail("核验期间页面或店铺发生变化，请重新核验。");
    const currentPages = s.browser.contexts().flatMap(ctx => ctx.pages());
    if (currentPages.length !== pages.length || currentPages.some(p => !pages.includes(p))) fail("标签页集合已变化，请重新核验身份。");
    s.identity = { page, pages, url, selector: input.identitySelector, confirmedAt: now(), revision };
    s.reason = "当前会话和页面店铺身份已确认；执行仍需通过商品与映射闸门。";
    return status(shop);
  }
  async function assertExecute(shop, expectedUrl) {
    const { session: s } = await connect(shop), identity = s.identity, turn = epoch;
    try {
      if (!identity || now() - identity.confirmedAt >= ttlMs || s.revision !== identity.revision) fail("店铺身份未确认或已过期，请重新核验。");
      if (identity.page.url() !== identity.url || (expectedUrl && identity.url !== expectedUrl)) fail("当前确认页与目标草稿地址不一致，请人工打开目标草稿后重新核验。");
      await readIdentity(identity.page, identity.selector, shop.name);
      const pages = s.browser.contexts().flatMap(ctx => ctx.pages());
      if (!current(s, shop) || epoch !== turn || s.identity !== identity || s.revision !== identity.revision || identity.page.url() !== identity.url || now() - identity.confirmedAt >= ttlMs || pages.length !== identity.pages.length || pages.some(page => !identity.pages.includes(page))) fail("执行核验期间会话已变化，请重新核验。");
      return identity.page;
    } catch (error) { invalidate(s, error.code === "SESSION_REVALIDATION_FAILED" ? error.message : "身份读取失败，请重新核验。"); const failure = new SessionError(s.reason); failure.riskDetected = error.riskDetected === true; throw failure; }
  }
  async function status(shop) {
    const base = { connected: false, ownershipVerified: false, identityConfirmed: false, canExecute: false, canConfirmIdentity: false, sessionId: "", confirmedAt: null, pages: [] };
    try {
      const { session: s, pages } = await connect(shop);
      if (s.identity) await assertExecute(shop).catch(() => {});
      return { ...base, connected: true, ownershipVerified: s.ownershipVerified, identityConfirmed: !!s.identity, canExecute: !!s.identity, canConfirmIdentity: s.ownershipVerified && pages.filter(p => sellerPageUrl(p.url())).length === 1, sessionId: s.sessionId, confirmedAt: s.identity ? new Date(s.identity.confirmedAt).toISOString() : null, pages: pages.slice(0, 8).map(p => ({ title: p.url().slice(0, 90), url: p.url() })), reason: s.reason };
    } catch (error) { const s = sessions.get(shop.id); return { ...base, connected: !!s?.browser.isConnected(), sessionId: s?.sessionId || "", reason: error.message }; }
  }
  return { connect, status, confirm, assertExecute, select, invalidateAll };
}
