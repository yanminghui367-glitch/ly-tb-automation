// Reproducible presentation-only capture. No seller browser, task writes or image generation.
import {chromium,expect} from 'playwright/test';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const stage=process.argv[2]||'final';
assert(/^[a-z0-9-]+$/.test(stage));
const root=fileURLToPath(new URL('../../output/playwright/home-reference-20260923/',import.meta.url));
const out=root+stage+'/';await mkdir(out,{recursive:true});
if(stage==='before')assert.equal(await access(out+'desktop.png').then(()=>true,()=>false),false,'The original before image is immutable; choose a different capture name.');
const base='http://127.0.0.1:4318';
const before=await fetch(base+'/api/v1/state').then(r=>r.json());
assert.equal(before.active,null);assert.equal(before.settings.executionEnabled,false);
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],writes=[];
try{
 const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1,reducedMotion:'reduce'});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**/api/**',r=>{if(r.request().method()!=='GET'){writes.push(r.request().url());return r.abort();}return r.continue();});
 await p.goto(base+'/?visual=reference');
 await expect(p.locator('.city-name')).toHaveText('东京');
 await expect(p.locator('#interactiveGlobe')).toHaveAttribute('data-state','ready');
 await expect(p.locator('#interactiveGlobe')).toHaveAttribute('data-motion','false');
 await p.waitForFunction(()=>document.querySelector('#interactiveGlobe').dataset.camera);
 await p.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.decode()));});
 await expect(p.locator('#rotateGlobe')).toHaveAttribute('aria-pressed','false');
 const dimensions=await p.evaluate(()=>{const result={viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,zoom:visualViewport.scale,scrollWidth:document.documentElement.scrollWidth,globe:{...document.querySelector('#interactiveGlobe').dataset}};for(const q of ['.header','.globe-stage','.hero h1','.intro','.search-box','.quick-row','.city-card','.city-name','.primary-actions','.metrics','.operations','.hero-signoff']){const e=document.querySelector(q);if(e){const r=e.getBoundingClientRect();result[q]={x:r.x,y:r.y,width:r.width,height:r.height};}}return result;});
 assert.equal(dimensions.dpr,1);assert.equal(dimensions.zoom,1);assert.equal(dimensions.scrollWidth,1672);
 await p.screenshot({path:out+'desktop.png'});
 if(process.argv.includes('--responsive'))for(const [w,h] of [[1440,900],[1920,1080],[390,844]]){await p.setViewportSize({width:w,height:h});await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.screenshot({path:out+`viewport-${w}x${h}.png`,fullPage:w===390});}
 await context.close();
 // Exact CSS compositing of the original reference and screenshot: no crop, stretch or invented pixels.
 const reference=await readFile(new URL('../assets/travel-os/brand-reference.png',import.meta.url));
 const actual=await readFile(out+'desktop.png');
 const refUrl='data:image/png;base64,'+reference.toString('base64'),actualUrl='data:image/png;base64,'+actual.toString('base64');
 const compare=await browser.newPage({viewport:{width:3344,height:941},deviceScaleFactor:1});
 await compare.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#000;display:flex}img{display:block;width:1672px;height:941px;flex:none}</style><img src="${refUrl}" alt="图一原始参考"><img src="${actualUrl}" alt="${stage}实际网页">`);await compare.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await compare.screenshot({path:out+'side-by-side.png'});
 await compare.setViewportSize({width:1672,height:941});await compare.addStyleTag({content:'body{position:relative}img{position:absolute;inset:0}img:last-child{opacity:.5}'});await compare.screenshot({path:out+'overlay-50.png'});await compare.close();
 const after=await fetch(base+'/api/v1/state').then(r=>r.json());
 assert.deepEqual(after.records.map(x=>x.itemId).sort(),before.records.map(x=>x.itemId).sort());assert.equal(after.active,null);assert.equal(after.settings.executionEnabled,false);assert(after.kernel.ok);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 await writeFile(out+'capture.json',JSON.stringify({stage,at:new Date().toISOString(),reference:'brand-reference.png (1672x941)',dimensions,errors,writes,recordsUnchanged:after.records.length,kernel:after.kernel,newRealPublications:0},null,2));
 console.log(JSON.stringify({stage,out,dimensions,errors,writes}));
}finally{await browser.close();}
