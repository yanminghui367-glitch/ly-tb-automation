import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(import.meta.dirname,'../../output/destination-ui-20260925');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1672,height:941},deviceScaleFactor:1});
 await page.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4318/travel-os.html#destinations');
 await page.locator('#page-destinations table tbody tr').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:resolve(out,process.argv[2]||'desktop.png'),fullPage:true});
 console.log(JSON.stringify({errors,size:await page.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth})),title:await page.title()}));
} finally {await browser.close();}
