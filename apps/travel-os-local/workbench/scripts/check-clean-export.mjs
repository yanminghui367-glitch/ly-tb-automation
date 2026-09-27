// Only for a fresh exported checkout. No executor launch, CDP or production data.
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=resolve(import.meta.dirname,'../..'),runtime=join(root,'workbench/.runtime');
assert(!existsSync(runtime),'Run only on a fresh exported checkout, never an existing operator workspace.');
assert(!existsSync(join(root,'browser-profile')),'Browser profiles must not be present.');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
process.env.WORKBENCH_NO_LISTEN='1';process.env.WORKBENCH_PORT=String(port);delete process.env.WORKBENCH_LAN_ADDRESS;
const {workbenchServer}=await import('../server.mjs');
// Manual listen deliberately skips the production startup callback that opens Chrome.
await new Promise(r=>workbenchServer.listen(port,'127.0.0.1',r));
const base='http://127.0.0.1:'+port,out=join(root,'output/clean-export-check');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1672,height:941},deviceScaleFactor:1});
const errors=[],blockedWrites=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>{if(r.request().method()==='GET')return r.continue();blockedWrites.push(new URL(r.request().url()).pathname);return r.abort();});
try {
 const health=await fetch(base+'/api/v1/health').then(r=>r.json());assert.equal(health.kernel.ok,true);checks.push('ten locked kernel files match after export');
 const state=await fetch(base+'/api/os/state').then(r=>r.json());assert.equal(state.products.length,0);assert.equal(state.attempts.length,0);assert.equal(state.engine.records.length,0);assert(!state.engine.active);checks.push('clean database has no products, execution history or active task');
 for(const path of ['/','/travel-os.html#overview','/travel-os.html#products','/travel-os.html#tasks','/travel-os.html#settings']){
  await page.goto(base+path);await page.evaluate(()=>document.fonts.ready);
  if(path.startsWith('/travel-os.html'))await page.waitForFunction(()=>document.getElementById('connectionState')?.textContent==='本地服务已连接');
  if(path.includes('overview')){await page.locator('.overview-metric').first().waitFor();assert.deepEqual(await page.locator('.ov-metric-copy strong').allTextContents(),['0','0','0','0']);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(out,'clean-overview.png')});}
  assert.equal(await page.title(),'星途 Travel OS');checks.push('read-only route '+path);
 }
 assert.equal(errors.length,0);assert.equal(blockedWrites.length,0);assert(!existsSync(join(root,'browser-profile')));checks.push('no script errors, mutations or execution-browser profile created');
 await writeFile(join(out,'result.json'),JSON.stringify({checks,errors,blockedWrites,mode:'EMPTY_EXPORT_READ_ONLY'},null,2));console.log(JSON.stringify({passed:checks.length,errors,blockedWrites}));
} finally {await browser.close();workbenchServer.closeAllConnections();workbenchServer.close();}
