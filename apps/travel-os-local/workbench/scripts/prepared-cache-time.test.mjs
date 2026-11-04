import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {createHash} from 'node:crypto';
import {preparedMaterialAsset,verifyMaterialUploadReceipt} from '../taobao-publisher.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),url='https://img.alicdn.com/imgextra/i1/3997268470/O1CN01WXQFj8hAvKC2XrKe_!!3997268470.png_320x320?t=1793597808000';
async function fixture(t,expected=url){const runtime=await mkdtemp(join(tmpdir(),'ly-cache-time-'));assert(runtime.startsWith(resolve(tmpdir())+sep+'ly-cache-time-'));t.after(()=>rm(runtime,{recursive:true,force:true}));const shopId='shop-cache-time-fixture',path=join(runtime,'original.png'),bytes=Buffer.from('synthetic immutable fixture'),asset={path,sha256:hash(bytes),materialVersion:{revision:'fixture-r1'}};await writeFile(path,bytes);const uploadName='original--'+asset.sha256+'.png',receipt={version:1,shopId,sha256:asset.sha256,uploadName,url:expected,aliases:[{path,materialVersion:asset.materialVersion}],at:new Date().toISOString()},folder=join(runtime,'material-upload-preparation',hash(JSON.stringify(shopId)).slice(0,24),'receipts');await mkdir(folder,{recursive:true});const receiptPath=join(folder,asset.sha256+'.json');await writeFile(receiptPath,JSON.stringify(receipt));return {asset:await preparedMaterialAsset(asset,shopId,runtime),receiptPath,bytes:await readFile(receiptPath)};}
test('observed one-second cache time drift retains exact prepared image identity',async t=>{const f=await fixture(t);assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('7808000','7807000')),true);assert.deepEqual(await readFile(f.receiptPath),f.bytes);});
test('positive one-second drift and exact URL are accepted',async t=>{const f=await fixture(t);assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('7808000','7809000')),true);assert.equal(await verifyMaterialUploadReceipt(f.asset,url),true);});
const denied=[
 ['more than one second',url.replace('7808000','7806999')],
 ['different source image',url.replace('WXQFj8hAvKC','OTHERIMAGE')],
 ['different resize variant',url.replace('_320x320','_640x640')],
 ['unrelated host',url.replace('img.alicdn.com','img.alicdn.com.attacker.example').replace('7808000','7807000')],
 ['insecure protocol',url.replace('https:','http:').replace('7808000','7807000')],
 ['extra query key',url.replace('7808000','7807000')+'&version=2'],
 ['duplicate t',url.replace('7808000','7807000')+'&t=1793597808000'],
 ['encoded duplicate t',url.replace('7808000','7807000')+'&%74=1793597808000'],
 ['missing t',url.split('?')[0]],
 ['short t',url.replace('1793597808000','2')],
 ['nonnumeric t',url.replace('1793597808000','179359780800x')],
 ['fragment',url.replace('7808000','7807000')+'#other'],
 ['credentials',url.replace('https://','https://name@').replace('7808000','7807000')]
];for(const [name,observed]of denied)test('reject '+name,async t=>{const f=await fixture(t);assert.equal(await verifyMaterialUploadReceipt(f.asset,observed),false);assert.deepEqual(await readFile(f.receiptPath),f.bytes);});
test('other query bytes and their order must remain identical',async t=>{const f=await fixture(t,url+'&a=%20&b=1');assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('7808000','7807000')+'&a=%20&b=1'),true);assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('7808000','7807000')+'&a=+&b=1'),false);assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('7808000','7807000')+'&b=1&a=%20'),false);});
test('card path uses the same strict comparison and receipt is immutable',async t=>{const f=await fixture(t),card={locator:selector=>{assert.equal(selector,'.PicList_pic_imgBox__c0HXw img');return {getAttribute:async name=>{assert.equal(name,'src');return url.replace('7808000','7807000');}};}};assert.equal(await verifyMaterialUploadReceipt(f.asset,card),true);assert.deepEqual(await readFile(f.receiptPath),f.bytes);});
test('forged upload binding still fails before URL relaxation',async t=>{const f=await fixture(t),forged={...f.asset,preparedMaterial:{...f.asset.preparedMaterial,uploadName:'other.png'}};await assert.rejects(verifyMaterialUploadReceipt(forged,url.replace('7808000','7807000')),/MATERIAL_PREPARATION_RECEIPT_INVALID/);});
test('legacy short cache time mismatch remains rejected',async t=>{const f=await fixture(t,url.replace('1793597808000','1'));assert.equal(await verifyMaterialUploadReceipt(f.asset,url.replace('1793597808000','2')),false);});
