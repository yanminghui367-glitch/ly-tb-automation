// Read-only regression: retain rotation; no screen-position mode.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(import.meta.dirname,'../../output/playwright/globe-drag-20261005');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[],writes=[];
const check=(ok,label)=>{assert(ok,label);checks.push(label);};
try{
 for(const width of [1672,390]){
  const context=await browser.newContext({viewport:{width,height:941},reducedMotion:'reduce'});
  await context.route('**/api/**',r=>{if(r.request().method()!=='GET'){writes.push(r.request().url());return r.abort();}return r.continue();});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4318/');
  await p.waitForFunction(()=>document.querySelector('#interactiveGlobe')?.dataset.camera);
  const state=()=>p.locator('#interactiveGlobe').evaluate(el=>({...el.dataset}));
  const settle=()=>p.waitForFunction(()=>document.querySelector('#interactiveGlobe').dataset.motion==='false');
  check(await p.locator('#moveGlobe').count()===0,'没有位置移动按钮 '+width);
  const label=p.locator('.globe-point:not([hidden]) .point-label:not([hidden])').first(),box=await label.boundingBox();
  const before=await state();
  await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
  await p.mouse.move(box.x+box.width/2-80,box.y+box.height/2+30,{steps:16});await p.mouse.up();
  await p.waitForTimeout(250);
  check((await state()).camera!==before.camera,'城市标签拖动旋转正常 '+width);
  check((await state()).projection===before.projection,'拖动不移动地球的页面位置 '+width);
  await p.locator('#resetGlobe').click();await settle();
  check((await state()).camera===before.camera,'重置视角正常 '+width);
  if(width>950){
  const city=await label.innerText();let selections=0;
  p.on('request',r=>{if(r.url().includes('/api/v1/destinations?key='))selections++;});
  await label.click();await p.waitForFunction(name=>document.querySelector('.city-name')?.textContent===name,city);await settle();await p.waitForTimeout(150);
  check(selections===1,'点击城市只选择一次 '+width);
  }
  const distance=+(await state()).distance;await p.locator('#zoomInGlobe').click();await settle();
  check(+(await state()).distance<distance,'缩放正常 '+width);
  await p.screenshot({path:resolve(out,`rotation-only-${width}.png`)});await context.close();
 }
 check(errors.length===0,'无脚本错误');check(writes.length===0,'无业务写请求');
}finally{await writeFile(resolve(out,'rotation-verification.json'),JSON.stringify({checks,errors,writes},null,2));await browser.close();}
console.log(JSON.stringify({passed:checks.length,errors,writes}));
