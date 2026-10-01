// Read-only validation of a restored business copy; never starts an executor browser.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]||join(import.meta.dirname,'..')),out=join(root,'output/migration-ui-check');
const require=createRequire(join(root,'workbench/package.json')),{chromium}=require('playwright');
const report=JSON.parse(await readFile(join(root,'workbench/.runtime/migration-report.json'),'utf8'));
assert.equal(existsSync(join(root,'browser-profile')),false,'restored copy must not have a browser profile');
process.env.WORKBENCH_NO_LISTEN='1';process.env.WORKBENCH_PORT='0';delete process.env.WORKBENCH_LAN_ADDRESS;
const {workbenchServer}=await import(pathToFileURL(join(root,'workbench/server.mjs')));
await new Promise(r=>workbenchServer.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+workbenchServer.address().port;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1672,height:941},deviceScaleFactor:1});
const errors=[],writes=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>{if(r.request().method()==='GET')return r.continue();writes.push(new URL(r.request().url()).pathname);return r.abort();});
try{
 const health=await fetch(base+'/api/v1/health').then(r=>r.json());assert(health.kernel.ok);checks.push('frozen kernel passes');
 const state=await fetch(base+'/api/os/state').then(r=>r.json());assert.equal(state.products.length,700);assert.equal(state.engine.records.length,report.counts.source.history);assert.equal(state.engine.settings.executionEnabled,false);assert(!state.engine.active);checks.push('700 products and original history restored, no execution enabled or active');
 for(const route of ['overview','tasks','shops','products','destinations','quotes','records','settings']){
  await page.goto(base+'/travel-os.html#'+route);await page.waitForFunction(()=>document.getElementById('connectionState')?.textContent==='本地服务已连接');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.title(),'星途 Travel OS');assert(await page.locator('#page-'+route).isVisible());
  await page.screenshot({path:join(out,route+'.png')});checks.push(route+' renders restored data');
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/travel-os.html#products');await page.waitForFunction(()=>document.getElementById('connectionState')?.textContent==='本地服务已连接');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('390px product page has no horizontal page overflow');
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(root,'workbench/.runtime/source-workflow/state.sqlite'),{readOnly:true});let task;
 for(const row of db.prepare('SELECT payload FROM imports ORDER BY rowid DESC').all()){const d=JSON.parse(row.payload);task=d.tasks?.find(t=>!t.adapterIssues?.length);if(task)break;}db.close();assert(task);
 const {assertTaskFiles}=await import(pathToFileURL(join(root,'workbench/taobao-publisher.mjs')));await assertTaskFiles(task);checks.push('restored original worksheet/package and 1+4+8 material hashes pass for a ready sample');
 assert.equal(errors.length,0);assert.equal(writes.length,0);assert.equal(existsSync(join(root,'browser-profile')),false);checks.push('no script errors, API writes, browser profile or publication');
 const result={at:new Date().toISOString(),checks,errors,writes,products:state.products.length,history:state.engine.records.length,mode:'RESTORED_COPY_READ_ONLY'};await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:checks.length,errors,writes,products:state.products.length,history:state.engine.records.length}));
}finally{await browser.close();workbenchServer.closeAllConnections();workbenchServer.close();}
