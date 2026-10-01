// Business-data migration only. Never walks a browser profile or exports login state.
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,readdir,lstat,copyFile,mkdtemp} from 'node:fs/promises';
import {resolve,join,relative,dirname,basename,isAbsolute,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyKernel} from '../workbench/kernel-integrity.mjs';
const helper=join(import.meta.dirname,'migration-archive.py');
const normalize=p=>resolve(p).replaceAll('\\','/');
const inside=(root,p)=>{const r=relative(root,p);return !r||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
const forbidden=p=>/(?:^|[\\/])(?:browser-profile|chrome-profile|browser-checkpoints|node_modules|\.playwright-cli)(?:[\\/]|$)/i.test(p);
const fileType=p=>/\.(xlsx|json|png|jpe?g|webp)$/i.test(p);
const image=p=>/\.(png|jpe?g|webp)$/i.test(p);
async function sha(p){const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');}
async function json(p,fallback){try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
async function writeJson(p,x){await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(x,null,2)+'\n');}
async function copy(src,dest){await mkdir(dirname(dest),{recursive:true});await copyFile(src,dest);}
const tableExists=(db,t)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
function counts(db){return Object.fromEntries(['imports','runs','history','batches','batch_items','quotes','preparations'].filter(t=>tableExists(db,t)).map(t=>[t,db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));}
function idle(db){for(const [t,states] of [['runs',['RUNNING','SUBMITTING']],['batches',['RUNNING']],['batch_items',['RUNNING']]])if(tableExists(db,t)&&db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE state IN (${states.map(()=>'?').join(',')})`).get(...states).n)throw Error('有运行中或提交中任务，请先在原工作台暂停并等状态落盘。');}
const sourceColumns={imports:['payload'],runs:['task','checkpoint','result'],history:['payload'],events:['payload'],batch_items:['task','result'],batch_events:['payload'],batches:['review'],product_actions:['result']};
const productColumns={quotes:['payload'],preparations:['payload'],os_requests:['fingerprint','result']};
function payloads(db,columns,fn){for(const [t,cols] of Object.entries(columns))if(tableExists(db,t))for(const row of db.prepare(`SELECT ${cols.join(',')} FROM ${t}`).all())for(const c of cols)if(row[c])fn(JSON.parse(row[c]));}
async function regular(p){if(forbidden(p))throw Error('禁止访问浏览器/凭证目录');const st=await lstat(p);if(!st.isFile()||st.isSymbolicLink())throw Error('只复制普通文件：'+p);let parent=dirname(p);while(dirname(parent)!==parent){if((await lstat(parent)).isSymbolicLink())throw Error('不通过目录链接读取业务文件：'+p);parent=dirname(parent);}return st;}
async function walkImages(dir,fn){if(forbidden(dir))throw Error('禁止访问浏览器目录');if((await lstat(dir)).isSymbolicLink())throw Error('不遍历目录链接');for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('素材目录含链接，需人工核对');const p=join(dir,e.name);if(e.isDirectory())await walkImages(p,fn);else if(e.isFile()&&image(p))await fn(p);}}
export async function exportData(root,archive,{aliases={}}={}){
 root=resolve(root);archive=resolve(archive);if(existsSync(archive))throw Error('迁移包已存在，拒绝覆盖');
 await mkdir(dirname(archive),{recursive:true});const stage=await mkdtemp(join(dirname(archive),'.travelos-export-'));
 const runtime=join(root,'workbench/.runtime'),settings=await json(join(runtime,'product-v1/settings.json')),jobs=await json(join(runtime,'jobs.json'),{jobs:[],tasks:[]});
 if((jobs.tasks||[]).some(t=>t.state==='RUNNING'))throw Error('旧版任务仍在执行，请先暂停。');
 const sourceFile=join(runtime,'source-workflow/state.sqlite'),productFile=join(runtime,'travel-os/product.sqlite');
 const source=new DatabaseSync(sourceFile,{readOnly:true}),product=new DatabaseSync(productFile,{readOnly:true});
 const versions=[source,product].map(db=>db.prepare('PRAGMA data_version').get().data_version);
 let sourceCopy,productCopy;
 try{
  idle(source);await mkdir(join(stage,'state'),{recursive:true});
  await backup(source,join(stage,'state/source.sqlite'));await backup(product,join(stage,'state/product.sqlite'));
  sourceCopy=new DatabaseSync(join(stage,'state/source.sqlite'));productCopy=new DatabaseSync(join(stage,'state/product.sqlite'));sourceCopy.exec('PRAGMA journal_mode=DELETE');productCopy.exec('PRAGMA journal_mode=DELETE');idle(sourceCopy);
  const expectedCounts={source:counts(sourceCopy),product:counts(productCopy)};
  const shops=(await json(join(runtime,'shops.json'),[])).map(s=>({id:s.id,name:s.name,port:s.port,createdAt:s.createdAt,loginHint:''}));
  await writeJson(join(stage,'state/settings.json'),{...settings,executionEnabled:false});await writeJson(join(stage,'state/jobs.json'),jobs);await writeJson(join(stage,'state/shops.json'),shops);
  const references=new Map(),warnings=[];
  function gather(value){if(Array.isArray(value)){for(const v of value)gather(v);return;}if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){if(typeof v==='string'&&isAbsolute(v)&&fileType(v)){if(forbidden(v))throw Error('业务快照引用了禁止迁移的目录');const p=normalize(v);let ref=references.get(p);if(!ref)references.set(p,ref={path:v,hashes:new Set()});if(['path','workbook'].includes(k)&&value.sha256)ref.hashes.add(value.sha256);}else if(v&&typeof v==='object')gather(v);}}
  payloads(sourceCopy,sourceColumns,gather);payloads(productCopy,productColumns,gather);gather(jobs);
  for(const k of ['pool','heat'])if(settings[k])gather({path:settings[k]});
  const assetRoot=resolve(settings.assets),mappings=[{old:normalize(root),target:'.',kind:'directory'},{old:normalize(assetRoot),target:'business-data/assets',kind:'directory'}];
  const copied=new Map();
  async function add(p,stored,original=p,hashes=new Set()){
   await regular(p);const target=join(stage,stored);if(copied.has(stored))return;
   const before=await sha(p);await copy(p,target);const actual=await sha(target);if(actual!==before||actual!==await sha(p))throw Error('导出期间文件变化：'+p);
   if(hashes.size&&[...hashes].some(h=>h!==actual))warnings.push({path:original,reason:'当前文件与部分历史快照哈希不同，原问题保留，不能直接恢复执行'});
   copied.set(stored,{path:stored,bytes:(await lstat(target)).size,sha256:actual});
  }
  await walkImages(assetRoot,p=>add(p,'data/assets/'+relative(assetRoot,p).split(sep).join('/')));
  for(const [key,ref] of references){
   const p=ref.path,actual=existsSync(p)?p:aliases[p]||aliases[key];
   if(!actual||!existsSync(actual)){warnings.push({path:p,reason:'原引用文件缺失，迁移包不补造'});continue;}
   if(actual!==p&&(!ref.hashes.size||![...ref.hashes].every(h=>h===ref.hashes.values().next().value)||await sha(actual)!==ref.hashes.values().next().value))throw Error('改名文件必须与原快照哈希完全一致：'+p);
   let stored,target;
   if(inside(assetRoot,p)){stored='data/assets/'+relative(assetRoot,p).split(sep).join('/');target='business-data/'+stored.slice(5);}
   else if(inside(root,p)){const rel=relative(root,p).split(sep).join('/');if(rel.startsWith('workbench/.runtime/')&&!/^(workbench\/\.runtime\/(imports\/|source-workflow\/uploads\/))/.test(rel))throw Error('不迁移未知运行目录：'+rel);stored='project/'+rel;target=rel;}
   else{stored='data/documents/'+createHash('sha256').update(key).digest('hex').slice(0,16)+'/'+basename(p);target='business-data/'+stored.slice(5);}
   await add(actual,stored,p,ref.hashes);mappings.push({old:key,target,kind:'file',...(actual!==p?{matchedBySha256:true}: {})});
  }
  // Preserve task evidence images only, never traces, browser checkpoints or login files.
  for(const sub of ['workbench/output/tasks','workbench/output/mapping-evidence'])if(existsSync(join(root,sub)))await walkImages(join(root,sub),p=>add(p,'project/'+relative(root,p).split(sep).join('/')));
  const auditDir=join(runtime,'material-audits');if(existsSync(auditDir))for(const e of await readdir(auditDir,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.json'))await add(join(auditDir,e.name),'state/material-audits/'+e.name);
  for(const e of await readdir(join(stage,'state'),{withFileTypes:true}))if(e.isFile()){const p=join(stage,'state',e.name);copied.set('state/'+e.name,{path:'state/'+e.name,bytes:(await lstat(p)).size,sha256:await sha(p)});}
  if([source,product].some((db,i)=>db.prepare('PRAGMA data_version').get().data_version!==versions[i])||JSON.stringify(await json(join(runtime,'product-v1/settings.json')))!==JSON.stringify(settings)||JSON.stringify(await json(join(runtime,'jobs.json'),{jobs:[],tasks:[]}))!==JSON.stringify(jobs))throw Error('业务状态在导出期间变化，请在空闲时重试。');
  idle(source);
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),kernelManifestSha256:await sha(join(root,'workbench/kernel-lock.json')),originalRoot:normalize(root),counts:expectedCounts,mappings,files:[...copied.values()].sort((a,b)=>a.path.localeCompare(b.path)),warnings,executionEnabledAfterRestore:false,excluded:['browser-profile','chrome-profile','browser-checkpoints','cookies','passwords','tokens','node_modules','launcher/network settings']};
  await writeJson(join(stage,'MIGRATION_MANIFEST.json'),manifest);
  sourceCopy.close();sourceCopy=null;productCopy.close();productCopy=null;
  execFileSync('python',[helper,'pack',archive,stage],{stdio:'inherit',windowsHide:true});
  const report={archive,bytes:(await lstat(archive)).size,sha256:await sha(archive),files:manifest.files.length,counts:expectedCounts,warnings: warnings.length,staging:stage};await writeJson(archive+'.report.json',report);console.log(JSON.stringify(report));return report;
 }finally{sourceCopy?.close();productCopy?.close();source.close();product.close();}
}
function rebase(value,mappings,root){if(Array.isArray(value))return value.map(v=>rebase(v,mappings,root));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rebase(v,mappings,root)]));if(typeof value!=='string'||!isAbsolute(value))return value;const p=normalize(value);for(const m of mappings){if(p===m.old||(m.kind==='directory'&&p.startsWith(m.old+'/')))return join(root,m.target,...p.slice(m.old.length).split('/').filter(Boolean));}return value;}
function rebaseDb(db,columns,mappings,root){db.exec('BEGIN IMMEDIATE');try{for(const [t,cols] of Object.entries(columns))if(tableExists(db,t))for(const row of db.prepare(`SELECT rowid AS migration_rowid,${cols.join(',')} FROM ${t}`).all())for(const c of cols)if(row[c]){const next=JSON.stringify(rebase(JSON.parse(row[c]),mappings,root));if(next!==row[c])db.prepare(`UPDATE ${t} SET ${c}=? WHERE rowid=?`).run(next,row.migration_rowid);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
export async function restoreData(root,archive){
 root=resolve(root);archive=resolve(archive);const runtime=join(root,'workbench/.runtime');
 if(!existsSync(join(root,'workbench/kernel-lock.json')))throw Error('目标必须是已下载的 Travel OS 应用目录。');
 if((await lstat(root)).isSymbolicLink()||!(await verifyKernel(root,join(root,'workbench/kernel-lock.json'))).ok)throw Error('目标目录或冻结内核不正确。');
 if(existsSync(join(root,'browser-profile'))||existsSync(join(root,'business-data'))||existsSync(join(root,'.runtime/launcher'))||(existsSync(runtime)&&(await readdir(runtime)).length))throw Error('只允许恢复到首次启动前的全新目录，拒绝覆盖已有业务/浏览器数据。');
 const stage=await mkdtemp(join(dirname(root),'.travelos-restore-'));
 execFileSync('python',[helper,'unpack',archive,stage],{stdio:'inherit',windowsHide:true});
 const m=await json(join(stage,'MIGRATION_MANIFEST.json'));if(m.schemaVersion!==1)throw Error('迁移包版本不受支持。');
 if(await sha(join(root,'workbench/kernel-lock.json'))!==m.kernelManifestSha256)throw Error('迁移包和目标程序的内核版本不同。');
 for(const f of m.files){if(!/^(state\/(source\.sqlite|product\.sqlite|settings\.json|jobs\.json|shops\.json|material-audits\/[^/]+\.json)|data\/(assets|documents)\/.+|project\/(output\/.+|workbench\/(output\/(tasks|mapping-evidence)\/.+|\.runtime\/(imports|source-workflow\/uploads)\/.+)))$/.test(f.path)||forbidden(f.path))throw Error('迁移包包含非业务文件：'+f.path);const p=resolve(stage,f.path);if(!inside(stage,p)||(await regular(p)).size!==f.bytes||await sha(p)!==f.sha256)throw Error('迁移包完整性失败：'+f.path);}
 const mappings=m.mappings.map(x=>{if(!['file','directory'].includes(x.kind)||typeof x.old!=='string'||typeof x.target!=='string'||!inside(root,resolve(root,x.target))||forbidden(x.target))throw Error('迁移映射无效');return x;}).sort((a,b)=>b.old.length-a.old.length);
 const sourceCheck=new DatabaseSync(join(stage,'state/source.sqlite'),{readOnly:true}),productCheck=new DatabaseSync(join(stage,'state/product.sqlite'),{readOnly:true});
 try{idle(sourceCheck);if(JSON.stringify({source:counts(sourceCheck),product:counts(productCheck)})!==JSON.stringify(m.counts))throw Error('迁移包状态数量不符');}finally{sourceCheck.close();productCheck.close();}
 for(const f of m.files){if(f.path.startsWith('data/'))await copy(join(stage,f.path),join(root,'business-data',f.path.slice(5)));else if(f.path.startsWith('project/'))await copy(join(stage,f.path),join(root,f.path.slice(8)));else await copy(join(stage,f.path),join(runtime,'migration-original',f.path.slice(6)));}
 await copy(join(stage,'state/source.sqlite'),join(runtime,'source-workflow/state.sqlite'));await copy(join(stage,'state/product.sqlite'),join(runtime,'travel-os/product.sqlite'));
 const s=new DatabaseSync(join(runtime,'source-workflow/state.sqlite')),p=new DatabaseSync(join(runtime,'travel-os/product.sqlite'));
 let restoredCounts;
 try{rebaseDb(s,sourceColumns,mappings,root);rebaseDb(p,productColumns,mappings,root);for(const db of [s,p])if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('恢复后 SQLite 完整性检查失败');restoredCounts={source:counts(s),product:counts(p)};if(JSON.stringify(restoredCounts)!==JSON.stringify(m.counts))throw Error('恢复后业务数量变化');}finally{s.close();p.close();}
 const settings=rebase(await json(join(stage,'state/settings.json')),mappings,root);settings.executionEnabled=false;
 await writeJson(join(runtime,'product-v1/settings.json'),settings);await writeJson(join(runtime,'jobs.json'),rebase(await json(join(stage,'state/jobs.json')),mappings,root));
 const shops=await json(join(stage,'state/shops.json'));for(const shop of shops){if(!/^[a-z0-9-]+$/.test(shop.id))throw Error('店铺标识无效');shop.profileDir=join(root,'browser-profile',shop.id);shop.loginHint='';}await writeJson(join(runtime,'shops.json'),shops);
 for(const f of m.files.filter(f=>f.path.startsWith('state/material-audits/')))await writeJson(join(runtime,'material-audits',basename(f.path)),rebase(await json(join(stage,f.path)),mappings,root));
 const report={at:new Date().toISOString(),archiveSha256:await sha(archive),filesVerified:m.files.length,counts:restoredCounts,warnings:m.warnings,executionEnabled:false,browserProfileCreated:false,loginRequired:true,pathMappings:mappings,originalSnapshots:join(runtime,'migration-original'),note:'原始审计快照保留；仅新副本中的路径引用重定位，原审核哈希及历史发布证据不倒改。请人工核对后再恢复执行。'};
 await writeJson(join(runtime,'migration-report.json'),report);console.log(JSON.stringify({filesVerified:report.filesVerified,counts:restoredCounts,warnings:m.warnings.length,executionEnabled:false}));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [mode,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('参数应为 --名称 值');options[args[i].slice(2)]=args[i+1];}
 const root=options.root||resolve(import.meta.dirname,'..');
 if(mode==='export'&&options.archive)await exportData(root,options.archive,{aliases:options.aliases?await json(options.aliases):{}});
 else if(mode==='restore'&&options.archive)await restoreData(root,options.archive);
 else throw Error('用法：node tools/migration-data.mjs export|restore --archive 数据包.zip [--root 应用目录] [--aliases 路径映射.json]');
}
