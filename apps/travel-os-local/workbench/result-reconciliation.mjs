// Read-only seller lookup followed by an atomic local reconciliation.
// No publish, edit, duplicate-listing or batch-start operation exists here.
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect} from 'playwright/test';
import {digest} from './source-store.mjs';
import {visibleChallenge} from './browser-environment.mjs';
import {redact} from './product-state.mjs';

const fail=message=>{throw Error(message);};
const normalize=s=>String(s).replace(/\s+/g,' ').trim();
export function submissionWindow(events){
 const start=events.findLast(x=>x.kind==='SUBMITTING');
 const end=start&&events.find(x=>x.seq>start.seq&&x.kind==='RESULT_UNKNOWN');
 if(!start||!end||!Number.isFinite(Date.parse(start.at))||!Number.isFinite(Date.parse(end.at)))fail('缺少原任务提交时间证据，保持待核验');
 return {from:Math.floor(Date.parse(start.at)/60000)*60000,to:Math.ceil(Date.parse(end.at)/60000)*60000};
}
export function validateListing(row,task,itemId,window){
 const lines=row.name.split(/\r?\n/).map(normalize).filter(Boolean);
 if(!lines.includes(normalize(task.listing.title)))fail('后台商品标题与原冻结标题不一致');
 if(!new RegExp('(?:^|\\s)ID\\s*[:：]\\s*'+itemId+'(?:\\s|$)').test(row.name))fail('后台商品 ID 不一致');
 const price=normalize(row.price).replace(/[¥￥,\s]/g,'');
 if(!/^\d+(?:\.\d{1,2})?$/.test(price)||Number(price)!==Number(task.business.price_cny))fail('后台商品价格与原冻结价格不一致');
 const inventory=normalize(row.inventory).replaceAll(',','');
 if(!/^\d+$/.test(inventory)||Number(inventory)!==Number(task.business.inventory))fail('后台商品库存与原冻结库存不一致');
 const times=row.created.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?/g)||[];
 if(times.length!==1)fail('后台创建时间无法唯一识别，保持待核验');
 // Seller management displays China time. Minute precision is bounded by the
 // original submission interval rounded outward to minutes, never by now().
 const stamp=Date.parse(times[0].replace(' ','T')+'+08:00');
 if(!Number.isFinite(stamp)||stamp<window.from||stamp>window.to)fail('后台创建时间与本次提交时间不匹配，保持待核验');
 return {createdAt:times[0],timeZone:'Asia/Shanghai',submissionWindow:window};
}

