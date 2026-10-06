import {mkdtemp,rm,readFile,writeFile,mkdir,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ProductApi} from '../product-api.mjs';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
export const shop={id:'wuzhou-changyou',name:'五洲畅游'};
export async function fixture(t,{count=2}={}){
 await mkdir(resolve('../output/setup-20261006/tests'),{recursive:true});const dir=await mkdtemp(resolve('../output/setup-20261006/tests/travel-setup-')),sourceRoot=join(dir,'source');
 execFileSync('python',[resolve('scripts/setup-fixture.py'),sourceRoot,'--count',String(count)],{windowsHide:true});
 const store=new SourceStore(join(dir,'runtime','source.sqlite')),source={store,runtime:join(dir,'runtime'),artifacts:join(dir,'artifacts'),active:null},batch=new BatchWorkflow(source);
 let loggedIn=false,launches=0;const owner={sessions:new Map(),status:async()=>({running:true,loggedIn,loginState:loggedIn?'LOGGED_IN':'LOGIN_REQUIRED',checkedAt:new Date().toISOString(),reason:loggedIn?'店铺身份匹配':'请人工登录目标店铺'}),focus:async()=>{}};
 const params={source,batch,shop,owner,runtime:join(dir,'runtime'),integrity:async()=>({ok:true,files:13}),launch:async()=>{launches++;}},p=new ProductApi(params);
 const call=async(action,input)=>{let result;await p.handle({method:input===undefined?'GET':'POST'},{},new URL('http://localhost/api/v1/'+action),{body:async()=>input,json:(_r,_s,value)=>result=value});return result;};
 t?.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 return {dir,sourceRoot,store,source,batch,p,params,owner,call,setLogin:v=>loggedIn=v,launches:()=>launches};
}
