import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {preparedMaterialAsset,materialAssetName,verifyMaterialUploadReceipt} from '../taobao-publisher.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{platformName=true}={}){
 const runtime=await mkdtemp(join(tmpdir(),'ly-prepared-consumption-'));
 t.after(()=>rm(runtime,{recursive:true,force:true}));
 const shopId='shop-prepared-test',path=join(runtime,'原主图.png'),bytes=Buffer.from('immutable original synthetic bytes');
 await writeFile(path,bytes);
 const asset={path,sha256:hash(bytes),materialVersion:{revision:'source-r1'}};
 const uploadName='原主图--'+asset.sha256+'.png',materialName=uploadName.slice(0,50)+'.png';
 const receipt={version:1,shopId,sha256:asset.sha256,uploadName,url:'https://img.alicdn.com/imgextra/test.png_320x320?t=1',aliases:[{path,materialVersion:asset.materialVersion}],at:new Date().toISOString()};
 const root=join(runtime,'material-upload-preparation',hash(JSON.stringify(shopId)).slice(0,24)),folder=join(root,'receipts');
 if(platformName){
  const jobId='a'.repeat(32),batchIntentAt=new Date().toISOString(),platformId='synthetic-card-17';
  receipt.materialName=materialName;receipt.platformId=platformId;
  receipt.evidence={kind:'TRUNCATED_SHA256_MATERIAL_CARD',rule:'FIRST_50_PLUS_EXTENSION',shopId,jobId,batchIntentAt,expectedFullName:uploadName,sha256:asset.sha256,materialName,hashPrefix:asset.sha256.slice(0,50-uploadName.indexOf(asset.sha256)),platformId,visible:true,decoded:true,nameUnique:true,url:receipt.url};
  await mkdir(join(root,'jobs'),{recursive:true});await writeFile(join(root,'jobs',jobId+'.json'),JSON.stringify({id:jobId,shopId,files:[{name:uploadName,sha256:asset.sha256}],batchIntents:[{at:batchIntentAt,files:[uploadName]}]}));
 }
 const receiptPath=join(folder,asset.sha256+'.json');
 await mkdir(folder,{recursive:true});await writeFile(receiptPath,JSON.stringify(receipt));
 return {runtime,shopId,asset,receipt,materialName,receiptPath};
}

test('prepared asset carries actual platform name while preserving immutable upload name and original asset',async t=>{
 const x=await fixture(t),p=await preparedMaterialAsset(x.asset,x.shopId,x.runtime);
 assert.equal(p.preparedMaterial.materialName,x.materialName);
 assert.equal(p.preparedMaterial.uploadName,x.receipt.uploadName);
 assert.notEqual(p.preparedMaterial.materialName,p.preparedMaterial.uploadName);
 assert.equal(materialAssetName(p),x.materialName);
 assert.equal(p.path,x.asset.path);assert.equal(p.sha256,x.asset.sha256);assert.deepEqual(p.materialVersion,x.asset.materialVersion);
 assert.equal(x.asset.preparedMaterial,undefined);
});

test('platform-name lookup keeps exact URL and original upload-name receipt binding',async t=>{
 const x=await fixture(t),p=await preparedMaterialAsset(x.asset,x.shopId,x.runtime);
 const card={locator:selector=>{assert.equal(selector,'.PicList_pic_imgBox__c0HXw img');return {getAttribute:async key=>{assert.equal(key,'src');return x.receipt.url;}};}};
 assert.equal(await verifyMaterialUploadReceipt(p,card),true);
 assert.equal(await verifyMaterialUploadReceipt(p,'https://img.alicdn.com/imgextra/test.png_320x320?t=2'),false);
 const forged={...p,preparedMaterial:{...p.preparedMaterial,uploadName:x.materialName}};
 await assert.rejects(verifyMaterialUploadReceipt(forged,x.receipt.url),/MATERIAL_PREPARATION_RECEIPT_INVALID/);
});

test('old prepared receipt without platform name retains complete upload-name lookup',async t=>{
 const x=await fixture(t,{platformName:false}),p=await preparedMaterialAsset(x.asset,x.shopId,x.runtime);
 assert.equal(materialAssetName(p),x.receipt.uploadName);
 assert.equal(await verifyMaterialUploadReceipt(p,x.receipt.url),true);
});

test('ordinary source filename stays unchanged and wrong-shop receipt cannot be attached',async t=>{
 const x=await fixture(t);
 assert.equal(materialAssetName(x.asset),'原主图.png');
 assert.equal(await preparedMaterialAsset(x.asset,'shop-another',x.runtime),x.asset);
});

test('unproved platform-name override is rejected rather than becoming a search fallback',async t=>{
 const x=await fixture(t);x.receipt.materialName='其他同名图片.png';
 await writeFile(x.receiptPath,JSON.stringify(x.receipt));
 await assert.rejects(preparedMaterialAsset(x.asset,x.shopId,x.runtime),e=>e.code==='MATERIAL_PREPARATION_RECEIPT_INVALID');
});
