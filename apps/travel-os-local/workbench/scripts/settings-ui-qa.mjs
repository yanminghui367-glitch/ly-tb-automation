// Settings visual and interaction checks. Production writes are never forwarded.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyKernel} from '../kernel-integrity.mjs';
const base='http://127.0.0.1:4318',out=resolve(import.meta.dirname,'../../output/playwright/settings-20260925');
await mkdir(out,{recursive:true});
const before=await fetch(base+'/api/os/state').then(r=>r.json());
const checks=[],errors=[],writes=[];
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1672,height:941},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
 await context.route('**/api/**',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/travel-os.html#settings');await page.locator('#settingsForm').waitFor();await page.evaluate(()=>document.fonts.ready);
 check(await page.locator('#settingsService').innerText()==='已连接','Live service responds and page renders');
 check(await page.locator('#page-settings').innerText().then(t=>t.includes('127.0.0.1:4318')&&!t.includes('localhost:4318')),'Service uses current visit host');
 await page.screenshot({path:out+'/desktop.png'});
 const panelBoxes=await page.locator('.settings-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};}));
 check(panelBoxes[1].top>panelBoxes[0].bottom,'Runtime card is below source card');
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:width===390?844:941});
  if(width===390)await page.evaluate(()=>{localStorage.setItem('travel-os:sidebar-expanded','false');});
  if(width===390){await page.reload();await page.locator('#settingsForm').waitFor();await page.evaluate(()=>document.fonts.ready);}
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}px`);
  if(width===390||width===1440)await page.screenshot({path:out+`/width-${width}.png`,fullPage:true});
 }
 await context.close();
 // Isolated API projection exercises controls without modifying actual settings or browser.
 const state=structuredClone(before);state.engine.configuration=null;state.engine.browser={...state.engine.browser,loggedIn:false,label:'需要登录'};
 for(const [key,value]of Object.entries({heat:'D:\\TravelOS\\data\\热度.xlsx',pool:'D:\\TravelOS\\data\\商品资料.xlsx',assets:'D:\\TravelOS\\images',sheet:'Sheet1'}))state.engine.settings[key]=value;
 state.engine.settings.executionEnabled=false;
 let failSave=false,delaySave=false,failState=false;
 const mock=await browser.newContext({viewport:{width:1672,height:941}});
 await mock.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
 await mock.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  const json=(body,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path.endsWith('/events'))return;
  if(r.request().method()==='GET'){
   if(path==='/api/os/state')return failState?r.abort():json(state);
   if(path==='/api/v1/state')return json(state.engine);
   return r.continue();
  }
  writes.push({path,input:r.request().postDataJSON()});
  if(path==='/api/v1/settings'){
   if(delaySave)await new Promise(resolve=>setTimeout(resolve,350));
   if(failSave)return json({error:'路径暂时无法保存，请重试'},400);
   Object.assign(state.engine.settings,r.request().postDataJSON());return json(state.engine.settings);
  }
  if(path==='/api/v1/import')return json({tasks:[{id:'isolated'}],excluded:[{reason:'隔离校验示例'}]});
  if(path==='/api/v1/check'){state.engine.configuration={at:new Date().toISOString(),checks:[{name:'商品 Excel',ok:false,detail:'路径不存在或当前无法访问'}]};return json(state.engine.configuration);}
  if(path==='/api/v1/browser')return json({ok:true});
  return json({error:'QA blocked unrecognized write'},403);
 });
 const p=await mock.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/travel-os.html#settings');await p.locator('#settingsForm').waitFor();await p.evaluate(()=>document.fonts.ready);
 check(await p.locator('#settingsEnvironment').innerText()==='待检查','Unknown configuration does not claim success');
 await p.screenshot({path:out+'/reference-state.png'});
 await p.locator('#settings-heat').fill('D:\\new.xlsx');
 await p.locator('#settingsImport').click();
 check(writes.length===0,'Unsaved paths cannot import stale saved settings');
 check((await p.locator('#settingsFeedback').innerText()).includes('尚未保存'),'Unsaved warning visible');
 await p.locator('[data-action="settings-source"][data-key="assets"]').click();
 check(await p.locator('#settingsSourceForm a').getAttribute('target')==='_blank','Upload opens existing flow without losing settings draft');
 await p.locator('[name="sourcePath"]').fill('D:\\new-images');await p.locator('#settingsSourceForm button[type="submit"]').click();
 check(await p.locator('#settings-assets').inputValue()==='D:\\new-images','Source dialog writes into draft only');
 failSave=true;await p.locator('#settingsSave').click();await p.getByRole('alert').filter({hasText:'路径暂时无法保存'}).first().waitFor();
 check(await p.locator('#settings-heat').inputValue()==='D:\\new.xlsx','Save failure preserves entered paths');
 failSave=false;delaySave=true;await p.locator('#settingsSave').click();
 await p.locator('#settingsSave:disabled').waitFor();check(await p.locator('#settingsImport').isDisabled(),'Save in progress prevents competing writes');
 await p.locator('#settingsSave:not(:disabled)').waitFor();
 check(state.engine.settings.heat==='D:\\new.xlsx'&&state.engine.settings.assets==='D:\\new-images','Saved values are sent to existing settings API');
 await p.locator('#settingsImport').click();await p.locator('#settingsImport:not(:disabled)').waitFor();
 check((await p.locator('#settingsFeedback').innerText()).includes('1 条进入本次预览'),'Import result is visible');
 await p.locator('[data-action="settings-check"]').click();await p.locator('[data-action="settings-check"]:not(:disabled)').waitFor();
 check(await p.locator('#settingsEnvironment').innerText()==='有项目待处理','Failed configuration does not show green success');
 await p.locator('.settings-checks summary').click();check(await p.locator('#settingsChecksBody').isVisible(),'Check details expandable');
 await p.locator('[data-action="settings-browser"]').click();await p.locator('[data-action="settings-browser"]:not(:disabled)').waitFor();
 check((await p.locator('#settingsFeedback').innerText()).includes('工作台主机'),'Browser feedback identifies host computer');
 await p.locator('[data-action="execution-setting"]').click();check(await p.locator('#permitForm').isVisible(),'Execution permission retains explicit shop confirmation');await p.locator('#closeEditor').click();
 await p.locator('#settings-sheet').fill('draft-sheet');await p.getByRole('link',{name:'产品库',exact:true}).click();await p.getByRole('link',{name:'资料设置',exact:true}).click();
 check(await p.locator('#settings-sheet').inputValue()==='draft-sheet','Navigation preserves unsaved draft');
 await p.screenshot({path:out+'/validation-state.png'});
 failState=true;await mock.setOffline(true);await p.locator('#reconnect').evaluate(el=>el.click());
 await p.waitForFunction(()=>document.getElementById('settingsService').textContent==='连接中断');
 check(await p.locator('#settingsService').innerText()==='连接中断','Disconnection updates service status');
 check(await p.locator('#settingsSave').isDisabled(),'Disconnection disables writes');
 check(await p.locator('#settings-sheet').inputValue()==='draft-sheet','Disconnection preserves draft');
 await p.screenshot({path:out+'/offline.png'});
 await mock.close();
 const after=await fetch(base+'/api/os/state').then(r=>r.json());
 check(JSON.stringify(before.engine.settings)===JSON.stringify(after.engine.settings),'Real settings unchanged');
 check(before.engine.records.length===after.engine.records.length&&before.engine.active===after.engine.active,'Real records and active execution unchanged');
 check((await verifyKernel()).ok,'Frozen execution kernel intact');
 check(errors.length===0,'No page JavaScript errors');
 await writeFile(out+'/verification.json',JSON.stringify({checks,errors,isolatedWriteCount:writes.length,productionWrites:0},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,out}));
}finally{await browser.close();}
