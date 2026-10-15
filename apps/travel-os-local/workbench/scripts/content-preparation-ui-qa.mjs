import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {SourceStore,digest} from '../source-store.mjs';
import {SourceWorkflow} from '../source-workflow.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url))),dir=await mkdtemp(join(tmpdir(),'ly-content-browser-'));
const out=join(root,'..','output','content-preparation-20261015','ui');await mkdir(out,{recursive:true});
const store=new SourceStore(join(dir,'state.sqlite')),shop={id:'shop-isolated-review',name:'隔离审核店'};
let server,browser;
try{
 const file=join(dir,'main.png');await writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLa8AAAAASUVORK5CYII=','base64'));
 const tasks=Array.from({length:25},(_,i)=>({shopId:shop.id,taskId:'qa-'+i,priority:i+1,listing:{type:'country',country:'测试目的地'+(i+1),title:'测试目的地'+(i+1)+'导游'},business:{shop_name:shop.name},source:{},assets:{main:[{path:file,sha256:digest(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLa8AAAAASUVORK5CYII=','base64'))}],secondary:[],details:[]},adapterIssues:[]}));
 const importId=store.imported({sourceHash:'isolated-browser',sheet:'境外城市热度',tasks});
 const source={store,runtime:dir,artifacts:join(dir,'tasks'),active:null,checkLiveContent:SourceWorkflow.prototype.checkLiveContent,preflight:async()=>{},launch(){throw Error('ISOLATED_NO_PUBLISH');}},batch=new BatchWorkflow(source);
 const p=batch.preview(importId,2),b=batch.create({importId,limit:2,mode:'LIVE',review:{reviewed:true,selectionHash:p.selectionHash,authorization:'isolated'}},shop),q=batch.store.items(b.id)[0];
 let run;
 for(let n=0;n<3;n++){
  if(n)batch.store.move(q.id,'RETRY');batch.store.claim(q.id);
  if(!n){run=store.create(importId,q.task,'LIVE','SOURCE',{reviewed:true,taskHash:digest(q.task)});batch.store.attach(q.id,run.id);}else store.move(run.id,'QUEUED','操作者请求恢复；重新校验页面');
  store.move(run.id,'RUNNING');store.checkpoint(run.id,{pausedAt:new Date().toISOString(),reason:'CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核',errorCode:null,screenshotError:'当前没有可截图的页面'});
  store.move(run.id,'PAUSED','CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核');batch.store.move(q.id,'FAILED','CONTENT_REVIEW_REQUIRED: 缺少固定清单与主图内容审核');
 }
 batch.store.setBatch(b.id,'PAUSED','isolated original');
 const api=new ProductApi({imageReviewPolicy:{enabled:false},source,batch,shop,runtime:dir,owner:{sessions:new Map(),status:async()=>({running:true,loggedIn:true})},launch:async()=>{},integrity:async()=>({ok:true,revision:'isolated-review'}),checkFiles:async()=>{}});
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(url.searchParams.get('executionShop')!==shop.id)throw Error('错店图片或请求');
   let raw='';for await(const chunk of req)raw+=chunk;
   return await api.handle(req,res,url,{body:async()=>JSON.parse(raw||'{}'),json});
  }
  if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/travel-os.css"><link rel="stylesheet" href="/operations-catalog.css"><main style="margin:32px;max-width:1100px"><div id="review"></div></main><script type="module">import {mountContentReview} from '/content-review-ui.js';const request=async(path,input)=>{const u=new URL(path,location);u.searchParams.set('executionShop','${shop.id}');const r=await fetch(u,input?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}:{}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};window.panel=mountContentReview(document.getElementById('review'),{get:request,post:request,shopName:'${shop.name}'});</script></html>`);return;}
  const allowed=['content-review-ui.js','travel-os.css','operations-catalog.css','typography.css'];if(!allowed.includes(url.pathname.slice(1))){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});res.end(await readFile(join(root,url.pathname.slice(1))));
 }catch(e){json(res,409,{error:e.message});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('已导入 25 条商品，尚未建立执行清单。',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'建立执行清单',exact:true}).isDisabled(),true);
 await page.getByRole('checkbox',{name:/确认以本次导入资料建立执行清单/}).check();await page.getByRole('button',{name:'建立执行清单',exact:true}).click();
 const card=page.locator('[data-content-key]').first();await card.getByRole('button',{name:'保存本条审核'}).waitFor();
 await page.waitForFunction(()=>{const i=document.querySelector('img');return i?.complete&&i.naturalWidth>0;});
 await card.getByRole('checkbox',{name:'确认恢复本条未启动记录'}).check();await card.getByRole('button',{name:'恢复未启动记录',exact:true}).click();
 await page.getByText('未启动记录已恢复，尚未开始执行。',{exact:true}).waitFor();
 assert.equal(batch.store.item(q.id).attempts,3);assert.equal(batch.store.preflightBudget(q.id).effectiveAttempts,0);assert.equal(store.run(run.id).state,'PAUSED');
 await card.getByLabel('审核结果').selectOption('PASS');await card.getByLabel('审核者').fill('隔离网页QA');await card.getByLabel('实际观察到的文字与内容').fill('隔离测试主图，已查看原图并核对本条目的地绑定');await card.getByRole('button',{name:'保存本条审核'}).click();
 await page.getByText('本条审核已保存。',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-content-key] [data-content-field="decision"]')?.value==='PASS');
 assert.equal(await card.getByLabel('审核者').inputValue(),'隔离网页QA');
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('21. 测试目的地21',{exact:false}).waitFor();
 assert.equal(await page.locator('[data-content-key]').count(),5);await page.getByRole('button',{name:'上一页',exact:true}).click();await page.getByText('已保存：审核通过',{exact:true}).waitFor();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,'review-desktop.png'),fullPage:false});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'review-mobile.png'),fullPage:false});
 assert.equal(store.list().length,1);assert.equal(store.run(run.id).state,'PAUSED');assert.equal(api.round.round().state,'READY');assert.deepEqual(errors,[]);
 const result={passed:true,checks:['visible list creation','scoped real image requests','restore original 3/3 record','raw attempts preserved and credit finite','explicit single review saved','pagination','no executor launched','no page errors'],rawAttempts:3,effectiveAttempts:0,total:25,reviewed:1};await writeFile(join(out,'qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));store.close();await rm(dir,{recursive:true,force:true});}
