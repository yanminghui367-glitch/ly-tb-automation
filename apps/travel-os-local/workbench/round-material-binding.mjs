import {createHash} from 'node:crypto';
import {readFile,realpath,mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,dirname,basename,extname} from 'node:path';

const digest=x=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const key=t=>digest([t.shopId,t.listing.type,t.listing.country,t.listing.city||'']);
const fail=m=>{throw Error('SOURCE_OR_ASSET_CHANGED: 资料版本绑定检查失败：'+m);};
const parse=x=>x?JSON.parse(x):null;
function versionPath(db,b,c){
 const file=db.prepare('PRAGMA database_list').all().find(x=>x.name==='main')?.file;if(!file)fail('素材版本需要本店持久资料库');
 const version=digest([b.shopId,b.roundId,b.importId,c.path,c.fromSha256,c.toSha256]);
 return join(dirname(file),'material-bindings',digest(b.shopId).slice(0,16),version,basename(c.path,extname(c.path))+'--v-'+version.slice(0,16)+extname(c.path));
}
const exists=db=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='round_material_bindings'").get();
const schema=db=>db.exec('CREATE TABLE IF NOT EXISTS round_material_bindings(round_id TEXT NOT NULL,key TEXT NOT NULL,task_hash TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(round_id,key))');
const revision=(db,id)=>digest({round:db.prepare('SELECT * FROM rounds WHERE id=?').get(id),items:db.prepare('SELECT * FROM round_items WHERE round_id=? ORDER BY position').all(id),runs:db.prepare('SELECT * FROM runs ORDER BY id').all(),queues:db.prepare('SELECT * FROM batch_items ORDER BY id').all(),history:db.prepare('SELECT * FROM history ORDER BY key').all(),events:db.prepare('SELECT * FROM events ORDER BY seq').all(),latest:db.prepare('SELECT id,payload FROM imports ORDER BY rowid DESC LIMIT 1').get(),bindings:exists(db)?db.prepare('SELECT * FROM round_material_bindings ORDER BY round_id,key').all():[]});
function idle(db){
 if(db.prepare("SELECT 1 FROM rounds WHERE state IN ('RUNNING','PAUSING')").get()||db.prepare("SELECT 1 FROM runs WHERE state IN ('RUNNING','SUBMITTING')").get()||db.prepare("SELECT 1 FROM batches WHERE state='RUNNING'").get())fail('执行尚未停止');
}
function eligible(db,x){
 if(x.state!=='PENDING'||x.entered_publish||x.submitted||x.submission_uncertain||x.run_id||x.result)return false;
 if(db.prepare('SELECT 1 FROM runs WHERE key=?').get(x.key)||db.prepare('SELECT 1 FROM history WHERE key=?').get(x.key))return false;
 const queues=db.prepare('SELECT * FROM batch_items WHERE key=?').all(x.key);
 if(queues.length>(x.queue_id?1:0))fail('存在未绑定的原队列');
 if(x.queue_id){const q=queues.find(q=>q.id===x.queue_id);if(!q||q.batch!==x.batch_id||q.key!==x.key||digest(parse(q.task))!==x.task_hash)fail('原队列身份不一致');if(q.state!=='PENDING'||q.attempts!==0||q.run_id||q.result)return false;}
 return true;
}
const businessTask=t=>{const {assets,publishVariant,setupSelection,...rest}=t;return rest;};

