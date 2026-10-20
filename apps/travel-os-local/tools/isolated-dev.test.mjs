import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm,realpath,symlink,unlink,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createSnapshot,verifySnapshot,runIsolatedTests} from './isolated-dev.mjs';
async function fixture(t){
 const parent=await realpath(tmpdir()),root=await mkdtemp(join(parent,'travel-isolation-'));
 t.after(async()=>{assert.equal(dirname(root),parent);await rm(root,{recursive:true,force:true});});
 for(const dir of ['docs','engine','tools','workbench','.interface-design','.impeccable'])await mkdir(join(root,dir));
 for(const file of ['.gitignore','.gitattributes','AGENTS.md','README.md','PRODUCT.md','DESIGN.md','design-qa.md','安装工作台.cmd','恢复业务数据.cmd','启动上架工作台.vbs','打开旅行上架工作台.cmd'])await writeFile(join(root,file),'synthetic source');
 await copyFile(join(import.meta.dirname,'sync-source.mjs'),join(root,'tools/sync-source.mjs'));
 return root;
}
test('snapshot excludes runtime/profile/dependencies and verifies every copied source byte',async t=>{
 const root=await fixture(t);
 for(const dir of ['.runtime','browser-profile','chrome-profile','node_modules','output']){await mkdir(join(root,'workbench',dir));await writeFile(join(root,'workbench',dir,'DO_NOT_COPY'),'synthetic private data');}
 await writeFile(join(root,'workbench','.env'),'synthetic private data');await writeFile(join(root,'workbench','data.sqlite'),'synthetic private data');
 const destination=join(root,'output','dev'),marker=await createSnapshot({root,destination});assert(marker.files>10);
 assert.equal(marker.isolatedRoot,await realpath(destination));assert.equal(marker.noProductionRuntime,true);assert.deepEqual(await verifySnapshot(destination),{files:marker.files,bytes:marker.bytes});
 const manifest=JSON.parse(await readFile(join(destination,'SOURCE_MANIFEST.json'),'utf8'));assert(!manifest.files.some(e=>/DO_NOT_COPY|\.env|\.sqlite/.test(e.path)));
 await assert.rejects(createSnapshot({root,destination}),/DESTINATION_EXISTS/);
 await writeFile(join(destination,'README.md'),'changed');await assert.rejects(verifySnapshot(destination),/HASH_MISMATCH/);
});
test('destination guards reject source/parent/outside and linked paths before exporting',async t=>{
 const root=await fixture(t);
 for(const destination of [root,dirname(root),join(root,'workbench'),join(root,'output')])await assert.rejects(createSnapshot({root,destination}),/MUST_BE_NEW_OUTPUT_CHILD/);
 const outside=await mkdtemp(join(await realpath(tmpdir()),'travel-isolation-link-')),link=join(root,'output');
 await symlink(outside,link,'junction');
 try{await assert.rejects(createSnapshot({root,destination:join(link,'candidate')}),/LINK_REFUSED/);await assert.rejects(lstat(join(outside,'candidate')),e=>e.code==='ENOENT');}
 finally{await unlink(link);assert.equal(dirname(outside),await realpath(tmpdir()));await rm(outside,{recursive:true,force:true});}
});
test('test runner requires an isolated marker and refuses startup/relative escape commands',async t=>{
 const root=await fixture(t);await assert.rejects(runIsolatedTests({root,files:['workbench/server.mjs']}),e=>e.code==='ENOENT');
 const destination=join(root,'output','dev');await createSnapshot({root,destination});
 for(const file of ['workbench/server.mjs','../workbench/scripts/a.test.mjs','tools/start-workbench.mjs'])await assert.rejects(runIsolatedTests({root:destination,files:[file]}),/TEST_PATH_REFUSED/);
 const check=join(destination,'workbench/scripts');await mkdir(check,{recursive:true});
 await writeFile(join(check,'isolated-env.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';test('isolated child',()=>{assert.equal(process.env.WORKBENCH_PORT,'0');assert.equal(process.env.WORKBENCH_NO_LISTEN,'1');assert.equal(process.env.TRAVEL_OS_ISOLATED,'1');assert.equal(process.env.WORKBENCH_LAN_ADDRESS,undefined);writeFileSync(new URL('../../runner-child-ran',import.meta.url),'ran');});");
 await runIsolatedTests({root:destination,files:['workbench/scripts/isolated-env.test.mjs']});
 assert.equal(await readFile(join(destination,'runner-child-ran'),'utf8'),'ran');
});
