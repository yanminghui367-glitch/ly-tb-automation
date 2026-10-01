// Export an allowlisted source snapshot; runtime and browser directories are never walked.
import {readdir,readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {resolve,relative,join,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),destination=process.argv[2]?resolve(process.argv[2]):null;
const skipped=new Set(['node_modules','.runtime','.playwright-cli','browser-profile','chrome-profile','output','outputs','__pycache__','.git']);
const roots=['docs','engine','tools','workbench','.interface-design','.impeccable'];
const top=['.gitignore','.gitattributes','AGENTS.md','README.md','PRODUCT.md','DESIGN.md','design-qa.md','安装工作台.cmd','恢复业务数据.cmd','启动上架工作台.vbs','打开旅行上架工作台.cmd'];
const files=[];
async function add(path){const s=await lstat(path);if(s.isSymbolicLink())throw Error('源码不包含链接：'+relative(root,path));if(s.isDirectory()){for(const e of await readdir(path,{withFileTypes:true}))if(!skipped.has(e.name))await add(join(path,e.name));}else if(!/\.(log|pyc|sqlite.*|db|key|pem)$/i.test(path)&&!/^\.env(?:\.|$)/.test(path.split(sep).at(-1)))files.push(path);}
for(const p of [...top,...roots])await add(join(root,p));
const entries=[];
for(const p of files.sort()){
 const path=relative(root,p).split(sep).join('/'),bytes=await readFile(p);
 if(bytes.length<2e6&&!/\.(png|jpg|jpeg|woff2|webp)$/i.test(p)&&/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(bytes.toString()))throw Error('检测到凭证模式，停止导出：'+path);
 if(destination){const target=join(destination,path);await mkdir(dirname(target),{recursive:true});await copyFile(p,target);}
 entries.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const manifest={schemaVersion:1,createdAt:new Date().toISOString(),files:entries};
await writeFile(join(destination||root,'SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:entries.length,bytes:entries.reduce((n,f)=>n+f.bytes,0),destination:destination||root}));
