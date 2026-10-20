// Isolated browser UI verification. Temporary databases and a random local port only.
// The fixture never launches an executor or contacts the production service.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {chromium} from 'playwright';
import {createStaticHandler} from '../static-files.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.env.QA_OUTPUT_DIR||join(root,'output/sidebar-orb-ui'));
await mkdir(out,{recursive:true});
const runtime=await mkdtemp(join(out,'fixture-')),store=new SourceStore(':memory:');
const shop={id:'wuzhou-changyou',name:'执行监控隔离测试店'};
const tasks=[1,2].map(n=>({shopId:shop.id,priority:n,source:{sheet:'隔离测试',row:n+1},listing:{type:'city',country:'测试国家',city:'测试城市'+n,title:'测试商品'+n},business:{shop_name:shop.name,price_cny:20,inventory:10},assets:{main:[],secondary:[],details:[]},adapterIssues:[]}));
const importId=store.imported({sourceHash:'MONITOR_UI_ONLY',tasks,summary:{total:2}});
const flow={store,runtime,artifacts:runtime,active:null,preflight:async()=>{},launch(){throw Error('No executor allowed in UI fixture');}};
const owner={sessions:new Map(),status:async()=>({running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date().toISOString()})};
const product=new ProductApi({source:flow,batch:new BatchWorkflow(flow),owner,shop,runtime,integrity:async()=>({ok:true,files:0,revision:'UI_FIXTURE'}),checkFiles:async()=>{},launch:async()=>{throw Error('No browser execution allowed');}});
await product.round.create({importId,repairVersion:'UI_FIXTURE',expectedCount:2,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:2}});
const os=new TravelOsApi({product:async()=>product,shops:async()=>[shop],browser:owner,runtime});
const snapshot=await os.snapshot();
const checks=[],writes=[],errors=[],streams=new Set();
const check=(ok,label)=>{checks.push({ok:!!ok,label});console.log((ok?'PASS ':'FAIL ')+label);assert.ok(ok,label);};
let fixture=structuredClone(snapshot),logFail=false,logDelay=null;
const r=fixture.engine.round;
Object.assign(r,{id:'ui-round',manifestHash:'ui-manifest',shop:fixture.engine.shop.id,state:'WAITING_HUMAN',active:false,reason:'PAUSED_CAPTCHA',executionRecovery:null,verificationControl:null,processed:259,total:700,currentItem:'current-key',current:{key:'current-key',destination:'当前测试城市',stage:'existing-listing-query',runId:'current-run',state:'WAITING_HUMAN',submitted:false,submissionUncertain:false,reason:'PAUSED_CAPTCHA'},window:{id:'ui-window',sequence:3,state:'WAITING_HUMAN',total:100,ended:59,submitted:40,resumedCount:1,counts:{NEW_SUCCESS:40,PREFLIGHT_SKIPPED:19,PENDING:41},autoContinue:false},windowHistory:[]});
fixture.engine.active=null;fixture.engine.execution={state:'PAUSED',label:'已暂停',detail:'旧批次提示不应进入监控'};
fixture.engine.batch ||= {id:'fixture-batch',counts:{FAILED:0,RETRY:0},elapsedMs:0,items:tasks.map(task=>({task,shopId:shop.id,title:task.listing.title}))};
fixture.engine.batch.items=fixture.engine.batch.items.slice(0,2).map((x,i)=>({...x,id:'history-'+i,runId:'history-run-'+i,destination:'历史测试城市'+i,title:'历史任务 '+i,state:'SKIPPED',displayState:'SKIPPED',roundHold:false,candidateHold:false,contentHold:false,issue:null,reason:'历史原因',kind:'execution'}));
fixture.engine.batch.current='history-0';fixture.engine.batch.state='PAUSED';fixture.engine.batch.failureBlocked=false;
fixture.preparations=[];fixture.engine.pageManagement=null;fixture.engine.settings.executionEnabled=true;
const serve=createStaticHandler(join(root,'workbench'));
const json=(res,x)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(x));};
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(req.method!=='GET'){let body='';for await(const x of req)body+=x;writes.push({path:url.pathname,input:JSON.parse(body||'{}')});return json(res,{accepted:true});}
 if(url.pathname==='/api/os/state')return json(res,fixture);
 if(url.pathname==='/api/v1/state')return json(res,fixture.engine);
 if(url.pathname==='/api/v1/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
 if(url.pathname==='/api/v1/rounds/window')return json(res,{id:r.window.id,shop:shop.id,roundId:r.id,items:[]});
 if(url.pathname==='/api/v1/task'){const id=url.searchParams.get('id');if(logDelay&&id==='current-run')await logDelay;if(logFail){res.writeHead(500);return res.end('{"error":"isolated log failure"}');}return json(res,{id,events:[{at:new Date().toISOString(),label:id==='current-run'?'当前商品日志':'所选历史商品日志',kind:'STEP_INTENT',technical:{step:'attribute-style'},reason:''}],checkpoint:{step:'attribute-style'}});}
 if(url.pathname.startsWith('/api/'))return json(res,{});
 await serve(req,res);
 }catch(e){res.writeHead(500);res.end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
await context.addInitScript(()=>{const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){this.canvas.__qaDraws=(this.canvas.__qaDraws||0)+1;return draw.apply(this,args);};});
await context.addInitScript(()=>localStorage.setItem('travel-os:sidebar-expanded','true'));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const emit=async()=>{fixture.engine.at=new Date().toISOString();for(const res of streams)res.write('event: state\ndata: '+JSON.stringify(fixture.engine)+'\n\n');await page.waitForTimeout(120);};


