// Read-only seller lookup followed by an atomic local reconciliation.
// No publish, edit, duplicate-listing or batch-start operation exists here.
import {mkdir,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {RoundManualSkip} from './round-manual-skip.mjs';
import {assertAuxiliaryPage} from './publishing-pages.mjs';
import {randomUUID} from 'node:crypto';
import {expect} from 'playwright/test';
import {digest} from './source-store.mjs';
import {visibleChallenge} from './browser-environment.mjs';
import {redact} from './product-state.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const fail=message=>{throw Error(message);};
const normalize=s=>String(s).replace(/\s+/g,' ').trim();
export function submissionWindow(events){
 const start=events.findLast(x=>x.kind==='SUBMITTING');
 const end=start&&events.find(x=>x.seq>start.seq&&x.kind==='RESULT_UNKNOWN');
 if(!start||!end||!Number.isFinite(Date.parse(start.at))||!Number.isFinite(Date.parse(end.at))||Date.parse(end.at)<Date.parse(start.at))fail('缺少原任务提交时间证据，保持待核验');
 return {from:Math.floor(Date.parse(start.at)/60000)*60000,to:Math.ceil(Date.parse(end.at)/60000)*60000};
}
// The original submit interval, never a new recovery's wall clock. A missing
// receipt permits observation only; this module has no publish operation.
export function submissionLookupWindow(events,through=new Date().toISOString()){
 const start=events.findLast(x=>x.kind==='SUBMITTING');
 const end=start&&events.find(x=>x.seq>start.seq&&x.kind==='RESULT_UNKNOWN');
 if(!start)fail('缺少原任务提交时间证据，保持待核验');
 const from=Date.parse(start.at),to=Date.parse(end?.at||through);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)fail('原提交时间证据无效，保持待核验');
 const clicked=start&&events.find(x=>x.seq>start.seq&&x.kind==='SUBMIT_CLICKED'&&(!end||x.seq<end.seq));
 const clickedAt=Date.parse(clicked?.at);
 if(!Number.isFinite(clickedAt)||clickedAt<from||clickedAt>to)fail('缺少原任务实际提交点击时间，保持待核验');
 return {from:Math.floor(from/60000)*60000,to:Math.ceil(to/60000)*60000,clickedAt,observedThrough:to};
}
export function assertUnclaimedSubmissionId(store,run,itemId){
 for(const row of store.db.prepare('SELECT key,payload FROM history').all())if(row.key===run.key||String(JSON.parse(row.payload).itemId)===itemId)fail('原任务或该商品 ID 已有成功记录，请查看历史；不重复关联');
 for(const r of store.list())if(r.id!==run.id&&[r.checkpoint.itemId,r.checkpoint.reconciliation?.itemId,r.result?.itemId].some(v=>String(v)===itemId))fail('该商品 ID 已关联其他任务，禁止串用');
}
export async function readSubmittedListing({context,task,target,dir,guard,window,assertUnused,
 tableFactory,evidence,timeout=30000,interval=1200}){
 if(typeof assertUnused!=='function'||!window||!Number.isFinite(window.from)||!Number.isFinite(window.to)||!Number.isFinite(window.clickedAt)||!Number.isFinite(window.observedThrough)||window.from>window.to||window.clickedAt>window.observedThrough)fail('缺少原提交范围或商品归属检查，保持待核验');
 if(!Number.isFinite(timeout)||timeout<=0||timeout>30000||!Number.isFinite(interval)||interval<0||interval>2000)fail('后台只读确认预算无效');
 const unknown=message=>Object.assign(Error('已点击提交、回执未读到；'+message+'，保持 RESULT_UNKNOWN，禁止再次提交'),{code:'RESULT_UNKNOWN'});
 const deadline=Date.now()+timeout,controller=new AbortController();
 const checked=async page=>{if(controller.signal.aborted||Date.now()>=deadline)throw unknown('后台确认时间已用尽');await guard(page);if(controller.signal.aborted||Date.now()>=deadline)throw unknown('后台确认时间已用尽');};
 let timer;
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unknown('后台确认时间已用尽'));},timeout);});
 const lookup=(async()=>{
 if(!tableFactory||!evidence){const defaults=await import('./listing-verification.mjs');tableFactory??=defaults.sellerTable;evidence??=defaults.listingEvidence;}
 const table=await tableFactory(context,task,checked,{deadline,signal:controller.signal});
 for(let attempt=0;attempt<3;attempt++){
  await checked(table.page);
  const found=await table.search({title:task.listing.title});await checked(table.page);
  const rows=found.records.filter(row=>row.title===task.listing.title);
  if(rows.length>1)throw unknown('后台同标题商品不唯一，不能自动认领');
  if(rows.length===1){
   const row=rows[0];
   if(!/^\d{6,30}$/.test(String(row.itemId||'')))throw unknown('后台商品 ID 无效');
   const cell=label=>{const cells=(row.cells||[]).filter(c=>normalize(c.label).startsWith(label));if(cells.length!==1)throw unknown('后台'+label+'列不唯一或缺失');return cells[0].text;};
   let timeEvidence;
   try{timeEvidence=validateListing({name:row.title+'\nID: '+row.itemId,price:cell('价格'),inventory:cell('库存'),created:cell('创建时间')},task,row.itemId,window);}
   catch(error){throw unknown(error.message);}
   // Minute rounding alone could lend an old same-title product to this task.
   // Automatic recovery needs second precision strictly AFTER the actual click
   // second. Coarser/same-second timestamps remain unknown for manual review.
   const stamp=Date.parse(timeEvidence.createdAt.replace(' ','T')+'+08:00');
   if(!/\d{2}:\d{2}:\d{2}$/.test(timeEvidence.createdAt)||stamp<=Math.floor(window.clickedAt/1000)*1000||stamp>window.observedThrough||stamp>Date.now())throw unknown('后台创建时间精度不足或不在原提交点击与观察区间，不能自动认领');
   if(target==='WAREHOUSE'?row.status!=='仓库中':!['出售中','待审核','审核中'].includes(row.status))throw unknown('后台商品状态与原上架目标不符');
   await assertUnused(row.itemId);await checked(table.page);
   const result=await evidence(table,row,task,dir,{newSubmission:true,deadline});
   await checked(table.page);await assertUnused(row.itemId);
   if(String(result?.itemId)!==row.itemId||!result.rowText||!result.screenshot||!Number.isFinite(Date.parse(result.verifiedAt)))throw unknown('后台确认凭证不完整');
   return {...result,...timeEvidence,submissionRecovery:{method:'frozen-title-read-only',attempt:attempt+1,submissionWindow:window}};
  }
  if(attempt<2)await delay(Math.min(interval,Math.max(0,deadline-Date.now())));
 }
 throw unknown('后台三次只读查询仍未找到唯一匹配商品');
 })();
 try{return await Promise.race([lookup,expired]);}finally{clearTimeout(timer);controller.abort();}
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

