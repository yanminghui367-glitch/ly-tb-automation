import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,shop} from './skip-independent-fixture.mjs';
import {ProductApi} from '../product-api.mjs';
import {RoundItemApi} from '../round-item-api.mjs';
async function fixture(t){
 const f=await setup(t),p={shop,roundItems:new RoundItemApi(f.action)};
 const request=async(method,path,input)=>{
  let result;await ProductApi.prototype.handleRound.call(p,{method},{},new URL(path,'http://localhost'),{body:async()=>input,json:(_r,status,data)=>result={status,data}});return result;
 };
 return {...f,request};
}
test('shop-scoped website item GET and skip POST reach original item adapter with their own scope',async t=>{
 const f=await fixture(t),query=new URLSearchParams({...f.scope(),executionShop:shop.id});
 const detail=await f.request('GET','/api/v1/rounds/item?'+query);assert.equal(detail.status,200);assert.equal(detail.data.key,f.scope().key);assert.equal(detail.data.capabilities.skip.allowed,true);
 const result=await f.request('POST','/api/v1/rounds/item-skip?executionShop='+shop.id,{...f.scope(),expectedRevision:detail.data.revision,requestId:'scoped-skip',reason:'原问题条首轮跳过'});
 assert.equal(result.status,200);assert.equal(result.data.outcome.state,'MANUAL_SKIPPED');assert.equal(f.flow.submits,0);
});
test('wrong or duplicate shop routing is rejected; unknown item parameters remain invalid',async t=>{
 const f=await fixture(t),base='/api/v1/rounds/item?'+new URLSearchParams(f.scope());
 for(const suffix of ['&executionShop=other-shop','&executionShop='+shop.id+'&executionShop='+shop.id])await assert.rejects(f.request('GET',base+suffix),/当前执行店铺不一致/);
 assert.equal((await f.request('GET',base+'&executionShop='+shop.id+'&other=1')).status,400);assert.equal(f.flow.submits,0);
});
