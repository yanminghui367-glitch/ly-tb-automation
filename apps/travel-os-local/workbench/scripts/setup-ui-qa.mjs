import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {fixture,shop} from './setup-fixture.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';
const x=await fixture(),out=resolve('../output/playwright/setup-20261006');await mkdir(out,{recursive:true});
const shops=[shop],os=new TravelOsApi({product:async()=>x.p,shops:async()=>shops,browser:x.owner,runtime:x.dir,launch:async()=>{throw Error('QA禁止连接真实浏览器');},addShop:async()=>{throw Error('QA不新增真实店铺');}});
x.p.launch=async()=>{x.setLogin(true);return {running:true};};
const body=async req=>{let raw='';for await(const part of req)raw+=part;return JSON.parse(raw||'{}');};
const json=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const handler=createStaticHandler(resolve('.')),requests=[];
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');requests.push({method:req.method,path:url.pathname});if(url.pathname==='/api/os/state')return json(res,200,{...await os.snapshot(),testMode:true});if(url.pathname.startsWith('/api/os/'))return await os.handle(req,res,url,{body,json});if(url.pathname.startsWith('/api/v1/'))return await x.p.handle(req,res,url,{body,json});await handler(req,res);}catch(e){json(res,e.statusCode||409,{error:e.message});}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
const check=(ok,name)=>{assert(ok,name);checks.push(name);};
const action=(name)=>page.locator(`[data-setup="${name}"]`).first();
const waitIdle=()=>page.waitForFunction(()=>document.querySelector('.setup-content')?.getAttribute('aria-busy')==='false');
let storage=join(x.dir,'selected-drive');try{await stat('D:/');storage='D:/TravelOS-Setup-QA-'+randomUUID();}catch{}
try{
 await page.goto(base+'/travel-os.html#settings');await page.locator('#setupStorage').waitFor();await waitIdle();
 check(await page.locator('#checkBrowser').isHidden(),'资料设置隐藏重复的顶部登录按钮');
 await page.screenshot({path:join(out,'01-storage.png'),fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'下载固定模板'}).count().then(async n=>{if(!n){await action('skip-storage').click();}await page.getByRole('link',{name:'下载固定模板'}).click();});const file=await download;await file.saveAs(join(out,'downloaded-template.zip'));check((await readFile(join(out,'downloaded-template.zip'))).equals(await readFile('templates/travel-os-template-v1.zip')),'网页下载模板与发布模板一致');
 await page.locator('[data-setup=step][data-step="1"]').click();await page.locator('#setupStorage').fill(storage);await action('save-storage').click();await page.locator('#setupFormat').waitFor();await waitIdle();
 await action('upload').click();await page.locator('#setupFolder').setInputFiles(x.sourceRoot);await action('import').click();await page.locator('#setupLoginState').waitFor();await waitIdle();
 const state=await x.p.setup.state(),settings=await x.p.settings();check(resolve(settings.assets).startsWith(resolve(storage)),'Excel与图片实际写入所选存储位置');check(state.source.summary.total===2&&state.source.summary.secondary===8&&state.source.summary.covers===2,'导入全量数量与模板图片分组正确');
 check(await page.locator('[data-setup=connect]').count()===1,'登录步骤只有一个连接店铺入口');
 await page.screenshot({path:join(out,'02-login-required.png'),fullPage:true});
 await action('next').click();await action('check').click();await waitIdle();check(await page.locator('.setup-check.bad').count()>0,'登录未完成时检查失败并直接展开原因');await page.screenshot({path:join(out,'03-check-failed.png'),fullPage:true});
 await page.locator('[data-setup=step][data-step="3"]').click();await action('connect').click();await waitIdle();check((await page.locator('#setupLoginState').innerText()).includes('已登录'),'模拟登录身份匹配后状态更新');await action('next').click();await action('check').click();await waitIdle();check((await page.locator('#setupStepTitle').innerText()).includes('通过'),'已完整核对资料和店铺后显示准备检查通过');
 check((await x.p.settings()).executionEnabled===false&&x.store.list().length===0&&x.store.db.prepare('SELECT COUNT(*) n FROM batches').get().n===0,'准备检查没有开启执行或创建上架任务');
 await page.screenshot({path:join(out,'04-ready-desktop.png'),fullPage:true});
 x.setLogin(false);await page.waitForFunction(()=>document.querySelector('#setupStepTitle')?.textContent.includes('连接已变化'));check(await page.locator('.setup-content a[href="#tasks"]').isHidden(),'登录失效后撤下准备通过与任务入口');check((await page.locator('[data-report-login]').innerText()).includes('需复查'),'历史绿色店铺结果在登录失效后提示复查');
 await page.locator('[data-setup=step][data-step="3"]').click();await action('connect').click();await waitIdle();await action('next').click();await action('check').click();await waitIdle();
 await page.reload();await page.getByRole('heading',{name:'准备检查已通过'}).waitFor();check(true,'刷新后恢复已保存的资料与检查状态');
 await action('guide').click();check((await page.locator('.setup-guide').innerText()).includes('安装工作台.cmd'),'新电脑教程包含安装启动至任务核对的完整路径');await page.locator('.setup-folder-dialog').getByRole('button',{name:'知道了'}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'05-ready-mobile.png'),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'390px页面无横向溢出');
 await page.locator('[data-setup=step][data-step="2"]').click();await page.screenshot({path:join(out,'06-import-mobile.png'),fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'手机导入步骤无横向溢出');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(out,'07-import-desktop.png'),fullPage:true});
 check(errors.length===0,'浏览器脚本错误为0');check(requests.filter(r=>r.method==='POST').every(r=>/^\/api\/v1\/(setup\/|browser$)/.test(r.path)),'本轮浏览器仅操作隔离配置与模拟登录接口');
 await writeFile(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,storage,settings:{assets:settings.assets},requests,realSellerAccess:false},null,2));console.log(JSON.stringify({passed:checks.length,errors,storage}));
}catch(e){await page.screenshot({path:join(out,'failure.png'),fullPage:true});throw e;}
finally{await context.close();await browser.close();x.p.closeStreams();os.store.close();x.store.close();await new Promise(done=>server.close(done));if(resolve(storage).startsWith(resolve('D:/TravelOS-Setup-QA-'))&&storage!=='D:/')await rm(storage,{recursive:true,force:true});if(resolve(x.dir).startsWith(resolve('../output/setup-20261006/tests/travel-setup-')))await rm(x.dir,{recursive:true,force:true});}