const selectors=['[data-execution-orb]','[data-sidebar-execution-orb]'];
const assertState=async expected=>{await page.waitForFunction(({selectors,expected})=>selectors.every(s=>document.querySelector(s)?.dataset.state===expected),{selectors,expected});check(true,'both locations share '+expected+' state');};
try{
 await page.goto(base+'/travel-os.html#tasks');
 for(const selector of selectors)await page.locator(selector+' canvas').waitFor();
 await page.waitForFunction(selectors=>selectors.every(s=>document.querySelector(s+' [data-renderer]')?.dataset.renderer==='webgl'),selectors);
 const canvases=await Promise.all(selectors.map(s=>page.locator(s+' canvas').elementHandle()));
 check(await page.locator('.execution-orb canvas').count()===2,'two independent canvases are mounted');
 for(const [i,s]of selectors.entries()){
  const box=await page.locator(s).boundingBox();check(box.width===110&&box.height===110,'same 110px size at location '+i);
  check(await canvases[i].evaluate(c=>c.__qaDraws>0&&c.width<=165&&c.height<=165),'real GPU drawing and DPR cap at location '+i);
 }
 const nav=await page.locator('#navigation').boundingBox(),sidebarBox=await page.locator(selectors[1]).boundingBox(),footer=await page.locator('.sidebar-bottom').boundingBox();
 check(sidebarBox.y>=nav.y+nav.height&&sidebarBox.y+110<footer.y,'sidebar orb sits below navigation and above footer');
 await page.screenshot({path:join(out,'desktop-both-orbs.png'),fullPage:true});
 for(const [state,active,expected]of [['RUNNING',true,'speaking'],['PAUSING',true,'idle'],['SYSTEM_BLOCKED',false,'idle'],['WAITING_HUMAN',false,'idle'],['COMPLETED',false,'idle'],['RUNNING',false,'idle'],['RUNNING',true,'speaking']]){r.state=state;r.active=active;r.window.state=state;await emit();await assertState(expected);}
 for(let n=0;n<8;n++)await emit();
 for(const [i,s]of selectors.entries())check(await page.locator(s+' canvas').evaluate((c,old)=>c===old,canvases[i]),'SSE redraws retain location '+i+' canvas');
 for(const res of streams)res.write('event: problem\ndata: {}\n\n');await assertState('idle');await emit();await assertState('speaking');
 await page.locator('#navigation a[href="#shops"]').click();await emit();check(await page.locator(selectors[1]).isVisible(),'sidebar orb stays visible on another page');check(await page.locator(selectors[1]+' canvas').evaluate((c,old)=>c===old,canvases[1]),'navigation retains sidebar canvas');
 await page.locator('#navigation a[href="#tasks"]').click();await assertState('speaking');
 await page.locator('#sidebarToggle').click();check(!await page.locator(selectors[1]).isVisible(),'collapsed rail does not crop or overlap the full-size orb');await page.locator('#sidebarToggle').click();check(await page.locator(selectors[1]).isVisible(),'expanding sidebar restores the same orb');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page has no horizontal overflow');await page.locator('#sidebarToggle').click();await page.waitForTimeout(200);check(await page.locator(selectors[1]).isVisible(),'mobile expanded navigation includes the same orb');await page.screenshot({path:join(out,'mobile-sidebar-orb.png'),fullPage:true});
 await page.locator('#sidebarToggle').click();await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(200);if(!await page.locator(selectors[1]).isVisible())await page.locator('#sidebarToggle').click();
 await canvases[0].evaluate(c=>{const ext=c.getContext('webgl').getExtension('WEBGL_lose_context');ext.restoreContext=()=>{};ext.loseContext();});
 await page.waitForFunction(()=>document.querySelector('[data-execution-orb] [data-renderer]')?.dataset.renderer==='fallback');check(await page.locator(selectors[1]+' [data-renderer]').getAttribute('data-renderer')==='webgl','monitor context loss does not break sidebar renderer');
 await page.locator(selectors[1]).evaluate(h=>h.style.display='none');await page.waitForTimeout(200);const draws=await canvases[1].evaluate(c=>c.__qaDraws||0);await page.waitForTimeout(200);check(await canvases[1].evaluate(c=>c.__qaDraws||0)===draws,'hidden sidebar orb stops GPU work');await page.locator(selectors[1]).evaluate(h=>h.style.removeProperty('display'));
 const fallback=await context.newPage();await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'||kind==='webgl2'?null:get.call(this,kind,...args);};});await fallback.goto(base+'/travel-os.html#tasks');await fallback.waitForFunction(selectors=>selectors.every(s=>document.querySelector(s+' [data-renderer]')?.dataset.renderer==='fallback'),selectors);check(true,'both locations expose the same fallback without WebGL');await fallback.close();
 check(writes.length===0,'display-only update sends no business mutation');check(errors.length===0,'no uncaught browser errors');
}catch(e){await page.screenshot({path:join(out,'failure.png'),fullPage:true});throw e;}
finally{await writeFile(join(out,'qa.json'),JSON.stringify({at:new Date().toISOString(),checks,writes,errors,productionRequests:0},null,2));for(const res of streams)res.end();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));os.store.db.close();store.close();}
