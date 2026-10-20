import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';

export async function fixture(t,n=6){
 const dir=await mkdtemp(join(tmpdir(),'ly-window-')),store=new SourceStore(join(dir,'source.sqlite'));
 t.after(async()=>{store.close();assert(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});});
 const shop={id:'window-test-shop',name:'隔离测试'},tasks=Array.from({length:n},(_,i)=>({shopId:shop.id,priority:i+1,source:{},listing:{type:'city',country:'测试',city:'城市'+(i+1),title:'标题'+(i+1)},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]}));
 const importId=store.imported({sourceHash:'isolated-window',tasks});let held=false,release,failAt=0,behavior=()=>null;
 const flow={store,artifacts:dir,active:null,launches:[],stop:false,submits:0,
  launch(id){assert(!this.active);this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{
   store.move(id,'RUNNING');if(held)await new Promise(r=>release=r);
   if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}
   const task=store.run(id).task;
   const outcome=behavior(task);if(outcome){store.checkpoint(id,{step:outcome.step||'main-image-1',errorCode:outcome.code});if(outcome.state==='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});}store.move(id,outcome.state||'PAUSED',outcome.reason||'TASK_DATA: 单商品错误');return;}
   if(task.priority===failAt){store.checkpoint(id,{step:'main-image-1',errorCode:'TASK_DATA'});store.move(id,'PAUSED','TASK_DATA: 单商品资料错误');return;}
   store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});
   store.move(id,'VERIFIED','',{itemId:String(999000+task.priority),status:'出售中',rowText:'隔离平台记录',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
  })().finally(()=>this.active=null);},
  async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();}
 };
 const batch=new BatchWorkflow(flow);let checked=[];
 const make=()=>new ListingRound({source:flow,batch,shop,contentReviews:{assertApproved:()=>({decision:'PASS'})},checkFiles:async task=>checked.push(task.priority),assertExecution:async()=>{},verifyExisting:async({history})=>history||null,artifacts:join(dir,'rounds')});
 const round=make(),r=await round.create({importId,repairVersion:'fixture',expectedCount:n,authorization:{allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n}});
 // This fixture targets the post-P5 window gate. Separate existing tests prove
 // the real 1 -> 5 publication gates; this is not platform acceptance evidence.
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const create=async(config={})=>round.windows.create(await round.windows.preview(r.id,config));
 const run=async w=>{round.start(r.id,{windowId:w.id});await round.pending;};
 return {round,r,store,flow,batch,tasks,make,create,run,checked,hold:()=>held=true,release:()=>{held=false;release?.();},fail:n=>failAt=n,setBehavior:f=>behavior=f};
}

