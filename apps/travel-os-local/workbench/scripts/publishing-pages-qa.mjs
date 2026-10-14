// Real headed Chrome, disposable profile, all requests fulfilled with synthetic
// fixtures. Never connects to 9222, loads production data, or contacts Taobao.
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createBackgroundPage,getAuxiliaryPage,assertAuxiliaryPage} from '../publishing-pages.mjs';
import {openTaskPage,verifyResult} from '../taobao-publisher.mjs';
import {inspectExistingListing} from '../result-reconciliation.mjs';
import {uploadMaterial} from '../publishing-materials.mjs';
import {visibleChallenge} from '../browser-environment.mjs';
const output=resolve(import.meta.dirname,'../../output/playwright/browser-stability-20261007');await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'ly-quiet-browser-')),token='LYQuiet-'+Date.now(),checks=[],observations=[];
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:null});
const exec=promisify(execFile),materialUrl='https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu',listUrl='https://myseller.taobao.com/home.htm/SellManage/all',formUrl='https://item.upload.taobao.com/sell/v2/publish.htm';
const task={shopId:'test-shop',listing:{title:'合成东京测试商品'},business:{shop_name:'合成测试店',price_cny:20,inventory:999}};
const check=(name)=>checks.push({name,passed:true});
const materialHTML=`<title>${token}-material</title><div class="shopName--x6nyUylx">合成测试店</div><button onclick="const d=document.querySelector('[role=dialog]');d.hidden=false;d.querySelector('input[type=file]').value='';document.getElementById('receipt').textContent='0 个文件上传中';">上传文件</button><section role="dialog" aria-label="上传素材" hidden><label><input type="checkbox">添加水印</label><label><input type="checkbox" checked>原图上传</label><label><input type="checkbox">上传后自动关闭</label><input type="file" onchange="window.uploads=(window.uploads||0)+1;document.getElementById('receipt').textContent='1 个文件上传成功'"><p id="receipt"></p><button onclick="this.closest('section').hidden=true">完成</button></section>`;
try{
 await context.route('**/*',async r=>{
  const u=new URL(r.request().url());let body;
  if(u.hostname==='fixture.test')body=`<title>${token}-observer</title><h1>前台观察页：执行期间应保持本页</h1><p>独立测试，无真实商品操作</p>`;
  else if(u.hostname==='upload.taobao.com')body=`<title>${token}-category</title><span>其它商品定制</span><button onclick="location.href='${formUrl}'">确认，下一步</button>`;
  else if(u.hostname==='item.upload.taobao.com')body=`<title>${token}-form</title><div class="UserArea_shopName__3xGhm">合成测试店</div><div id="sell-field-title"><input></div>`;
  else if(u.hostname==='qn.taobao.com')body=materialHTML;
  else if(u.hostname==='myseller.taobao.com')body=`<title>${token}-verification</title><div class="shopName--x6nyUylx">合成测试店</div><button role="tab">全部(1)</button><input id="queryTitle"><input id="queryItemId"><button>搜索</button><table><thead><tr><th>商品名称</th><th>价格</th><th>库存</th><th>创建时间</th></tr></thead><tbody><tr><td>${task.listing.title}<br>ID:123456789<br>出售中</td><td>20.00</td><td>999</td><td>2026-10-07 20:00:10</td></tr></tbody></table>`;
  else throw Error('unexpected fixture host');
  await r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'+body});
 });
 const front=context.pages()[0];await front.goto('https://fixture.test/observer');await front.bringToFront();
 const session=await context.newCDPSession(front);const {targetInfo}=await session.send('Target.getTargetInfo');
 const bounds=(await session.send('Browser.getWindowForTarget',{targetId:targetInfo.targetId})).bounds;
 // Playwright emulates focus on every attached tab; visibilityState alone is
 // not an active-tab oracle. Check the actual Windows Chrome window title.
 const observe=async label=>{
  const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',`Get-Process chrome | Where-Object {$_.MainWindowTitle -like '${token}*'} | Select-Object -ExpandProperty MainWindowTitle`],{windowsHide:true});
  const titles=stdout.trim().split(/\r?\n/).filter(Boolean);assert.equal(titles.length,1);assert(titles[0].startsWith(token+'-observer'));
  assert.deepEqual((await session.send('Browser.getWindowForTarget',{targetId:targetInfo.targetId})).bounds,bounds);
  observations.push({label,windowTitle:titles[0],bounds,tabCount:context.pages().length});
 };
 await observe('baseline');
 let form;const checkpoint={};form=await openTaskPage(context,task,{},async()=>{},p=>Object.assign(checkpoint,p));
 assert.equal(await form.locator('#sell-field-title input').inputValue(),task.listing.title);await observe('new-form');check('后台创建发布页并填写标题，前台与窗口尺寸不变');
 const same=await openTaskPage(context,task,checkpoint,async()=>{},()=>{});assert.equal(same,form);check('恢复准确复用原表单，不新开页');
 const materialGuard=async p=>{if(await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');assertAuxiliaryPage(p,'material');assert.equal(await p.locator('.shopName--x6nyUylx').innerText(),task.business.shop_name,'WRONG_SHOP');};
 const args={role:'material',shopId:task.shopId,url:materialUrl+'?spm=first',guard:materialGuard};
 const library=await getAuxiliaryPage(context,args);
 for(let i=0;i<12;i++){
  const dialog=await uploadMaterial(library,{name:'test-'+i+'.png',mimeType:'image/png',buffer:Buffer.from('fixture-only')},()=>materialGuard(library));await dialog.getByRole('button',{name:'完成',exact:true}).click();
 }
 assert.equal(await library.evaluate(()=>window.uploads),12);await library.screenshot({path:join(output,'background-material.png')});await observe('12-background-uploads');check('12次原生文件控件合成上传、截图均不切页');
 const n=context.pages().length;
 for(let i=0;i<100;i++)assert.equal(await getAuxiliaryPage(context,{...args,url:materialUrl+'?spm='+i}),library);
 assert.equal(context.pages().length,n);await observe('100-role-reuses');check('100次不同跟踪参数请求只复用同一素材页');
 const guard=async p=>{if(p&&await visibleChallenge(p))throw Error('PAUSED_CAPTCHA');if(p)assert.equal(await p.locator('.shopName--x6nyUylx').innerText(),task.business.shop_name);};
 const result=await verifyResult(context,task,'123456789','SOURCE',output+sep,guard);assert.equal(result.itemId,'123456789');await observe('verify-result');check('平台核验流程的合成页仍验证标题价格库存，不切前台');
 const beforeReconcile=context.pages().length;
 await inspectExistingListing({context,task,itemId:'123456789',target:'SOURCE',dir:output,guard,window:{from:Date.parse('2026-10-07T20:00:00+08:00'),to:Date.parse('2026-10-07T20:01:00+08:00')}});
 assert.equal(context.pages().length,beforeReconcile);await observe('reconciliation');check('人工关联核验共用同一核验页');
 await library.locator('.shopName--x6nyUylx').evaluate(e=>e.textContent='其他店铺');await assert.rejects(getAuxiliaryPage(context,args),/WRONG_SHOP/);check('错误店铺停止操作');
 await library.locator('.shopName--x6nyUylx').evaluate(e=>e.textContent='合成测试店');await library.locator('body').evaluate(e=>e.insertAdjacentHTML('beforeend','<p id="risk">安全验证</p>'));
 await assert.rejects(getAuxiliaryPage(context,args),/PAUSED_CAPTCHA/);assert.equal(await library.evaluate(()=>window.uploads),12);await library.locator('#risk').evaluate(e=>e.remove());check('辅助页验证码会停止，不继续上传');
 await library.goto('https://fixture.test/manual');const count=context.pages().length;await assert.rejects(getAuxiliaryPage(context,args),/地址改变/);assert.equal(library.url(),'https://fixture.test/manual');assert.equal(context.pages().length,count);check('用户导航离开辅助页时暂停，不覆盖页面');
 await library.close();const replacement=await getAuxiliaryPage(context,args);assert.notEqual(replacement,library);await observe('closed-helper-recreated');check('关闭辅助页后重新绑定新页并核验身份');
 const duplicate=await createBackgroundPage(context);await duplicate.goto(formUrl);await duplicate.locator('#sell-field-title input').fill(task.listing.title);
 await assert.rejects(openTaskPage(context,task,checkpoint,async()=>{},()=>{}),/无法唯一识别/);check('两个相同任务标题的发布页阻塞恢复，不猜页面');
 await front.screenshot({path:join(output,'observer-after.png')});await observe('final');await session.detach();
 await writeFile(join(output,'result.json'),JSON.stringify({checks,observations,productionActions:0,focusOracle:'Windows Chrome MainWindowTitle (Playwright emulates page visibility)',profile},null,2));
 console.log(JSON.stringify({passed:checks.length,output}));
}finally{await context.close();}
