import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyInsertedDetails} from '../taobao-publisher.mjs';
const assets=[1,2].map(i=>({path:`frozen/detail-${i}.png`,sha256:String(i).repeat(64)}));
const urls=[1,2].map(i=>`https://img.alicdn.com/detail-${i}.png`);
const receipt=i=>({order:i+1,url:urls[i],source:assets[i]});
test('missing first receipt cannot hide later wrong content or order',async()=>{
 await assert.rejects(verifyInsertedDetails(urls,assets,[null,{...receipt(1),url:urls[0]}]),/EXISTING_DETAIL_MISMATCH/);
 await assert.rejects(verifyInsertedDetails(urls,assets,[null,{...receipt(1),order:1}]),/EXISTING_DETAIL_MISMATCH/);
});
test('missing first receipt cannot hide later wrong frozen source',async()=>{
 await assert.rejects(verifyInsertedDetails(urls,assets,[null,{...receipt(1),source:assets[0]}]),/DETAIL_SOURCE_MISMATCH/);
});
test('too many images takes priority over missing receipt',async()=>{
 await assert.rejects(verifyInsertedDetails([...urls,urls[0]],assets,[]),/TOO_MANY_DETAIL_IMAGES/);
});
test('only missing receipts with all known content valid is eligible for exact missing error',async()=>{
 await assert.rejects(verifyInsertedDetails(urls,assets,[null,receipt(1)]),e=>e.message==='EXISTING_DETAIL_RECEIPT_MISSING');
});
