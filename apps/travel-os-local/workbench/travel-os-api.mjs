// Product-only adapter. Execution is delegated to the frozen engine and its V1 gates.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TravelOsStore,geoKey,problem} from './travel-os-store.mjs';
import {destinationCatalog} from './destination-catalog.mjs';
import {browserView,redact} from './product-state.mjs';
import {destinationKey,digest} from './source-store.mjs';
import {materialLibrary} from './material-library.mjs';
import {readFile,realpath} from 'node:fs/promises';
import {auditSignature,readMaterialAudit,scanMaterials} from './material-audit.mjs';
export class TravelOsApi {
 constructor({product,shops,addShop,browser,launch,runtime}){Object.assign(this,{product,shops,addShop,browser,launch,runtime});this.store=new TravelOsStore(join(runtime,'travel-os','product.sqlite'));}
 async catalog(){const p=await this.product(),shops=await this.shops();const products=shops.flatMap(s=>destinationCatalog(p.source.store,s.id).items.map(d=>({...d,shopId:s.id,shopName:s.name,geoKey:geoKey(d)})));return {products,shops};}
 async materialAudit(shopId,rescan=false){
  const p=await this.product(),{products,shops}=await this.catalog();
  if(!shops.some(s=>s.id===shopId&&!this.store.removed(s.id)))throw problem('店铺不存在',404);
  const scoped=products.filter(x=>x.shopId===shopId),settings=await p.settings();
  if(!rescan)return readMaterialAudit(this.runtime,shopId,auditSignature(scoped,settings));
  if(p.source.active||p.batch.active)throw problem('任务执行中，请暂停后检索资料');
  this.auditRuns??=new Map();
  if(!this.auditRuns.has(shopId))this.auditRuns.set(shopId,scanMaterials({runtime:this.runtime,shopId,products:scoped,store:p.source.store,settings}).finally(()=>this.auditRuns.delete(shopId)));
  return this.auditRuns.get(shopId);
 }
 async materials(products){
  const signature=digest(products.map(d=>[d.key,d.source.importId]));
  if(this.materialCache?.signature===signature&&Date.now()-this.materialCache.at<30000)return this.materialCache.value;
  const p=await this.product(),imports=new Map(),byShop=new Map();
  for(const d of products){if(!imports.has(d.source.importId))imports.set(d.source.importId,new Map((p.source.store.batch(d.source.importId)?.tasks||[]).map(t=>[destinationKey(t),t])));const task=imports.get(d.source.importId).get(d.key);if(task){if(!byShop.has(d.shopId))byShop.set(d.shopId,[]);byShop.get(d.shopId).push(task);}}
  const assets=new Map();
  const value=Object.fromEntries(await Promise.all([...byShop].map(async([shopId,tasks])=>[shopId,await materialLibrary(tasks,{assetUrl:file=>{const id=digest([shopId,file]);assets.set(id,{file,shopId});return '/api/os/material-asset?id='+id;}})])));
  this.materialAssets=assets;
  this.materialCache={signature,at:Date.now(),value};return value;
 }
 async selectedPreview(input){const p=await this.product(),{products,shops}=await this.catalog(),d=products.find(x=>x.key===input.productKey),shop=shops.find(s=>s.id===input.shopId&&!this.store.removed(s.id));
  if(!d||!shop)throw problem('商品或店铺不存在',404);
  if(shop.id!==p.shop.id||d.shopId!==shop.id)throw problem('此店铺尚未完成该商品的执行适配，不能修改原任务的店铺归属');
  const imported=p.source.store.batch(d.source.importId),task=imported?.tasks.find(t=>destinationKey(t)===d.key);
  if(!task)throw problem('原始任务快照不存在，请重新导入资料');
  if(task.adapterIssues?.length)throw problem('资料未齐备：'+task.adapterIssues.join('；'));
  if(p.source.store.completed(task))throw problem('商品已有成功记录，禁止重复发布');
  if(p.source.store.db.prepare('SELECT 1 FROM runs WHERE key=?').get(d.key)||p.source.store.db.prepare('SELECT 1 FROM batch_items WHERE key=?').get(d.key))throw problem('商品已有任务，请从原任务继续');
  return {importId:imported.id,task,selectionHash:digest([task]),shop:{id:shop.id,name:shop.name},scope:'仅所选目的地 '+d.destination+'，1 个商品；默认仅填写，创建后不会自动开始'};
 }
 async snapshot(){const p=await this.product(),{products,shops}=await this.catalog(),state=await p.snapshot();
 const safeShops=shops.filter(s=>!this.store.removed(s.id)).map(s=>({id:s.id,name:s.name,createdAt:s.createdAt,executionSupported:s.id===state.shop.id&&products.some(d=>d.shopId===s.id),browser:s.id===state.shop.id?state.browser:browserView(this.browser.sessions.get(s.id)?.last),products:products.filter(d=>d.shopId===s.id).length}));
 const attempts=p.source.store.list().map(r=>({id:r.id,shopId:r.task.shopId,destination:r.task.listing.city||r.task.listing.country,geoKey:geoKey(r.task.listing),title:r.task.listing.title,state:r.state,reason:redact(r.reason),batchId:p.source.store.db.prepare('SELECT batch FROM batch_items WHERE run_id=?').get(r.id)?.batch||null,step:r.checkpoint?.step||null,at:r.at,updated:r.updated,itemId:r.result?.itemId||r.checkpoint?.itemId||null}));
 return {at:new Date().toISOString(),products,materials:await this.materials(products),shops:safeShops,quotes:this.store.quotes(),preparations:this.store.preparations(),attempts,engine:state,capabilities:{selectedDestinationExecution:true,multiShopExecution:false,automaticRetry:false,reason:'所选商品经原快照、已有任务、成功记录与资料检查后，可复用现有队列创建单项批次。新增店铺需完成执行适配。'}};}
 async handle(req,res,url,{body,json}){const action=url.pathname.slice('/api/os/'.length),p=await this.product();
 if(action==='material-audit'&&req.method==='GET')return json(res,200,await this.materialAudit(url.searchParams.get('shopId')));
 if(action==='material-audit'&&req.method==='POST'){
  const input=await body(req);if(Object.keys(input).some(k=>k!=='shopId'))throw problem('仅接受店铺标识，检索使用已配置资料目录',400);
  return json(res,200,await this.materialAudit(input.shopId,true));
 }
 if(req.method==='GET'&&action==='material-asset'){
  const {products}=await this.catalog();await this.materials(products);
  const asset=this.materialAssets?.get(url.searchParams.get('id'));
  if(!asset||this.store.removed(asset.shopId))throw problem('素材不存在',404);
  const actual=await realpath(asset.file).catch(()=>null);
  if(actual!==asset.file)throw problem('素材已变更，请重新读取资料',404);
  const bytes=await readFile(actual).catch(()=>null);if(!bytes)throw problem('素材无法读取',404);
  res.writeHead(200,{'content-type':/\.png$/i.test(actual)?'image/png':/\.webp$/i.test(actual)?'image/webp':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(bytes);
 }
 if(req.method==='GET'&&action==='state')return json(res,200,await this.snapshot());
 if(req.method==='GET'&&action==='selected-preview')return json(res,200,await this.selectedPreview(Object.fromEntries(url.searchParams)));
 if(req.method!=='POST')return json(res,404,{error:'未找到操作'});
 const input=await body(req),{products,shops}=await this.catalog(),shop=shops.find(s=>s.id===input.shopId&&!this.store.removed(s.id));let data;
 if(action==='selected-preview'){p.assertRulesIdle();const checked=await this.selectedPreview(input),prepared=await p.rules.prepare({...checked,tasks:[checked.task],limit:1},shop.id,'selected:'+input.productKey);data={...checked,task:prepared.tasks[0],selectionHash:prepared.selectionHash,draftId:prepared.draftId};}
 else if(action==='quotes/add')data=this.store.addQuote(input,products.find(d=>d.key===input.productKey));
 else if(action==='quotes/archive')data=this.store.archiveQuote(input.id);
 else if(action==='preparations/create')data=this.store.prepare(input,products.find(d=>d.key===input.productKey),shop);
 else if(action==='preparations/cancel')data=this.store.cancelPreparation(input.id);
 else if(action==='selected-create'){
  p.assertRulesIdle();if(!shop)throw problem('店铺不存在',404);
  if(input.draftId){
   if(input.mode!=='DRY_RUN')throw problem('此入口仅支持提交前暂停，不执行正式发布');
   const draft=p.rules.draft(input.draftId,shop.id);
   data=await p.rules.create({...input,importId:draft.importId},shop.id,p.batch,async()=>({tasks:[(await this.selectedPreview(input)).task]}),'selected:'+input.productKey);
  }else{
   if(p.rules.preset(shop.id).enabled)throw problem('请先核对随机预览');
  const checked=await this.selectedPreview(input);
  if(input.mode!=='DRY_RUN')throw problem('所选目的地入口当前仅支持 DRY_RUN；正式发布继续使用已验证的批次入口');
  if(input.review?.reviewed!==true||input.review.selectionHash!==checked.selectionHash)throw problem('资料预览已变化，请重新核对');
  data=p.batch.store.create(checked.importId,[checked.task],checked.shop.id,'DRY_RUN',input.review);
  }
  // The engine queue is authoritative. A crash before this link is repaired by the UI's original product key.
  for(const draft of this.store.preparations().filter(d=>d.productKey===input.productKey&&d.shopId===input.shopId&&d.state==='PREPARING'))this.store.db.prepare("UPDATE preparations SET state='QUEUED',payload=? WHERE id=?").run(JSON.stringify({...draft,batchId:data.id}),draft.id);
 }
 else if(action==='shops/add'){const name=String(input.name||'').trim();if(!name||name.length>80)throw problem('店铺名称须为 1—80 字',400);if(shops.some(s=>s.name===name&&!this.store.removed(s.id)))throw problem('该名称的店铺已存在');const added=await this.addShop(name);data={id:added.id,name:added.name};}
 else if(action==='shops/remove'){if(!shop)throw problem('店铺不存在',404);if(input.confirmName!==shop.name)throw problem('请核对要删除的店铺名称');const pending=p.source.store.list().some(r=>r.task.shopId===shop.id&&['RUNNING','SUBMITTING','RESULT_UNKNOWN','PAUSED','PAUSED_CAPTCHA','QUEUED'].includes(r.state));const queue=p.source.store.db.prepare("SELECT 1 FROM batches WHERE shop=? AND state IN ('READY','RUNNING','PAUSED','WAITING_HUMAN')").get(shop.id);if((p.batch.active||p.source.active)||pending||queue)throw problem('店铺仍有执行任务或待核验记录，处理后才能移除');data=this.store.removeShop(shop.id);}
 else if(['shops/check','shops/browser'].includes(action)){if(!shop)throw problem('店铺不存在',404);if(action==='shops/browser')await this.launch(shop);data={id:shop.id,browser:browserView(await this.browser.status(shop),Date.now(),true)};}
 else if(action==='batch/skip'){if(this.store.removed(p.shop.id))throw problem('执行店铺已移除');if(p.source.active||p.batch.active)throw problem('请先暂停并等待断点保存');const item=p.batch.store.item(input.taskId);if(item.batch!==input.id)throw problem('商品不属于此批次');const run=item.run_id?p.source.store.run(item.run_id):null;if(run&&['RESULT_UNKNOWN','SUBMITTING','RUNNING'].includes(run.state))throw problem('结果未确认，只能核验，不能跳过');if(!String(input.reason||'').trim())throw problem('请填写跳过原因',400);data=p.batch.skip(input.id,input.taskId,input.reason);}
 else throw problem('未实现此操作',404);
 return json(res,200,data);
 }
}
