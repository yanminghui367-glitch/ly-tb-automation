import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

 test('real detail UI exposes receipt recovery and reuses lost response request without submitting',async()=>{
 const root=resolve(import.meta.dirname,'..'),allowed=new Set(['round-item-detail.js','shop-scope.js','task-view-model.mjs','ui-copy.js','round-item-detail.css']);
 const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname.slice(1);if(!path){res.setHeader('Content-Type','text/html');return res.end('<html><meta charset="utf-8"><body><main id="panel"></main></body></html>');}if(!allowed.has(path)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(join(root,path)));}catch{res.writeHead(500);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());await p.goto(base);
  await p.evaluate(async()=>{
   await import('/ui-copy.js');const {mountRoundItemDetail}=await import('/round-item-detail.js');
   const scope={roundId:'r',windowId:'w',key:'k'};globalThis.calls=[];globalThis.ids=0;globalThis.lose=true;
   const data={...scope,revision:'rev',shopId:'fixture-shop',manifestHash:'m',taskHash:'t',current:{key:'k',runId:'run',state:'RESULT_UNKNOWN',title:'休斯敦美国定制服务',destination:'休斯敦',submitted:false,submissionUncertain:true,reason:'缺少原任务实际提交点击时间，保持待核验'},submissionEvidence:true,capabilities:{verify:{allowed:true,mode:'VERIFY'},skip:{allowed:false},retry:{allowed:false},park:{allowed:false}},attempts:[]};
   const request=async(path,init={})=>{const input=init.body?JSON.parse(init.body):null;calls.push({path,input});if(input){if(lose){lose=false;throw Error('lost');}data.current.state='NEW_SUCCESS';return {ok:true,status:200,json:async()=>({accepted:true,replayed:true,id:input.id,itemId:input.itemId,state:'VERIFIED',batchContinued:false})};}return {ok:true,status:200,json:async()=>structuredClone(data)};};
   globalThis.mount=()=>mountRoundItemDetail(document.querySelector('#panel'),scope,{request,makeId:()=>`request-${++ids}`,storage:sessionStorage,onRun:()=>{}});globalThis.view=mount();await view.ready;
  });
  await p.locator('[data-item-associate] [name=itemId]').fill('1095269536185');await p.locator('[data-item-associate] [name=confirmedBy]').fill('测试确认人');
  await p.locator('[data-item-associate] button').click();assert.equal(await p.evaluate(()=>calls.filter(c=>c.input).length),0,'confirmation checkbox required');
  await p.locator('[data-item-associate] [name=confirmed]').check();await p.locator('[data-item-associate] button').click();await p.getByRole('button',{name:'核对此次回执关联',exact:true}).waitFor();
  assert.equal(await p.evaluate(()=>calls.filter(c=>c.input).length),1);
  await p.evaluate(async()=>{view.dispose();view=mount();await view.ready;});await p.getByRole('button',{name:'核对此次回执关联',exact:true}).click();await p.getByText('原商品核验成功；未重新提交。剩余商品不会自动启动，请回到执行监控查看可用操作。',{exact:true}).waitFor();
  const requests=await p.evaluate(()=>calls.filter(c=>c.input));assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].path,'/api/v1/reconcile');assert.equal(requests[0].input.confirmedBy,'测试确认人');assert.equal(await p.locator('[data-item-associate]').count(),0);assert.equal(await p.evaluate(()=>ids),1);assert.deepEqual(errors,[]);
  await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }finally{await browser?.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});
