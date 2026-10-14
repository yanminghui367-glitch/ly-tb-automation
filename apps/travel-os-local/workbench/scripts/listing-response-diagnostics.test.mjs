import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseTableResponse,sellerTable} from '../listing-verification.mjs';
import {RoundVerification} from '../round-verification.mjs';

const secret='sensitive-Fixture-Only-9x.token';
const host='https://h5api.m.taobao.com/h5/mtop.taobao.sell.pc.manage.async/1.0/';
const task={shopId:'fixture',business:{shop_name:'测试店铺'},listing:{type:'city',country:'美国',city:'匹兹堡',title:'匹兹堡测试旅行服务'}};
const otherTask={...task,listing:{type:'city',country:'法国',city:'巴黎',title:'巴黎测试旅行服务'}};
const otherRow={itemId:'100001',title:otherTask.listing.title,status:'出售中'};
const ok=(page=1)=>({ret:['SUCCESS::'+secret],data:{result:JSON.stringify({success:true,data:{table:{dataSource:[]},pagination:{current:page,total:0,pageSize:20}}})}});
function caught(fn){try{fn();assert.fail('must reject');}catch(error){return error;}}
function diagnostic(error,stage){
 assert.equal(error.code,'ERR_ASSERTION');assert.equal(error.tableDiagnostic?.stage,stage);
 assert.equal(error.tableDiagnostic.schemaVersion,1);assert.match(error.tableDiagnostic.code,/^TABLE_[A-Z_]+$/);
 assert.equal(error.tableDiagnostic.httpStatus,200);assert.equal(error.tableDiagnostic.expectedPage,7);
 assert(!JSON.stringify({message:error.message,diagnostic:error.tableDiagnostic,stack:error.stack}).includes(secret));
 assert(!/CAPTCHA|验证码|登录失效/.test(error.message));return error.tableDiagnostic;
}

test('outer ret and business failure are distinct diagnostics while original failure remains closed',()=>{
 const outer=caught(()=>parseTableResponse({ret:['FAIL::'+secret+' 验证码'],data:{result:'{}'}},{httpStatus:200,expectedPage:7}));
 const inner=caught(()=>parseTableResponse({ret:['SUCCESS::'+secret],data:{result:JSON.stringify({success:false,message:secret,code:secret})}},{httpStatus:200,expectedPage:7}));
 assert.equal(outer.message,'后台列表响应未成功');assert.equal(inner.message,outer.message);
 assert.deepEqual(diagnostic(outer,'ret').retCodes,['FAIL']);
 assert.equal(diagnostic(inner,'result-status').resultSuccess,false);
 assert.notEqual(outer.tableDiagnostic.code,inner.tableDiagnostic.code);
});

test('malformed payload and result JSON never expose response fragments or parse exception text',()=>{
 for(const payload of [null,[],{}, {ret:secret},{ret:[null]}])diagnostic(caught(()=>parseTableResponse(payload,{httpStatus:200,expectedPage:7})),'ret');
 const invalid={ret:['SUCCESS::'+secret],data:{result:'{"message":"'+secret+'" invalid'}};
 assert.equal(diagnostic(caught(()=>parseTableResponse(invalid,{httpStatus:200,expectedPage:7})),'result-json').resultShape,'string');
 for(const result of [null,{},[],{success:secret}])assert.equal(diagnostic(caught(()=>parseTableResponse({ret:['SUCCESS::ok'],data:{result}},{httpStatus:200,expectedPage:7})),'result-status').resultSuccess,null);
});

