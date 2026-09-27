import test, { after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { rmdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createSessionGuard, verifyCommandLine, sellerPageUrl } from "../session-guard.mjs";
process.env.WORKBENCH_NO_LISTEN = "1";
const { createTask, executeNextDryRun, updateTask, nextShopPort, assertPortAvailable } = await import("../server.mjs");
const syntheticDirectories = [];
after(async () => { for (const path of syntheticDirectories) await rmdir(path).catch(error => { if (error.code !== "ENOENT") throw error; }); });

// These names, selectors, pages and command lines exist only in memory.
function fixture() {
  const shop = { id: "SYNTHETIC", name: "合成店铺", port: 19222, profileDir: resolve("SYNTHETIC-NOT-READ") };
  let clock = 10000;
  const page = new EventEmitter();
  Object.assign(page, { address: "https://myseller.taobao.com/synthetic-draft", text: shop.name, visible: true, count: 1, closed: false, risk: false, actions: [],
    url() { return this.address; }, isClosed() { return this.closed; }, async bringToFront() {}, async title() { return "SYNTHETIC"; }, frames() { return []; }, async screenshot() {},
    locator(selector) { const p = this; return { async count() { return p.count; }, async isVisible() { return p.visible; }, async innerText() { if (p.onRead) await p.onRead(); return selector === "body" ? "SYNTHETIC" : p.text; }, async waitFor() { if (p.onWait) p.onWait(); }, async fill(value) { p.actions.push(value); } }; },
    navigate(url = "https://myseller.taobao.com/other") { this.address = url; this.emit("framenavigated", {}); }
  });
  const ctx = new EventEmitter(); ctx.list = [page]; ctx.pages = () => ctx.list;
  const browser = new EventEmitter();
  Object.assign(browser, { connected: true, args: ["--enable-automation", `--remote-debugging-port=${shop.port}`, `--user-data-dir=${shop.profileDir}`], contexts: () => [ctx], isConnected() { return this.connected; }, async newBrowserCDPSession() { return { send: async () => { if (this.commandError) throw Error("SYNTHETIC private detail"); return { arguments: this.args }; }, async detach() {} }; } });
  const guard = createSessionGuard({ connector: async () => browser, risk: async p => p.risk, now: () => clock, ttlMs: 1000 });
  const confirm = async (extra = {}) => { const s = await guard.status(shop); return guard.confirm(shop, { sessionId: s.sessionId, shopName: shop.name, identitySelector: "#synthetic-name", reviewed: true, ...extra }); };
  return { shop, page, ctx, browser, guard, confirm, expire: () => { clock += 1001; } };
}

test("CDP connection alone has no identity authority", async () => { const f = fixture(); const s = await f.guard.status(f.shop); assert.equal(s.connected, true); assert.equal(s.ownershipVerified, true); assert.equal(s.canExecute, false); await assert.rejects(f.guard.assertExecute(f.shop), /身份/); });
for (const name of ["profile", "port", "automation", "unknown-command", "duplicate-port"]) test(`ownership rejects ${name}`, async () => {
  const f = fixture();
  if (name === "profile") f.browser.args[2] = `--user-data-dir=${resolve("WRONG")}`;
  if (name === "port") f.browser.args[1] = "--remote-debugging-port=1234";
  if (name === "automation") f.browser.args.shift();
  if (name === "unknown-command") f.browser.commandError = true;
  if (name === "duplicate-port") f.browser.args.push(f.browser.args[1]);
  const s = await f.guard.status(f.shop); assert.equal(s.ownershipVerified, false); assert.equal(s.canExecute, false); assert.equal(JSON.stringify(s).includes("SYNTHETIC private"), false);
});
test("confirmation permits only the exact owned page, selector and name", async () => { const f = fixture(); const s = await f.confirm(); assert.equal(s.canExecute, true); assert.equal(await f.guard.assertExecute(f.shop, f.page.url()), f.page); await assert.rejects(f.guard.assertExecute(f.shop, "https://myseller.taobao.com/other"), /草稿/); assert.equal((await f.guard.status(f.shop)).identityConfirmed, false); });
for (const [name, input] of Object.entries({ missing: { identitySelector: "" }, unreviewed: { reviewed: "true" }, wrongName: { shopName: "其他" }, staleId: { sessionId: "OLD" }, unknown: { unsafe: true }, locatorEngine: { identitySelector: "#a >> text=合成店铺" } })) test(`confirmation input rejects ${name}`, async () => { const f = fixture(); await assert.rejects(f.confirm(input)); assert.equal((await f.guard.status(f.shop)).canExecute, false); });
for (const condition of ["wrong-text", "hidden", "ambiguous", "login", "risk"]) test(`identity rejects ${condition}`, async () => { const f = fixture(); if (condition === "wrong-text") f.page.text = "别的店铺"; if (condition === "hidden") f.page.visible = false; if (condition === "ambiguous") f.page.count = 2; if (condition === "login") f.page.address = "https://login.taobao.com/"; if (condition === "risk") f.page.risk = true; await assert.rejects(f.confirm()); });
for (const change of ["expired", "disconnect", "navigate", "new-tab", "new-unobserved-tab", "shop", "config", "identity-change", "risk"]) test(`confirmation is irrevocably invalidated by ${change}`, async () => {
  const f = fixture(); await f.confirm();
  if (change === "expired") f.expire();
  if (change === "disconnect") { f.browser.connected = false; f.browser.emit("disconnected"); f.browser.connected = true; }
  if (change === "navigate") f.page.navigate();
  if (change === "new-tab" || change === "new-unobserved-tab") { const page = new EventEmitter(); page.url = () => "about:blank"; f.ctx.list.push(page); if (change === "new-tab") f.ctx.emit("page", page); }
  if (change === "shop") f.guard.select({ ...f.shop, id: "OTHER" });
  if (change === "config") f.shop.name = "改名";
  if (change === "identity-change") f.page.text = "其他店铺";
  if (change === "risk") f.page.risk = true;
  await assert.rejects(f.guard.assertExecute(f.shop)); f.page.risk = false; f.page.text = f.shop.name;
  assert.equal((await f.guard.status(f.shop)).canExecute, false);
});
test("navigation during confirmation cannot overwrite invalidation", async () => { const f = fixture(); f.page.onRead = () => { f.page.navigate(); }; await assert.rejects(f.confirm(), /变化/); assert.equal((await f.guard.status(f.shop)).canExecute, false); });
test("seller URL whitelist rejects generic Taobao and login signals", () => { for (const url of ["https://taobao.com/", "https://example.taobao.com/", "http://myseller.taobao.com/", "https://myseller.taobao.com/login", "https://myseller.taobao.com/?redirect=login"]) assert.equal(sellerPageUrl(url), false); });
test("command line checks reject relative profile without reading the directory", () => { const f = fixture(); assert.equal(verifyCommandLine(f.browser.args, f.shop), true); assert.equal(verifyCommandLine(f.browser.args, { ...f.shop, profileDir: "relative" }), false); });
test("port allocation skips existing noncontiguous shop ports", () => { assert.equal(nextShopPort([{ port: 9222 }, { port: 9224 }, { port: 9223 }]), 9225); assert.equal(nextShopPort([{ port: 9224 }]), 9222); });
test("launch preflight refuses occupied unknown port and invalid port", async () => { const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); try { await assert.rejects(assertPortAvailable(server.address().port), /占用/); await assert.rejects(assertPortAvailable(0), /无效/); } finally { await new Promise(resolve => server.close(resolve)); } });

