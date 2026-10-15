import {readFile} from 'node:fs/promises';
import {basename,extname} from 'node:path';
import {digest,destinationKey} from './source-store.mjs';
import {assertShopInput} from './shop-identity.mjs';
import {contentPreflightRepairPlan,applyContentPreflightRepair} from './content-preflight-budget.mjs';

const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
const uuid=value=>/^[a-f0-9-]{36}$/i.test(value||'');
// All writes are explicit website preparation actions. None starts an executor.
export class ContentPreparation {
 constructor(owner){this.owner=owner;}
 scope(){
  const o=this.owner,latest=o.source.store.batch(),previous=o.round.round();
  const r=previous?.state==='COMPLETED'&&previous.import_id!==latest?.id?null:previous,imported=r?o.source.store.batch(r.import_id):latest;
  if(!imported)return {round:null,imported:null,items:[]};
  if(imported.tasks.some(t=>t.shopId!==o.shop.id))fail('资料不属于当前店铺');
  const items=r?o.round.items(o.round.assertManifest(r.id).id):imported.tasks.map((task,i)=>({key:destinationKey(task),position:i+1,task,task_hash:digest(task)}));
  return {round:r,imported,items};
 }
 view(url){
  const o=this.owner,{round,imported,items}=this.scope();
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)fail('无效审核页码');
  const reviews=new Map(round?items.map(x=>[x.key,o.contentReviews.inspect(x.task,round)]):[]);
  const count=decision=>[...reviews.values()].filter(x=>x.decision===decision).length;
  return {shop:o.shop,importId:imported?.id||null,total:items.length,offset,limit,reviewed:count('PASS'),mismatched:count('MISMATCH'),unreviewed:items.length-count('PASS')-count('MISMATCH'),round:round?{id:round.id,manifestHash:round.manifest_hash,state:round.state}:null,
   items:items.slice(offset,offset+limit).map(x=>({key:x.key,position:x.position,destination:x.task.listing.city||x.task.listing.country,title:x.task.listing.title,taskHash:x.task_hash,mainHashes:(x.task.assets.main||[]).map(a=>a.sha256),
    images:(x.task.assets.main||[]).map((a,index)=>({name:basename(a.path),url:'/api/v1/content-preparation/image?'+new URLSearchParams({executionShop:o.shop.id,...(round?{id:round.id}:{}),importId:imported.id,key:x.key,index:String(index)})})),
    review:reviews.get(x.key)||null,...(x.queue_id?o.batch.store.preflightBudget(x.queue_id):{}),
    repairEligible:!!(round&&contentPreflightRepairPlan({source:o.source,batch:o.batch,round,item:x}).eligible)}))};
 }
 async idle(){
  const o=this.owner;o.assertRulesIdle();o.round.assertIdle();
  if(o.round.creating||o.round.hasUnsettledExecution())fail('原任务尚未安全停止，请稍后核对');
  if(!(await o.integrity()).ok)fail('程序版本校验失败，不能修改审核记录');
  o.assertRulesIdle();o.round.assertIdle();
 }
 async image(url,res){
  const {round,imported,items}=this.scope(),x=items.find(v=>v.key===url.searchParams.get('key'));
  if(!imported||url.searchParams.get('importId')!==imported.id||(url.searchParams.get('id')||null)!==(round?.id||null)||!x)fail('图片范围已变化，请刷新审核页');
  const index=Number(url.searchParams.get('index')),a=x.task.assets.main?.[index];
  if(!Number.isInteger(index)||index<0||!a)fail('图片不存在');
  const bytes=await readFile(a.path);if(digest(bytes)!==a.sha256)fail('原主图已经变化，请重新核对资料版本');
  const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(a.path).toLowerCase()];
  if(!type)fail('图片格式不支持');
  res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);
 }
 async write(action,input){
  const o=this.owner;assertShopInput(input,o.shop.id);
  if(!uuid(input.requestId))fail('缺少有效操作编号，请刷新后重试');
  const actionName='content-preparation/'+action,target=action==='create'?input.importId:input.id,hash=digest(input);
  const previous=o.source.store.db.prepare('SELECT * FROM product_actions WHERE id=?').get(input.requestId);
  if(previous){const saved=JSON.parse(previous.result);if(previous.action!==actionName||previous.target!==target||saved.inputHash!==hash)fail('操作编号对应内容已变化');return {...saved,replayed:true};}
  await this.idle();
  let result;
  if(action==='create'){
   const existing=o.round.round(),imported=o.source.store.batch(input.importId);
   if(input.confirmed!==true||!imported||!Number.isInteger(input.expectedCount)||input.expectedCount!==imported.tasks.length)fail('请核对当前店铺及完整商品清单数量');
   if(existing&&existing.state!=='COMPLETED'){if(existing.import_id!==input.importId)fail('已有其他固定清单，请从原清单继续');o.round.assertManifest(existing.id);result={accepted:true,id:existing.id,existing:true};}
   else{
    if(existing?.import_id===input.importId)fail('本资料的执行清单已完成，请查看原结果');
    if(o.source.store.batch()?.id!==input.importId)fail('资料版本已更新，请重新核对最新清单');
    o.assertImportRules(input.importId);
    // Do not silently attach tasks from a different import or a DRY_RUN batch.
    const keys=new Set(imported.tasks.map(destinationKey));
    for(const row of o.source.store.db.prepare("SELECT id FROM batches WHERE state IN ('READY','RUNNING','PAUSED','WAITING_HUMAN')").all()){
     const b=o.batch.store.batch(row.id),queue=o.batch.store.items(row.id);
     if(b.shop!==o.shop.id||b.imported!==input.importId||b.mode!=='LIVE'||queue.some(q=>!keys.has(q.key)))fail('已有批次与当前资料或模式不一致，请核对原批次');
    }
    const kernel=await o.integrity();if(!kernel.ok)fail('程序版本已变化，请重新检查');
    const created=await o.round.create({importId:input.importId,expectedCount:input.expectedCount,repairVersion:kernel.revision,
     authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:o.shop.name,expectedCount:input.expectedCount,source:'website-explicit-fixed-list-confirmation'}});
    result={accepted:true,id:created.id,executionStarted:false};
   }
  }else{
   const r=o.round.assertManifest(input.id);if(r.shop!==o.shop.id||r.manifest_hash!==input.manifestHash)fail('原清单或店铺已变化，请刷新');
   const x=o.round.item(r.id,input.key);
   if(action==='review'){
    const prepared=await o.contentReviews.prepare(r,[x],{id:r.id,manifestHash:r.manifest_hash,method:'direct-visual',reviewer:input.reviewer,
     entries:[{key:x.key,taskHash:input.taskHash,mainHashes:input.mainHashes,decision:input.decision,observedText:input.observedText,evidence:x.task.assets.main.map(a=>({path:a.path,sha256:a.sha256}))}]});
    await this.idle();o.round.assertManifest(r.id);
    o.source.store.transaction(()=>{o.contentReviews.save(prepared);o.round.applyContentReviews(r.id,prepared);this.record(input.requestId,actionName,target,{accepted:true,id:r.id,key:x.key,inputHash:hash,executionStarted:false});});
    await o.round.report(r.id);return {accepted:true,id:r.id,key:x.key,inputHash:hash,executionStarted:false};
   }else if(action==='repair'){
    if(input.confirmed!==true)fail('请确认恢复原未启动记录');
    // A recovery credit is a separate audited decision, never an image approval.
    result=applyContentPreflightRepair({source:o.source,batch:o.batch,round:r,item:x});
    o.round.event(r.id,x.key,'CONTENT_PREFLIGHT_BUDGET_REPAIRED',{...result,requestId:input.requestId,notPublished:true});
   }else fail('未知资料审核操作');
  }
  result={...result,inputHash:hash,executionStarted:false};this.record(input.requestId,actionName,target,result);return result;
 }
 record(id,action,target,result){this.owner.source.store.db.prepare('INSERT INTO product_actions VALUES(?,?,?,?,?)').run(id,action,target,new Date().toISOString(),JSON.stringify(result));}
 async handle(req,res,url,{body,json}){
  const action=url.pathname.slice('/api/v1/content-preparation'.length).replace(/^\//,'');
  if(req.method==='GET'&&!action){json(res,200,this.view(url));return true;}
  if(req.method==='GET'&&action==='image'){await this.image(url,res);return true;}
  if(req.method==='POST'&&['create','review','repair'].includes(action)){
   const input=await body(req);if(this.writing)fail('正在保存审核操作，请等待完成后重试');
   this.writing=true;try{json(res,200,await this.write(action,input));}finally{this.writing=false;}return true;
  }
  fail('资料审核操作不存在');
 }
}
