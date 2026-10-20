import {lstat,mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,join,dirname,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const defaultRoot=resolve(import.meta.dirname,'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const forbidden=new Set(['.git','.runtime','browser-profile','chrome-profile','.playwright-cli','node_modules','output','outputs']);
function descendant(parent,path){const rel=relative(parent,path);return !!rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);}
async function noLinks(path){
 let current=resolve(path);
 for(;;){try{if((await lstat(current)).isSymbolicLink())throw Error('ISOLATION_LINK_REFUSED');}catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=dirname(current);if(parent===current)break;current=parent;}
}
function child(command,args,options){return new Promise((resolveResult,reject)=>{
 const process=spawn(command,args,{...options,windowsHide:true,stdio:'inherit'});
 process.once('error',reject);process.once('exit',code=>code===0?resolveResult():reject(Error(`ISOLATION_CHILD_FAILED:${code}`)));
});}
export async function verifySnapshot(root){
 root=resolve(root);await noLinks(root);
 const manifest=JSON.parse(await readFile(join(root,'SOURCE_MANIFEST.json'),'utf8'));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('ISOLATION_MANIFEST_INVALID');
 const seen=new Set();
 for(const entry of manifest.files){
  const parts=String(entry.path).split('/'),path=resolve(root,...parts);
  if(!descendant(root,path)||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||forbidden.has(p))||seen.has(path))throw Error('ISOLATION_MANIFEST_PATH_INVALID');
  seen.add(path);await noLinks(path);const bytes=await readFile(path);
  if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)throw Error('ISOLATION_HASH_MISMATCH:'+entry.path);
 }
 for(const name of ['.git','.runtime','browser-profile','chrome-profile','workbench/.runtime','workbench/output']){
  try{await lstat(join(root,name));throw Error('ISOLATION_RUNTIME_PRESENT:'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return {files:seen.size,bytes:manifest.files.reduce((sum,e)=>sum+e.bytes,0)};
}
export async function createSnapshot({root=defaultRoot,destination}){
 root=resolve(root);destination=resolve(root,destination||'');
 if(!descendant(join(root,'output'),destination))throw Error('ISOLATION_DESTINATION_MUST_BE_NEW_OUTPUT_CHILD');
 await noLinks(root);await noLinks(destination);
 try{await lstat(destination);throw Error('ISOLATION_DESTINATION_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(dirname(destination),{recursive:true});await mkdir(destination);
 // The existing allowlist exporter never enters runtime or browser directories.
 // A partial snapshot is retained for inspection on failure; it is never reused.
 await child(process.execPath,[join(root,'tools/sync-source.mjs'),destination],{cwd:root});
 const verified=await verifySnapshot(destination);
 const marker={schemaVersion:1,createdAt:new Date().toISOString(),sourceRoot:await realpath(root),isolatedRoot:await realpath(destination),...verified,noProductionRuntime:true,noProductionPort4318:true,noBrowserCredentials:true,noGitAncestorLookup:true,testsUseSyntheticData:true};
 await writeFile(join(destination,'ISOLATED_DEV.json'),JSON.stringify(marker,null,2)+'\n',{flag:'wx'});
 return marker;
}
export async function runIsolatedTests({root=defaultRoot,files}){
 root=resolve(root);await noLinks(root);
 const marker=JSON.parse(await readFile(join(root,'ISOLATED_DEV.json'),'utf8'));
 if(marker.schemaVersion!==1||resolve(marker.isolatedRoot)!==await realpath(root)||resolve(marker.sourceRoot)===root||!marker.testsUseSyntheticData||!marker.noProductionRuntime)throw Error('ISOLATION_MARKER_INVALID');
 if(!files?.length)throw Error('ISOLATION_TEST_FILES_REQUIRED');
 const paths=[];
 for(const file of files){
  if(!/^(?:workbench\/scripts|tools)\/[a-zA-Z0-9_.-]+\.test\.mjs$/.test(file))throw Error('ISOLATION_TEST_PATH_REFUSED');
  const path=resolve(root,file);await noLinks(path);if(!(await lstat(path)).isFile())throw Error('ISOLATION_TEST_FILE_REQUIRED');paths.push(path);
 }
 const env={...process.env,WORKBENCH_PORT:'0',WORKBENCH_NO_LISTEN:'1',TRAVEL_OS_ISOLATED:'1'};
 delete env.WORKBENCH_LAN_ADDRESS;delete env.WORKBENCH_TEST_RUNTIME;delete env.NODE_TEST_CONTEXT;
 await child(process.execPath,['--test',...paths],{cwd:root,env});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,...args]=process.argv.slice(2);
 try{
  if(command==='create'){if(args.length!==1)throw Error('Usage: create output/<new-directory>');console.log(JSON.stringify(await createSnapshot({destination:args[0]})));}
  else if(command==='test')await runIsolatedTests({files:args});
  else throw Error('Usage: node tools/isolated-dev.mjs create output/<new-directory> | test workbench/scripts/<name>.test.mjs');
 }catch(e){console.error(e.message);process.exitCode=1;}
}
