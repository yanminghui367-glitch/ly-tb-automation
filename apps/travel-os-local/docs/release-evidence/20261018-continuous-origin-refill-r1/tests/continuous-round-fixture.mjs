import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceStore,digest,destinationKey} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound,classifyRoundFailure} from '../listing-round.mjs';

const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const task=n=>({schemaVersion:2,taskId:'task-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'国家',city:'城市'+n,title:'标题'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});
const result=n=>({itemId:String(100000+n),status:'仓库中',rowText:'真实后台记录',screenshot:'evidence.png',verifiedAt:new Date().toISOString(),url:'https://item.taobao.com/item.htm?id='+String(100000+n)});
async function fixture(t,n=7,{tasks=Array.from({length:n},(_,i)=>task(i+1)),rules,classifyFailure,onGate}={}){
 const dir=await mkdtemp(join(tmpdir(),'ly-round-')),store=new SourceStore(join(dir,'state.sqlite')),importId=store.imported({sourceHash:'pool-hash',tasks,summary:{total:n}});
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 let release,held=false,behavior=()=>({state:'VERIFIED'}),check=async()=>{},inspect=async({history})=>history||null,executionCheck=async()=>{};
 const flow={store,artifacts:dir,runtime:dir,active:null,submits:0,launches:[],stop:false,maxActive:0,
  launch(id){assert.equal(this.active,null,'single source owner');this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{const r=store.run(id);if(r.state!=='RESULT_UNKNOWN')store.move(id,'RUNNING');if(held)await new Promise(resolve=>release=resolve);if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}const outcome=behavior(r);if(outcome.state==='VERIFIED'){if(r.state!=='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});}store.move(id,'VERIFIED','',result(r.task.priority));}else if(outcome.state==='RESULT_UNKNOWN'){store.move(id,'SUBMITTING');this.submits++;store.event(id,'SUBMIT_CLICKED',{});store.checkpoint(id,{itemId:String(100000+r.task.priority),step:'submit-once'});store.move(id,'RESULT_UNKNOWN','submitted then disconnected');}else{store.checkpoint(id,{step:outcome.step||'main-image-1',errorCode:outcome.code});store.move(id,outcome.state||'PAUSED',outcome.reason||'MATERIAL_UPLOAD_UNCONFIRMED');}})().finally(()=>this.active=null);},
  async resume({id}){if(store.run(id).state!=='RESULT_UNKNOWN')store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}
 };
 const batch=new BatchWorkflow(flow),make=()=>new ListingRound({batch,source:flow,shop,contentReviews:{assertApproved:()=>({decision:"PASS"})},rules,checkFiles:t=>check(t),assertExecution:v=>executionCheck(v),verifyExisting:v=>inspect(v),artifacts:join(dir,'rounds'),classifyFailure,onGate});
 const round=make();
 const authorization={source:'user-goal-20261008',objectiveSha256:'a'.repeat(64),allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:n};
 const create=options=>round.create({importId,authorization,repairVersion:'tested-v1',expectedCount:n,...options});
 const finish=async id=>{round.start(id);await round.pending;if(round.view(id).state==='PAUSED'&&round.view(id).gate===1){round.resume(id);await round.pending;}return round.view(id);};
 return {dir,store,tasks,flow,batch,round,make,authorization,create,finish,importId,setBehavior:f=>behavior=f,setInspect:f=>inspect=f,setCheck:f=>check=f,setExecutionCheck:f=>executionCheck=f,hold:()=>held=true,release:()=>{held=false;release?.();}};
}


export {fixture,task,result,shop};