function executionFixture(f) {
  const fields = ["category", "title", "price", "main_images", "secondary_images", "detail_images"].map(id => ({ id, source: `profile.${id}`, locator: { strategy: "css", value: "#synthetic-field" }, interaction: "fill", reviewed: true }));
  const mapping = { platform: "taobao", version: "SYNTHETIC", verified_evidence: "SYNTHETIC-NOT-PLATFORM", draft_url: f.page.url(), fields };
  const job = { id: "SYNTHETIC-job", destination: "合成国", status: "READY", listing: { location_type: "country", country: "合成国", destination: "合成国" }, profile: { shop_name: f.shop.name, ...Object.fromEntries(fields.map(field => [field.id, "SYNTHETIC"])) }, assets: {}, reviewEvidence: {}, packageValidation: { valid: true }, releaseBlockers: [], automationMapping: mapping, mappingValidation: { valid: true } };
  const state = { activeShopId: f.shop.id, jobs: [job], tasks: [] }, task = createTask(state, f.shop, [job.id]);
  syntheticDirectories.push(fileURLToPath(new URL(`../output/tasks/${task.id}`, import.meta.url)));
  return { state, task };
}
test("direct executor rejects missing identity before any action", async () => { const f = fixture(), { state, task } = executionFixture(f); await executeNextDryRun(state, f.shop, task, f.guard); assert.equal(task.currentStep, "SESSION_REVALIDATION_FAILED"); assert.deepEqual(f.page.actions, []); });
test("executor rechecks after locator wait and refuses navigation", async () => { const f = fixture(), { state, task } = executionFixture(f); await f.confirm(); f.page.onWait = () => f.page.navigate(); await executeNextDryRun(state, f.shop, task, f.guard); assert.equal(task.currentStep, "SESSION_REVALIDATION_FAILED"); assert.deepEqual(f.page.actions, []); });
test("risk detected before a field requires human risk recovery, not session queue", async () => { const f = fixture(), { state, task } = executionFixture(f); await f.confirm(); f.page.onWait = () => { f.page.risk = true; }; await executeNextDryRun(state, f.shop, task, f.guard); assert.equal(task.currentStep, "PAUSED_RISK_CONTROL"); assert.deepEqual(f.page.actions, []); assert.throws(() => updateTask(state, task.id, "queue")); assert.throws(() => updateTask(state, task.id, "resume", "")); assert.equal((await f.guard.status(f.shop)).canExecute, false); });
test("concurrent direct executor cannot start the same shop twice", async () => { const f = fixture(), { state, task } = executionFixture(f); let release; const hold = new Promise(resolve => { release = resolve; }); const original = f.guard.assertExecute; f.guard.assertExecute = async (...args) => { await hold; return original(...args); }; const first = executeNextDryRun(state, f.shop, task, f.guard); await assert.rejects(executeNextDryRun(state, f.shop, structuredClone(task), f.guard), /已有执行/); release(); await first; assert.deepEqual(f.page.actions, []); });
test("positive synthetic execution reaches human review without navigation", async () => { const f = fixture(), { state, task } = executionFixture(f); await f.confirm(); await executeNextDryRun(state, f.shop, task, f.guard); assert.equal(task.currentStep, "FINAL_REVIEW_REQUIRED"); assert.equal(f.page.actions.length, 6); assert.equal(f.page.url(), "https://myseller.taobao.com/synthetic-draft"); });
test("session pause requeues item; ordinary risk pause cannot use queue", () => { const f = fixture(), { state, task } = executionFixture(f); task.state = "PAUSED"; task.items[0].state = "PAUSED"; task.currentStep = "PAUSED_RISK_CONTROL"; assert.throws(() => updateTask(state, task.id, "queue")); task.currentStep = "SESSION_REVALIDATION_FAILED"; updateTask(state, task.id, "queue"); assert.equal(task.items[0].state, "WAITING_FOR_FORM"); });
