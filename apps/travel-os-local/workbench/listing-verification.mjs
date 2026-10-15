import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from 'playwright/test';
import {getAuxiliaryPage,assertAuxiliaryPage} from './publishing-pages.mjs';
import {visibleChallenge} from './browser-environment.mjs';

// Observe only requests made by the official seller table after a native UI
// action. No private endpoint calls, token reads, or alternate browser owner.
export function matchesTableRequest(request,{title='',itemId='',page=1}={}){
 try{
  const url=new URL(request.url());
  if(url.hostname!=='h5api.m.taobao.com'||url.pathname!=='/h5/mtop.taobao.sell.pc.manage.async/1.0/')return false;
  const params=new URLSearchParams(request.postData()||url.search),data=JSON.parse(params.get('data'));
  if(data.url!=='/taobao/manager/table.htm')return false;
  const body=JSON.parse(data.jsonBody),filter=body.filter||{};
  return body.tab==='all'&&body.pagination?.current===page&&(filter.queryTitle||'')===title&&(filter.queryItemId||'')===itemId&&Object.entries(filter).every(([k,v])=>['queryTitle','queryItemId'].includes(k)||v===null||v===false||v==='');
 }catch{return false;}
}
// Only documented protocol codes may leave the response. A code-shaped secret
// is still untrusted. EMAS development guide v2.5.3.3 (2023-08-02), pp.187-189:
// https://apsara-doc.oss-cn-hangzhou.aliyuncs.com/apsara-pdf/emas/v_2_5_3_3/emas/zh/development-guide-2.pdf
// This diagnostic allowlist does not infer a cause or authorize recovery.
const RET_CODES=new Set(['SUCCESS','FAIL','FAIL_SYS_SESSION_EXPIRED','FAIL_SYS_FLOWLIMIT','FAIL_SYS_API_UNAUTHORIZED','FAIL_SYS_TRAFFIC_LIMIT','FAIL_SYS_AUTH_FAILED','SYSTEM_ERROR','FAIL_SYS_SERVICE_TIMEOUT','FAIL_SYS_SERVICE_FAULT']);
const TABLE_FAILURES={
 'http':['TABLE_HTTP_FAILURE','后台列表HTTP请求未成功','后台列表请求失败'],
 'response-json':['TABLE_RESPONSE_JSON_INVALID','后台列表响应不是有效JSON','后台列表响应格式异常，不能判定商品不存在'],
 'ret':['TABLE_RET_FAILURE','后台列表外层响应未成功','后台列表响应未成功'],
 'result-json':['TABLE_RESULT_JSON_INVALID','后台列表result不是有效JSON','后台列表响应格式异常，不能判定商品不存在'],
 'result-status':['TABLE_RESULT_UNSUCCESSFUL','后台列表result.success不是true','后台列表响应未成功'],
 'table-shape':['TABLE_SHAPE_INVALID','后台列表表格或分页结构不完整','后台列表结构变化，不能判定商品不存在'],
 'item-ids':['TABLE_ITEM_IDS_INVALID','后台商品ID缺失、格式错误或重复','后台商品ID不唯一'],
 'pagination-count':['TABLE_PAGE_COUNT_INVALID','后台分页数量与声明不一致','后台分页数量不一致'],
 'page-number':['TABLE_PAGE_MISMATCH','后台响应页码与预期页码不一致','后台分页响应与操作不一致']
};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function tableFailure(stage,{httpStatus=null,expectedPage=null}={},payload,result){
 const [code,message,publicMessage]=TABLE_FAILURES[stage],ret=Array.isArray(payload?.ret)?payload.ret:null;
 const retCodes=[];let unknownRetCount=0;
 for(const value of ret||[]){
  const separator=typeof value==='string'?value.indexOf('::'):-1;
  const candidate=separator>0&&separator<=64?value.slice(0,separator):null;
  if(candidate&&/^[A-Z][A-Z0-9_]{0,63}$/.test(candidate)&&RET_CODES.has(candidate)){
   if(retCodes.length<3&&!retCodes.includes(candidate))retCodes.push(candidate);
  }else unknownRetCount++;
 }
 const rawResult=payload?.data?.result;
 const tableDiagnostic={schemaVersion:1,stage,code,message,
  httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:null,
  expectedPage:Number.isInteger(expectedPage)&&expectedPage>=1&&expectedPage<=1000?expectedPage:null,
  payloadObject:object(payload),retArray:!!ret,retCount:ret?.length??null,retCodes,unknownRetCount,
  resultShape:rawResult===undefined?'missing':typeof rawResult==='string'?'string':object(rawResult)?'object':'other',
  resultSuccess:typeof result?.success==='boolean'?result.success:null,
  tableRowsArray:Array.isArray(result?.data?.table?.dataSource),paginationObject:object(result?.data?.pagination)};
 return Object.assign(new assert.AssertionError({message:publicMessage}),{tableDiagnostic});
}
export function parseTableResponse(payload,metadata={}){
 const fail=(stage,result)=>{throw tableFailure(stage,metadata,payload,result);};
 if(!Array.isArray(payload?.ret)||!payload.ret.length||!payload.ret.every(s=>typeof s==='string'&&s.startsWith('SUCCESS::')))fail('ret');
 let result;
 try{result=typeof payload.data?.result==='string'?JSON.parse(payload.data.result):payload.data?.result;}
 catch{fail('result-json');} // JSON.parse messages can quote raw response text.
 if(result?.success!==true)fail('result-status',result);
 const table=result.data?.table,pagination=result.data?.pagination;
 if(!(Array.isArray(table?.dataSource)&&pagination&&Number.isInteger(pagination.total)&&pagination.total>=0&&Number.isInteger(pagination.current)&&pagination.current>0&&Number.isInteger(pagination.pageSize)&&pagination.pageSize>0))fail('table-shape',result);
 const ids=table.dataSource.map(row=>String(row?.itemId));
 if(!ids.every(id=>/^\d+$/.test(id))||new Set(ids).size!==ids.length)fail('item-ids',result);
 const expected=Math.max(0,Math.min(pagination.pageSize,pagination.total-(pagination.current-1)*pagination.pageSize));
 if(ids.length!==expected)fail('pagination-count',result);
 if(metadata.expectedPage!==undefined&&metadata.expectedPage!==null&&pagination.current!==metadata.expectedPage)fail('page-number',result);
 return {ids,total:pagination.total,page:pagination.current,pageSize:pagination.pageSize};
}
// Close only the observed SKU-management announcement through its native close
// control. Unknown dialogs, input forms and verification challenges stay intact.
export async function dismissSellerTablePromotion(page,checked){
 await checked(page);
 const wrappers=page.locator('.next-overlay-wrapper.opened'),blocking=[];
 for(let i=0;i<await wrappers.count();i++){
  const wrapper=wrappers.nth(i);
  if(await wrapper.locator('.next-overlay-backdrop').isVisible())blocking.push(wrapper);
 }
 if(!blocking.length)return {dismissed:false};
 const blocked=()=>Object.assign(Error('后台商品核验页有未识别弹窗，请在执行 Chrome 处理弹窗后重新核验；原商品不会重复发布。'),{code:'TABLE_UI_OVERLAY_BLOCKED',tableDiagnostic:{schemaVersion:1,stage:'ui-overlay',code:'TABLE_UI_OVERLAY_BLOCKED',blockingOverlayCount:blocking.length}});
 if(blocking.length!==1)throw blocked();
 const wrapper=blocking[0],dialog=wrapper.locator('.next-dialog[role="dialog"]');
 const close=dialog.locator('button[type="button"][class*="closeHotspot--"][aria-label="关闭"]');
 const experience=dialog.locator('button[type="button"][class*="buttonHotspot--"][aria-label="立即体验，跳转SKU管理页"]');
 if(await dialog.count()!==1||await close.count()!==1||await experience.count()!==1||await dialog.locator('button').count()!==2||await dialog.locator('input,textarea,select,iframe,[contenteditable="true"],a[href],[role="button"]').count()||!await close.isVisible()||!await experience.isVisible())throw blocked();
 await checked(page);
 try{
  await close.click({timeout:5000});
  await expect(experience).toBeHidden({timeout:5000});
 }catch{
  throw Object.assign(Error('后台 SKU 管理介绍弹窗未能正常关闭，请在执行 Chrome 关闭后重新核验；原商品不会重复发布。'),{code:'TABLE_PROMOTION_CLOSE_FAILED',tableDiagnostic:{schemaVersion:1,stage:'ui-overlay',code:'TABLE_PROMOTION_CLOSE_FAILED'}});
 }
 await checked(page);
 return {dismissed:true,kind:'sku-management-announcement'};
}
export async function sellerTable(context,task,guard,{onFailure}={}){
 const checked=async page=>{
  await guard(page);if(await visibleChallenge(page))throw Error('PAUSED_CAPTCHA');
  assertAuxiliaryPage(page,'verification');
  await expect(page.locator('div.shopName--x6nyUylx')).toHaveText(task.business.shop_name,{useInnerText:true,timeout:10000});
  assertAuxiliaryPage(page,'verification');
 };
 const page=await getAuxiliaryPage(context,{role:'verification',shopId:task.shopId,url:'https://qn.taobao.com/home.htm/SellManage/all',guard:checked});
 const prepare=async()=>{
  try{return await dismissSellerTablePromotion(page,checked);}
  catch(error){if(error.tableDiagnostic){try{await onFailure?.(error.tableDiagnostic);}catch{}}throw error;}
 };
 await prepare();
 const all=page.getByRole('tab',{name:/^全部\(/});
 if(await all.getAttribute('aria-selected')!=='true'){await prepare();await all.click();await expect(all).toHaveAttribute('aria-selected','true');}
 const rows=()=>page.locator('tr').filter({has:page.locator('a.title-link')});
 async function action(expected,click){
  await prepare();
  const start=Date.now();
  const responsePromise=page.waitForResponse(r=>matchesTableRequest(r.request(),expected)&&r.request().timing().startTime>=start,{timeout:25000});
  // Attach a rejection handler before any click/guard can throw.
  responsePromise.catch(()=>{});
  await click();const response=await responsePromise;
  const metadata={httpStatus:response.status(),expectedPage:expected.page};
  // The callback sees only the allowlisted projection, never response/error text.
  const reject=async error=>{try{if(onFailure)await onFailure(error.tableDiagnostic);}catch{}throw error;};
  if(!response.ok())return reject(tableFailure('http',metadata));
  await response.finished();await checked(page);
  let payload,current;
  try{payload=await response.json();}catch{return reject(tableFailure('response-json',metadata));}
  try{current=parseTableResponse(payload,metadata);}catch(error){return reject(error);}
  await expect.poll(async()=>rows().evaluateAll(nodes=>nodes.map(n=>n.innerText.match(/ID[:：]\s*(\d+)/)?.[1])),{timeout:15000}).toEqual(current.ids);
  await checked(page);
  const records=await rows().evaluateAll(nodes=>nodes.map(n=>({
   itemId:n.innerText.match(/ID[:：]\s*(\d+)/)?.[1],title:n.querySelector('a.title-link')?.innerText.trim(),text:n.innerText,
   cells:[...n.querySelectorAll('td[label]')].map(e=>({label:e.getAttribute('label'),text:e.innerText})),
   status:n.querySelector('.product-desc-span-status')?.innerText.trim(),image:n.querySelector('img.product-desc-extend-image')?.getAttribute('src')
  })));
  assert(records.every(r=>r.title&&r.status),'后台商品名称或状态不完整');
  assert(await page.locator('#queryTitle').inputValue()===expected.title&&await page.locator('#queryItemId').inputValue()===expected.itemId,'后台筛选被改动，停止核验');
  await expect(all).toHaveAttribute('aria-selected','true');return {...current,records};
 }
 async function search({title='',itemId=''}={}){
  await prepare();await page.locator('#queryTitle').fill(title);await page.locator('#queryItemId').fill(itemId);
  const outer=page.locator('#queryOuterId');if(await outer.count())await outer.fill('');
  await page.locator('#queryItemId').press('Tab');
  let current=await action({title,itemId,page:1},()=>page.getByRole('button',{name:'搜索',exact:true}).click()),records=[...current.records];
  const total=current.total,seen=new Set(records.map(r=>r.itemId));
  while(records.length<total){
   assert(current.page<1000,'后台分页超出安全上限');
   const next=page.locator('.l-config-list-table .l-config-list-pagination').getByRole('button',{name:/^下一页(?:，当前第\d+页)?$/});await expect(next).toHaveCount(1);await expect(next).toBeEnabled();
   current=await action({title,itemId,page:current.page+1},()=>next.click());
   assert(current.total===total,'后台商品数量在分页期间变化，请重新核验');
   for(const row of current.records){assert(!seen.has(row.itemId),'后台分页重复，不能确认查重完整性');seen.add(row.itemId);records.push(row);}
  }
  assert(records.length===total,'后台列表读取不完整');return {records,total,at:new Date().toISOString(),shop:task.shopId,query:{title,itemId}};
 }
 return {page,search,guard:()=>checked(page)};
}
export function observedBusiness(row){
 const cell=label=>row.cells.find(x=>x.label===label)?.text||'';
 const price=Number(cell('价格').replace(/[¥￥,\s]/g,'')),inventory=Number(cell('库存').replace(/[,\s]/g,''));
 return {price,inventory,status:row.status};
}
export async function listingEvidence(table,row,task,dir,{newSubmission=false}={}){
 assert(/^\d+$/.test(row.itemId)&&row.title&&row.status,'后台商品证据不足');
 if(newSubmission){
  assert(row.title===task.listing.title,'后台商品标题与提交快照不符');
  const actual=observedBusiness(row);
  assert(actual.price===Number(task.business.price_cny),'后台商品价格与提交快照不符');
  assert(actual.inventory===Number(task.business.inventory),'后台商品库存与提交快照不符');
  assert(/^(出售中|仓库中|待审核|审核中)$/.test(row.status),'后台商品状态需人工核验：'+row.status);
 }
 await table.guard();await mkdir(dir,{recursive:true});
 const screenshot=join(dir,'verified-in-list.png');await table.page.screenshot({path:screenshot,fullPage:true});
 const actual=observedBusiness(row),differences=[];
 if(actual.price!==Number(task.business.price_cny))differences.push('当前价格与原快照不同，未改价');
 if(actual.inventory!==Number(task.business.inventory))differences.push('当前库存与原快照不同，未修改');
 const result={itemId:row.itemId,url:'https://item.taobao.com/item.htm?id='+row.itemId,status:row.status,rowText:row.text,screenshot,verifiedAt:new Date().toISOString(),observed:actual,differences};
 await writeFile(join(dir,'verification.json'),JSON.stringify({shop:task.shopId,title:row.title,...result},null,2));return result;
}
