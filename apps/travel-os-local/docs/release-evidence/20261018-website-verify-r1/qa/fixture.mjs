import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=process.env.QA_WORKBENCH||fileURLToPath(new URL('../dev/workbench/',import.meta.url));
const load=name=>import(pathToFileURL(join(root,name)).href);
const {SourceStore,digest,destinationKey}=await load('source-store.mjs');
const {BatchWorkflow}=await load('batch-workflow.mjs');
const {ListingRound}=await load('listing-round.mjs');
const {RoundManualSkip}=await load('round-manual-skip.mjs');
const shop={id:'wuzhou-changyou',name:'五洲畅游'};
const task=n=>({schemaVersion:2,taskId:'isolated-'+n,shopId:shop.id,priority:n,source:{},listing:{type:'city',country:'fixture-country',city:'fixture-city-'+n,title:'fixture-title-'+n},assets:{main:[],secondary:[],details:[]},business:{shop_name:shop.name,price_cny:20,inventory:999999},adapterIssues:[]});
const result=n=>({itemId:String(100000+n),status:'仓库中',rowText:'isolated fixture only',screenshot:'fixture.png',verifiedAt:new Date().toISOString()});
async function setup(t,{limit=3}={}){
 const artifacts=join(import.meta.dirname,'artifacts','skip-fixture-'+randomUUID());await mkdir(artifacts,{recursive:true});
 const store=new SourceStore(':memory:');t.after(()=>store.close());const tasks=[task(1),task(2),task(3)],importId=store.imported({sourceHash:'fixture',tasks,summary:{total:3}});
 let hold=false,release;
 const flow={store,artifacts,active:null,queueLease:null,submits:0,launches:[],stop:false,
  launch(id){assert.equal(this.active,null);this.active=id;this.stop=false;this.launches.push(id);this.pending=(async()=>{let r=store.run(id);store.move(id,'RUNNING');if(hold)await new Promise(r=>release=r);if(this.stop){store.move(id,'PAUSED','操作者暂停');return;}store.move(id,'SUBMITTING');store.event(id,'SUBMIT_CLICKED',{});this.submits++;store.move(id,'VERIFIED','',result(r.task.priority));})().finally(()=>this.active=null);},
  async resume({id}){store.move(id,'QUEUED');this.launch(id);},pause(){this.stop=true;release?.();},preflight:async()=>{}};
 const batch=new BatchWorkflow(flow),round=new ListingRound({batch,source:flow,shop,assertExecution:async()=>{},verifyExisting:async({history})=>history||null,checkFiles:async()=>{},contentReviews:{assertApproved:()=>({decision:'PASS'})},artifacts});
 const authorization={allowLive:true,maxSafeRecoveries:2,confirmedShop:shop.name,expectedCount:3};
 const r=await round.create({importId,authorization,repairVersion:'ISOLATED_SKIP_ONLY',expectedCount:3});
 store.db.prepare('UPDATE rounds SET gate=5 WHERE id=?').run(r.id);
 const preview=await round.windows.preview(r.id,{limit}),w=round.windows.create(preview),action=new RoundManualSkip(round);
 const scope=(n=1)=>({roundId:r.id,windowId:w.id,key:destinationKey(tasks[n-1])});
 const request=(n=1,extra={})=>({...scope(n),expectedRevision:action.inspect(scope(n)).revision,requestId:'request-'+n,reason:'operator fixture skip',...extra});
 const pause=async()=>{hold=true;round.start(r.id,{windowId:w.id});for(let i=0;!flow.active&&i<1000;i++)await new Promise(r=>setTimeout(r,1));assert(flow.active);round.pause();release?.();await round.pending;hold=false;assert.equal(flow.submits,0);};
 return {store,tasks,flow,batch,round,action,r,w,scope,request,pause};
}
export {setup,shop,digest,destinationKey,load};