export async function inspectExistingListing({context,task,itemId,target,dir,guard,window,tableFactory,evidence}){
 if(!tableFactory||!evidence){const defaults=await import('./listing-verification.mjs');tableFactory??=defaults.sellerTable;evidence??=defaults.listingEvidence;}
 const table=await tableFactory(context,task,guard),found=await table.search({itemId});await guard(table.page);
 const rows=found.records.filter(row=>String(row.itemId)===itemId);
 if(rows.length!==1)fail('后台未找到唯一的原商品 ID，保持待核验');
 const row=rows[0],cell=label=>{const values=(row.cells||[]).filter(c=>normalize(c.label).startsWith(label));if(values.length!==1)fail('后台'+label+'列缺失或不唯一');return values[0].text;};
 const timeEvidence=validateListing({name:row.title+'\nID: '+row.itemId,price:cell('价格'),inventory:cell('库存'),created:cell('创建时间')},task,itemId,window);
 if(target==='WAREHOUSE'?row.status!=='仓库中':row.status!=='出售中')fail('后台商品状态与原上架目标不一致，保持待核验');
 const result=await evidence(table,row,task,dir,{newSubmission:true});await guard(table.page);
 return {...result,...timeEvidence};
}

export class ResultReconciliation {
 constructor(api,inspect=inspectExistingListing){this.api=api;this.inspect=inspect;}
 assertUnused(run,itemId){
  assertUnclaimedSubmissionId(this.api.source.store,run,itemId);
 }
 async associate(input){
  const api=this.api,{source,batch,owner,shop}=api,store=source.store;
  const itemId=String(input.itemId||'').trim();
  if(!/^\d{6,30}$/.test(itemId)||input.confirmed!==true)fail('请输入后台商品 ID，并确认核对原店铺与商品');
  if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))fail('缺少操作编号，请重新打开核验窗口');
  const requestHash=digest({id:input.id,itemId,confirmed:input.confirmed,confirmedBy:input.confirmedBy??null,reason:input.reason??null,roundId:input.roundId??null,windowId:input.windowId??null,key:input.key??null,expectedRevision:input.expectedRevision??null});
  const previous=store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);
  if(previous){const result=JSON.parse(previous.result);if(previous.action!=='reconcile'||previous.target!==input.id||result.itemId!==itemId||result.requestHash&&result.requestHash!==requestHash)fail('请求编号不能用于其他关联');return {...result,replayed:true};}
  if(api.reconciling||api.capturing||source.active||batch.active)fail('有任务运行或核验中，请等待停止后再关联');
  const run=store.run(input.id);
  if(run.state!=='RESULT_UNKNOWN'||run.mode!=='LIVE'||run.task.shopId!==shop.id||run.task.business.shop_name!==shop.name)fail('只允许核验原店铺中正式提交结果不明的任务');
  if(run.checkpoint.itemId&&run.checkpoint.itemId!==itemId)fail('原断点已有不同商品 ID，不能替换');
  this.assertUnused(run,itemId);const window=submissionWindow(store.events(run.id));
  const revision=digest(run),queue=store.db.prepare('SELECT id,batch FROM batch_items WHERE run_id=?').get(run.id);
  const queueRevision=queue?digest(batch.store.item(queue.id)):null;
  const round=api.round,bindings=round?store.db.prepare('SELECT round_id,key FROM round_items WHERE run_id=?').all(run.id):[];
  if(bindings.length>1)fail('原任务对应多个轮次，不能自动关联');
  let bound=null,reader=null;
  const readBound=()=>{
   round.assertIdle();if(round.creating||round.hasUnsettledExecution()||round.executionAttempts?.blocked)fail('轮次执行尚未停稳，请等待后再核验');
   const r=round.assertManifest(bindings[0].round_id),w=round.windows.open(r.id);
   if(!w||w.finished)fail('原轮次窗口已结束，请使用原商品核验入口');
   const current=reader.read({roundId:r.id,windowId:w.id,key:bindings[0].key});
   if(current.x.state!=='RESULT_UNKNOWN'||current.run?.id!==run.id||current.run.state!=='RESULT_UNKNOWN'||current.assignment.outcome||!current.x.entered_publish||['content-review','content-preflight'].includes(current.x.failure_stage))fail('原商品当前状态不允许关联结果');
   if(!['RESULT_UNKNOWN','PAUSED','SYSTEM_BLOCKED','WAITING_HUMAN','STOPPED'].includes(r.state))fail('原轮次当前状态不允许关联结果');
   if(store.db.prepare('SELECT id FROM round_item_attempts WHERE key=? AND finished_at IS NULL').get(current.x.key))fail('原商品还有未完成操作，请先核对原请求');
   round.assertContentForTask(current.x.task,r.id);
   return current;
  };
  if(bindings.length){
   reader=new RoundManualSkip(round,{readOnly:true});bound=readBound();
   if(input.roundId!==undefined&&(input.roundId!==bound.r.id||input.windowId!==bound.w.id||input.key!==bound.x.key||input.expectedRevision!==bound.revision))fail('原商品或窗口已变化，请刷新后核验');
  }else if(input.roundId!==undefined)fail('原商品不属于请求的轮次');
  const actor={name:String(input.confirmedBy||'本机操作者').trim(),identitySource:'LOCAL_OPERATOR_DECLARATION'};
  if(!actor.name||actor.name.length>80)fail('请填写本次核验确认人');
  const reason=String(input.reason||'操作者确认原提交回执商品 ID，并请求后台交叉核验').trim();
  if(!reason||reason.length>1000)fail('请填写有效核验原因');
  const assertOriginal=()=>{
   if(digest(store.run(run.id))!==revision)fail('原任务已变化，请重新核验');
   if(queue&&digest(batch.store.item(queue.id))!==queueRevision)fail('原队列记录已变化，请重新核验');
   if(bound){
    // source.active is this read-only association's lease; do not treat it as another publisher.
    if(round.active||batch.active||source.active!==run.id||api.round!==round)fail('核验执行归属已变化');
    const current=reader.read({roundId:bound.r.id,windowId:bound.w.id,key:bound.x.key});
    if(current.revision!==bound.revision||round.windows.open(bound.r.id)?.id!==bound.w.id)fail('原轮次或商品记录已变化，请重新核验');
    round.assertContentForTask(current.x.task,bound.r.id);
   }
  };
  if(queue&&batch.store.item(queue.id).state!=='WAITING_HUMAN')fail('原队列状态不支持关联，请先检查任务');
  api.reconciling=true;source.active=run.id;source.stop=false;
  const context=owner.sessions.get(shop.id)?.context;
  const guard=async page=>{
   if(source.stop)fail('操作者暂停核验；原任务保持待核验');
   const status=await owner.status(shop);
   if(status.loginState==='PAUSED_CAPTCHA'||page&&await visibleChallenge(page))fail('出现验证码，请人工处理后重新核验');
   if(!status.running||!status.loggedIn||owner.sessions.get(shop.id)?.context!==context)fail('请先在原店铺执行 Chrome 登录，保留会话');
   if(page){
    assertAuxiliaryPage(page,'verification');
    const identity=page.locator('div.shopName--x6nyUylx');await expect(identity).toHaveCount(1);await expect(identity).toHaveText(shop.name,{useInnerText:true});
   }
  };
  try{
   if(!(await api.integrity()).ok)fail('内核完整性未通过，不能关联');
   if(!context)fail('原店铺执行 Chrome 未连接');await guard();
   const target=run.target==='WAREHOUSE'||run.task.business.listing_time==='放入仓库'?'WAREHOUSE':'SOURCE';
   const result=await this.inspect({context,task:run.task,itemId,target,dir:join(source.artifacts,run.id,'association',input.requestId),guard,window});
   await guard();
   if(result.itemId!==itemId||!result.rowText||!result.status||!result.verifiedAt||!result.createdAt)fail('缺少完整的后台核验证据');
   const image=await readFile(result.screenshot);if(image.length<8||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('核验截图无效，保持待核验');
   if(!(await api.integrity()).ok)fail('核验期间内核发生变化，保持待核验');await guard();assertOriginal();
   if(bound)round.assertResultIdentity(bound.r.id,bound.x.key,result);
   let originalEvidence=null;
   if(run.checkpoint.screenshot){
    const root=resolve(source.artifacts,run.id),path=resolve(run.checkpoint.screenshot),rel=relative(root,path);
    if(rel&&!rel.startsWith('..')&&!rel.includes(':')){
     try{const bytes=await readFile(path);if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))originalEvidence={path,sha256:digest(bytes),at:run.checkpoint.screenshotAt||null};}catch{}
    }
   }
   const audit={actor,reason,confirmed:true,originalEvidence,submissionWindow:window,originalRunId:run.id,roundId:bound?.r.id||null,windowId:bound?.w.id||null,key:run.key};
   const receipt={accepted:true,requestHash,id:run.id,itemId,state:'VERIFIED',batchId:queue?.batch||null,batchContinued:false};
   store.transaction(()=>{
    assertOriginal();
    this.assertUnused(run,itemId);
    store.checkpoint(run.id,{itemId,screenshot:result.screenshot,screenshotAt:result.verifiedAt,screenshotError:null,reconciliation:{requestId:input.requestId,itemId,verifiedAt:result.verifiedAt,screenshot:result.screenshot,...audit}});
    store.db.prepare("UPDATE runs SET state='VERIFIED',reason='',result=? WHERE id=? AND state='RESULT_UNKNOWN'").run(JSON.stringify(result),run.id);
    store.history(run.task,result);store.event(run.id,'RESULT_RECONCILED',{itemId,requestId:input.requestId,result,...audit});store.event(run.id,'VERIFIED',{reason:'原商品关联核验',result});
    if(queue){
     batch.store.move(queue.id,'SUCCEEDED','原商品关联核验；未启动余下任务',result);
     const remaining=batch.store.items(queue.batch).some(x=>['PENDING','RETRY','WAITING_HUMAN','RUNNING'].includes(x.state));
     batch.store.setBatch(queue.batch,remaining?'PAUSED':'COMPLETED',remaining?'原商品已核验，剩余任务需重新确认后继续':'原商品已核验，本批结束');
    }
    if(bound){
     store.event(run.id,'SUBMIT_EVIDENCE',{method:'original-receipt-backend-reconciliation',itemId,requestId:input.requestId,screenshot:result.screenshot,originalEvidence,submittedByThisAction:false});
     round.update(bound.r.id,bound.x.key,{state:'NEW_SUCCESS',result,...round.submissionFlags(store.run(run.id),bound.r.id),finished:new Date().toISOString(),reason:'原提交回执商品已在后台核验，未再次提交'});
     round.event(bound.r.id,bound.x.key,'ITEM_RESULT_ASSOCIATED',{requestId:input.requestId,itemId,windowId:bound.w.id,...audit,submittedByThisAction:false});
     round.state(bound.r.id,bound.r.stopped?'STOPPED':'PAUSED','原商品核验完成；其余商品保持原状态，可检查后继续本轮');
    }
    store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(input.requestId,'reconcile',run.id,new Date().toISOString(),JSON.stringify(receipt));
   });
   return receipt;
  }catch(error){
   store.event(run.id,'RECONCILIATION_REJECTED',{itemId,error:redact(error.message).slice(0,500)});throw error;
  }finally{api.reconciling=false;if(source.active===run.id)source.active=null;}
 }
}
