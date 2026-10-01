import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const statePath = new URL("../.runtime/jobs.json", import.meta.url);
// Keep account-facing checks deliberately small. Run only on the explicitly chosen batch.
const limit = Number(process.argv[2] || 1);
const state = JSON.parse(await readFile(statePath, "utf8"));
const jobs = state.jobs.filter(job => job.status === "READY").slice(0, limit);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 10000 });
const page = await browser.contexts()[0].newPage();
const results = [];

try {
  for (const job of jobs) {
    const url = `https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20&queryTitle=${encodeURIComponent(job.title)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByText(/共\d+件商品/).first().waitFor({ timeout: 15000 });
    const text = await page.getByText(/共\d+件商品/).first().textContent();
    const count = Number(text?.match(/\d+/)?.[0] || 0);
    results.push({ id: job.id, destination: job.destination, title: job.title, liveCount: count, action: count ? "skip" : "candidate" });
    await page.waitForTimeout(7000);
  }
  console.log(JSON.stringify({ checked: results.length, candidates: results.filter(row => row.action === "candidate"), duplicates: results.filter(row => row.action === "skip") }, null, 2));
} finally {
  await page.close();
  await browser.close();
}
