import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {SourceStore,digest} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ProductApi} from '../product-api.mjs';
import {TravelOsApi} from '../travel-os-api.mjs';
import {replaceMaterial,materialEditInfo,materialReplacements} from '../material-replacement.mjs';

export function png(red=20){
 const crc=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(kind,data)=>{const b=Buffer.concat([Buffer.from(kind),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(b));return Buffer.concat([head,b,tail]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,red,120,200,255]))),chunk('IEND',Buffer.alloc(0))]);
}
export async function fixture(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'travel-replace-'))),root=join(dir,'assets'),shop={id:'test-shop',name:'图片QA店'};
 const bytes=png(),make=async relative=>{const path=join(root,relative);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);return {path,sha256:digest(bytes),mimeType:'image/png'};};
 const main=await make('主图/城市.png'),a=await Promise.all([1,2,3,4].map(i=>make('副图/A/'+i+'.png'))),b=await Promise.all([1,2,3,4].map(i=>make('副图/B/'+i+'.png'))),covers=await Promise.all([1,2].map(i=>make('详情首页/首页-'+i+'.png'))),body=await make('详情正文/正文.png');
 const store=new SourceStore(join(dir,'source.sqlite')),flow={store,active:null,artifacts:dir,launch(){throw Error('NO_EXECUTION');}},batch=new BatchWorkflow(flow);
 const params={source:flow,batch,shop,runtime:dir,owner:{sessions:new Map(),status:async()=>({running:false,loggedIn:false})},launch(){throw Error('NO_BROWSER');},integrity:async()=>({ok:true}),checkFiles:async()=>{}},p=new ProductApi(params);
 await p.saveSettings({assets:root});
 const tasks=[1,2].map(n=>({shopId:shop.id,priority:n,listing:{type:'city',country:'测试国',city:'城市'+n,title:'测试标题'+n},business:{shop_name:shop.name},source:{synthetic:true},assets:{main:[main],secondary:a,details:[covers[0],body]},adapterIssues:[]}));
 const input={sourceHash:'ISOLATED_IMAGE_REPLACEMENT',assetRoot:root,format:'travel-os-template-v2',sheet:'商品清单',tasks,templateMaterials:{secondary:{A:a,B:b},covers}},importId=store.imported(input);
 const api=new TravelOsApi({product:async()=>p,shops:async()=>[shop,{id:'other-shop',name:'另一店'}],browser:params.owner,launch:params.launch,runtime:dir});
 const assetFor=file=>{const id=digest([shop.id,file]);return {id,file,originalFile:file,shopId:shop.id,url:'/api/os/material-asset?id='+id};};
 const asset=assetFor(covers[0].path);
 const request=async(target=asset,red=220)=>{const info=await materialEditInfo(p,target);return {shopId:shop.id,assetId:target.id,expectedRevision:info.revision,expectedHash:info.sha256,name:'新图.png',data:png(red).toString('base64'),requestId:randomUUID()};};
 t.after(async()=>{api.store.close();store.close();assert.equal(dirname(dir),await realpath(tmpdir()));await rm(dir,{recursive:true,force:true});});
 return {dir,root,p,params,shop,store,flow,batch,api,asset,assetFor,request,input,importId,covers,bytes};
}

