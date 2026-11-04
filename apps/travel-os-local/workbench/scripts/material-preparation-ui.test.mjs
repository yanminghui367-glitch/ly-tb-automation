import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {createStaticHandler} from '../static-files.mjs';

test('website prepares images only, persists a lost resume request across refresh, and renders desktop/mobile without publishing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'material-ui-')),store=new SourceStore(':memory:'),shop={id:'wuzhou-changyou',name:'隔离图片准备店'};
 const tasks=[1,2].map(n=>({shopId:shop.id,listing:{type:'country',country:'测试国家'+n,title:'隔离商品'+n},business:{shop_name:shop.name,price_cny:20,inventory:100},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
 const imported=store.imported({sourceHash:'MATERIAL_UI_FIXTURE',tasks,summary:{total:2}}),flow={store,runtime:dir,artifacts:dir,active:null,preflight:async()=>{},launch(){throw Error('No executor allowed');}},owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
 const product=new ProductApi({source:flow,batch:new BatchWorkflow(flow),owner,shop,runtime:dir,integrity:async()=>({ok:true,revision:'ISOLATED'}),checkFiles:async()=>{},launch:async()=>{throw Error('No browser execution');}});
 await product.round.create({importId:imported,repairVersion:'ISOLATED',expectedCount:2,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:2}});
 const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime:dir});const fixture=await os.snapshot(),r=fixture.engine.round;Object.assign(r,{state:'STOPPED',active:false,current:null,window:{id:'w',sequence:1,state:'STOPPED',finished:new Date().toISOString(),total:2,ended:0,counts:{PENDING:2},submitted:0,resumedCount:0},windowHistory:[]});
 const root=resolve(import.meta.dirname,'..'),serve=createStaticHandler(root),writes=[],errors=[],streams=new Set(),controls=new Map();let job=null,failGets=0,pollMarkerPending=false,rejectResume=false,recheckFound=false;
 const plan={shopId:shop.id,roundId:r.id,planHash:'a'.repeat(64),selectedCount:2,excludedCount:0,totalImages:3,uniqueImages:2,items:[{position:1,destination:'测试国家1'},{position:2,destination:'测试国家2'}],excluded:[]};
 const json=(res,value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(req.method==='POST'){
   let text='';for await(const b of req)text+=b;const input=JSON.parse(text||'{}');writes.push({path:u.pathname,input});
   if(u.pathname==='/api/v1/material-preparation/preview')return json(res,plan);
   if(u.pathname==='/api/v1/material-preparation/start'){job={id:'b'.repeat(32),shopId:shop.id,roundId:r.id,planHash:plan.planHash,requestId:input.requestId,state:'RUNNING',active:true,executionStarted:false,reason:'详情图片仍等待上传回执，请查看逐图处理结果',counts:{SUCCEEDED:1,PENDING:1,FAILED:0,UPLOAD_UNKNOWN:0},files:[{name:'主图.png',state:'SUCCEEDED'},{name:'详情.png',state:'PENDING'}]};return json(res,job);}
   if(u.pathname==='/api/v1/material-preparation/pause'){job.state='PAUSED';job.active=false;controls.set(input.requestId,{requestId:input.requestId,accepted:true,action:'pause'});return json(res,job);}
   if(u.pathname==='/api/v1/material-preparation/resume'){
    if(rejectResume){job.state='ATTENTION_REQUIRED';job.active=false;job.scopeCurrent=false;job.counts={SUCCEEDED:0,UPLOAD_UNKNOWN:1,PENDING:1,FAILED:0};job.files[0].state='UPLOAD_UNKNOWN';job.reason='原商品范围状态已变化，请只读核查原上传结果';controls.set(input.requestId,{requestId:input.requestId,accepted:false,action:'resume',reason:'原商品范围已变化，不能继续旧上传'});return json(res,{error:'原商品范围已变化，不能继续旧上传'},409);}
    job.state='RUNNING';job.active=true;controls.set(input.requestId,{requestId:input.requestId,accepted:true,action:'resume'});failGets=1;res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
   if(u.pathname==='/api/v1/material-preparation/recheck'){controls.set(input.requestId,{requestId:input.requestId,accepted:true,action:'recheck'});if(recheckFound){job.state='PAUSED';job.counts={SUCCEEDED:1,UPLOAD_UNKNOWN:0,PENDING:1,FAILED:0};job.files[0].state='SUCCEEDED';job.reason='原上传图片已核查，剩余图片未继续上传';}else job.reason='只读核查尚未找到唯一图片，原上传结果仍待人工确认';return json(res,job);}
   if(u.pathname==='/api/v1/material-preparation/cancel'){controls.set(input.requestId,{requestId:input.requestId,accepted:true,action:'cancel'});job.stopRequested='CANCELLED';job.state=job.counts.UPLOAD_UNKNOWN?'ATTENTION_REQUIRED':'CANCELLED';return json(res,job);}
   return json(res,{error:'Fixture forbids any other write'},409);
  }
  if(u.pathname==='/api/os/state'){fixture.engine.materialPreparation=job;return json(res,fixture);}
  if(u.pathname==='/api/v1/state')return json(res,{...fixture.engine,materialPreparation:job});
  if(u.pathname==='/api/v1/material-preparation'){if(failGets>0){failGets--;return json(res,{error:'模拟回执暂不可读'},503);}if(pollMarkerPending&&u.searchParams.has('id')&&!u.searchParams.has('controlRequestId')){job.reason='当前图片状态已重新读取，原操作回执仍需核对';pollMarkerPending=false;}return json(res,job?{...job,...(u.searchParams.has('controlRequestId')?{controlReceipt:controls.get(u.searchParams.get('controlRequestId'))||null}:{})}:null);}
  if(u.pathname==='/api/v1/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(':fixture\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
  if(u.pathname.startsWith('/api/'))return json(res,{});
  await serve(req,res);
 }catch(error){json(res,{error:error.message},500);}});
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await page.goto(base+'/travel-os.html#tasks');await page.getByRole('button',{name:'准备本轮图片',exact:true}).click();await page.getByRole('button',{name:'检查图片范围',exact:true}).click();await page.getByRole('button',{name:'确认并准备图片',exact:true}).click();assert.equal(writes.filter(x=>x.path.endsWith('/start')).length,0);assert.equal(await page.locator('#editorError').innerText(),'请先核对店铺与范围并勾选确认');
  await page.locator('[data-material-confirm]').check();await page.getByRole('button',{name:'确认并准备图片',exact:true}).click();await page.locator('[data-material-preparation-job]').waitFor();assert.equal(writes.filter(x=>x.path.endsWith('/start')).length,1);assert.equal(await page.locator('#editorError').innerText(),'','accepted preparation clears obsolete form validation');assert.match(await page.locator('[data-material-preparation-job]').innerText(),/详情图片仍等待上传回执/,'current job diagnostic remains visible');
  const out=resolve(root,'../..','ui-self');await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'material-preparation-desktop.png')});
  await page.getByRole('button',{name:'暂停图片准备',exact:true}).click();await page.getByRole('button',{name:'核对并继续未完成图片',exact:true}).waitFor();await page.getByRole('button',{name:'核对并继续未完成图片',exact:true}).click();await page.locator('[data-material-control-reconcile]').waitFor();const resume=writes.filter(x=>x.path.endsWith('/resume'));assert.equal(resume.length,1);const controlError=await page.locator('#editorError').innerText();assert.match(controlError,/回执暂未确认/);pollMarkerPending=true;await page.getByRole('button',{name:'刷新图片进度',exact:true}).click();await page.getByText('当前图片状态已重新读取，原操作回执仍需核对',{exact:true}).waitFor();assert.equal(await page.locator('#editorError').innerText(),controlError,'normal job polling preserves an unresolved control error');
  await page.reload();await page.getByRole('button',{name:'查看图片准备进度',exact:true}).click();await page.locator('[data-material-control-reconcile]').waitFor();await page.locator('[data-material-control-reconcile]').click();await page.waitForFunction(()=>document.querySelector('[data-material-control-reconcile]')===null);assert.equal(writes.filter(x=>x.path.endsWith('/resume')).length,1,'lost response reconciles GET receipt, no second action');
  job.state='PAUSED';job.active=false;job.scopeCurrent=undefined;rejectResume=true;await page.reload();await page.getByRole('button',{name:'查看图片准备进度',exact:true}).click();await page.getByRole('button',{name:'核对并继续未完成图片',exact:true}).click();await page.getByRole('button',{name:'只读核查上传结果',exact:true}).waitFor();assert.match(await page.locator('#editorError').innerText(),/原商品范围已变化/);
  await page.getByRole('button',{name:'只读核查上传结果',exact:true}).click();await page.getByText('只读核查尚未找到唯一图片，原上传结果仍待人工确认',{exact:true}).waitFor();assert.equal(await page.locator('#editorError').innerText(),'','successful read-only action clears the old rejected resume feedback');assert.match(await page.locator('[data-material-preparation-job]').innerText(),/结果未确认 1 张/);
  await page.getByRole('button',{name:'取消剩余准备',exact:true}).click();assert.equal(job.state,'ATTENTION_REQUIRED');await page.getByRole('button',{name:'只读核查上传结果',exact:true}).waitFor();await page.screenshot({path:join(out,'material-recheck-unknown.png')});
  recheckFound=true;await page.getByRole('button',{name:'只读核查上传结果',exact:true}).click();await page.getByText('原上传图片已核查，剩余图片未继续上传',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'核对并继续未完成图片',exact:true}).count(),0,'stale scope never offers old upload resume');assert.match(await page.locator('[data-material-preparation-job]').innerText(),/尚未上传 1 张/);await page.screenshot({path:join(out,'material-recheck-confirmed.png')});
  await page.getByRole('button',{name:'取消剩余准备',exact:true}).click();await page.getByRole('button',{name:'重新预览当前范围',exact:true}).click();await page.getByRole('button',{name:'检查图片范围',exact:true}).waitFor();assert.equal(writes.filter(x=>x.path==='/api/v1/material-preparation/start').length,1,'recheck and replan never start a second upload');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'material-preparation-mobile.png')});assert.deepEqual(errors,[]);assert(writes.every(x=>x.path.startsWith('/api/v1/material-preparation/')),'zero product start/resume/submit requests');
 }finally{await browser?.close();for(const stream of streams)stream.end();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});store.close();os.store.close();await rm(dir,{recursive:true,force:true});}
});
