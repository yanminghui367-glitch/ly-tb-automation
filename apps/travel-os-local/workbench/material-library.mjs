// Inventory of the material version referenced by a shop's imported tasks.
// Candidate/version subdirectories are not recursively mixed in.
import {readdir,stat,realpath} from 'node:fs/promises';
import {basename,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
const image=p=>/\.(png|jpe?g|webp)$/i.test(p);
const inside=(root,file)=>{const r=relative(root,file);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
export async function materialLibrary(tasks,{assetUrl}={}){
 const result={at:new Date().toISOString(),status:tasks.length?'ready':'unconfigured',main:{count:0},secondary:{count:0,sets:[]},details:{count:0,sets:[]},covers:{count:0,sets:[]},warnings:[]};
 const mains=new Set(),roots=new Set();
 for(const t of tasks){
  for(const a of t.assets?.main||[])if(a.path&&isAbsolute(a.path)&&image(a.path))mains.add(resolve(a.path));
  for(const g of ['secondary','details'])for(const a of t.assets?.[g]||[])if(a.path&&isAbsolute(a.path)&&/^(副图|详情页)/.test(basename(dirname(a.path))))roots.add(dirname(dirname(resolve(a.path))));
 }
 const existing=await Promise.all([...mains].map(p=>stat(p).then(s=>s.isFile(),()=>false)));
 result.main.count=existing.filter(Boolean).length;
 if(existing.some(x=>!x))result.warnings.push('部分商品主图已无法读取，请核对资料目录。');
 if(tasks.length&&!roots.size)result.warnings.push('尚未识别店铺公共套图目录，请核对导入资料。');
 for(const root of roots){
  let base,entries;
  try{base=await realpath(root);entries=await readdir(base,{withFileTypes:true});}catch{result.warnings.push('套图目录无法读取，请核对资料目录。');continue;}
  for(const entry of entries.filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))){
   const group=/^副图[-_—－]*(第.+套|[AB]套)$/.test(entry.name)?'secondary':/^详情页(?:[-_—－]*内容页)?$/.test(entry.name)?'details':/^详情页[-_—－]*(首图|首页)$/.test(entry.name)?'covers':null;
   if(!group)continue;
   try{
    const dir=await realpath(resolve(base,entry.name));if(!inside(base,dir))throw Error('OUTSIDE');
    const files=(await readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()&&image(e.name)).map(e=>e.name).sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    result[group].sets.push({name:entry.name,count:files.length,files,...(assetUrl?{previews:files.map(name=>({name,url:assetUrl(resolve(dir,name))}))}:{})});result[group].count+=files.length;
   }catch{result.warnings.push(entry.name+'无法读取，请核对资料目录。');}
  }
 }
 if(result.warnings.length)result.status='partial';
 return result;
}