export async function inspectExistingListing({context,task,itemId,target,dir,guard,window}){
 const address='https://myseller.taobao.com/home.htm/SellManage/all';
 let page=context.pages().find(p=>p.url().startsWith('https://myseller.taobao.com/home.htm/SellManage/'));
 if(!page){page=await context.newPage();await page.goto(address,{waitUntil:'domcontentloaded'});}
 await guard(page);
 const tab=page.getByRole('tab',{name:target==='WAREHOUSE'?/^仓库中\(/:/^全部\(/});await tab.click();
 await page.locator('#queryTitle').fill('');await page.locator('#queryItemId').fill(itemId);await guard(page);
 await page.getByRole('button',{name:'搜索',exact:true}).click();
 const row=page.locator('tr').filter({hasText:new RegExp('ID\\s*[:：]\\s*'+itemId+'(?!\\d)')});
 await expect(row).toHaveCount(1,{timeout:10000});
 const table=row.locator('xpath=ancestor::table[1]'),headers=await table.locator('thead th').allInnerTexts();
 const fields={};
 for(const [key,label] of [['name','商品名称'],['price','价格'],['inventory','库存'],['created','创建时间']]){
  const indices=headers.map((h,i)=>normalize(h).startsWith(label)?i:-1).filter(i=>i>=0);
  if(indices.length!==1)fail('无法识别后台的'+label+'列，保持待核验');
  fields[key]=await row.locator('td').nth(indices[0]).innerText();
 }
 const timeEvidence=validateListing(fields,task,itemId,window),rowText=await row.innerText();
 if(target==='WAREHOUSE')await expect(tab).toHaveAttribute('aria-selected','true');
 else if(!rowText.includes('出售中'))fail('原任务要求出售中，后台商品状态不一致');
 await guard(page);await mkdir(dir,{recursive:true});
 const screenshot=join(dir,'reconciled-'+randomUUID()+'.png');await page.screenshot({path:screenshot,fullPage:true,timeout:5000});
 await guard(page);
 return {itemId,url:'https://item.taobao.com/item.htm?id='+itemId,status:target==='WAREHOUSE'?'仓库中':'出售中',rowText,screenshot,verifiedAt:new Date().toISOString(),...timeEvidence};
}

export class ResultReconciliation {
 constructor(api,inspect=inspectExistingListing){this.api=api;this.inspect=inspect;}
 assertUnused(run,itemId){
  const store=this.api.source.store;
  for(const row of store.db.prepare('SELECT key,payload FROM history').all())if(row.key===run.key||String(JSON.parse(row.payload).itemId)===itemId)fail('原任务或该商品 ID 已有成功记录，请查看历史；不重复关联');
  for(const r of store.list())if(r.id!==run.id&&[r.checkpoint.itemId,r.checkpoint.reconciliation?.itemId,r.result?.itemId].some(v=>String(v)===itemId))fail('该商品 ID 已关联其他任务，禁止串用');
 }
 async associate(input){
  const api=this.api,{source,batch,owner,shop}=api,store=source.store;
  const itemId=String(input.itemId||'').trim();
  if(!/^\d{6,30}$/.test(itemId)||input.confirmed!==true)fail('请输入后台商品 ID，并确认核对原店铺与商品');
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))fail('缺少操作编号，请重新打开核验窗口');
  const previous=store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);
  if(previous){const result=JSON.parse(previous.result);if(previous.action!=='reconcile'||previous.target!==input.id||result.itemId!==itemId)fail('请求编号不能用于其他关联');return {...result,replayed:true};}
  if(api.reconciling||api.capturing||source.active||batch.active)fail('有任务运行或核验中，请等待停止后再关联');
  const run=store.run(input.id);
  if(run.state!=='RESULT_UNKNOWN'||run.mode!=='LIVE'||run.task.shopId!==shop.id||run.task.business.shop_name!==shop.name)fail('只允许核验原店铺中正式提交结果不明的任务');
  if(run.checkpoint.itemId&&run.checkpoint.itemId!==itemId)fail('原断点已有不同商品 ID，不能替换');
  this.assertUnused(run,itemId);const window=submissionWindow(store.events(run.id));
  const revision=digest(run),queue=store.db.prepare('SELECT id,batch FROM batch_items WHERE run_id=?').get(run.id);
  if(queue&&batch.store.item(queue.id).state!=='WAITING_HUMAN')fail('原队列状态不支持关联，请先检查任务');
  api.reconciling=true;source.active=run.id;source.stop=false;
  const context=owner.sessions.get(shop.id)?.context;
  const guard=async page=>{
   if(source.stop)fail('操作者暂停核验；原任务保持待核验');
   const status=await owner.status(shop);
   if(status.loginState==='PAUSED_CAPTCHA'||page&&await visibleChallenge(page))fail('出现验证码，请人工处理后重新核验');
   if(!status.running||!status.loggedIn||owner.sessions.get(shop.id)?.context!==context)fail('请先在原店铺执行 Chrome 登录，保留会话');
   if(page){
    if(!page.url().startsWith('https://myseller.taobao.com/home.htm/SellManage/'))fail('核验页面已改变，保持待核验');
    const identity=page.locator('div.shopName--x6nyUylx');await expect(identity).toHaveCount(1);await expect(identity).toHaveText(shop.name,{useInnerText:true});
   }
  };
  try{
   if(!(await api.integrity()).ok)fail('内核完整性未通过，不能关联');
   if(!context)fail('原店铺执行 Chrome 未连接');await guard();
   const target=run.target==='WAREHOUSE'||run.task.business.listing_time==='放入仓库'?'WAREHOUSE':'SOURCE';
   const result=await this.inspect({context,task:run.task,itemId,target,dir:join(source.artifacts,run.id),guard,window});
   await guard();
   if(result.itemId!==itemId||!result.rowText||!result.status||!result.verifiedAt||!result.createdAt)fail('缺少完整的后台核验证据');
   const image=await readFile(result.screenshot);if(image.length<8||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('核验截图无效，保持待核验');
   const receipt={accepted:true,id:run.id,itemId,state:'VERIFIED',batchId:queue?.batch||null,batchContinued:false};
   store.transaction(()=>{
    if(digest(store.run(run.id))!==revision)fail('原任务已变化，请重新核验');
    this.assertUnused(run,itemId);
    store.checkpoint(run.id,{itemId,screenshot:result.screenshot,screenshotAt:result.verifiedAt,screenshotError:null,reconciliation:{requestId:input.requestId,itemId,verifiedAt:result.verifiedAt,screenshot:result.screenshot}});
    store.db.prepare("UPDATE runs SET state='VERIFIED',reason='',result=? WHERE id=? AND state='RESULT_UNKNOWN'").run(JSON.stringify(result),run.id);
    store.history(run.task,result);store.event(run.id,'RESULT_RECONCILED',{itemId,requestId:input.requestId,result});store.event(run.id,'VERIFIED',{reason:'原商品关联核验',result});
    if(queue){
     batch.store.move(queue.id,'SUCCEEDED','原商品关联核验；未启动余下任务',result);
     const remaining=batch.store.items(queue.batch).some(x=>['PENDING','RETRY','WAITING_HUMAN','RUNNING'].includes(x.state));
     batch.store.setBatch(queue.batch,remaining?'PAUSED':'COMPLETED',remaining?'原商品已核验，剩余任务需重新确认后继续':'原商品已核验，本批结束');
    }
    store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'reconcile',run.id,new Date().toISOString(),JSON.stringify(receipt));
   });
   return receipt;
  }catch(error){
   store.event(run.id,'RECONCILIATION_REJECTED',{itemId,error:redact(error.message).slice(0,500)});throw error;
  }finally{api.reconciling=false;if(source.active===run.id)source.active=null;}
 }
}
