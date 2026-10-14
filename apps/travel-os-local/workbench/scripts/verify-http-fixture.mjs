import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setup} from './skip-independent-fixture.mjs';
import {RoundItemHostGuard} from '../round-item-host.mjs';
import {RoundItemVerify} from '../round-item-verify.mjs';
import {RoundVerification} from '../round-verification.mjs';

export async function fixture(t,{submitted=false}={}){
 const f=await setup(t),o=f.round;
 if(submitted){
  await f.pause();const x=o.item(f.r.id,f.scope().key),run=f.store.run(x.run_id);
  f.store.move(run.id,'QUEUED');f.store.move(run.id,'RUNNING');f.store.move(run.id,'SUBMITTING');f.store.event(run.id,'SUBMIT_CLICKED',{});f.store.checkpoint(run.id,{itemId:'700001',step:'submit-once'});f.store.move(run.id,'RESULT_UNKNOWN');
  o.update(f.r.id,x.key,{state:'RESULT_UNKNOWN',submitted:1,submission_uncertain:1,failure_stage:'verify-platform-result'});o.state(f.r.id,'RESULT_UNKNOWN','synthetic unknown submit');
 }else{o.update(f.r.id,f.scope().key,{state:'RESULT_UNKNOWN',failure_stage:'existing-listing-check'});o.state(f.r.id,'PAUSED','synthetic candidate');}
 const p={round:o,source:f.flow,batch:f.batch,shop:o.shop,owner:{sessions:new Map([[o.shop.id,{context:{}}]])},capturing:false,reconciling:false,integrity:async()=>({ok:true})};
 let removed=false;const host=new RoundItemHostGuard(p,{isShopRemoved:()=>removed}),action=new RoundItemVerify(host);
 const screenshot=join(o.artifacts,'verify.png');await writeFile(screenshot,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));
 const result={itemId:'700001',url:'https://item.taobao.com/item.htm?id=700001',status:'出售中',rowText:'synthetic seller row',screenshot,verifiedAt:new Date().toISOString(),observed:{price:20,inventory:999999},differences:[]};
 let calls=0;o.verifyExisting=async()=>{calls++;return result;};
 const request=(extra={})=>({...f.scope(),expectedRevision:action.reader.read(f.scope()).revision,requestId:'verify-1',...extra});
 return {...f,p,host,action,result,request,calls:()=>calls,remove:()=>removed=true};
}

