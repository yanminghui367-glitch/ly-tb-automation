import { chromium, errors } from 'playwright';
import { expect } from 'playwright/test';
import { basename } from 'node:path';
import { verifyCommandLine } from '../../workbench/session-guard.mjs';
import { EngineError, requireThat, resolveValue } from './contract.mjs';
import { projectProfile, visibleChallenge } from '../../workbench/browser-environment.mjs';

const riskWords = ['验证码', '滑块', '滑动验证', '人机验证', '安全验证', '行为验证', '异常访问', '登录失效', '请登录', 'captcha', 'slide to verify', 'drag the slider', 'security check', 'sign in'];
// Runs read-only inside each frame. No credential, storage or network payload collection.
function riskInDocument(words) {
  const text = `${document.title}\n${document.body?.innerText || ''}\n${location.pathname}`.toLowerCase();
  return words.find(w => text.includes(w)) || '';
}
export class PublishPage {
  constructor(page, profile, { ownership = async () => {}, timeout = 5000 } = {}) {
    this.page = page; this.profile = profile; this.ownership = ownership; this.timeout = timeout;
    page.setDefaultTimeout(timeout);
  }
  locator(selector, frame) { return (frame ? this.page.frameLocator(frame) : this.page).locator(selector); }
  async risk() {
    if (await visibleChallenge(this.page)) return 'CAPTCHA';
    for (const frame of this.page.frames()) {
      try { const found = await frame.evaluate(riskInDocument, riskWords); if (found) return found; }
      catch (e) { if (this.page.isClosed()) throw new EngineError('BROWSER_DISCONNECTED'); }
    }
    return '';
  }
  async guard() {
    requireThat(!this.page.isClosed(), 'BROWSER_DISCONNECTED');
    const risk = await this.risk();
    if (risk) throw new EngineError('CAPTCHA_OR_LOGIN', '检测到验证码、登录或风控；请人工处理后恢复当前任务。');
    const actual = new URL(this.page.url()), expected = new URL(this.profile.draftUrl);
    requireThat(actual.origin === expected.origin, 'UNEXPECTED_PAGE_ORIGIN');
    await this.ownership();
    const id = this.locator(this.profile.identity.selector);
    requireThat(await id.count() === 1 && await id.isVisible(), 'SHOP_IDENTITY_NOT_UNIQUE');
    requireThat((await id.innerText()).trim() === this.profile.identity.expected, 'WRONG_SHOP');
  }
  async guarded(operation) {
    await this.guard();
    // Condition watchers notice a risk while a field is waiting. Any already-issued
    // Playwright action is drained before return; no subsequent action is dispatched.
    let stopped = false;
    let signalled = false;
    const watched = this.page.frames().map(frame => frame.waitForFunction(riskInDocument, riskWords, { timeout: this.timeout })
      .then(async () => {
        if (!stopped) {
          if (!signalled) { signalled = true; await this.onRisk?.(); }
          throw new EngineError('CAPTCHA_OR_LOGIN');
        }
      })
      .catch(e => { if (e instanceof errors.TimeoutError || stopped) return new Promise(() => {}); throw e; }));
    const action = Promise.resolve().then(operation);
    try { const result = await Promise.race([action, ...watched]); await this.guard(); return result; }
    catch (e) {
      // Native locator operations have bounded timeouts; settle before resume is allowed.
      await action.catch(() => {});
      if (e.code === 'CAPTCHA_OR_LOGIN' || await this.risk().catch(() => '')) throw new EngineError('CAPTCHA_OR_LOGIN');
      throw e;
    } finally { stopped = true; }
  }
  async prepare({ resume = false } = {}) {
    if (resume) { await this.guard(); requireThat(this.page.url() === this.profile.draftUrl, 'RESUME_PAGE_CHANGED'); return; }
    // Real connections must first pass identity on the existing seller page.
    if (this.profile.environment === 'TAOBAO') await this.guard();
    await this.page.goto(this.profile.draftUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout });
    await this.guard();
  }
  expected(task, field) {
    const v = resolveValue(task, field.source);
    return field.action === 'upload' ? v.map(a => basename(a.path)) : String(v);
  }
  async matches(task, field) {
    const loc = this.locator(field.verify.selector, field.frame), expected = this.expected(task, field);
    if (field.verify.kind === 'uploadedNames') {
      const names = await loc.allTextContents(); return JSON.stringify(names.map(s => s.trim())) === JSON.stringify(expected);
    }
    if (await loc.count() !== 1) return false;
    const actual = field.verify.kind === 'value' ? await loc.inputValue() : await loc.innerText();
    return actual.trim() === expected;
  }
  async verify(task, field) {
    const loc = this.locator(field.verify.selector, field.frame), expected = this.expected(task, field);
    if (field.verify.kind === 'value') await expect(loc).toHaveValue(expected, { timeout: this.timeout });
    else await expect(loc).toHaveText(expected, { timeout: this.timeout });
  }
  async apply(task, field) {
    await this.guarded(async () => {
      if (await this.matches(task, field)) return;
      requireThat(field.action !== 'manual', `MANUAL_FIELD_${field.id}`);
      if (field.action === 'upload' && await this.locator(field.verify.selector, field.frame).count() > 0) throw new EngineError(`MANUAL_FIELD_${field.id}_PARTIAL_UPLOAD`);
      const loc = this.locator(field.selector, field.frame), value = resolveValue(task, field.source);
      if (field.action === 'fill') await loc.fill(String(value));
      else if (field.action === 'select') await loc.selectOption(String(value));
      else if (field.action === 'upload') await loc.setInputFiles(value.map(a => a.path));
      await this.verify(task, field);
    });
  }
  async screenshot(path) { await this.page.screenshot({ path, fullPage: true, timeout: this.timeout }); }
  async submit(task) {
    await this.guard();
    for (const field of this.profile.fields) requireThat(await this.matches(task, field), `FINAL_VALUE_CHANGED_${field.id}`);
    if (this.profile.formErrors) requireThat(!await this.locator(this.profile.formErrors).isVisible(), 'FORM_VALIDATION_ERROR');
    await this.guard();
    await this.locator(this.profile.submit.selector).click({ timeout: this.timeout });
  }
  async result(task) {
    const r = this.profile.result;
    await this.guarded(async () => { await expect(this.locator(r.success)).toBeVisible({ timeout: this.timeout }); });
    const itemId = (await this.locator(r.itemId).innerText()).trim();
    const href = await this.locator(r.itemLink).getAttribute('href');
    const url = new URL(href, this.page.url());
    requireThat(/^\d+$/.test(itemId), 'INVALID_PLATFORM_ITEM_ID');
    requireThat(url.searchParams.get('id') === itemId, 'RESULT_ID_LINK_MISMATCH');
    if (this.profile.environment === 'TAOBAO') requireThat(url.protocol === 'https:' && url.hostname === 'item.taobao.com', 'INVALID_ITEM_URL');
    else requireThat(url.origin === new URL(this.profile.draftUrl).origin, 'INVALID_FIXTURE_URL');
    requireThat((await this.locator(r.title).innerText()).trim() === task.listing.title, 'RESULT_TITLE_MISMATCH');
    return { itemId, url: url.href, environment: this.profile.environment, verifiedAt: new Date().toISOString() };
  }
}