// Prepare against the already imported package. Preserve each original random
// slot; never copy a new task or infer identity from a similar filename.
export async function prepareMaterialBindings(db,{roundId,importId,shopId,manifestHash,confirmedBy,reason}={}){
 if(confirmedBy!=='用户'||typeof reason!=='string'||!reason.trim())fail('缺少用户明确更新资料授权');
 idle(db);const before=revision(db,roundId),r=db.prepare('SELECT * FROM rounds WHERE id=?').get(roundId);
 if(!r||r.shop!==shopId||r.manifest_hash!==manifestHash||!['PAUSED','STOPPED','SYSTEM_BLOCKED','NEEDS_REVIEW'].includes(r.state))fail('原轮次、店铺、版本或停止状态不匹配');
 const imported=db.prepare('SELECT id,payload FROM imports ORDER BY rowid DESC LIMIT 1').get();if(imported?.id!==importId)fail('指定资料不是最新已保存版本');
 const source=parse(imported.payload),rows=db.prepare('SELECT * FROM round_items WHERE round_id=? ORDER BY position').all(roundId),tasks=new Map();
 if(digest({shop:r.shop,importId:r.import_id,entries:rows.map(x=>({key:x.key,position:x.position,taskHash:x.task_hash}))})!==r.manifest_hash||digest(parse(r.authorization))!==r.authorization_hash)fail('原清单或授权完整性检查失败');
 for(const t of source.tasks||[]){if(t.shopId!==shopId||tasks.has(key(t)))fail('新资料店铺或商品身份重复');tasks.set(key(t),t);}
 if(tasks.size!==rows.length||rows.some(x=>!tasks.has(x.key)))fail('新旧资料的商品范围不同');
 if(source.sourceBinding&&source.sourceBinding.shopId!==shopId)fail('新资料属于其他店铺');
 if(!source.assetRoot)fail('新资料缺少素材根目录');
 const root=await realpath(source.assetRoot),catalog=new Map();
 const declare=a=>{if(!a?.path||!/^[a-f0-9]{64}$/.test(a.sha256||''))fail('新素材版本信息不完整');const p=resolve(a.path),rel=relative(root,p);if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||rel.split(sep).some(s=>s.startsWith('.')))fail('新素材不属于当前正式资料目录');if(catalog.has(p)&&catalog.get(p)!==a.sha256)fail('同一文件出现多个新版本');catalog.set(p,a.sha256);};
 for(const t of tasks.values())for(const files of Object.values(t.assets||{}))for(const a of files)declare(a);
 for(const files of Object.values(source.templateMaterials?.secondary||{}))for(const a of files)declare(a);
 for(const a of source.templateMaterials?.covers||[])declare(a);
 const files=new Map(),hashFile=async path=>{const p=resolve(path);if(await realpath(p)!==p)fail('文件路径指向发生变化');if(!files.has(p))files.set(p,digest(await readFile(p)));return files.get(p);};
 const entries=[],excluded=[];
 for(const x of rows){
  const task=parse(x.task);if(key(task)!==x.key||digest(task)!==x.task_hash)fail('原任务快照或身份改变');
  if(!eligible(db,x)){excluded.push({key:x.key,state:x.state});continue;}
  if(digest(businessTask(task))!==digest(businessTask(tasks.get(x.key))))fail('商品文字、业务字段或表格来源改变，不能仅更新图片版本');
  for(const s of [task.source,...(task.sourceReferences||[])])if(s?.workbook&&await hashFile(s.workbook)!==s.sha256)fail('原表格文件发生变化');
  const changes=[];
  for(const [group,assets]of Object.entries(task.assets))for(const [index,a]of assets.entries()){
   const path=resolve(a.path),sha=catalog.get(path);if(!sha)fail('新资料缺少原任务选定的图片');
   if(await hashFile(path)!==sha)fail('新图片再次改变或新导入记录不符');
   if(sha===a.sha256)continue;
   if(!['secondary','details'].includes(group))fail('主图变化需要重新核对内容，不能直接绑定');
   const change={group,index,path:a.path,fromSha256:a.sha256,toSha256:sha};change.effectivePath=versionPath(db,{shopId,roundId,importId},change);changes.push(change);
  }
  entries.push({version:1,shopId,roundId,manifestHash,key:x.key,taskHash:x.task_hash,importId,confirmedBy,reason,changes});
 }
 idle(db);if(revision(db,roundId)!==before)fail('检查期间原任务或新资料发生变化');
 const plan={version:1,roundId,shopId,manifestHash,importId,expectedRevision:before,entries,excluded};return {...plan,sha256:digest(plan)};
}

