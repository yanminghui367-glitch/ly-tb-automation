// Read-only checks against the running LAN workbench. Block all API writes.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyKernel} from '../kernel-integrity.mjs';
const out=resolve(import.meta.dirname,'../../output/playwright/quotes-20260925');
await mkdir(out,{recursive:true});
const base='http://127.0.0.1:4318';
const before=await fetch(base+'/api/os/state').then(r=>r.json());
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[],writes=[];
try{
 const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
 await context.route('**/api/**',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes.push(r.request().url());return r.abort();}return r.continue();});
 await context.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const check=(ok,label)=>{assert.ok(ok,label);checks.push(label);};
 const capture=async name=>{await page.evaluate(()=>document.fonts.ready);await page.locator('#page-quotes img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))));await page.screenshot({path:resolve(out,name+'.png')});};
 await page.goto(base+'/travel-os.html#quotes');await page.locator('.quotes-stats').waitFor();
 check(Number(await page.locator('.quotes-stat strong').first().innerText())===before.quotes.length,'正式页面统计与接口一致');
 check(await page.locator('#page-quotes img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),'报价图标均正常加载');
 await capture('desktop');
 await page.getByRole('button',{name:'录入报价',exact:true}).click();await page.screenshot({path:resolve(out,'form-desktop.png')});await page.keyboard.press('Escape');
 for(const hash of ['products','destinations','shops','tasks','records','settings','overview','quotes']){
  await page.evaluate(hash=>location.hash=hash,hash);await page.locator('#page-'+hash).waitFor({state:'visible'});
  check(await page.locator('#page-'+hash).isVisible(),'路由 '+hash+' 可访问');
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#sidebarToggle').click();await capture('mobile');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'正式页面390px无横向溢出');
 const lan='http://192.168.1.3:4318';
 const response=await page.goto(lan+'/travel-os.html#quotes');await page.locator('.quotes-stats').waitFor();
 check(response.ok(),'本机通过局域网地址打开报价库成功');
 await page.setViewportSize({width:1672,height:941});await page.locator('#sidebarToggle').click();await capture('lan-desktop');
 check(errors.length===0,'正式页面无未捕获浏览器错误');check(writes.length===0,'浏览器没有发起写入请求');
 const after=await fetch(base+'/api/os/state').then(r=>r.json());
 check(JSON.stringify(before.quotes)===JSON.stringify(after.quotes),'正式报价数据未改变');
 const kernel=await verifyKernel();check(kernel.ok,'冻结执行内核一致');
 await writeFile(resolve(out,'production-qa.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,writes,quotes:after.quotes.length,kernel,lanUrl:lan+'/travel-os.html#quotes',otherDeviceVerified:false},null,2));
 console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