test('code extraction is bounded strict uppercase only and metadata is numeric or null',()=>{
 const ret=['FAIL::'+secret,'bad_code::'+secret,'X'.repeat(65)+'::'+secret,'TOKENABC123SECRET::'+secret,'OTHER_CODE::'+secret,'FOURTH_CODE::'+secret];
 const e=caught(()=>parseTableResponse({ret,message:secret,headers:{cookie:secret}},{httpStatus:secret,expectedPage:secret}));
 assert(e.tableDiagnostic);assert(e.tableDiagnostic.retCodes.length<=3);
 assert(e.tableDiagnostic.retCodes.every(x=>/^[A-Z][A-Z0-9_]{0,63}$/.test(x)));
 assert(!e.tableDiagnostic.retCodes.some(x=>x===secret||x==='bad_code'||x.length>64));
 assert(!JSON.stringify(e.tableDiagnostic).includes('TOKENABC123SECRET'));assert.equal(e.tableDiagnostic.unknownRetCount,5);
 assert.equal(e.tableDiagnostic.httpStatus,null);assert.equal(e.tableDiagnostic.expectedPage,null);
 assert(!JSON.stringify(e.tableDiagnostic).includes(secret));assert(!Object.hasOwn(e.tableDiagnostic,'headers'));
});

test('documented codes are diagnostic only, bounded, and cannot create a login or retry decision',()=>{
 const ret=['FAIL_SYS_SESSION_EXPIRED','FAIL_SYS_FLOWLIMIT','FAIL_SYS_API_UNAUTHORIZED','FAIL_SYS_TRAFFIC_LIMIT','FAIL_SYS_AUTH_FAILED','SYSTEM_ERROR','FAIL_SYS_SERVICE_TIMEOUT','FAIL_SYS_SERVICE_FAULT'].map(code=>code+'::'+secret+' 验证码');
 const e=caught(()=>parseTableResponse({ret},{httpStatus:200,expectedPage:7})),d=diagnostic(e,'ret');
 assert.equal(d.retCodes.length,3);assert.equal(d.unknownRetCount,0);assert.equal(d.retCount,8);
 assert.deepEqual(d.retCodes,ret.slice(0,3).map(x=>x.split('::')[0]));assert.equal(e.message,'后台列表响应未成功');
 assert.equal(e.code,'ERR_ASSERTION');assert(!Object.hasOwn(e,'retry'));
 const unknown=caught(()=>parseTableResponse({ret:['TOKENABC123SECRET::'+secret]},{httpStatus:200,expectedPage:7}));
 assert.equal(diagnostic(unknown,'ret').unknownRetCount,1);assert.deepEqual(unknown.tableDiagnostic.retCodes,[]);
});

test('table shape, ID, count and expected-page failures cannot become valid empty results',()=>{
 const make=result=>({ret:['SUCCESS::ok'],data:{result}});
 const table={success:true,data:{table:{dataSource:[]},pagination:{total:0,current:7,pageSize:20}}};
 const cases=[
  [make({success:true}),'table-shape'],
  [make({...table,data:{...table.data,table:{dataSource:[null]}}}),'item-ids'],
  [make({...table,data:{...table.data,pagination:{total:121,current:7,pageSize:20}}}),'pagination-count'],
  [ok(1),'page-number']
 ];
 for(const [payload,stage] of cases)diagnostic(caught(()=>parseTableResponse(payload,{httpStatus:200,expectedPage:7})),stage);
 assert.deepEqual(parseTableResponse(ok()),{ids:[],total:0,page:1,pageSize:20});
 assert.deepEqual(parseTableResponse(ok(),{httpStatus:200,expectedPage:1}),{ids:[],total:0,page:1,pageSize:20});
});