export async function applyMaterialBindings(store,plan){
 const db=store.db,{sha256,...payload}=plan;if(digest(payload)!==sha256)fail('预检记录被修改');
 // Rebuild from actual imports and files. Caller-supplied mappings are never trusted.
 const first=plan.entries[0];if(!first)fail('没有可绑定的未执行商品');
 const checked=await prepareMaterialBindings(db,{...plan,confirmedBy:first.confirmedBy,reason:first.reason});
 if(checked.sha256!==plan.sha256)fail('预检已失效，请重新核对');
 const created=[];
 try{
  for(const c of new Map(plan.entries.flatMap(b=>b.changes.map(c=>[c.effectivePath,c]))).values()){
   const dbRoot=dirname(db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file);
   let parent=dbRoot;for(const part of relative(dbRoot,dirname(c.effectivePath)).split(sep)){parent=join(parent,part);await mkdir(parent).catch(e=>{if(e.code!=='EEXIST')throw e;});if(await realpath(parent)!==parent)fail('素材版本目录发生重定向');}
   const bytes=await readFile(c.path);if(digest(bytes)!==c.toSha256)fail('写入版本副本前图片已变化');
   try{await writeFile(c.effectivePath,bytes,{flag:'wx'});created.push(c.effectivePath);}catch(e){if(e.code!=='EEXIST')throw e;if(await realpath(c.effectivePath)!==c.effectivePath||digest(await readFile(c.effectivePath))!==c.toSha256)fail('已有版本副本内容不符');}
  }
 return store.transaction(()=>{
  idle(db);if(revision(db,plan.roundId)!==plan.expectedRevision)fail('保存前原任务已变化');
  schema(db);const at=new Date().toISOString();
  for(const b of plan.entries){
   const x=db.prepare('SELECT * FROM round_items WHERE round_id=? AND key=?').get(b.roundId,b.key);if(!x||!eligible(db,x)||x.task_hash!==b.taskHash)fail('商品已经执行或被跳过');
   const old=db.prepare('SELECT payload FROM round_material_bindings WHERE round_id=? AND key=?').get(b.roundId,b.key);
   if(old){if(digest(parse(old.payload))!==digest(b))fail('已有独立版本绑定，禁止覆盖');continue;}
   db.prepare('INSERT INTO round_material_bindings VALUES(?,?,?,?,?,?)').run(b.roundId,b.key,b.taskHash,JSON.stringify(b),digest(b),at);
  }
  const result={roundId:plan.roundId,importId:plan.importId,bound:plan.entries.length,changedItems:plan.entries.filter(e=>e.changes.length).length,changedFiles:[...new Set(plan.entries.flatMap(e=>e.changes.map(a=>a.path)))],excluded:plan.excluded.length,originalTasksUnchanged:true,executionStarted:false};
  const round=db.prepare('SELECT * FROM rounds WHERE id=?').get(plan.roundId);
  const previousError=round.reason;
  if(round.state==='SYSTEM_BLOCKED'&&/SOURCE_OR_ASSET_CHANGED/.test(previousError)){
   const reason='已核对并绑定已保存的新图片版本；原任务与跳过记录保留，等待检查并继续';
   db.prepare("UPDATE rounds SET state='PAUSED',reason=?,updated=? WHERE id=?").run(reason,at,plan.roundId);
   db.prepare("UPDATE round_windows SET state='PAUSED',reason=?,updated=? WHERE round_id=? AND state='SYSTEM_BLOCKED'").run(reason,at,plan.roundId);
  }
  db.prepare('INSERT INTO round_events(round_id,key,at,kind,payload) VALUES(?,?,?,?,?)').run(plan.roundId,null,at,'MATERIAL_VERSION_BOUND',JSON.stringify({...result,planHash:sha256,confirmedBy:first.confirmedBy,reason:first.reason,previousState:round.state,previousError}));return result;
 });
 }catch(error){for(const path of created)await unlink(path).catch(()=>{});throw error;}
}

export function readMaterialBinding(db,task){
 if(!exists(db))return null;
 const rows=db.prepare('SELECT b.*,r.shop,r.manifest_hash,i.task_hash current_hash FROM round_material_bindings b JOIN rounds r ON r.id=b.round_id JOIN round_items i ON i.round_id=b.round_id AND i.key=b.key WHERE b.key=? AND b.task_hash=? AND r.shop=? AND r.state!=\'COMPLETED\'').all(key(task),digest(task),task.shopId);
 if(!rows.length)return null;if(rows.length!==1)fail('原任务出现多个绑定');
 const row=rows[0],binding=parse(row.payload);if(digest(binding)!==row.sha256||binding.version!==1||binding.confirmedBy!=='用户'||binding.shopId!==task.shopId||binding.roundId!==row.round_id||binding.key!==row.key||binding.taskHash!==row.task_hash||row.current_hash!==row.task_hash||binding.manifestHash!==row.manifest_hash)fail('绑定记录与原轮次不一致');
 for(const c of binding.changes)if(c.effectivePath!==versionPath(db,binding,c))fail('素材副本不属于本店绑定版本');
 return {...binding,sha256:row.sha256};
}

export function materialTask(task,binding){
 if(!binding)return task;
 const {sha256,...payload}=binding;if(digest(payload)!==sha256||binding.version!==1||binding.confirmedBy!=='用户'||binding.shopId!==task.shopId||binding.key!==key(task)||binding.taskHash!==digest(task))fail('运行素材版本不属于原任务');
 const next=structuredClone(task),seen=new Set();
 for(const c of binding.changes){const slot=c.group+':'+c.index,a=task.assets[c.group]?.[c.index];if(!['secondary','details'].includes(c.group)||seen.has(slot)||!Number.isInteger(c.index)||!a||a.path!==c.path||a.sha256!==c.fromSha256||!/^[a-f0-9]{64}$/.test(c.toSha256)||!isAbsolute(c.effectivePath||''))fail('图片槽位或原版本不一致');seen.add(slot);next.assets[c.group][c.index]={...a,path:c.effectivePath,sha256:c.toSha256,materialVersion:{shopId:binding.shopId,roundId:binding.roundId,importId:binding.importId,originalPath:c.path,sha256:c.toSha256}};}
 return next;
}
