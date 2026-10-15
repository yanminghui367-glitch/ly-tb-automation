// Read-only browser verification against the local workbench. Never permits a write request.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base=process.env.QA_BASE_URL||'http://127.0.0.1:4318',root=resolve(import.meta.dirname,'../..'),out=join(root,'output/playwright/batch-recheck-20261014');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1672,height:1000},serviceWorkers:'block'});
const errors=[],writes=[],checks=[];
await context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){writes.push({method:req.method(),url:req.url()});return route.abort();}return new URL(req.url()).origin===new URL(base).origin?route.continue():route.abort();});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
try{
 await page.goto(base+'/travel-os.html#tasks',{waitUntil:'domcontentloaded',timeout:45000});await page.locator('.queue-panel tbody tr [data-action=round-item-detail]').first().waitFor();
 const rows=page.locator('.queue-panel tbody tr'),selector=page.locator('#taskHistoryBatchSelector');
 const engine=await page.evaluate(()=>fetch('/api/v1/state').then(r=>r.json()));
 const current=engine.round.window,history=engine.round.windowHistory;
 assert.equal(await rows.count(),Math.min(20,current.total));
 assert.equal(await rows.first().locator('[data-action=round-item-detail]').getAttribute('data-window'),current.id);
 checks.push('实际当前批次默认展示，每页20条');
 const skipped=(await page.locator('[data-action=queue-filter][data-filter=skipped] .task-tab-count').innerText());
 await page.locator('[data-action=queue-filter][data-filter=skipped]').click();
 assert.equal(await rows.count(),Math.min(20,Number(skipped)));assert.ok(Number(skipped)>0);
 assert.ok((await rows.allTextContents()).every(text=>text.includes('跳过')));checks.push('实际跳过筛选数量与列表一致：'+skipped+'条');
 await page.locator('.queue-panel').screenshot({path:join(out,'live-skipped-desktop.png')});
 const button=page.locator('[data-action=queue-recheck]');await button.waitFor();assert.equal(await button.isDisabled(),true);checks.push('正式服务未更新时明确禁用重新上架');
 await page.setViewportSize({width:390,height:844});await page.locator('.queue-panel').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:join(out,'live-skipped-mobile.png')});await page.setViewportSize({width:1672,height:1000});
 await page.locator('[data-action=queue-filter][data-filter=all]').click();
 assert.equal(await selector.locator('option').count(),history.length+1);checks.push('历史下拉与实际窗口记录一致');
 await page.locator('[data-action=task-next]').click();assert.equal(await rows.first().locator('td').first().innerText(),'21');checks.push('实际第二页从21开始');
 const first=[...history].sort((a,b)=>a.sequence-b.sequence)[0];await selector.selectOption(first.id);
 await page.waitForFunction(id=>document.querySelector('.queue-panel [data-action="round-item-detail"]')?.dataset.window===id,first.id);
 assert.equal(await rows.count(),Math.min(20,first.total));checks.push('历史第一批正确显示原批次内容');
 await page.locator('.queue-panel').screenshot({path:join(out,'live-history.png')});
 await selector.selectOption('');await page.waitForFunction(id=>document.querySelector('.queue-panel [data-action="round-item-detail"]')?.dataset.window===id,current.id);
 await page.locator('.queue-panel').screenshot({path:join(out,'live-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('.queue-panel').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:join(out,'live-mobile.png')});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('实际390px无整页横向溢出');
 for(const name of ['travel-os.js','tasks.css','task-view-model.mjs']){
  const bytes=await page.evaluate(async name=>Array.from(new Uint8Array(await (await fetch('/'+name,{cache:'no-store'})).arrayBuffer())),name);
  assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'),createHash('sha256').update(await readFile(join(root,'workbench',name))).digest('hex'));
 }checks.push('正式网站脚本和样式与本地修改字节一致');
 assert.equal(errors.length,0);assert.equal(writes.length,0);checks.push('无浏览器错误和写请求');
 await writeFile(join(out,'live-check.json'),JSON.stringify({base,at:new Date().toISOString(),currentWindow:current.id,history:history.map(w=>({sequence:w.sequence,at:w.started||w.at,total:w.total})),checks,errors,writes},null,2));
 console.log(JSON.stringify({checks,errors,writes},null,2));
}finally{await browser.close();}
