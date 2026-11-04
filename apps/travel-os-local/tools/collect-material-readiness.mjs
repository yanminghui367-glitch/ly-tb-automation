// Read-only collector for old per-stage diagnostics and current review summaries.
import {readdir,readFile,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
const stages=['upload-entry','upload-panel','upload-receipt','thumbnail','detail-panel','main-panel','prepared-material-card','bulk-material-card','bulk-upload-receipt'];
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const percentile=(xs,p)=>xs.length?xs.toSorted((a,b)=>a-b)[Math.ceil(xs.length*p)-1]:null;
const metric=(rows,key)=>{const xs=rows.map(x=>x[key]).filter(finite);return {samples:xs.length,p50Ms:percentile(xs,.5),p90Ms:percentile(xs,.9)};};
export async function collectMaterialReadiness(roots){
 const rows=[],invalid=[],seenFiles=new Set(),seenRows=new Set();
 async function visit(dir){for(const f of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(f.isSymbolicLink())continue;if(f.isDirectory()){if(!f.name.startsWith('.')&&!['node_modules','browser-profile','chrome-profile'].includes(f.name))await visit(join(dir,f.name));continue;}if(!f.isFile()||!(f.name==='review.json'||/^detail-readiness-.*\.json$/.test(f.name)))continue;
  const path=await realpath(join(dir,f.name));if(seenFiles.has(path))continue;seenFiles.add(path);
  let doc;try{doc=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch(e){invalid.push({file:path,reason:'诊断文件无法解析'});continue;}
  const entries=f.name==='review.json'?(Array.isArray(doc.materialReadiness)?doc.materialReadiness:[]):[...(Array.isArray(doc.priorReady)?doc.priorReady:[]),doc];
  for(const [index,r]of entries.entries()){
   if(!stages.includes(r?.stage)||!finite(r.durationMs)||!['ready','failed'].includes(r.status)){invalid.push({file:path,index,reason:'阶段、状态或耗时字段无效'});continue;}
   const data=Object.fromEntries(['at','stage','selector','status','durationMs','observeMs','guardMs','timeoutMs','overallTimeoutMs','timeoutReason'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
   // A dated observation may be copied into failure.priorReady and review.json.
   // Undated historical observations stay distinct rather than guessing identity.
   const key=JSON.stringify([await realpath(dir),r.at?data:{file:path,index}]);if(seenRows.has(key))continue;seenRows.add(key);rows.push(data);
  }
 }}
 for(const root of roots)await visit(resolve(root));
 const summary=sample=>{const ready=sample.filter(r=>r.status==='ready');return {observations:sample.length,ready:ready.length,failed:sample.length-ready.length,elapsed:metric(ready,'durationMs'),observation:metric(ready,'observeMs'),guard:metric(ready,'guardMs'),failureReasons:sample.filter(r=>r.status!=='ready').map(r=>({reason:r.timeoutReason||null,durationMs:r.durationMs}))};};
 return {readOnly:true,method:'就绪样本使用最近秩分位数；缺失耗时不填零；旧逐阶段文件与新review汇总兼容，按带时间观察去重',files:seenFiles.size,invalid,stages:Object.fromEntries(stages.map(s=>[s,summary(rows.filter(r=>r.stage===s))])),selectorBreakdown:[...new Set(rows.map(r=>JSON.stringify([r.stage,r.selector||''])))].map(key=>{const [stage,selector]=JSON.parse(key);return {stage,selector,...summary(rows.filter(r=>r.stage===stage&&(r.selector||'')===selector))};})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv.length<3)throw Error('请提供任务证据目录；本工具只读，不访问浏览器、网络或数据库');console.log(JSON.stringify(await collectMaterialReadiness(process.argv.slice(2)),null,2));}
