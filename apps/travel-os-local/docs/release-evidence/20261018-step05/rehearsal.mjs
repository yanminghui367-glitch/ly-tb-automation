// Step 0.5: exercise real integrity and health handlers in an isolated file copy.
// Never constructs ProductApi, opens a business database, or sends a production POST.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyKernel} from '../../../workbench/kernel-integrity.mjs';
import {ProductApi} from '../../../workbench/product-api.mjs';

const root=resolve(import.meta.dirname,'../../..');
const out=join(root,'output/kernel-release-step05-20261018/runs',new Date().toISOString().replaceAll(/[:.]/g,'-'));
const fixture=join(out,'isolated'),lockPath=join(root,'workbench/kernel-lock.json');
const sha=x=>createHash('sha256').update(x).digest('hex');
const oldBytes=await readFile(lockPath),oldLock=JSON.parse(oldBytes),sourceHashes={};
const productionHealth=async()=>{
 const r=await fetch('http://127.0.0.1:4318/api/v1/health',{signal:AbortSignal.timeout(15000)});
 assert(r.ok);return r.json();
};
const before=await productionHealth();assert(before.kernel.ok);assert((await verifyKernel()).ok);
await mkdir(fixture,{recursive:true});
for(const [file,expected] of Object.entries(oldLock.files)){
 const original=join(root,file);assert(!(await lstat(original)).isSymbolicLink());
 sourceHashes[file]=sha(await readFile(original));assert.equal(sourceHashes[file],expected);
 const target=join(fixture,file);await mkdir(dirname(target),{recursive:true});await copyFile(original,target);
}
const isolatedLock=join(fixture,'workbench/kernel-lock.json');await writeFile(isolatedLock,oldBytes);
const results=[];
const server=createServer(async(req,res)=>{
 try{
  assert.equal(req.method,'GET');assert.equal(req.url,'/api/v1/health');
  await ProductApi.prototype.handle.call({integrity:()=>verifyKernel(fixture,isolatedLock)},req,res,new URL(req.url,'http://127.0.0.1'),{
   body:()=>{throw Error('Writes disabled');},
   json:(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));}
  });
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const localUrl=`http://127.0.0.1:${server.address().port}/api/v1/health`;
async function check(name,ok,revision,changed=[]){
 const disk=await verifyKernel(fixture,isolatedLock),response=await fetch(localUrl),http=await response.json();
 assert.equal(response.status,200);assert.deepEqual(http.kernel,disk);
 assert.equal(disk.ok,ok);assert.equal(disk.files,84);assert.equal(disk.revision,revision);assert.deepEqual(disk.changed,changed);
 results.push({name,pass:true,kernel:disk,usedActualHealthHandler:true});
}
try{
 await check('原锁与隔离源码一致',true,oldLock.revision);
 const file='workbench/publishing-materials.mjs',target=join(fixture,file),original=await readFile(target);
 await writeFile(target,Buffer.concat([original,Buffer.from('\n// STEP05 ISOLATED REHEARSAL ONLY\n')]));
 await check('修改一项冻结文件后变红',false,oldLock.revision,[file]);
 const wrong=structuredClone(oldLock);wrong.files[file]='0'.repeat(64);await writeFile(isolatedLock,JSON.stringify(wrong));
 await check('错误哈希不能恢复通过',false,oldLock.revision,[file]);
 const candidate={scope:'Step 0.5 isolated rehearsal only',files:[{path:file,baselineSha256:oldLock.files[file],sha256:sha(await readFile(target))}]};
 const candidateBytes=Buffer.from(JSON.stringify(candidate,null,2)+'\n');await writeFile(join(out,'candidate-manifest.json'),candidateBytes);
 const next=structuredClone(oldLock);next.revision='20261018-step05-isolated-rehearsal-r1';next.files[file]=candidate.files[0].sha256;
 next.step05IsolatedRehearsal={scope:candidate.scope,candidateManifestSha256:sha(candidateBytes),independentQA:false,productionRelease:false};
 for(const [p,h] of Object.entries(oldLock.files))if(p!==file)assert.equal(next.files[p],h);
 await writeFile(isolatedLock,JSON.stringify(next,null,2)+'\n');
 await check('只更新候选一项哈希后变绿',true,next.revision);
 await writeFile(join(fixture,'workbench/step05-unlisted-example.mjs'),'// isolated coverage example\n');
 await check('未登记文件不会被自动纳入校验',true,next.revision);
 await writeFile(target,original);await writeFile(isolatedLock,oldBytes);
 await check('原文件与原锁成对恢复后变绿',true,oldLock.revision);
}finally{await new Promise((done,reject)=>server.close(e=>e?reject(e):done()));}
assert.equal(sha(await readFile(lockPath)),sha(oldBytes),'Production lock drift');
for(const [file,h] of Object.entries(sourceHashes))assert.equal(sha(await readFile(join(root,file))),h,'Production file drift: '+file);
const after=await productionHealth();assert.deepEqual(after.kernel,before.kernel);assert.equal(after.pid,before.pid);
const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0'));
const git={head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),trackedSame:[],trackedDifferent:[],untracked:[]};
for(const [file,h] of Object.entries(sourceHashes)){
 if(!tracked.has(file))git.untracked.push(file);
 else git[sha(execFileSync('git',['show','HEAD:'+file],{cwd:root,maxBuffer:20*1024*1024}))===h?'trackedSame':'trackedDifferent'].push(file);
}
const report={at:new Date().toISOString(),scope:'Step 0.5 only; isolated self-test, not independent QA or deployment',passed:results.length,results,
 production:{before,after,lockSha256:sha(oldBytes),frozenFilesUnchanged:84,productionPostRequests:0,restarts:0,goodsSubmitted:0},
 git,candidateManifestSha256:sha(await readFile(join(out,'candidate-manifest.json')))};
await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,result:join(out,'result.json'),productionUnchanged:true,pid:after.pid,kernel:after.kernel}));
