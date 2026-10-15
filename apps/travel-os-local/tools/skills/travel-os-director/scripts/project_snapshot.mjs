import {readFile,readdir,access} from 'node:fs/promises';
import {join,resolve,extname,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const excluded=new Set(['.git','.runtime','node_modules','browser-profile','output','outputs','__pycache__']);
async function inventory(dir){
 const result={files:0,extensions:{}};
 async function visit(path){
  for(const entry of await readdir(path,{withFileTypes:true})){
   if(entry.isSymbolicLink()||excluded.has(entry.name))continue;
   if(entry.isDirectory())await visit(join(path,entry.name));
   else if(entry.isFile()){result.files++;const key=extname(entry.name)||'(none)';result.extensions[key]=(result.extensions[key]||0)+1;}
  }
 }
 try{await visit(dir);}catch(e){result.error=e.code||'READ_FAILED';}return result;
}
async function frozen(root){
 try{
  const lock=JSON.parse(await readFile(join(root,'workbench/kernel-lock.json'),'utf8')),changed=[],actual={};
  for(const [file,expected] of Object.entries(lock.files||{})){
   const path=resolve(root,file),rel=relative(root,path);
   if(isAbsolute(file)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||rel.split(/[\\/]/).some(x=>excluded.has(x))){changed.push(file);actual[file]='REFUSED_PATH';continue;}
   const sha=await readFile(path).then(hash).catch(()=>null);actual[file]=sha;if(sha!==expected)changed.push(file);
  }
  const count=Object.keys(lock.files||{}).length;
  return {ok:count>0&&changed.length===0,revision:lock.revision||lock.baselineCommit,files:count,changed,actual};
 }catch(e){return {ok:false,error:e.code||'INVALID_MANIFEST'};}
}
async function get(base,path){
 try{
  const response=await fetch(base+path,{signal:AbortSignal.timeout(5000)});
  if(!response.ok)return {available:false,status:response.status};
  return {available:true,data:await response.json()};
 }catch(e){return {available:false,error:e.name==='TimeoutError'?'TIMEOUT':'UNAVAILABLE_OR_INVALID_JSON'};}
}
const kernelView=x=>x?{ok:x.ok,revision:x.revision,files:x.files,changed:x.changed}:null;
const browserView=x=>x?{running:x.running,loggedIn:x.loggedIn,loginState:x.loginState,checkedAt:x.checkedAt,stale:x.stale}:null;
function stateView(s){
 const r=s.round,w=r?.window,c=r?.current;
 return {shop:s.shop,active:s.active,executionEnabled:s.settings?.executionEnabled,listingDefaults:s.settings?.listingDefaults,kernel:kernelView(s.kernel),browser:browserView(s.browser),
  round:r?{id:r.id,shop:r.shop,importId:r.importId,manifestHash:r.manifestHash,authorizationHash:r.authorizationHash,repairVersion:r.repairVersion,state:r.state,active:r.active,total:r.total,counts:r.counts,updated:r.updated,
   current:c?{key:c.key,destination:c.destination,state:c.state,stage:c.stage,runId:c.runId,submitted:c.submitted,submissionUncertain:c.submissionUncertain,enteredPublish:c.enteredPublish}:null,
   window:w?{id:w.id,sequence:w.sequence,state:w.state,total:w.total,ended:w.ended,counts:w.counts,selectionHash:w.selectionHash}:null}:null,
  recordCount:s.records?.length,exceptionCount:s.exceptions?.length};
}

export async function collectSnapshot({root=process.cwd(),base='http://127.0.0.1:4318',offline=false}={}){
 root=resolve(root);
 // A loopback probe only. Do not send project information to a remote host.
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Probe base must be a loopback origin');
 await access(join(root,'AGENTS.md'));await access(join(root,'workbench/server.mjs'));
 const startedAt=new Date().toISOString(),before=await frozen(root),sourceInventory={};
 const results=await Promise.allSettled(['docs','workbench','engine','tools'].map(async name=>({name,value:await inventory(join(root,name))})));
 for(const result of results)if(result.status==='fulfilled')sourceInventory[result.value.name]=result.value.value;
 let git;
 try{
  // Git normally walks up into a parent repository. A fixture/export inside
  // the production tree must not inspect that unrelated repository.
  await access(join(root,'.git'));
  const {stdout:top}=await exec('git',['-C',root,'rev-parse','--show-toplevel'],{windowsHide:true,timeout:10000});
  const normalize=path=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
  if(normalize(top.trim())!==normalize(root))throw Error('NOT_A_REPOSITORY_ROOT');
  const {stdout}=await exec('git',['-c','core.quotepath=false','-C',root,'status','--porcelain=v1'],{windowsHide:true,timeout:10000,maxBuffer:2*1024*1024});
  const lines=stdout.split(/\r?\n/).filter(Boolean);
  const {stdout:head}=await exec('git',['-C',root,'log','-1','--format=%H %cI %s'],{windowsHide:true,timeout:10000});
  git={available:true,head:head.trim(),changedEntries:lines.length,trackedChanges:lines.filter(x=>!x.startsWith('??')).length,untrackedEntries:lines.filter(x=>x.startsWith('??')).length};
 }catch{git={available:false,reason:'NOT_A_REPOSITORY_ROOT_OR_GIT_UNAVAILABLE'};}
 let live={probed:false};
 if(!offline){
  const [h,s,o]=await Promise.all([get(url.origin,'/api/v1/health'),get(url.origin,'/api/v1/state'),get(url.origin,'/api/os/state')]);
  live={probed:true,base:url.origin,
   health:h.available?{available:true,app:h.data.app,pid:h.data.pid,kernel:kernelView(h.data.kernel)}:h,
   state:s.available?{available:true,...stateView(s.data)}:s,
   website:o.available?{available:true,shops:o.data.shops?.map(x=>({id:x.id,name:x.name,executionSupported:x.executionSupported,products:x.products})),capabilities:o.data.capabilities,productCount:o.data.products?.length}:o};
 }
 const after=await frozen(root),changedDuringProbe=Object.keys({...before.actual,...after.actual}).filter(file=>before.actual?.[file]!==after.actual?.[file]);
 const disk={...after};delete disk.actual;
 const health=live.health?.kernel,state=live.state?.kernel;
 return {startedAt,finishedAt:new Date().toISOString(),root,scope:'READ_ONLY_FILES_GIT_AND_EXISTING_SERVICE_GET',sourceInventory,git,diskKernel:disk,live,
  consistency:{filesChangedDuringProbe:changedDuringProbe,healthVsStateRevision:health&&state?health.revision===state.revision:null,stateVsDiskRevision:state?state.revision===disk.revision:null,
   note:'Version labels can match while hashes differ. Compare changed files and evidence; this snapshot does not approve execution.'}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);let root=process.cwd(),base='http://127.0.0.1:4318',offline=false;
 try{
  for(let i=0;i<args.length;i++){
   if(args[i]==='--root'&&args[i+1])root=args[++i];
   else if(args[i]==='--base'&&args[i+1])base=args[++i];
   else if(args[i]==='--offline')offline=true;
   else throw Error('Usage: project_snapshot.mjs [--root path] [--offline] [--base loopback-origin]');
  }
  console.log(JSON.stringify(await collectSnapshot({root,base,offline}),null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
