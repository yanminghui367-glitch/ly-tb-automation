import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {digest} from './source-store.mjs';
import {assertShopInput} from './shop-identity.mjs';
import {readMaterialBinding,materialTask} from './round-material-binding.mjs';
import {executionDetailImages} from './taobao-publisher.mjs';
import {readExecutionProfile} from './source-workflow.mjs';
import {visibleChallenge} from './browser-environment.mjs';
import {setPageScope} from './page-ownership.mjs';
import {getAuxiliaryPage} from './publishing-pages.mjs';
import {createNativeMaterialUploadAdapter} from './publishing-materials.mjs';
import {createMaterialUploadPreparation} from './material-upload-preparation.mjs';

const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
const jobId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const read=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function save(file,value){await mkdir(join(file,'..'),{recursive:true});const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2));await rename(tmp,file);}
async function ensureMapping(file,value){const current=await read(file);if(current){if(digest(current)===digest(value))return;if(current.jobId===null&&value.jobId&&digest({...current,jobId:value.jobId})===digest(value)){await save(file,value);return;}fail('原图片准备映射已变化，请核对原记录');}await save(file,value);}
const submitKinds=new Set(['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED']);
const publicReason=value=>{const text=String(value||'');if(!text)return null;if(/[A-Za-z]:[\\/]|\b(?:ENOENT|EACCES|EPERM)\b/.test(text))return '本地图片文件无法读取或版本已变化，请检查资料后重新预览';return /[\u3400-\u9fff]/.test(text)?text.replace(/\b[A-Z][A-Z0-9_]{3,}\b/g,'').slice(0,500):'图片处理状态未能确认，请检查逐图结果并人工核对';};
const resourceName=path=>basename(String(path).replaceAll('\\','/'));
function localMaterialIssue(error,resources){
 const messages={ENOENT:'文件或其所在文件夹不存在',EACCES:'文件没有读取权限',EPERM:'文件读取被系统拒绝',ENOTDIR:'文件所在路径不是有效文件夹'},path=typeof error?.path==='string'?error.path:null;
 if(Object.hasOwn(messages,error?.code||''))return path&&resources.has(path)?`${messages[error.code]}：${resourceName(path)}。请回原资料文件夹补齐或修正后重新预览。`:null;
 // Binding identity, profile settings, SQL and general assertions are not local
 // missing-file issues. Only explicit asset-content failures may be excluded.
 if(error?.code&&!['ERR_ASSERTION','SOURCE_OR_ASSET_CHANGED'].includes(error.code))return null;
 const message=String(error?.message||'');if(/资料版本绑定检查失败/.test(message))return null;
 const code=error?.code==='SOURCE_OR_ASSET_CHANGED'?'SOURCE_OR_ASSET_CHANGED':message.match(/^(SOURCE_OR_ASSET_CHANGED|FORM_DETAIL_PADDING_SOURCE_CHANGED|FORM_DETAIL_PADDING_CHANGED|FORM_DETAIL_PADDING_PNG_REQUIRED|FORM_DETAIL_PADDING_DIMENSIONS)(?:\s|:|$)/)?.[1];
 if(!code)return null;
 const names=path&&resources.has(path)?[resourceName(path)]:[...resources].map(resourceName);
 return `资料文件内容与原快照或已确认图片规格不一致，请核对：${names.slice(0,6).join('、')||'本条商品的原资料文件'}${names.length>6?'等文件':''}。修正后重新导入核对并预览。`;
}
async function registerDeclaredPadding(runtime,task,resources){
 const profile=await read(join(runtime,'execution-profile.json')),entries=profile?.detailImagePadding;
 if(profile?.version!==1||profile.shopId!==task.shopId||profile.confirmedBy!=='用户'||!Array.isArray(entries)||!entries.length||entries.length>10)return;
 const fields=['sourcePath','sourceSha256','relativePath','sha256','dimensions','left','right'];
 if(new Set(entries.map(e=>e?.sourcePath)).size!==entries.length||entries.some(e=>!e||Object.keys(e).length!==fields.length||fields.some(k=>!Object.hasOwn(e,k))||typeof e.sourcePath!=='string'||!e.sourcePath||!['sourceSha256','sha256'].every(k=>/^[a-f0-9]{64}$/.test(e[k]||''))||!/^detail-image-padding\/[A-Za-z0-9_-]+\.png$/.test(e.relativePath||'')||![e.left,e.right].every(n=>Number.isInteger(n)&&n>=0&&n<=32)||e.left+e.right===0||!Array.isArray(e.dimensions)||e.dimensions.length!==2||!e.dimensions.every(n=>Number.isInteger(n)&&n>0)))return;
 // Only exact, structurally valid declarations are local file candidates. The
 // existing profile reader still validates all authorization/settings/symlinks.
 for(const entry of entries)resources.add(join(runtime,entry.relativePath));
}
export class MaterialPreparationApi{
 constructor(owner,{factory=createMaterialUploadPreparation,adapterFactory=null}={}){this.owner=owner;this.factory=factory;this.adapterFactory=adapterFactory;this.runtime=join(owner.runtime,'material-preparation-api');this.starting=false;this.engine=null;this.enginePromise=null;this.scope=null;this.currentIntent=null;this.closing=false;this.operationDone=null;}
 get active(){return this.starting||!!this.engine?.active;}
 async idle({own=false}={}){
  const o=this.owner;
  if(o.batch.active||o.source.active||o.capturing||o.reconciling||o.round.creating||o.round.hasUnsettledExecution()||o.materialPreparationOtherBusy?.()||!own&&this.active)fail('图片准备或商品处理尚未结束，请先暂停并等待当前操作完成');
  o.round.assertIdle();
 }
 config(input){
  assertShopInput(input,this.owner.shop.id);
  if(input.shopId!==this.owner.shop.id||!uuid(input.roundId))fail('图片准备的店铺或原清单不正确');
  const round=this.owner.round.assertManifest(input.roundId);
  if(round.shop!==this.owner.shop.id)fail('原清单属于其他店铺');
  if(input.windowId){
   if(!uuid(input.windowId)||input.startPosition!==undefined||input.endPosition!==undefined)fail('请只选择一个原窗口或一个清单序号范围');
   const window=this.owner.round.windows.assert(input.windowId,round.id);
   if(!window||window.round_id!==round.id)fail('图片准备窗口不属于原清单');
   const entries=this.owner.round.windows.entries(window.id);
   if(!entries.length||entries.length>100)fail('每次图片准备仅支持原窗口内最多100条商品');
   return {roundId:round.id,windowId:window.id,keys:entries.map(x=>x.key),manifestHash:round.manifest_hash};
  }
  const {startPosition,endPosition}=input;
  if(!Number.isInteger(startPosition)||!Number.isInteger(endPosition)||startPosition<1||endPosition<startPosition||endPosition-startPosition>=100)fail('请指定原清单内连续1—100条商品的有效序号');
  const all=this.owner.round.items(round.id);
  if(endPosition>all.length)fail('图片准备序号超过原清单范围');
  return {roundId:round.id,startPosition,endPosition,keys:all.filter(x=>x.position>=startPosition&&x.position<=endPosition).map(x=>x.key),manifestHash:round.manifest_hash};
 }
 async preview(input,{own=false}={}){
  await this.idle({own});if(!own&&await(await this.getEngine()).attention?.())fail('仍有原图片准备结果未确认，请先打开图片准备进度核对原任务');const o=this.owner,config=this.config(input),revision=o.round.selections.revision(config.roundId),items=o.round.items(config.roundId),files=new Map(),selected=[],excluded=[];
  for(const key of config.keys){
   const x=items.find(x=>x.key===key);if(!x)fail('原窗口中的商品已无法确认');
   const run=x.run_id?o.source.store.run(x.run_id):null,events=run?o.source.store.events(run.id):[],queue=x.queue_id?o.batch.store.item(x.queue_id):null;
   if(queue&&(queue.key!==x.key||digest(queue.task)!==x.task_hash))fail('原队列与固定商品快照不一致');
   const protectedItem=!['PENDING','FAILED'].includes(x.state)||x.submitted||x.submission_uncertain||x.result||queue&&['SUCCEEDED','SKIPPED','RUNNING'].includes(queue.state)||run&&(['SUBMITTING','RESULT_UNKNOWN','VERIFIED','RUNNING'].includes(run.state)||run.result||run.checkpoint?.itemId)||events.some(e=>submitKinds.has(e.kind)||e.kind==='STEP_INTENT'&&e.payload?.name==='submit-once')||o.round.parking?.has(config.roundId,x);
   if(protectedItem){excluded.push({key,position:x.position,destination:x.task.listing.city||x.task.listing.country,reason:'已提交、已结束或需要核验，图片准备不处理此商品'});continue;}
   if(x.task.shopId!==o.shop.id||digest(x.task)!==x.task_hash)fail('原商品快照或店铺归属已变化');
   let binding,profile,assets;
   const sources=[...(x.task.source?.workbook?[{path:x.task.source.workbook,sha256:x.task.source.sha256}]:[]),...(x.task.sourceReferences||[]).filter(s=>s?.workbook).map(s=>({path:s.workbook,sha256:s.sha256}))];
   const resources=new Set([...sources,...Object.values(x.task.assets||{}).flat()].filter(a=>typeof a?.path==='string').map(a=>a.path));
   resources.add(join(o.source.runtime,'detail-image-padding'));
   try{
    binding=readMaterialBinding(o.source.store.db,x.task);const effective=materialTask(x.task,binding);
    for(const a of Object.values(effective.assets||{}).flat())if(typeof a?.path==='string')resources.add(a.path);
    await registerDeclaredPadding(o.source.runtime,x.task,resources);profile=await readExecutionProfile(o.source.runtime,x.task);
    for(const a of profile?.detailImagePadding||[])if(typeof a?.path==='string')resources.add(a.path);
    const declared=[...sources,...(binding?.changes||[]).map(c=>({path:c.path,sha256:c.toSha256})),...Object.values(effective.assets||{}).flat(),...(profile?.detailImagePadding||[]).map(a=>({path:a.path,sha256:a.sha256}))];
    for(const asset of declared){
     if(!asset?.path||!/^[a-f0-9]{64}$/.test(asset.sha256||''))fail('原资料缺少文件或内容校验信息');
     const bytes=await readFile(asset.path);if(digest(bytes)!==asset.sha256)throw Object.assign(Error('SOURCE_OR_ASSET_CHANGED'),{code:'SOURCE_OR_ASSET_CHANGED',path:asset.path});
    }
    assets=[...(effective.assets.main||[]),...(effective.assets.secondary||[]),...await executionDetailImages(x.task,profile,binding)];
    await o.checkFiles(x.task);
   }catch(error){const reason=localMaterialIssue(error,resources);if(!reason)throw error;excluded.push({key,position:x.position,destination:x.task.listing.city||x.task.listing.country,reason});continue;}
   for(const asset of assets){if(!asset?.path||!/^[a-f0-9]{64}$/.test(asset.sha256||''))fail('原图片缺少文件或内容校验信息');const previous=files.get(asset.path);if(previous&&previous.sha256!==asset.sha256)fail('同一路径出现不同图片版本');files.set(asset.path,asset);}
   selected.push({key,position:x.position,destination:x.task.listing.city||x.task.listing.country,taskHash:x.task_hash,bindingHash:binding?.sha256||null,profileHash:profile?.sha256||null});
  }
  const assets=[...files.values()];
  await this.idle({own});if(o.round.selections.revision(config.roundId)!==revision)fail('检查期间原任务发生变化，请重新预览');
  const scope={shopId:o.shop.id,...config,revision,selected,excluded,items:assets.map(a=>({path:a.path,sha256:a.sha256,materialVersion:a.materialVersion||null}))},planHash=digest(scope);
  return {scope,view:{shopId:o.shop.id,roundId:config.roundId,windowId:config.windowId||null,startPosition:config.startPosition||null,endPosition:config.endPosition||null,planHash,selectedCount:selected.length,excludedCount:excluded.length,totalImages:assets.length,uniqueImages:new Set(assets.map(a=>a.sha256)).size,items:selected.map(({taskHash,bindingHash,profileHash,...x})=>x),excluded,images:assets.map(a=>({name:basename(a.path),sha256:a.sha256})),executionStarted:false}};
 }
 async guard(page){
  if(this.closing)fail('程序正在关闭，图片准备已停止领取新批次');
  await this.idle({own:true});const o=this.owner;
  if(!this.scope||o.round.selections.revision(this.scope.roundId)!==this.scope.revision)fail('图片准备的原任务或资料已变化，已停止继续上传');
  if(!(await o.integrity()).ok)fail('程序版本校验失败，图片准备已停止');
  const state=await o.owner.status(o.shop);
  if(!state.running||!state.loggedIn||state.loginState!=='LOGGED_IN')fail(state.loginState==='PAUSED_CAPTCHA'?'出现验证码，请先在专用浏览器人工处理':'请先打开并登录本店专用浏览器');
  if(page&&await visibleChallenge(page))fail('出现验证码，请先在专用浏览器人工处理');
 }
 async lookupGuard(saved,original,page){
  if(this.closing)fail('程序正在关闭，图片结果核查已停止');
  await this.idle({own:true});const o=this.owner,durable=await read(join(this.runtime,'jobs',original.id+'.json'));
  if(!saved.scope||saved.scope.shopId!==o.shop.id||digest(saved.scope)!==saved.input.planHash||!durable||digest(durable)!==digest(saved))fail('原图片准备任务身份或范围无法确认');
  const job=await(await this.getEngine()).view(original.id);
  if(job.shopId!==o.shop.id||job.requestId!==saved.input.requestId||job.intent!==digest({shopId:o.shop.id,items:saved.scope.items})||job.id!==original.id)fail('原上传图片与准备任务身份不一致');
  if(!(await o.integrity()).ok)fail('程序版本校验失败，不能核查上传结果');
  const state=await o.owner.status(o.shop);
  if(!state.running||!state.loggedIn||state.loginState!=='LOGGED_IN')fail(state.loginState==='PAUSED_CAPTCHA'?'出现验证码，请先在专用浏览器人工处理':'请先打开并登录本店专用浏览器');
  if(page&&await visibleChallenge(page))fail('出现验证码，请先在专用浏览器人工处理');
 }
 async getEngine(){
  if(this.engine)return this.engine;
  if(!this.enginePromise)this.enginePromise=Promise.resolve().then(()=>this.factory({runtime:this.owner.source.runtime,shopId:this.owner.shop.id,shopName:this.owner.shop.name,guard:()=>this.guard(),onJobCreated:async({job,requestId,action})=>{
   const intent=this.currentIntent;if(this.closing||!intent||intent.input.requestId!==requestId||intent.action!==action||!this.scope)fail('图片准备受理上下文不一致，上传未开始');
   if(action==='prepare'){
    await save(join(this.runtime,'requests',requestId+'.json'),{intentHash:intent.intentHash,input:intent.input,scope:this.scope,jobId:job.id});
    await save(join(this.runtime,'jobs',job.id+'.json'),{input:intent.input,scope:this.scope});
   }else await save(join(this.runtime,'controls',requestId+'.json'),{intentHash:intent.intentHash,jobId:job.id,action});
   await save(join(this.runtime,'latest.json'),{id:job.id});
  },adapter:{uploadBatch:async options=>(await this.adapter()).uploadBatch(options),lookupBatch:async options=>{const adapter=await this.adapter();return typeof adapter.lookupBatch==='function'?adapter.lookupBatch(options):[];}}})).then(engine=>this.engine=engine).catch(error=>{this.enginePromise=null;throw error;});
  return this.enginePromise;
 }
 async adapter({guard=page=>this.guard(page),scope=this.scope}={}){
  if(this.adapterFactory)return this.adapterFactory(guard);
  const o=this.owner;await guard();const context=o.owner.sessions.get(o.shop.id)?.context;if(!context)fail('本店专用浏览器未运行');
  setPageScope(context,{db:o.source.store.db,shopId:o.shop.id,runId:null,taskKey:'material-preparation:'+scope.roundId,taskHash:digest(scope),roundId:scope.roundId,executionWindowId:scope.windowId||null});
  const page=await getAuxiliaryPage(context,{role:'material',shopId:o.shop.id,url:'https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu',guard:page=>guard(page)});
  return createNativeMaterialUploadAdapter(page,()=>guard(page),{shopName:o.shop.name});
 }
 public(job){const interrupted=job.state==='RUNNING'&&!this.active;const files=job.files.map(f=>({name:f.name,sha256:f.sha256,state:interrupted&&f.state==='UPLOADING'?'UPLOAD_UNKNOWN':f.state,reason:publicReason(f.reason)}));return {id:job.id,shopId:job.shopId,state:interrupted?'ATTENTION_REQUIRED':job.state,active:this.active,reason:interrupted?'上次图片准备已中断，请核对未确认图片后再继续':publicReason(job.reason),stopRequested:job.stopRequested,createdAt:job.createdAt,updatedAt:job.updatedAt,counts:Object.fromEntries(['PENDING','UPLOADING','SUCCEEDED','FAILED','UPLOAD_UNKNOWN'].map(state=>[state,files.filter(f=>f.state===state).length])),files,executionStarted:false};}
 async jobView(job){const saved=await read(join(this.runtime,'jobs',job.id+'.json'));let scopeCurrent=false;try{scopeCurrent=!!saved?.scope&&this.owner.round.selections.revision(saved.scope.roundId)===saved.scope.revision;}catch{}return {...this.public(job),planHash:saved?.input.planHash||null,roundId:saved?.input.roundId||null,requestId:saved?.input.requestId||null,scopeCurrent};}
 async latest(){const latest=await read(join(this.runtime,'latest.json'));if(!latest)return null;const engine=await this.getEngine(),attention=await engine.attention?.();return this.jobView(attention||await engine.view(latest.id));}
 reserve(){
  if(this.closing)fail('程序正在关闭，不能开始图片准备');
  if(this.starting)fail('图片准备正在受理，请沿用原操作编号查询');
  this.starting=true;let settle;const operation=new Promise(resolve=>settle=resolve);this.operationDone=operation;
  return ()=>{this.starting=false;this.currentIntent=null;settle();if(this.operationDone===operation)this.operationDone=null;};
 }
 async start(input){
  const release=this.reserve();
  try{
   const allowed=['shopId','roundId','windowId','startPosition','endPosition','planHash','requestId','confirmed'];if(Object.keys(input).some(k=>!allowed.includes(k))||!uuid(input.requestId)||input.confirmed!==true||!/^[a-f0-9]{64}$/.test(input.planHash||''))fail('请先预览图片范围并明确确认');
   assertShopInput(input,this.owner.shop.id);const file=join(this.runtime,'requests',input.requestId+'.json'),before=await read(file),intentHash=digest(input);
   if(before){if(before.intentHash!==intentHash)fail('操作编号已用于其他图片范围');if(before.jobId){const original=await(await this.getEngine()).view(before.jobId);if(!before.scope||digest(before.scope)!==input.planHash||original.shopId!==this.owner.shop.id||original.requestId!==input.requestId||original.intent!==digest({shopId:this.owner.shop.id,items:before.scope.items}))fail('原图片准备请求与持久任务不一致');await ensureMapping(join(this.runtime,'jobs',original.id+'.json'),{input:before.input,scope:before.scope});if(!await read(join(this.runtime,'latest.json')))await save(join(this.runtime,'latest.json'),{id:original.id});return this.jobView(original);}}
   await this.idle({own:true});const engine=await this.getEngine();if(engine.active)fail('已有图片准备任务尚未结束');if(await engine.attention?.())fail('仍有原图片准备结果未确认，请先打开图片准备进度核对原任务');
   const checked=await this.preview(input,{own:true});if(!checked.view.selectedCount||!checked.view.uniqueImages)fail('本范围没有可准备图片的未提交商品');if(checked.view.planHash!==input.planHash)fail('原任务或图片范围已变化，请重新预览');
   this.scope=checked.scope;await this.guard();
   await save(file,{intentHash,input,scope:this.scope,jobId:null});this.currentIntent={input,intentHash,action:'prepare'};
   const job=await(await this.getEngine()).prepare({requestId:input.requestId,items:this.scope.items});
   // A surviving pre-dispatch engine job is mapped but never implicitly run.
   await ensureMapping(file,{intentHash,input,scope:this.scope,jobId:job.id});await ensureMapping(join(this.runtime,'jobs',job.id+'.json'),{input,scope:this.scope});if(!await read(join(this.runtime,'latest.json')))await save(join(this.runtime,'latest.json'),{id:job.id});
   return this.jobView(job);
  }finally{release();}
 }
 async control(action,input){
  const release=['resume','recheck'].includes(action)?this.reserve():()=>{};
  try{return await this.controlReserved(action,input);}catch(error){
   if(error.statusCode===409&&['resume','recheck'].includes(action)&&uuid(input?.requestId)&&jobId(input?.jobId)&&input.shopId===this.owner.shop.id){
    const saved=await read(join(this.runtime,'jobs',input.jobId+'.json')),file=join(this.runtime,'controls',input.requestId+'.json');
    if(saved?.input.planHash===input.planHash&&!await read(file))await save(file,{intentHash:digest({action,...input}),jobId:input.jobId,action,accepted:false,reason:publicReason(error.message)});
   }
   throw error;
  }finally{release();}
 }
 async controlReserved(action,input){
  assertShopInput(input,this.owner.shop.id);if(input.shopId!==this.owner.shop.id||!jobId(input.jobId)||!uuid(input.requestId)||Object.keys(input).some(k=>!['shopId','jobId','planHash','requestId'].includes(k)))fail('图片准备任务或店铺不正确');
  const saved=await read(join(this.runtime,'jobs',input.jobId+'.json'));if(!saved)fail('图片准备任务不属于本店原范围');const engine=await this.getEngine();
  if(input.planHash!==saved.input.planHash)fail('图片准备范围与原预览不一致');
  const file=join(this.runtime,'controls',input.requestId+'.json'),intentHash=digest({action,...input}),previous=await read(file);
  if(previous){if(previous.intentHash!==intentHash||previous.jobId!==input.jobId||previous.action!==action)fail('操作编号已用于其他图片处理');if(previous.accepted===false)fail(previous.reason||'原图片操作已被拒绝，请按当前条件重新核对');return this.jobView(await engine.view(input.jobId));}
  if(action==='pause'||action==='cancel'){const job=await engine[action](input.jobId);await save(file,{intentHash,jobId:input.jobId,action});return this.jobView(job);}
  if(action==='recheck'){
   await this.idle({own:true});if(engine.active)fail('请先暂停图片准备并等待当前批次结束');
   const original=await engine.view(input.jobId);if(!original.files.some(f=>['UPLOAD_UNKNOWN','UPLOADING'].includes(f.state)))fail('原任务没有需要只读核查的未确认图片');
   const lookupGuard=page=>this.lookupGuard(saved,original,page);await lookupGuard();
   this.scope=saved.scope;this.currentIntent={input,intentHash,action:'recheck'};
   const adapter=await this.adapter({guard:lookupGuard,scope:saved.scope});
   return this.jobView(await engine.recheck({jobId:input.jobId,requestId:input.requestId,guard:lookupGuard,adapter:{lookupBatch:options=>adapter.lookupBatch(options)}}));
  }
  if(action!=='resume')fail('无效图片准备操作');
  await this.idle({own:true});if(engine.active)fail('图片准备尚未安全停止');const attention=await engine.attention?.();if(attention&&attention.id!==input.jobId)fail('请先核对原来未确认的图片准备任务');const before=await engine.view(input.jobId);
  if(['CANCELLED','COMPLETED'].includes(before.state))fail('图片准备已取消或完成，不能继续旧任务');
  const checked=await this.preview(saved.input,{own:true});if(checked.view.planHash!==saved.input.planHash)fail('原商品或图片已变化，请重新核对，不能继续旧上传');
  this.scope=checked.scope;await this.guard();this.currentIntent={input,intentHash,action:'resume'};
  return this.jobView(await engine.resume({jobId:input.jobId,requestId:input.requestId}));
 }
 async shutdown(){this.closing=true;await this.operationDone;if(this.engine?.active){const latest=await this.latest();if(latest)await this.engine.pause(latest.id);await this.engine.waitIdle();}}
 async handle(req,res,url,{body,json}){
  try{
  const action=url.pathname.slice('/api/v1/material-preparation'.length).replace(/^\//,'');
  if(req.method==='GET'&&!action){const id=url.searchParams.get('id'),controlId=url.searchParams.get('controlRequestId');if(id&&!jobId(id)||controlId&&!uuid(controlId))fail('图片准备任务编号不正确');if(id&&!await read(join(this.runtime,'jobs',id+'.json')))fail('图片准备任务不属于本店');const result=id?await this.jobView(await(await this.getEngine()).view(id)):await this.latest();if(controlId){if(!id)fail('请指定原图片准备任务');const decision=await read(join(this.runtime,'controls',controlId+'.json'));if(decision&&decision.jobId!==id)fail('图片操作不属于该任务');result.controlReceipt=decision?{requestId:controlId,accepted:decision.accepted!==false,action:decision.action,reason:decision.accepted===false?publicReason(decision.reason):null}:null;}json(res,200,result);return true;}
  if(req.method!=='POST')fail('图片准备接口不存在');const input=await body(req);assertShopInput(input,this.owner.shop.id);
  const result=action==='preview'?(await this.preview(input)).view:action==='start'?await this.start(input):await this.control(action,input);json(res,200,result);return true;
  }catch(error){throw Object.assign(Error(publicReason(error.message)||'图片准备未完成，请检查原任务状态'),{statusCode:error.statusCode||(error.code?409:500)});}
 }
}