export async function connectSeller(profile) {
  requireThat(profile.environment === 'TAOBAO', 'REAL_CONNECTION_REQUIRES_TAOBAO_PROFILE');
  requireThat(Number.isInteger(profile.shop.port) && profile.shop.port > 0 && profile.shop.port < 65536, 'INVALID_CDP_PORT');
  requireThat(profile.shop.profileDir === projectProfile(profile.shop.id), 'PROJECT_PERSISTENT_PROFILE_REQUIRED');
  async function ownerStatus() {
    let status;
    try { const response = await fetch(`http://127.0.0.1:${Number(process.env.WORKBENCH_PORT || 4318)}/api/browser/status`, { signal: AbortSignal.timeout(15000) }); status = await response.json(); }
    catch { throw new EngineError('BROWSER_OWNER_UNAVAILABLE', '请启动项目工作台和专用 Chrome；任务保留断点。'); }
    requireThat(status.shop?.id === profile.shop.id && status.shop?.port === profile.shop.port && status.browser?.profileDir === projectProfile(profile.shop.id), 'BROWSER_OWNER_SHOP_MISMATCH');
    requireThat(status.browser.running, 'BROWSER_OWNER_UNAVAILABLE');
    requireThat(status.browser.loggedIn, 'CAPTCHA_OR_LOGIN');
  }
  await ownerStatus();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${profile.shop.port}`, { timeout: 5000 });
  async function ownership() {
    await ownerStatus();
    const cdp = await browser.newBrowserCDPSession();
    try { const { arguments: args } = await cdp.send('Browser.getBrowserCommandLine'); requireThat(verifyCommandLine(args, profile.shop), 'BROWSER_OWNERSHIP_MISMATCH'); }
    finally { await cdp.detach(); }
  }
  try {
    await ownership();
    const pages = browser.contexts().flatMap(c => c.pages()).filter(p => p.url() === profile.draftUrl);
    requireThat(pages.length === 1, 'ONE_SELLER_PAGE_REQUIRED');
    // Closing this CDP client disconnects only the task. The owner retains context.
    return { browser, disconnect: () => browser.close(), pageObject: new PublishPage(pages[0], profile, { ownership }) };
  } catch (e) { await browser.close(); throw e; }
}
