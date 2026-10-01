import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4318',out=resolve(import.meta.dirname,'../../output/material-audit-20260926');
await mkdir(out,{recursive:true});
const seed=await fetch(base+'/api/os/state').then(r=>r.json());seed.testMode=true;
const report=JSON.parse(await readFile(resolve(out,'report.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1672,height:941}}),checks=[],errors=[],writes=[];
let saved=null,fail=false;
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==='/api/os/state')return route.fulfill({json:seed});
 if(url.pathname==='/api/os/material-audit'){
  if(req.method()==='POST'){writes.push('mock-rescan');await new Promise(r=>setTimeout(r,300));if(fail)return route.fulfill({status:500,json:{error:'隔离测试：目录暂时不可读'}});saved=structuredClone(report);}
  return route.fulfill({json:saved});
 }
 if(req.method()!=='GET'){writes.push(url.pathname);return route.abort();}
 return route.continue();
});
const check=(value,label)=>{assert(value,label);checks.push(label);};
try{
 await page.goto(base+'/travel-os.html#products');await page.locator('.library-table').waitFor();
 await page.locator('[data-action=library-tab][data-filter=needs]').click();
 check(await page.locator('[data-action=rescan-materials]').isVisible(),'待补资料页显示重新检索按钮');
 await page.locator('[data-action=rescan-materials]').click();
 check(await page.locator('[data-action=rescan-materials]').isDisabled(),'检索中禁用重复点击');
 await page.locator('.material-audit-summary').waitFor();
 check((await page.locator('.material-audit-summary').innerText()).includes('主图内容错误 2'),'报告显示2条内容错图');
 check((await page.locator('.material-audit-summary').innerText()).includes('重复对应 28'),'报告显示28条重复对应');
 await page.locator('.material-audit-results>summary').click();
 const london=page.locator('.material-audit-item').filter({has:page.locator('summary>strong',{hasText:'伦敦'})});await london.locator(':scope>summary').click();
 check((await london.innerText()).includes('错图指纹'),'伦敦保留内容错误依据');
 const portland=page.locator('.material-audit-item').filter({has:page.locator('summary>strong',{hasText:'波特兰'})});await portland.locator(':scope>summary').click();check((await portland.innerText()).includes('154 / 149'),'重复关系展示实际源行与排名');
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(out,'desktop.png'),fullPage:true});
 await page.reload();await page.locator('[data-action=library-tab][data-filter=needs]').click();await page.locator('.material-audit-summary').waitFor();check(true,'重新进入显示上次检索结果');
 saved.stale=true;await page.locator('[data-action=library-tab][data-filter=""]').click();await page.locator('[data-action=library-tab][data-filter=needs]').click();await page.waitForFunction(()=>document.querySelector('.material-audit').textContent.includes('旧报告'));check(true,'资料配置变动提示旧报告');
 fail=true;await page.locator('[data-action=rescan-materials]').click();await page.locator('.material-audit [role=alert]').waitFor();check(await page.locator('[data-action=rescan-materials]').isEnabled(),'失败显示原因并允许重试');
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px无页面横向溢出');await page.screenshot({path:resolve(out,'mobile.png'),fullPage:true});
 await page.evaluate(()=>dispatchEvent(new Event('offline')));check(await page.locator('[data-action=rescan-materials]').isDisabled(),'断线禁用检索请求');
 check(errors.length===0,'无页面异常');check(writes.every(x=>x==='mock-rescan'),'仅拦截的诊断请求，无真实业务写入');
}finally{await writeFile(resolve(out,'ui-verification.json'),JSON.stringify({checks,errors,writes,mode:'浏览器拦截接口；报告为本机只读检索结果'},null,2));console.log(JSON.stringify({checks,errors,writes}));await browser.close();}
