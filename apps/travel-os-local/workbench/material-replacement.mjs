import {readFile,mkdir,writeFile,realpath,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,basename,extname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const inside=(root,file)=>{const r=relative(root,file);return r!==''&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
export const canonicalMaterial=a=>resolve(a.originalPath||a.path);
export function createMaterialReplacementSchema(db){db.exec(`
 CREATE TABLE IF NOT EXISTS material_replacements(shop TEXT NOT NULL,path TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(shop,path));
 CREATE TABLE IF NOT EXISTS material_replacement_events(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,at TEXT NOT NULL);
`);}
export function materialReplacements(db,shop){return new Map(db.prepare('SELECT path,payload FROM material_replacements WHERE shop=?').all(shop).map(r=>[r.path,JSON.parse(r.payload)]));}

// Only imports are projected forward. Runs, queues, rounds and old imports
// retain their original paths and bytes, including unknown submissions.
export function applyMaterialReplacements(db,input){
 const shops=[...new Set((input.tasks||[]).map(t=>t.shopId))],maps=new Map(shops.map(shop=>[shop,materialReplacements(db,shop)]));
 if(![...maps.values()].some(m=>m.size))return input;
 const output=structuredClone(input),used=new Map();
 const apply=(a,map)=>{
  if(!a?.path||!isAbsolute(a.path))return a;
  const replacement=map.get(canonicalMaterial(a));if(!replacement)return a;
  if(!a.originalPath&&a.sha256&&a.sha256!==replacement.baseHash)fail('原图片已在其他位置修改，请先核对素材版本后重新导入');
  used.set(replacement.id,{id:replacement.id,revision:replacement.revision});
  return {...a,...replacement.asset,originalPath:replacement.originalPath,materialRevision:replacement.revision};
 };
 for(const task of output.tasks||[])for(const group of ['main','secondary','details'])if(task.assets?.[group])task.assets[group]=task.assets[group].map(a=>apply(a,maps.get(task.shopId)));
 if(shops.length===1){
  const map=maps.get(shops[0]),t=output.templateMaterials;
  if(t?.secondary)for(const group of ['A','B'])if(t.secondary[group])t.secondary[group]=t.secondary[group].map(a=>apply(a,map));
  if(t?.covers)t.covers=t.covers.map(a=>apply(a,map));
  // A second cover or unused set still belongs to the new material version.
  for(const r of map.values())if(output.assetRoot&&inside(resolve(output.assetRoot),r.originalPath))used.set(r.id,{id:r.id,revision:r.revision});
 }
 if(used.size)output.materialRevisions=[...used.values()].sort((a,b)=>a.id.localeCompare(b.id));
 return output;
}
function imageType(bytes,name){
 const ext=extname(name).toLowerCase();let type;
 if(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.subarray(-8,-4).toString()==='IEND'){
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w*h>80000000)fail('图片尺寸无效或过大',400);type='image/png';
 }else if(bytes.length>16&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)type='image/jpeg';
 else if(bytes.length>20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length)type='image/webp';
 if(!type||!({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext]===type))fail('请选择有效的 PNG、JPG 或 WebP 图片，文件扩展名须与内容一致',400);
 return {type,ext};
}
async function decodeImage(bytes,type){
 try{
  // libvips reads PNG's default image and does not expose APNG frames in metadata.
  // Inspect chunk boundaries so animated content cannot hide behind that default.
  if(type==='image/png')for(let offset=8;offset<bytes.length;){
   if(offset+12>bytes.length)throw Error('TRUNCATED_PNG');
   const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
   if(length>bytes.length-offset-12||kind==='acTL')throw Error('INVALID_OR_ANIMATED_PNG');
   offset+=length+12;if(kind==='IEND'){if(offset!==bytes.length)throw Error('EXTRA_PNG_DATA');break;}
  }
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:80000000}),meta=await image.metadata();
  if('image/'+meta.format!==type||!meta.width||!meta.height||meta.width>32768||meta.height>32768||meta.width*meta.height>80000000||(meta.pages||1)!==1)throw Error('INVALID_IMAGE');
  // metadata alone reads headers; stats forces the complete pixel stream to decode.
  await image.stats();
 }catch{fail('图片无法完整解码、为动态多帧或尺寸过大，请重新导出有效的静态图片后上传',400);}
}
function assertIdle(p){p.assertRulesIdle();p.round?.assertIdle();if(p.round?.creating||p.reconciling)fail('任务正在创建或核验，请等待完成后修改图片');}

export async function materialEditInfo(p,asset){
 if(asset.shopId!==p.shop.id)fail('图片与当前店铺不一致',400);
 const originalPath=resolve(asset.originalFile||asset.file),replacement=materialReplacements(p.source.store.db,p.shop.id).get(originalPath);
 const file=replacement?.asset.path||asset.file;
 if(await realpath(file).catch(()=>null)!==file)fail('图片位置已变化，请刷新素材库',404);
 const bytes=await readFile(file),sha256=hash(bytes);
 if(replacement&&replacement.asset.sha256!==sha256)fail('图片内容已被其他操作修改，请重新核对');
 return {id:asset.id,shopId:p.shop.id,name:basename(file),revision:replacement?.revision||0,sha256,bytes:bytes.length,url:asset.url,scope:'FUTURE_TASKS_ONLY'};
}

