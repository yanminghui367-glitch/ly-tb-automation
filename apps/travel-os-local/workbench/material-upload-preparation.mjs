import {readFile,writeFile,mkdir,rename,readdir,lstat} from 'node:fs/promises';
import {join,resolve,basename,extname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const digest=x=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const fail=(code,message=code)=>{throw Object.assign(Error(message),{code});};
const validUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(alicdn|taobaocdn)\.com$/.test(u.hostname);}catch{return false;}};
const atomic=async(file,value)=>{await mkdir(resolve(file,'..'),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await rename(temp,file);};
const area=(runtime,shopId)=>join(runtime,'material-upload-preparation',digest(shopId).slice(0,24));
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const source=async item=>{if(!item||typeof item.path!=='string'||!isAbsolute(item.path)||!(/^[a-f0-9]{64}$/).test(item.sha256||''))fail('MATERIAL_PREPARATION_SOURCE_INVALID','图片路径或版本无效');const stat=await lstat(item.path);if(!stat.isFile()||stat.isSymbolicLink())fail('MATERIAL_PREPARATION_SOURCE_INVALID','图片必须是普通文件');const bytes=await readFile(item.path);if(digest(bytes)!==item.sha256)fail('SOURCE_OR_ASSET_CHANGED','图片内容已变化，请重新检查资料');return bytes;};
const originalBatch=(job,file,at)=>{const matches=job?.batchIntents?.filter(i=>i.at===at&&Array.isArray(i.files)&&i.files.includes(file.name)&&!i.cancelledBeforeSelection)||[];return matches.length===1?matches[0]:null;};
function validTruncatedCard(file,result,job,shopId){
 const e=result.evidence,extension=extname(file.name),hashStart=file.name.length-extension.length-file.sha256.length,prefixLength=50-hashStart;
 const prefix=file.sha256.slice(0,prefixLength),materialName=file.name.slice(0,50)+extension;
 return e?.kind==='TRUNCATED_SHA256_MATERIAL_CARD'&&file.name.endsWith('--'+file.sha256+extension)&&prefixLength>=20&&prefixLength<64&&e.hashPrefix===prefix&&result.materialName===materialName&&e.materialName===materialName&&e.expectedFullName===file.name&&e.sha256===file.sha256&&e.shopId===shopId&&job?.shopId===shopId&&e.jobId===job?.id&&job.files?.some(f=>f.name===file.name&&f.sha256===file.sha256)&&typeof result.platformId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(result.platformId)&&e.platformId===result.platformId&&e.rule==='FIRST_50_PLUS_EXTENSION'&&e.visible===true&&e.decoded===true&&e.nameUnique===true&&e.url===result.url&&validUrl(result.url)&&!!originalBatch(job,file,e.batchIntentAt);
}
function validEmptyNativeEvidence(job,file,e,bytes,shopId){
 const intent=originalBatch(job,file,e?.batchIntentAt),sha=value=>/^[a-f0-9]{64}$/i.test(value||'');
 const names=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&actual.every(n=>typeof n==='string'&&expected.includes(n));
 const unreadable=row=>row?.size===0&&(row.readBytes===undefined||row.readBytes===0)&&(row.readError===undefined||['NotFoundError','NotReadableError'].includes(row.readError))&&(row.readBytes===0||['NotFoundError','NotReadableError'].includes(row.readError));
 if(process.platform!=='win32'||file.path.length<260||!intent||Object.hasOwn(intent,'nativePathMode')||job.shopId!==shopId||e?.kind!=='EMPTY_NATIVE_FILE'||e.shopId!==shopId||e.jobId!==job.id||e.name!==file.name||e.stagedPath!==file.path||e.sha256!==file.sha256||e.offline!==true||e.networkBlocked!==true||e.sdkSkipsZero!==true||e.sdkRejected!==true||e.rawNativeSize!==0||!(e.rawReadBytes===0||['NotFoundError','NotReadableError'].includes(e.rawReadError))||e.extendedSha256!==file.sha256||e.diskSize!==bytes.length||bytes.length===0||e.extendedNativeSize!==bytes.length||!Number.isFinite(Date.parse(e.probeAt||''))||Date.parse(e.probeAt)<Date.parse(intent.at)||!sha(e.sdkSourceSha256)||!sha(e.browserExecutableSha256)||typeof e.browserVersion!=='string'||!e.browserVersion.trim())return false;
 if(!unreadable({size:e.rawNativeSize,readBytes:e.rawReadBytes,readError:e.rawReadError})||!names(e.nativeNames,intent.files)||!Array.isArray(e.nativeFiles)||!names(e.nativeFiles.map(f=>f?.name),intent.files)||!Array.isArray(e.extendedFiles)||!names(e.extendedFiles.map(f=>f?.name),intent.files)||!names(e.sdkExtendedNames,intent.files))return false;
 const readable=[];
 for(const name of intent.files){
  const original=job.files.find(f=>f.name===name),raw=e.nativeFiles.find(f=>f.name===name),extended=e.extendedFiles.find(f=>f.name===name);
  if(!original||!Number.isSafeInteger(extended?.size)||extended.size<=0||extended.readBytes!==extended.size||extended.sha256!==original.sha256)return false;
  if(raw?.size===0){if(!unreadable(raw))return false;}else{if(!Number.isSafeInteger(raw?.size)||raw.size<=0||raw.readBytes!==raw.size||raw.sha256!==original.sha256)return false;readable.push(name);}
 }
 const raw=e.nativeFiles.find(f=>f.name===file.name),extended=e.extendedFiles.find(f=>f.name===file.name);
 return unreadable(raw)&&extended.size===bytes.length&&names(e.sdkNames,readable)&&!e.sdkNames.includes(file.name)&&e.nativeFileCount===intent.files.length&&e.sdkFileCount===readable.length&&e.sdkFileCount<e.nativeFileCount;
}
export async function readPreparedMaterialReceipt({runtime,shopId,asset}){
 if(!runtime)return null;
 const file=join(area(runtime,shopId),'receipts',asset.sha256+'.json');let receipt;
 try{receipt=await read(file);}catch(e){
  if(e.code!=='ENOENT')fail('MATERIAL_PREPARATION_RECEIPT_INVALID','图片准备回执损坏，请重新核对');
  let names;try{names=await readdir(join(area(runtime,shopId),'jobs'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  for(const name of names.filter(n=>/^[a-f0-9]{32}\.json$/.test(n))){const job=await read(join(area(runtime,shopId),'jobs',name));if(job.shopId===shopId&&job.files.some(f=>f.sha256===asset.sha256&&['UPLOAD_UNKNOWN','UPLOADING'].includes(f.state)))fail('MATERIAL_PREPARATION_UNRESOLVED_UPLOAD','该图片已有上传未核记录，请先核对原图片准备任务 '+job.id+'，不可改为单张重复上传');}
  return null;
 }
 await source(asset);
 if(receipt.version!==1||receipt.shopId!==shopId||receipt.sha256!==asset.sha256||!validUrl(receipt.url)||typeof receipt.uploadName!=='string'||!receipt.uploadName.includes(asset.sha256)||!Array.isArray(receipt.aliases)||!receipt.aliases.some(a=>a.path===asset.path&&JSON.stringify(a.materialVersion??null)===JSON.stringify(asset.materialVersion??null)))
  fail('MATERIAL_PREPARATION_RECEIPT_INVALID','图片准备回执与店铺、文件或版本不匹配');
 if(receipt.materialName&&receipt.materialName!==receipt.uploadName){let job;try{if(!/^[a-f0-9]{32}$/.test(receipt.evidence?.jobId||''))throw Error('INVALID_JOB');job=await read(join(area(runtime,shopId),'jobs',receipt.evidence.jobId+'.json'));}catch{fail('MATERIAL_PREPARATION_RECEIPT_INVALID','缺少截名图片的原批次证据');}
  if(!validTruncatedCard({name:receipt.uploadName,sha256:asset.sha256},receipt,job,shopId))fail('MATERIAL_PREPARATION_RECEIPT_INVALID','截名图片回执未通过完整版本与平台身份核对');}
 return receipt;
}
export async function createMaterialUploadPreparation({runtime,shopId,shopName,adapter,batchSize=20,guard=async()=>{},onJobCreated=async()=>{}}){
 if(!isAbsolute(runtime||'')||!shopId||!shopName||typeof adapter?.uploadBatch!=='function'||!Number.isInteger(batchSize)||batchSize<1||batchSize>20)fail('MATERIAL_PREPARATION_CONFIG_INVALID');
 const root=area(runtime,shopId),jobs=join(root,'jobs');await mkdir(jobs,{recursive:true});let pending=null,current=null,starting=false;
 const jobFile=id=>{if(!/^[a-f0-9]{32}$/.test(id||''))fail('MATERIAL_PREPARATION_JOB_INVALID');return join(jobs,id+'.json');};
 const save=job=>{job.updatedAt=new Date().toISOString();job.counts={};for(const f of job.files)job.counts[f.state]=(job.counts[f.state]||0)+1;return atomic(jobFile(job.id),job);};
 const view=async id=>{const job=current?.id===id?structuredClone(current):await read(jobFile(id));if(job.shopId!==shopId)fail('MATERIAL_PREPARATION_SHOP_MISMATCH');return job;};
 const receipt=async(file,result,job)=>{
  if(!validUrl(result.url))fail('MATERIAL_PREPARATION_RECEIPT_INVALID','缺少逐张图片的平台地址');
  if(result.originalUrl&&!validUrl(result.originalUrl)||result.contentSha256&&!/^[a-f0-9]{64}$/.test(result.contentSha256))fail('MATERIAL_PREPARATION_RECEIPT_INVALID','原图证据字段无效');
  if(result.materialName&&result.materialName!==file.name){if(!validTruncatedCard(file,result,job,shopId))fail('MATERIAL_PREPARATION_RECEIPT_INVALID','截名图片缺少原批次与完整版本证据');await stagedBytes(file);}
  let prior=null;try{prior=await read(join(root,'receipts',file.sha256+'.json'));}catch(e){if(e.code!=='ENOENT')fail('MATERIAL_PREPARATION_RECEIPT_INVALID');}
  if(prior&&(prior.shopId!==shopId||prior.sha256!==file.sha256||prior.url!==result.url||prior.uploadName!==file.name||!Array.isArray(prior.aliases)))fail('MATERIAL_PREPARATION_RECEIPT_CONFLICT','同内容图片已有不同平台回执，请核对');
  const aliases=[...(prior?.aliases||[])];for(const a of file.aliases)if(!aliases.some(b=>digest(a)===digest(b)))aliases.push(a);
  const value={version:1,shopId,sha256:file.sha256,uploadName:file.name,materialName:result.materialName||file.name,platformId:result.platformId||null,url:result.url,originalUrl:result.originalUrl||null,contentSha256:result.contentSha256||null,aliases,at:new Date().toISOString(),evidence:result.evidence||null};
  await atomic(join(root,'receipts',file.sha256+'.json'),value);return value;
 };
 const stagedBytes=async f=>{if(basename(f.path)!==f.name||resolve(f.path)!==join(root,'staged',f.name)||!f.name.includes(f.sha256))fail('MATERIAL_PREPARATION_STAGED_NAME_INVALID');return source({path:f.path,sha256:f.sha256});};
 const lookup=async(job,files,lookupGuard,lookupAdapter)=>{
  const recorded=new Map();let found=0,notTransmitted=0;
  const onReceipt=async r=>{
   const f=files.find(f=>f.name===r?.name);if(!f)fail('MATERIAL_PREPARATION_RECEIPT_INVALID');
   if(recorded.has(r.name)){if(digest(recorded.get(r.name))!==digest(r))fail('MATERIAL_PREPARATION_RECEIPT_CONFLICT');return;}
   await lookupGuard();const bytes=await stagedBytes(f);let disposition='UNKNOWN';
   if(r.status==='SUCCEEDED'){await receipt(f,r,job);Object.assign(f,{state:'SUCCEEDED',url:r.url,reason:null});found++;disposition='SUCCEEDED';}
   else if(r.status==='NOT_TRANSMITTED'){
    const e=r.evidence,valid=validEmptyNativeEvidence(job,f,e,bytes,shopId);
    if(valid){Object.assign(f,{state:'FAILED',reason:'原生文件选择为空，已确认未进入上传队列，可恢复该图片'});notTransmitted++;disposition='NOT_TRANSMITTED';}
    else f.reason='未取得完整的未发送证据，继续保留上传待核';
   }
   recorded.set(r.name,r);job.lookupReceipts=[...(job.lookupReceipts||[]),{at:new Date().toISOString(),name:r.name,status:r.status,disposition,evidence:r.evidence||null}];await save(job);
  };
  await lookupGuard();const results=await lookupAdapter.lookupBatch({files,guard:lookupGuard,onReceipt,context:{shopId,jobId:job.id,batchIntents:structuredClone(job.batchIntents),originalFiles:job.files.map(({name,path,sha256})=>({name,path,sha256}))}});
  if(!Array.isArray(results))fail('MATERIAL_PREPARATION_RECEIPT_INVALID');
  for(const r of results)await onReceipt(r);return {found,notTransmitted};
 };
 const finish=async job=>{job.state=job.requiresAttention||job.files.some(f=>f.state==='UPLOAD_UNKNOWN')?'ATTENTION_REQUIRED':job.files.every(f=>f.state==='SUCCEEDED')?'COMPLETED':job.stopRequested==='CANCELLED'?'CANCELLED':job.stopRequested==='PAUSED'?'PAUSED':job.files.some(f=>f.state==='FAILED')?'PARTIAL_FAILED':'PAUSED';if(job.files.every(f=>f.state==='SUCCEEDED'))job.reason='';await save(job);};
 const run=job=>{
  current=job;pending=(async()=>{
   // A dispatched batch survives restart as unknown, never as fresh work.
   for(const f of job.files)if(f.state==='UPLOADING')f.state='UPLOAD_UNKNOWN';
   const unknown=job.files.filter(f=>f.state==='UPLOAD_UNKNOWN');
   if(unknown.length&&typeof adapter.lookupBatch==='function'){
    await lookup(job,unknown,guard,adapter);
   }
   if(job.files.some(f=>f.state==='UPLOAD_UNKNOWN')){await finish(job);return;}
   for(let offset=0;;offset++){
    if(job.stopRequested)break;const batch=job.files.filter(f=>f.state==='PENDING').slice(0,batchSize);if(!batch.length)break;
    await guard();
    for(const f of batch){const bytes=await source(f.aliases[0]);await mkdir(join(root,'staged'),{recursive:true});await writeFile(f.path,bytes);if(digest(await readFile(f.path))!==f.sha256)fail('SOURCE_OR_ASSET_CHANGED');}
    if(job.stopRequested)break;
    let dispatched=false,dispatchReserved=false;const recorded=new Map();
    try{
     const result=await adapter.uploadBatch({files:batch,guard,context:{shopId,jobId:job.id,originalFiles:job.files.map(({name,path,sha256})=>({name,path,sha256})),get batchIntents(){return structuredClone(job.batchIntents);}},
      onDispatch:async selection=>{if(dispatchReserved)fail('MATERIAL_PREPARATION_DUPLICATE_DISPATCH');if(selection!==undefined&&(!selection||typeof selection!=='object'||!['WINDOWS_EXTENDED','NATIVE'].includes(selection.nativePathMode)))fail('MATERIAL_PREPARATION_NATIVE_MODE_INVALID');dispatchReserved=true;await guard();if(job.stopRequested)fail('MATERIAL_PREPARATION_STOP_REQUESTED');for(const f of batch)f.state='UPLOADING';const intent={at:new Date().toISOString(),files:batch.map(f=>f.name),...(selection?{nativePathMode:selection.nativePathMode}:{})};job.batchIntents.push(intent);await save(job);if(job.stopRequested){for(const f of batch)f.state='PENDING';intent.cancelledBeforeSelection=true;await save(job);fail('MATERIAL_PREPARATION_STOP_REQUESTED');}dispatched=true;return {shopId,jobId:job.id,batchIntents:structuredClone(job.batchIntents),originalFiles:job.files.map(({name,path,sha256})=>({name,path,sha256}))};},
      onReceipt:async r=>{const f=batch.find(f=>f.name===r?.name);if(!dispatched||!f||!['SUCCEEDED','FAILED'].includes(r.status))fail('MATERIAL_PREPARATION_RECEIPT_INVALID');if(recorded.has(f.name)){if(digest(recorded.get(f.name))!==digest(r))fail('MATERIAL_PREPARATION_RECEIPT_CONFLICT');return;}
       if(r.status==='SUCCEEDED')await receipt(f,r,job);recorded.set(f.name,r);Object.assign(f,{state:r.status,url:r.url||null,reason:r.reason||null});await save(job);}});
     // An aggregate count or a returned list cannot replace durable callbacks.
     if(!Array.isArray(result)||batch.some(f=>!recorded.has(f.name)))fail('MATERIAL_PREPARATION_RECEIPT_MISSING','没有取得完整逐图上传回执');
    }catch(error){
     if(error.code==='MATERIAL_PREPARATION_STOP_REQUESTED'&&!dispatched){for(const f of batch)f.state='PENDING';await finish(job);return;}
     const human=/CAPTCHA|验证码|滑块|登录|身份|店铺/.test(String(error.message||error));if(human)job.requiresAttention=true;
     for(const f of batch)if(!recorded.has(f.name))Object.assign(f,{state:dispatched?'UPLOAD_UNKNOWN':human?'PENDING':'FAILED',reason:String(error.message||error).slice(0,500)});
     job.reason=String(error.message||error).slice(0,500);await save(job);
     // Guard failures, ambiguity and unacknowledged dispatch all stop new work.
     await finish(job);return;
    }
   }
   await finish(job);
  })().catch(async error=>{for(const f of job.files)if(f.state==='UPLOADING')f.state='UPLOAD_UNKNOWN';job.reason=String(error.message||error).slice(0,500);job.state='ATTENTION_REQUIRED';await save(job);}).finally(()=>{pending=null;current=null;});
 };
 const prepare=async({requestId,items})=>{
  if(typeof requestId!=='string'||!requestId||requestId.length>120||!Array.isArray(items)||!items.length||items.length>6000)fail('MATERIAL_PREPARATION_REQUEST_INVALID');
  const intent=digest({shopId,items}),id=digest({shopId,requestId}).slice(0,32);
  try{const prior=await view(id);if(prior.intent!==intent)fail('MATERIAL_PREPARATION_REQUEST_CONFLICT');return prior;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(pending||starting)fail('MATERIAL_PREPARATION_BUSY');starting=true;try{
  const grouped=new Map();for(const item of items){await guard();await source(item);let f=grouped.get(item.sha256);if(!f){const name=basename(item.path,extname(item.path)).replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,28)+'--'+item.sha256+extname(item.path).toLowerCase();f={sha256:item.sha256,name,path:join(root,'staged',name),aliases:[],state:'PENDING',url:null,reason:null};grouped.set(item.sha256,f);}if(!f.aliases.some(a=>digest(a)===digest(item)))f.aliases.push({path:item.path,sha256:item.sha256,materialVersion:item.materialVersion??null});}
  const job={version:1,id,shopId,shopName,requestId,intent,createdAt:new Date().toISOString(),state:'RUNNING',stopRequested:null,batchIntents:[],files:[...grouped.values()]};
  const older=await Promise.all((await readdir(jobs)).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).map(n=>read(join(jobs,n))));
  for(const f of job.files){let cached;try{cached=await read(join(root,'receipts',f.sha256+'.json'));}catch(e){if(e.code!=='ENOENT')fail('MATERIAL_PREPARATION_RECEIPT_INVALID');}
   if(cached){if(cached.shopId!==shopId||cached.sha256!==f.sha256||!validUrl(cached.url)||!cached.uploadName?.includes(f.sha256))fail('MATERIAL_PREPARATION_RECEIPT_INVALID');if(cached.materialName&&cached.materialName!==cached.uploadName){const prior=await read(jobFile(cached.evidence?.jobId));if(!validTruncatedCard({name:cached.uploadName,sha256:f.sha256},cached,prior,shopId))fail('MATERIAL_PREPARATION_RECEIPT_INVALID');}f.name=cached.uploadName;f.path=join(root,'staged',f.name);cached.aliases=[...cached.aliases,...f.aliases.filter(a=>!cached.aliases.some(b=>digest(a)===digest(b)))];await atomic(join(root,'receipts',f.sha256+'.json'),cached);f.state='SUCCEEDED';f.url=cached.url;}
   else {const prior=older.find(j=>j.shopId===shopId&&j.files.some(p=>p.sha256===f.sha256&&['UPLOAD_UNKNOWN','UPLOADING'].includes(p.state)));if(prior)fail('MATERIAL_PREPARATION_UNRESOLVED_UPLOAD','该图片在原准备任务 '+prior.id+' 的上传结果尚未确定，请先核对原任务');}}
  await save(job);current=job;
  try{await onJobCreated({job:structuredClone(job),requestId,action:'prepare'});}catch(error){job.state='PAUSED';job.reason='任务登记未完成，尚未开始上传';await save(job);current=null;throw error;}
  run(job);return structuredClone(job);
  }finally{starting=false;}
 };
 const stop=async(id,state)=>{const job=await view(id);if(current?.id===id){current.stopRequested=state;await save(current);return structuredClone(current);}if(job.state==='RUNNING')for(const f of job.files)if(f.state==='UPLOADING')f.state='UPLOAD_UNKNOWN';job.stopRequested=state;await finish(job);return job;};
 return {prepare,view,get active(){return !!pending||starting;},get lastJobId(){return current?.id||null;},waitIdle:()=>pending||Promise.resolve(),pause:id=>stop(id,'PAUSED'),cancel:id=>stop(id,'CANCELLED'),
  attention:async()=>{const names=(await readdir(jobs)).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)),values=await Promise.all(names.map(n=>read(join(jobs,n))));return values.filter(j=>j.shopId===shopId&&j.id!==current?.id&&j.files.some(f=>['UPLOAD_UNKNOWN','UPLOADING'].includes(f.state))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]||null;},
  latest:async()=>{const names=(await readdir(jobs)).filter(n=>/^[a-f0-9]{32}\.json$/.test(n));const values=await Promise.all(names.map(n=>read(join(jobs,n))));return values.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]||null;},
  recheck:async({jobId,requestId,guard:lookupGuard=guard,adapter:lookupAdapter=adapter})=>{
   if(pending||starting)fail('MATERIAL_PREPARATION_BUSY');starting=true;let job,request;
   try{
    if(typeof requestId!=='string'||!requestId||requestId.length>120||typeof lookupGuard!=='function'||typeof lookupAdapter?.lookupBatch!=='function')fail('MATERIAL_PREPARATION_RECHECK_INVALID');
    job=await view(jobId);if(job.recheckRequests?.some(r=>r.requestId===requestId))return job;
    request={requestId,at:new Date().toISOString(),state:'STARTED'};job.recheckRequests=[...(job.recheckRequests||[]),request];
    for(const f of job.files)if(f.state==='UPLOADING')f.state='UPLOAD_UNKNOWN';
    await save(job);current=job;
    // Controller records the readonly operation before lookup. It does not
    // grant permission to select files, claim a task or continue an upload loop.
    await onJobCreated({job:structuredClone(job),requestId,action:'recheck'});
    const unknown=job.files.filter(f=>f.state==='UPLOAD_UNKNOWN'),eligible=[];
    for(const f of unknown){await lookupGuard();try{await stagedBytes(f);eligible.push(f);}catch(error){f.reason='原上传副本证据无法核对，继续保留上传待核';}}
    const result=eligible.length?await lookup(job,eligible,lookupGuard,lookupAdapter):{found:0,notTransmitted:0};
    request.state='FINISHED';job.lastRecheck={requestId,at:new Date().toISOString(),...result,remainingUnknown:job.files.filter(f=>f.state==='UPLOAD_UNKNOWN').length};
    if(!job.lastRecheck.remainingUnknown){job.requiresAttention=false;if(unknown.length)job.reason='';}await finish(job);return structuredClone(job);
   }catch(error){
    if(job&&request){request.state='FINISHED';request.reason=String(error.message||error).slice(0,500);job.reason=request.reason;job.state='ATTENTION_REQUIRED';await save(job);}throw error;
   }finally{current=null;starting=false;}
  },
  resume:async({jobId,requestId})=>{if(pending||starting)fail('MATERIAL_PREPARATION_BUSY');starting=true;try{if(typeof requestId!=='string'||!requestId)fail('MATERIAL_PREPARATION_REQUEST_INVALID');const job=await view(jobId);if(job.resumeRequests?.includes(requestId)||job.state==='COMPLETED')return job;job.resumeRequests=[...(job.resumeRequests||[]),requestId];job.stopRequested=null;job.requiresAttention=false;for(const f of job.files)if(f.state==='FAILED')f.state='PENDING';job.state='RUNNING';await save(job);current=job;try{await onJobCreated({job:structuredClone(job),requestId,action:'resume'});}catch(error){job.state='PAUSED';job.reason='任务登记未完成，尚未恢复上传';await save(job);current=null;throw error;}run(job);return structuredClone(job);}finally{starting=false;}}};
}
