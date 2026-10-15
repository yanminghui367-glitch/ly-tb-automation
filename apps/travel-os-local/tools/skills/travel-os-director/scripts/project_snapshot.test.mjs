import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {collectSnapshot} from './project_snapshot.mjs';

async function fixture(t){
 const root=resolve(await mkdtemp(join(tmpdir(),'travel-director-')));
 assert.equal(dirname(root),resolve(tmpdir()));assert(basename(root).startsWith('travel-director-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['docs','workbench','engine','tools','workbench/.runtime','browser-profile'])await mkdir(join(root,dir),{recursive:true});
 for(const [file,text] of [['AGENTS.md','fixture'],['workbench/server.mjs','fixture'],['workbench/core.mjs','original'],['workbench/.runtime/secret.json','PRIVATE_SENTINEL'],['browser-profile/secret','PRIVATE_PROFILE_SENTINEL']])await writeFile(join(root,file),text);
 await writeFile(join(root,'workbench/kernel-lock.json'),JSON.stringify({revision:'disk-v2',files:{'workbench/core.mjs':createHash('sha256').update('original').digest('hex')}}));
 return root;
}

test('snapshot detects frozen mismatches, preserves files and excludes private directories',async t=>{
 const root=await fixture(t),first=await collectSnapshot({root,offline:true});
 assert.equal(first.diskKernel.ok,true);assert.equal(first.sourceInventory.workbench.files,3);assert.equal(first.live.probed,false);
 await writeFile(join(root,'workbench/core.mjs'),'changed');const result=await collectSnapshot({root,offline:true});
 assert.equal(result.diskKernel.ok,false);assert.deepEqual(result.diskKernel.changed,['workbench/core.mjs']);
 assert.equal(await readFile(join(root,'workbench/core.mjs'),'utf8'),'changed');
 assert.equal(await readFile(join(root,'workbench/.runtime/secret.json'),'utf8'),'PRIVATE_SENTINEL');
 assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(result).includes('PRIVATE_PROFILE_SENTINEL'));
});

test('existing-service probe issues GET only and separates cached health from current state',async t=>{
 const root=await fixture(t),calls=[];
 const server=createServer((req,res)=>{
  calls.push({method:req.method,path:req.url});res.setHeader('Content-Type','application/json');
  if(req.url==='/api/v1/health')res.end(JSON.stringify({app:'ly-tb-workbench',pid:1,kernel:{revision:'cached-v1',ok:true}}));
  else if(req.url==='/api/v1/state')res.end(JSON.stringify({shop:{id:'correct-shop'},kernel:{revision:'disk-v2',ok:true},settings:{executionEnabled:false},active:null,round:{id:'original-round',manifestHash:'original-manifest',state:'RESULT_UNKNOWN',counts:{RESULT_UNKNOWN:1},current:{submitted:true,submissionUncertain:true}}}));
  else res.end(JSON.stringify({shops:[{id:'correct-shop',name:'fixture'}],products:[],capabilities:{multiShopExecution:false}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await collectSnapshot({root,base:'http://127.0.0.1:'+server.address().port});
 assert.equal(calls.length,3);assert(calls.every(x=>x.method==='GET'));assert.equal(result.consistency.healthVsStateRevision,false);assert.equal(result.consistency.stateVsDiskRevision,true);
 assert.equal(result.live.state.round.manifestHash,'original-manifest');assert.equal(result.live.state.round.state,'RESULT_UNKNOWN');assert.equal(result.live.state.round.current.submitted,true);
 assert.equal(result.live.state.executionEnabled,false);
});

test('unavailable service remains unavailable, and remote probe origins are rejected',async t=>{
 const root=await fixture(t),server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const result=await collectSnapshot({root,base:'http://127.0.0.1:'+port});
 assert.equal(result.live.health.available,false);assert.equal(result.live.state.available,false);assert.equal(result.diskKernel.ok,true);
 await assert.rejects(collectSnapshot({root,base:'https://example.com'}),/loopback/);
});

test('an isolated copy inside a repository never reports the parent repository status',async t=>{
 const parent=await fixture(t);await promisify(execFile)('git',['init','--quiet',parent],{windowsHide:true});
 const root=join(parent,'isolated-copy');await mkdir(join(root,'workbench'),{recursive:true});
 await writeFile(join(root,'AGENTS.md'),'fixture-only');await writeFile(join(root,'workbench/server.mjs'),'fixture-only');
 const result=await collectSnapshot({root,offline:true});
 assert.equal(result.git.available,false);assert.equal(result.git.head,undefined);assert.equal(result.git.changedEntries,undefined);
 assert.equal(result.git.reason,'NOT_A_REPOSITORY_ROOT_OR_GIT_UNAVAILABLE');
});
