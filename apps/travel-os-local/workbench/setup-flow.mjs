import {readFile,writeFile,mkdir,rename,stat,statfs,lstat,realpath,readdir,unlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,dirname,basename,extname,parse} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {digest} from './source-store.mjs';
const exec=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
const inside=(root,file)=>{const r=relative(root,file);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
const extensions=new Set(['.xlsx','.png','.jpg','.jpeg','.webp']);
const blocked=p=>String(p).split(/[\\/]/).some(s=>s.startsWith('.')||/^(AppData|browser-profile|Windows|Program Files(?: \(x86\))?|node_modules|Cookies|Login Data)$/i.test(s));
const cleanName=s=>s&&!s.startsWith('.')&&!/[<>:"|?*\u0000-\u001f]/.test(s)&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s);
async function atomic(file,data){await mkdir(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,file);}
async function plainDirectory(path,{create=false}={}){
 if(typeof path!=='string'||!isAbsolute(path)||blocked(path))fail('请选择主机上的完整资料目录，不能使用系统、隐藏或浏览器配置目录');
 const abs=resolve(path);let cursor=parse(abs).root;
 for(const part of relative(cursor,abs).split(sep).filter(Boolean)){
  cursor=join(cursor,part);try{const s=await lstat(cursor);if(s.isSymbolicLink()||!s.isDirectory())fail('目录不能包含链接或文件：'+cursor);}catch(e){if(e.code!=='ENOENT')throw e;if(!create)fail('目录不存在：'+cursor);await mkdir(cursor);}
 }
 const physical=await realpath(abs);if(blocked(physical))fail('不能使用系统、隐藏或浏览器配置目录');return physical;
}
export class SetupFlow {
 constructor(product){this.p=product;this.file=join(product.runtime,'product-v1','setup.json');this.sessions=join(product.runtime,'product-v1','setup-uploads');}
 idle(){this.p.assertRulesIdle();if(this.p.reconciling)fail('原商品核验中，请稍后配置');}
 async config(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')fail('首次配置记录无法读取，请检查主机文件');return {version:1,storageRoot:'',format:'legacy',report:null};}}
 async save(patch){const value={...await this.config(),...patch,updatedAt:new Date().toISOString()};await atomic(this.file,value);return value;}
 fingerprint(s,id){return digest([s.heat,s.pool,s.assets,s.sheet,id]);}
 async state(){const c=await this.config(),s=await this.p.settings(),imported=this.p.source.store.batch(),same=this.matches(imported,s);return {...c,report:c.report?{...c.report,stale:c.report.fingerprint!==this.fingerprint(s,imported?.id)||!same}:null,source:same?{id:imported.id,summary:imported.summary,at:imported.at,format:imported.format||'legacy'}:null,shop:this.p.shop.name};}
 matches(batch,s){return !!batch&&resolve(batch.poolWorkbook||batch.workbook||'')===resolve(s.pool||'')&&resolve(batch.assetRoot||'')===resolve(s.assets||'')&&resolve(batch.workbook||'')===resolve(s.heat||'');}
 async folders(path){
  if(!path){const roots=process.platform==='win32'?['D:\\','E:\\','F:\\','C:\\']:['/'];const items=[];for(const root of roots){try{const fs=await statfs(root);items.push({name:root,path:root,freeBytes:fs.bavail*fs.bsize});}catch{}}return {path:'',parent:'',items};}
  const base=await plainDirectory(path);const entries=await readdir(base,{withFileTypes:true});
  return {path:base,parent:dirname(base)===base?'':dirname(base),items:entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!blocked(e.name)).slice(0,300).map(e=>({name:e.name,path:join(base,e.name)}))};
 }
 async storage(input){this.idle();const selected=String(input.path||'').trim();if(resolve(selected)===parse(resolve(selected)).root)fail('请选择磁盘下的专用资料文件夹，不要直接使用磁盘根目录');const root=await plainDirectory(selected,{create:true});
  const probe=join(root,'.travel-os-write-'+randomUUID());try{await writeFile(probe,'',{flag:'wx'});await unlink(probe);}catch{fail('此目录无法写入，请选择有写入权限的资料目录');}
  const fs=await statfs(root);if(fs.bavail*fs.bsize<32*1024*1024)fail('目录所在磁盘剩余空间不足32MB，请更换位置');
  await this.save({storageRoot:root,report:null});return {root,freeBytes:fs.bavail*fs.bsize};
 }
 async upload(input){this.idle();
  if(input.begin){const c=await this.config();if(!c.storageRoot)fail('请先选择上传存放位置');const base=await plainDirectory(c.storageRoot);const id=randomUUID(),root=join(base,'导入批次',id);await plainDirectory(root,{create:true});await atomic(join(this.sessions,id+'.json'),{id,root,files:[],complete:false});return {id,root};}
  if(!/^[a-f0-9-]{36}$/.test(input.id||''))fail('上传编号无效',400);
  let session;try{session=JSON.parse(await readFile(join(this.sessions,input.id+'.json'),'utf8'));}catch{fail('上传记录不存在，请重新选择资料');}
  if(session.complete)fail('该次上传已结束，请重新选择资料');
  const parts=String(input.name||'').replaceAll('\\','/').split('/');
  if(parts.some(p=>!cleanName(p))||!extensions.has(extname(parts.at(-1)).toLowerCase())||parts.length>8)fail('仅接受 Excel 与图片，文件名或目录层级无效',400);
  if(session.files.length>=5000)fail('一次最多上传5000个文件');
  const name=parts.join('/');if(session.files.some(f=>f.name.toLowerCase()===name.toLowerCase()))fail('文件重复：'+name);
  if(typeof input.data!=='string'||input.data.length>24*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail('上传内容格式无效',400);
  const bytes=Buffer.from(input.data,'base64');if(!bytes.length||bytes.length>16*1024*1024)fail('单个文件须为1字节至16MB',400);
  const root=await plainDirectory(session.root);const file=resolve(root,...parts);if(!inside(root,file))fail('文件路径越界',400);await plainDirectory(dirname(file),{create:true});
  const fs=await statfs(root);if(fs.bavail*fs.bsize<bytes.length+16*1024*1024)fail('存放位置空间不足，上传未继续；请选择其他磁盘');
  try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code==='EEXIST')fail('同名文件已存在，请重新上传整套资料');throw e;}
  session.files.push({name,bytes:bytes.length});await atomic(join(this.sessions,input.id+'.json'),session);return {root,path:file,count:session.files.length};
 }
 async importSource(input){this.idle();const format=input.format==='standard'?'standard':input.format==='legacy'?'legacy':null;if(!format)fail('请选择标准模板或原有Excel资料',400);
  let session,root=input.root;
  if(input.uploadId){if(!/^[a-f0-9-]{36}$/.test(input.uploadId))fail('上传编号无效',400);session=JSON.parse(await readFile(join(this.sessions,input.uploadId+'.json'),'utf8'));if(!session.files.length)fail('还没有上传文件');root=session.root;}
  let result,paths;
  if(format==='standard'){
   const base=await plainDirectory(root),workbook=join(base,'商品资料.xlsx');
   const s=await lstat(workbook).catch(()=>null);if(!s?.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)fail('未找到有效的商品资料.xlsx，请选择模板所在文件夹');
   try{const output=await exec(process.env.PYTHON||'python',[join(here,'setup-adapter.py'),'--root',base,'--shop-id',this.p.shop.id,'--shop-name',this.p.shop.name],{windowsHide:true,timeout:120000,maxBuffer:20*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});result=JSON.parse(output.stdout);}catch(e){fail(String(e.stderr||e.message).trim().slice(-1800));}
   // Existing executor is not generalized by adding a new import format.
   if(this.p.shop.id!=='wuzhou-changyou')for(const t of result.tasks)t.adapterIssues.push('此店铺尚未完成执行适配');
   paths={pool:workbook,heat:workbook,assets:base,sheet:'境外城市热度'};
  }else{
   paths=Object.fromEntries(['heat','pool','assets','sheet'].map(k=>[k,String(input[k]||'').trim()]));
   if(session){paths.heat=join(root,'热度.xlsx');paths.pool=join(root,'商品.xlsx');paths.assets=join(root,'图片');}
   if(Object.values(paths).some(v=>!v))fail('原有Excel需要热度表、商品表、图片目录和工作表名称');
   const preview=await this.p.batch.import(paths);result=this.p.source.store.batch(preview.importId);
  }
  this.idle();
  // Each explicit re-identification is a new selection, even A -> B -> A.
  // Preserve old imports/tasks; destinationKey still provides business deduplication.
  const selection={id:randomUUID(),materials:digest(result.templateMaterials||{})};
  result={...result,tasks:result.tasks.map(t=>({...t,setupSelection:selection}))};delete result.id;delete result.at;
  const id=this.p.source.store.imported(result);await this.p.saveSettings(paths);
  await this.save({format,report:null,lastImport:id});if(session){session.complete=true;await atomic(join(this.sessions,input.uploadId+'.json'),session);}
  return {importId:id,summary:result.summary,issues:result.tasks.filter(t=>t.adapterIssues.length).map(t=>({row:t.source.row,destination:t.listing.city||t.listing.country,issues:t.adapterIssues})),paths,preview:this.p.preview(id,20)};
 }
 async check(){this.idle();const env=await this.p.checkConfiguration(),settings=await this.p.settings(),batch=this.p.source.store.batch(),c=await this.config(),checks=[];
  const add=(group,name,ok,detail,step)=>checks.push({group,name,ok,detail,step});
  for(const item of env.checks){if(c.format==='standard'&&item.name==='热度 Excel')continue;add(item.name==='执行浏览器与店铺'?'店铺连接':item.name==='冻结内核'?'运行环境':'资料位置',item.name==='冻结内核'?'程序文件完整性':item.name,item.ok,item.name==='冻结内核'?(item.ok?'程序文件校验通过':'程序文件与已验证版本不一致，请修复后再执行'):item.detail,item.name==='执行浏览器与店铺'?3:2);}
  if(c.storageRoot){try{await plainDirectory(c.storageRoot);const fs=await statfs(c.storageRoot);add('资料位置','上传存放目录',fs.bavail*fs.bsize>=32*1024*1024,c.storageRoot,1);}catch(e){add('资料位置','上传存放目录',false,e.message,1);}}
  const same=this.matches(batch,settings);add('资料内容','已识别当前资料',same,same?`已识别 ${batch.summary?.total??batch.tasks.length} 条商品`:'资料位置已变化或尚未导入，请回到第2步识别资料',2);
  if(same){
   const invalid=batch.tasks.filter(t=>t.adapterIssues.length);add('资料内容','字段与图片',invalid.length===0,invalid.length?invalid.slice(0,12).map(t=>`${t.listing.city||t.listing.country}（第${t.source.row}行）：${t.adapterIssues.join('；')}`).join('\n'):'本次已导入商品的字段与图片数量检查通过；内容真实性仍需人工核对',2);
   const files=new Map();for(const t of batch.tasks)for(const f of [t.source,...t.sourceReferences||[],...Object.values(t.assets).flat()])files.set(f.workbook||f.path,f.sha256);
   for(const f of [...batch.templateMaterials?.secondary?.B||[],...(batch.templateMaterials?.covers||[])])files.set(f.path,f.sha256);
   const changed=[];for(const [file,hash]of files){try{if(digest(await readFile(file))!==hash)changed.push(basename(file)+'：内容已变化');}catch{changed.push(basename(file)+'：文件不可访问');}}
   add('资料内容','识别后文件未变化',changed.length===0,changed.length?changed.slice(0,12).join('\n'):`已核对 ${files.size} 个源文件`,2);
   const preset=this.p.rules.preset(this.p.shop.id);if(preset.enabled){try{await this.p.rules.checkPreset(preset);const selected=[...preset.secondary.A,...preset.secondary.B,...preset.covers];if(batch.format&&selected.some(f=>!inside(resolve(settings.assets),resolve(f.path))))throw Error('图片目录已换，随机规则仍引用旧资料，请重新选择图片并确认');add('资料内容','发布随机规则',true,'当前规则图片存在且未变化',2);}catch(e){add('资料内容','发布随机规则',false,e.message,2);}}
  }
  add('运行环境','店铺执行适配',this.p.shop.id==='wuzhou-changyou',this.p.shop.id==='wuzhou-changyou'?'当前店铺使用已有执行适配':'新增店铺需完成执行适配后才能运行',3);
  const report={at:new Date().toISOString(),checks,ready:checks.every(c=>c.ok===true),fingerprint:this.fingerprint(settings,batch?.id)};await this.save({report});return report;
 }
 async handle(req,res,url,{body,json}){
  const action=url.pathname.slice('/api/v1/setup/'.length);
  if(req.method==='GET'){
   if(action==='state')return json(res,200,await this.state());
   if(action==='folders')return json(res,200,await this.folders(url.searchParams.get('path')));
   if(action==='template'){const data=await readFile(join(here,'templates','travel-os-template-v1.zip'));res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="Travel-OS-template-v1.zip"','cache-control':'no-store'});return res.end(data);}
  }
  if(req.method==='POST'){const input=await body(req);let result;
   if(action==='storage')result=await this.storage(input);
   else if(action==='upload')result=await this.upload(input);
   else if(action==='import')result=await this.importSource(input);
   else if(action==='check')result=await this.check();
   else fail('未找到配置操作',404);
   return json(res,200,result);
  }
  fail('未找到配置入口',404);
 }
}
