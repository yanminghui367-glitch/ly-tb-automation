import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
const preview=JSON.parse(await readFile('output/batch20-20260921/preview.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.goto('http://127.0.0.1:4318/');
 await page.setContent(`<style>body{font:18px sans-serif}section{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}img{width:100%}p{margin:2px}</style><section>${preview.tasks.map(t=>`<article><img src="http://127.0.0.1:4318/api/source/asset?batch=${preview.importId}&order=${t.priority}&group=main&index=0"><p>${t.priority} ${t.listing.city}</p></article>`).join('')}</section>`);
 await page.waitForFunction(()=>Array.from(document.images).every(x=>x.complete&&x.naturalWidth>0),{},{timeout:60000});
 await page.screenshot({path:'output/batch20-20260921/preview-complete.png',fullPage:true});
 console.log(JSON.stringify(preview.tasks.map(t=>({rank:t.priority,city:t.listing.city,main:t.assets.main[0]}))));
}finally{await browser.close();}
