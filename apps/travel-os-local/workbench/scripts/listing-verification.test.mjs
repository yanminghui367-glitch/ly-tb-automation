import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {matchesTableRequest,parseTableResponse,sellerTable,listingEvidence,dismissSellerTablePromotion} from '../listing-verification.mjs';
const host='https://h5api.m.taobao.com/h5/mtop.taobao.sell.pc.manage.async/1.0/';
const data=(filter={},current=1)=>new URLSearchParams({data:JSON.stringify({url:'/taobao/manager/table.htm',jsonBody:JSON.stringify({tab:'all',pagination:{current,pageSize:20},filter})})}).toString();
const response=(ids,total=ids.length,current=1,pageSize=20)=>({ret:['SUCCESS::调用成功'],data:{result:JSON.stringify({success:true,data:{table:{dataSource:ids.map(itemId=>({itemId}))},pagination:{total,current,pageSize}}})}});
const request=(filter,page=1)=>({url:()=>host,postData:()=>data(filter,page)});
test('table request is tied to exact official table, filters, all tab and page',()=>{
 assert(matchesTableRequest(request({queryItemId:'123'}),{itemId:'123'}));
 assert(matchesTableRequest(request({queryTitle:'东京'},2),{title:'东京',page:2}));
 assert(!matchesTableRequest(request({queryItemId:'123'}),{itemId:'12'}));
 assert(!matchesTableRequest(request({queryTitle:'东京',queryOuterId:'hidden-filter'}),{title:'东京'}));
 assert(!matchesTableRequest({...request({}),url:()=>host.replace('h5api.m.taobao.com','untrusted.test')}));
 assert(!matchesTableRequest(request({},2)));
});
test('empty successful table is distinct from error or incomplete response',()=>{
 assert.deepEqual(parseTableResponse(response([])),{ids:[],total:0,page:1,pageSize:20});
 for(const invalid of [{},response(['1','1']),response(['1'],2),{...response([]),ret:['FAIL::需要验证']},response(['bad'])])assert.throws(()=>parseTableResponse(invalid));
 assert.equal(parseTableResponse(response(['21'],21,2)).page,2);
});
const task={shopId:'fixture',business:{shop_name:'测试店铺',price_cny:20,inventory:999999},listing:{title:'测试目的地定制服务'}};
const row=(id='123',status='出售中')=>({itemId:id,title:task.listing.title,text:task.listing.title+' ID:'+id,cells:[{label:'价格',text:'¥ 20.00'},{label:'库存',text:'999999'}],status});
test('new publication records actual pending review state without claiming on sale',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-verify-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const table={guard:async()=>{},page:{screenshot:async()=>{}}};
 const r=await listingEvidence(table,row('123','待审核'),task,dir,{newSubmission:true});assert.equal(r.status,'待审核');
 for(const bad of [{...row(),title:'其他目的地'},{...row(),status:'违规下架'},{...row(),cells:[{label:'价格',text:'¥ 120.00'},{label:'库存',text:'999999'}]}])await assert.rejects(listingEvidence(table,bad,task,dir,{newSubmission:true}));
});
test('historical evidence preserves changed price and stock without overwriting business data',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ly-existing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const r=await listingEvidence({guard:async()=>{},page:{screenshot:async()=>{}}},{...row(),cells:[{label:'价格',text:'¥ 1850.00'},{label:'库存',text:'999998'}]},task,dir);
 assert.equal(r.observed.price,1850);assert.equal(r.observed.inventory,999998);assert.equal(r.differences.length,2);assert.equal(task.business.price_cny,20);
});
async function browserFixture(t,origin='https://myseller.taobao.com',initialOverlay=''){
 const browser=await chromium.launch({headless:true,channel:'chrome'});t.after(()=>browser.close());const context=await browser.newContext();
 let items=[row('123'),row('456','仓库中')],requests=0;
 await context.route(origin+'/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><div class="shopName--x6nyUylx">测试店铺</div><button role="tab" aria-selected="true">全部(2)</button><input id="queryTitle"><input id="queryItemId"><input id="queryOuterId"><button id="search">搜索</button><div class="l-config-list-table"><table><tbody id="rows"></tbody></table><div class="l-config-list-pagination"><button id="next" disabled>下一页</button></div></div>${initialOverlay}<script>
 let current=1,lastTotal=0;async function load(){const filter={queryTitle:document.querySelector('#queryTitle').value,queryItemId:document.querySelector('#queryItemId').value};const body=new URLSearchParams({data:JSON.stringify({url:'/taobao/manager/table.htm',jsonBody:JSON.stringify({tab:'all',pagination:{current,pageSize:1},filter})})});const r=await fetch('${host}',{method:'POST',body});const payload=await r.json();const result=JSON.parse(payload.data.result);setTimeout(()=>{document.querySelector('#rows').innerHTML=result.data.table.dataSource.map(x=>'<tr><td label="商品名称"><a class="title-link">'+x.title+'</a><span>ID:'+x.itemId+'</span></td><td label="价格">¥ 20.00</td><td label="库存">999999</td><td><span class="product-desc-span-status">'+x.status+'</span></td></tr>').join('');lastTotal=result.data.pagination.total;document.querySelector('#next').disabled=current>=lastTotal;},80);}document.querySelector('#search').onclick=()=>{current=1;load();};document.querySelector('#next').onclick=()=>{current++;load();};</script>`}));
 await context.route(host,async route=>{
  requests++;const payload=JSON.parse(new URLSearchParams(route.request().postData()).get('data')),q=JSON.parse(payload.jsonBody);
  const found=items.filter(x=>(!q.filter.queryItemId||x.itemId===q.filter.queryItemId)&&(!q.filter.queryTitle||x.title.includes(q.filter.queryTitle))),current=q.pagination.current;
  const out=response([],0);out.data.result=JSON.stringify({success:true,data:{table:{dataSource:found.slice(current-1,current)},pagination:{total:found.length,current,pageSize:1}}});
  await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(out)});
 });
 const page=await context.newPage();await page.goto(origin+'/home.htm/SellManage/all');let guards=0;
 const table=await sellerTable(context,task,async()=>{guards++;});return {page,table,requests:()=>requests,guards:()=>guards,setItems:v=>items=v};
}
test('real isolated browser waits for rendered response, reads all pages and then proves empty result',async t=>{
 const f=await browserFixture(t),all=await f.table.search();assert.deepEqual(all.records.map(x=>x.itemId),['123','456']);assert.equal(all.records[1].status,'仓库中');
 const found=await f.table.search({itemId:'123'});assert.equal(found.total,1);
 const absent=await f.table.search({itemId:'999'});assert.equal(absent.total,0);assert.equal(absent.records.length,0);assert.equal(f.requests(),4);assert(f.guards()>10);
});
test('table ownership detects a changed shop before any search action',async t=>{
 const f=await browserFixture(t);await f.page.locator('div.shopName--x6nyUylx').evaluate(e=>e.innerText='其他店铺');
 await assert.rejects(f.table.search({itemId:'123'}));assert.equal(f.requests(),0);
});

test('official next-page aria label includes current page while visible text remains next',async t=>{
 const f=await browserFixture(t);await f.page.locator('#next').evaluate(e=>{e.setAttribute('aria-label','下一页，当前第1页');e.className='next-btn next-medium next-btn-normal next-pagination-item next-next';e.innerHTML='<span class="next-btn-helper">下一页</span><i class="next-icon next-icon-arrow-right next-xs next-btn-icon next-icon-last next-pagination-icon-next"></i>';});
 await f.page.evaluate(()=>{for(let i=0;i<2;i++){const b=document.createElement('button');b.setAttribute('aria-label','下一页，当前第1页');b.onclick=()=>{throw Error('wrong unrelated paginator');};document.body.append(b);}});
 await f.page.addStyleTag({content:'.next-icon-arrow-right::before { content: "\\e619"; }'});
 const all=await f.table.search();assert.deepEqual(all.records.map(x=>x.itemId),['123','456']);assert.equal(f.requests(),2);
});

test('current QianNiu origin reuses the same helper and preserves full pagination and identity checks',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 const all=await f.table.search();assert.deepEqual(all.records.map(x=>x.itemId),['123','456']);assert.equal(f.requests(),2);
 assert.equal((await f.table.search({itemId:'999'})).total,0);
 await f.page.locator('div.shopName--x6nyUylx').evaluate(e=>e.innerText='其他店铺');const before=f.requests();
 await assert.rejects(f.table.search());assert.equal(f.requests(),before);
});

const skuPromotion=`<div class="next-overlay-wrapper opened" id="promotion"><div class="next-overlay-backdrop" style="position:fixed;inset:0;background:#0006;z-index:100"></div><div role="dialog" class="next-dialog" style="position:fixed;left:100px;top:100px;background:white;z-index:101;padding:30px"><img alt="SKU管理页上线介绍"><button type="button" aria-label="关闭" class="closeHotspot--fixture" onclick="window.closeCount=(window.closeCount||0)+1;this.closest('.next-overlay-wrapper').remove()">关闭</button><button type="button" aria-label="立即体验，跳转SKU管理页" class="buttonHotspot--fixture" onclick="window.experienceCount=(window.experienceCount||0)+1">立即体验</button></div></div>`;

test('SKU introduction is closed natively before ID search; full original evidence is then verified',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),skuPromotion);
 const found=await f.table.search({itemId:'123'});
 assert.equal(found.records[0].itemId,'123');assert.equal(f.requests(),1);
 assert.equal(await f.page.evaluate(()=>window.closeCount),1);assert.equal(await f.page.evaluate(()=>window.experienceCount||0),0);
 const dir=await mkdtemp(join(tmpdir(),'ly-sku-promotion-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 assert.equal((await listingEvidence(f.table,found.records[0],task,dir,{newSubmission:true})).itemId,'123');
});

test('SKU promotion that appears during filter input is closed before the response-bound search click',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 await f.page.locator('#queryItemId').evaluate((e,html)=>e.addEventListener('input',()=>document.body.insertAdjacentHTML('beforeend',html),{once:true}),skuPromotion);
 const found=await f.table.search({itemId:'456'});assert.equal(found.records[0].itemId,'456');assert.equal(f.requests(),1);
 assert.equal(await f.page.evaluate(()=>window.closeCount),1);
});

test('unknown, ambiguous and editable dialogs remain untouched and never cause an underlying search',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 for(const html of [skuPromotion.replace('立即体验，跳转SKU管理页','未知操作'),skuPromotion.replace('</div></div>','<button type="button">另一个操作</button></div></div>'),skuPromotion.replace('</div></div>','<input value="原业务资料"></div></div>'),skuPromotion+skuPromotion]){
  await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),html);
  await assert.rejects(f.table.search({itemId:'123'}),e=>e.code==='TABLE_UI_OVERLAY_BLOCKED');
  assert.equal(f.requests(),0);assert.equal(await f.page.evaluate(()=>window.closeCount||0),0);
  await f.page.locator('.next-overlay-wrapper').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));
 }
});

test('CAPTCHA guard prevents closing even the recognized SKU promotion',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),skuPromotion+'<div>请完成验证码，拖动滑块进行安全验证</div>');
 await assert.rejects(f.table.search({itemId:'123'}),/PAUSED_CAPTCHA/);assert.equal(f.requests(),0);
 assert.equal(await f.page.evaluate(()=>window.closeCount||0),0);assert.equal(await f.page.locator('#promotion').count(),1);
});

test('changed shop prevents promotion dismissal; a hidden promotion does not interfere with search',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),skuPromotion);
 await assert.rejects(dismissSellerTablePromotion(f.page,async()=>{throw Error('店铺身份变化');}),/店铺身份/);
 assert.equal(await f.page.evaluate(()=>window.closeCount||0),0);assert.equal(f.requests(),0);
 await f.page.locator('#promotion').evaluate(e=>e.style.display='none');
 assert.equal((await f.table.search({itemId:'123'})).total,1);assert.equal(await f.page.evaluate(()=>window.closeCount||0),0);
});

test('guard is rechecked after native close and prevents search if identity changes',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),skuPromotion);
 let checks=0;
 await assert.rejects(dismissSellerTablePromotion(f.page,async()=>{if(++checks===3)throw Error('关闭后店铺身份变化');}),/关闭后店铺身份/);
 assert.equal(await f.page.evaluate(()=>window.closeCount),1);assert.equal(f.requests(),0);assert.equal(checks,3);
});


test('promotion on initial table load is closed before binding table controls',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com',skuPromotion);
 assert.equal(await f.page.evaluate(()=>window.closeCount),1);assert.equal(f.requests(),0);
 assert.equal((await f.table.search({itemId:'123'})).total,1);assert.equal(f.requests(),1);
});

test('unresponsive native close stops after one click and never forces a search through the overlay',async t=>{
 const f=await browserFixture(t,'https://qn.taobao.com');
 const html=skuPromotion.replace("this.closest('.next-overlay-wrapper').remove()","void 0");
 await f.page.locator('body').evaluate((e,html)=>e.insertAdjacentHTML('beforeend',html),html);
 await assert.rejects(f.table.search({itemId:'123'}),e=>e.code==='TABLE_PROMOTION_CLOSE_FAILED');
 assert.equal(await f.page.evaluate(()=>window.closeCount),1);assert.equal(f.requests(),0);assert.equal(await f.page.locator('#promotion').count(),1);
});