export async function replaceMaterial(p,asset,input){
 const allowed=['shopId','assetId','expectedRevision','expectedHash','name','data','requestId'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||input.shopId!==p.shop.id||asset.shopId!==p.shop.id||input.assetId!==asset.id)fail('图片与店铺或请求范围不一致',400);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId||'')||!Number.isInteger(input.expectedRevision)||input.expectedRevision<0||!/^[a-f0-9]{64}$/.test(input.expectedHash||''))fail('图片修改信息不完整，请重新打开后选择图片',400);
 if(typeof input.data!=='string'||input.data.length>Math.ceil(16*1024*1024/3)*4||typeof input.name!=='string'||input.name.length>180||basename(input.name)!==input.name||/[\\/\x00-\x1f]/.test(input.name))fail('图片文件无效，单张不能超过16MB',400);
 const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>16*1024*1024||bytes.toString('base64')!==input.data)fail('图片文件无效，单张不能超过16MB',400);
 const {type,ext}=imageType(bytes,input.name),db=p.source.store.db,sha256=hash(bytes);
 const fingerprint=hash({...input,data:undefined,sha256}),oldRequest=db.prepare('SELECT fingerprint,payload FROM material_replacement_events WHERE id=?').get(input.requestId);
 if(oldRequest){if(oldRequest.fingerprint!==fingerprint)fail('本次修改编号已用于另一张图片');return {...JSON.parse(oldRequest.payload),replayed:true};}
 assertIdle(p);const info=await materialEditInfo(p,asset);
 if(info.revision!==input.expectedRevision||info.sha256!==input.expectedHash)fail('图片已在其他页面修改，请刷新后重新选择');
 if(info.sha256===sha256)fail('所选图片与当前图片相同，无需重复上传');
 const settings=await p.settings(),root=await realpath(settings.assets),originalPath=resolve(asset.originalFile||asset.file);
 if(!inside(root,originalPath))fail('图片不在本店已配置的素材目录中，请重新核对');
 const originals=materialReplacements(db,p.shop.id),previous=originals.get(originalPath),revision=info.revision+1;
 const dir=join(root,'.travel-os-image-versions',hash(p.shop.id).slice(0,16),input.requestId),file=join(dir,basename(originalPath,extname(originalPath))+'-V'+revision+ext);
 assertIdle(p);p.capturing=true;let stored=false,written=false;
 try{
  await decodeImage(bytes,type);
  let parent=root;for(const part of ['.travel-os-image-versions',hash(p.shop.id).slice(0,16),input.requestId]){parent=join(parent,part);await mkdir(parent).catch(e=>{if(e.code!=='EEXIST')throw e;});if(await realpath(parent)!==parent||!inside(root,parent))fail('素材版本目录位置无效');}
  await writeFile(file,bytes,{flag:'wx'});written=true;
  if(p.batch.active||p.source.active||p.round?.active||p.round?.creating)fail('任务状态已变化，请暂停后重新修改');
  const current=await materialEditInfo(p,asset);if(current.revision!==info.revision||current.sha256!==info.sha256)fail('图片已在其他页面修改，请刷新后重试');
  let result;
  p.source.store.transaction(()=>{
   const event=db.prepare('SELECT id FROM material_replacement_events WHERE id=?').get(input.requestId);if(event)fail('此修改正在保存，请核对原操作');
   const latest=materialReplacements(db,p.shop.id).get(originalPath);if((latest?.revision||0)!==info.revision)fail('图片版本已变化，请刷新后重试');
   const value={id:asset.id,shopId:p.shop.id,originalPath,baseHash:previous?.baseHash||info.sha256,revision,asset:{path:file,sha256,mimeType:type},at:new Date().toISOString()};
   db.prepare('INSERT OR REPLACE INTO material_replacements VALUES(?,?,?)').run(p.shop.id,originalPath,JSON.stringify(value));
   const preset=p.rules.preset(p.shop.id);let presetChanged=false;
   const swap=a=>{if(canonicalMaterial(a)!==originalPath)return a;presetChanged=true;return {...a,...value.asset,originalPath,materialRevision:revision};};
   for(const group of ['A','B'])preset.secondary[group]=preset.secondary[group].map(swap);preset.covers=preset.covers.map(swap);
   if(presetChanged){preset.revision++;db.prepare('INSERT OR REPLACE INTO publishing_presets VALUES(?,?)').run(p.shop.id,JSON.stringify(preset));}
   const imports=db.prepare('SELECT id,payload FROM imports ORDER BY rowid DESC').all(),byKind=new Map();
   for(const row of imports){const payload=JSON.parse(row.payload);if(!payload.tasks?.some(t=>t.shopId===p.shop.id))continue;const kind=payload.sheet==='境外城市热度'?'heat':'pool';if(!byKind.has(kind))byKind.set(kind,payload);}
   const importIds=[];for(const payload of byKind.values()){delete payload.id;delete payload.at;importIds.push(p.source.store.imported(payload));}
   result={assetId:asset.id,shopId:p.shop.id,revision,name:basename(file),sha256,importIds,scope:'FUTURE_TASKS_ONLY',at:value.at};
   db.prepare('INSERT INTO material_replacement_events VALUES(?,?,?,?)').run(input.requestId,fingerprint,JSON.stringify(result),value.at);
  });
  stored=true;p.checkResult=null;p.rules.materialIndex.clear();return result;
 }finally{p.capturing=false;if(!stored&&written)await unlink(file).catch(()=>{});}
}
