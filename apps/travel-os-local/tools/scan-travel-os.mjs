// Read-only first-party inventory. Never descends into credentials, profiles or runtime.
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,extname,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=join(root,'output/travel-os-product-20260923');
const excluded=new Set(['.git','node_modules','.runtime','browser-profile','browser-profiles','__pycache__','.venv','vendor']);
const files=[],boundaries=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name),rel=relative(root,path).replaceAll('\\','/');
 if(e.isSymbolicLink()||excluded.has(e.name)||/profile|cookies|credentials|secrets|^\.env/i.test(e.name)){boundaries.push(rel);continue;}
 if(e.isDirectory()){if(['output','artifacts'].includes(e.name)){boundaries.push(rel+' (generated evidence; selected reports inspected separately)');continue;}await walk(path);continue;}
 if(!e.isFile())continue;
 const bytes=await readFile(path),text=/\.(md|mjs|js|py|html|css|json|yaml|yml|ps1|cmd|bat|toml|txt)$/i.test(e.name)?bytes.toString('utf8'):null;
 files.push({path:rel,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),kind:extname(path),headings:text?.match(/^#{1,3} .+$/gm)?.slice(0,12),exports:text?.match(/(?:export (?:async )?(?:class|function|const)|CREATE TABLE IF NOT EXISTS) [A-Za-z_0-9]+/g),lines:text?.split('\n').length});
}}
await walk(root);await mkdir(out,{recursive:true});await writeFile(join(out,'project-inventory.json'),JSON.stringify({at:new Date().toISOString(),root,files,boundaries},null,2));
console.log(JSON.stringify({files:files.length,sourceLines:files.reduce((n,f)=>n+(f.lines||0),0),byType:files.reduce((r,f)=>(r[f.kind]=(r[f.kind]||0)+1,r),{}),boundaries,output:'output/travel-os-product-20260923/project-inventory.json'}));
