import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {destinationKey,digest} from './source-store.mjs';
const script=fileURLToPath(new URL('../tools/rescan_materials.py',import.meta.url));
export const needsMaterials=d=>d.issues.length||d.counts.main!==1||d.counts.secondary!==4||d.counts.details<1;
export const auditSignature=(products,settings)=>digest([products.map(p=>[p.key,p.source.importId,p.issues,p.counts]),settings.assets,settings.pool,settings.heat,settings.sheet]);
export async function readMaterialAudit(runtime,shopId,signature){
 try{const result=JSON.parse(await readFile(join(runtime,'material-audits',digest(shopId)+'.json'),'utf8'));return {...result,stale:result.signature!==signature};}
 catch(e){if(e.code==='ENOENT')return null;throw Error('上次检索记录无法读取，请重新检索');}
}
export async function scanMaterials({runtime,shopId,products,store,settings}){
 const imports=new Map();
 const targets=products.filter(needsMaterials).map(product=>{
  if(!imports.has(product.source.importId))imports.set(product.source.importId,new Map((store.batch(product.source.importId)?.tasks||[]).map(t=>[destinationKey(t),t])));
  return {product,task:imports.get(product.source.importId).get(product.key)};
 });
 const result=await new Promise((resolve,reject)=>{
  const child=execFile(process.env.PYTHON||'python',[script],{windowsHide:true,timeout:120000,maxBuffer:12*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}},(error,stdout)=>{
   try{const data=JSON.parse(stdout);if(error||data.error)return reject(Error(data.error||'检索未完成，请重试'));resolve(data);}catch{reject(Error('资料检索进程未完成，请检查 Python 与资料目录'));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({settings,targets}));
 });
 const report={...result,at:new Date().toISOString(),shopId,signature:auditSignature(products,settings),stale:false};
 const dir=join(runtime,'material-audits');await mkdir(dir,{recursive:true});const file=join(dir,digest(shopId)+'.json'),temp=file+'.tmp';await writeFile(temp,JSON.stringify(report,null,2));await rename(temp,file);return report;
}
