import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {verifyKernel} from '../workbench/kernel-integrity.mjs';
const root=resolve(import.meta.dirname,'..'),checks=[];
if(Number(process.versions.node.split('.')[0])<24)throw Error('需要 Node.js 24+');
checks.push('Node.js 24+');
execFileSync('python',['-c','import sys; assert sys.version_info >= (3,10)'],{windowsHide:true});checks.push('Python 3.10+');
if(!['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].some(existsSync))throw Error('需要标准目录中的 Google Chrome');
checks.push('Google Chrome');
for(const [part,names] of [['workbench',['playwright','three','opencc-js']],['engine/v2',['playwright']]]){
 const require=createRequire(join(root,part,'package.json')),pkg=JSON.parse(await readFile(join(root,part,'package.json'),'utf8'));
 for(const name of names){require.resolve(name);const installed=JSON.parse(await readFile(join(root,part,'node_modules',name,'package.json'),'utf8'));if(installed.version!==(pkg.dependencies?.[name]||pkg.devDependencies?.[name]))throw Error('依赖版本不匹配：'+name);checks.push(part+': '+name+' '+installed.version);}
}
const kernel=await verifyKernel(root);if(!kernel.ok)throw Error('冻结内核校验失败：'+kernel.changed.join(', '));checks.push(`冻结内核 ${kernel.files}/${kernel.files}`);
const manifest=JSON.parse(await readFile(join(root,'SOURCE_MANIFEST.json'),'utf8'));let verified=0;
for(const f of manifest.files){const path=resolve(root,f.path);if(!path.startsWith(root+(/^[A-Za-z]:/.test(root)?'\\':'/')))throw Error('清单路径越界');const bytes=await readFile(path);if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('源码/资源与同步版本不同：'+f.path);verified++;}
const result={at:new Date().toISOString(),checks,sourceFilesVerified:verified,kernel,executionStarted:false};
await mkdir(join(root,'.runtime/install'),{recursive:true});await writeFile(join(root,'.runtime/install/verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