async function fixture(t,browser){
 const context=await browser.newContext();t.after(()=>context.close());let payload=ok(),status=200,body=null,requests=0;
 let guards=0,guardError=null,afterResponse=null;const failures=[],escaped=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='https://myseller.taobao.com')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="shopName--x6nyUylx">测试店铺</div><button role="tab" aria-selected="true">全部(0)</button><input id="queryTitle"><input id="queryItemId"><input id="queryOuterId"><button id="search">搜索</button><table><tbody></tbody></table><script>
 document.querySelector('#search').onclick=async()=>{const filter={queryTitle:document.querySelector('#queryTitle').value,queryItemId:document.querySelector('#queryItemId').value};const data=JSON.stringify({url:'/taobao/manager/table.htm',jsonBody:JSON.stringify({tab:'all',pagination:{current:1,pageSize:20},filter})});try{const payload=await (await fetch('${host}?token=${secret}',{method:'POST',body:new URLSearchParams({data})})).json();const result=typeof payload.data.result==='string'?JSON.parse(payload.data.result):payload.data.result;if(result.success)document.querySelector('tbody').innerHTML=result.data.table.dataSource.map(x=>'<tr><td><a class="title-link">'+x.title+'</a><span>ID:'+x.itemId+'</span><span class="product-desc-span-status">'+x.status+'</span></td></tr>').join('');}catch{}};
 </script>`});
  if(url.origin==='https://h5api.m.taobao.com'){
   requests++;if(afterResponse)await afterResponse();const request=JSON.parse(JSON.parse(new URLSearchParams(route.request().postData()).get('data')).jsonBody);
   return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','x-fixture-secret':secret},body:body??JSON.stringify(typeof payload==='function'?payload(request):payload)});
  }
  escaped.push(url.origin);return route.abort();
 });
 const page=await context.newPage();await page.goto('https://myseller.taobao.com/home.htm/SellManage/all');
 const guard=async()=>{guards++;if(guardError)throw guardError;};
 const create=options=>sellerTable(context,task,guard,options??{onFailure:async d=>failures.push(d)});
 const table=await create();
 return {page,context,table,create,guard,failures,escaped,requests:()=>requests,guards:()=>guards,set:v=>{payload=v.payload??ok();status=v.status??200;body=v.body??null;afterResponse=v.afterResponse??null;},setGuard:e=>guardError=e};
}

test('official reader uses safe diagnostics with no platform traffic or retry',async t=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});t.after(()=>browser.close());
 for(const [name,scenario,stage] of [
  ['HTTP failure',{status:503,body:secret},'http'],
  ['invalid JSON',{body:'<html>'+secret+'</html>'},'response-json'],
  ['outer failure',{payload:{ret:['FIXTURE_FAIL::'+secret],data:{result:secret}}},'ret'],
  ['business failure',{payload:{ret:['SUCCESS::ok'],data:{result:JSON.stringify({success:false,message:secret})}}},'result-status'],
  ['result malformed',{payload:{ret:['SUCCESS::ok'],data:{result:secret}}},'result-json'],
  ['wrong page',{payload:ok(2)},'page-number']
 ])await t.test(name,async t=>{
  const f=await fixture(t,browser);f.set(scenario);let error;
  await assert.rejects(f.table.search({title:'匹兹堡'}),e=>{error=e;return true;});
  assert.equal(error.tableDiagnostic?.stage,stage);assert.equal(f.failures.length,1);assert.equal(f.requests(),1);
  assert.equal(f.failures[0].httpStatus,scenario.status??200);assert.equal(f.failures[0].expectedPage,1);
  assert.deepEqual(f.failures[0],error.tableDiagnostic);assert(!JSON.stringify({failures:f.failures,message:error.message,stack:error.stack}).includes(secret));assert.deepEqual(f.escaped,[]);
 });
 await t.test('diagnostic callback failure never replaces original error or starts another request',async t=>{
  const f=await fixture(t,browser);f.set({status:500});const original=await f.create({onFailure:async()=>{throw Error(secret);}});
  await assert.rejects(original.search(),e=>e.message==='后台列表请求失败'&&e.tableDiagnostic?.stage==='http');assert.equal(f.requests(),1);
 });
 await t.test('successful empty response is unchanged and has no failure event',async t=>{
  const f=await fixture(t,browser),r=await f.table.search({title:'匹兹堡'});assert.equal(r.total,0);assert.deepEqual(r.records,[]);assert.equal(f.failures.length,0);assert.equal(f.requests(),1);assert(f.guards()>3);
 });
 await t.test('original guard and actual visible challenge remain authoritative',async t=>{
  const f=await fixture(t,browser),stop=Error('ROUND_PAUSE');f.setGuard(stop);
  await assert.rejects(f.table.search(),e=>e===stop);assert.equal(f.requests(),0);assert.equal(f.failures.length,0);
  f.setGuard(null);f.set({payload:{ret:['FAIL::'+secret]},afterResponse:()=>f.page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div>请拖动滑块</div>'))});
  await assert.rejects(f.table.search(),e=>e.message==='PAUSED_CAPTCHA'&&!e.tableDiagnostic);assert.equal(f.requests(),1);assert.equal(f.failures.length,0);
 });
 await t.test('complete RoundVerification reader cannot classify failed inventory or fresh query as absent',async t=>{
  const f=await fixture(t,browser),dir=await mkdtemp(join(tmpdir(),'ly-response-round-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const verifier=new RoundVerification({context:()=>f.context,guard:f.guard,round:()=>({round:{id:'fixed',authorization:{}},items:[{task},{task:otherTask}]}),artifacts:dir});
  f.set({payload:{ret:['FAIL::'+secret]}});
  await assert.rejects(verifier.verify({task,roundId:'fixed',key:'item'}),e=>e.tableDiagnostic?.stage==='ret');
  assert.equal(verifier.inventory,null);assert.equal(verifier.verified,0);assert.equal(f.requests(),1);
  const folder=join(dir,'fixed','verification','item'),files=await readdir(folder);assert.equal(files.length,1);assert.match(files[0],/^table-failure-[0-9a-f-]+\.json$/);
  const saved=JSON.parse(await readFile(join(folder,files[0]),'utf8'));assert.equal(saved.stage,'ret');assert(!JSON.stringify(saved).includes(secret));
  f.set({payload:q=>{if(q.filter.queryTitle)return ok();const result=ok();result.data.result=JSON.stringify({success:true,data:{table:{dataSource:[otherRow]},pagination:{current:1,total:1,pageSize:20}}});return result;}});
  assert.equal(await verifier.verify({task,roundId:'fixed',key:'item'}),null);const verified=verifier.verified;
  f.set({payload:{ret:['SUCCESS::ok'],data:{result:{success:false,message:secret}}}});
  await assert.rejects(verifier.verify({task,roundId:'fixed',key:'item'}),e=>e.tableDiagnostic?.stage==='result-status');assert.equal(verifier.verified,verified);
  await assert.rejects(verifier.verify({task,roundId:'fixed',key:'item',itemId:'100002'}),e=>e.tableDiagnostic?.stage==='result-status');assert.equal(verifier.verified,verified);
  const later=(await readdir(folder)).filter(x=>x.startsWith('table-failure-'));assert.equal(later.length,3);assert.equal(new Set(later).size,3);
 });
});

test('diagnostic file write failure is secondary and original tableFactory injection remains compatible',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-response-write-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const folder=join(dir,'fixed','verification','item');await mkdir(folder,{recursive:true});
 let onFailure,mode='plain',calls=0;
 const verifier=new RoundVerification({context:()=>({}),guard:async()=>{},round:()=>({round:{id:'fixed',authorization:{}},items:[{task},{task:otherTask}]}),artifacts:dir,tableFactory:async(_context,_task,_guard,options)=>{
  onFailure=options?.onFailure;return {search:async(q={})=>{calls++;if(mode==='plain'){const records=q.title?[]:[otherRow];return {records,total:records.length,at:new Date().toISOString()};}await rm(folder,{recursive:true});await writeFile(folder,'fixture');const e=caught(()=>parseTableResponse({ret:['FAIL::'+secret]},{httpStatus:200,expectedPage:1}));await onFailure(e.tableDiagnostic);throw e;}};
 }});
 assert.equal(await verifier.verify({task,roundId:'fixed',key:'item'}),null);assert.equal(typeof onFailure,'function');assert.equal(calls,2);
 // The isolated search replaces its artifact directory with a file after setup.
 mode='fail';
 await assert.rejects(verifier.verify({task,roundId:'fixed',key:'item'}),e=>e.tableDiagnostic?.stage==='ret');
});
