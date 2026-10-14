import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sellerTable,listingEvidence} from './listing-verification.mjs';
import {classifyListingIdentity,auditInventoryIdentity,LOCATION_ALIAS_EVIDENCE} from './listing-identity.mjs';

const issue=(code,message,details={})=>Object.assign(Error(message),{code,...details});
export class RoundVerification {
 constructor({context,guard,round,artifacts,tableFactory=sellerTable,evidence=listingEvidence}){Object.assign(this,{context,guard,round,artifacts,tableFactory,evidence});this.reset();}
 reset(){this.inventory=null;this.verified=0;}
 async verify({task,itemId,roundId,key,run,verificationAttemptId,executionAttemptId}){
  const current=this.round(),tasks=current.items.map(x=>x.task),authorization=current.round.authorization;
  assert(current.round.id===roundId,'核验轮次与当前清单不符');
  assert(verificationAttemptId===undefined||executionAttemptId===undefined,'处理记录类型冲突');
  verificationAttemptId=verificationAttemptId??executionAttemptId;
  if(verificationAttemptId!==undefined)assert(typeof verificationAttemptId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(verificationAttemptId),'核验处理编号无效');
  const originalDir=join(this.artifacts,roundId,'verification',key);
  const dir=verificationAttemptId?join(originalDir,'attempts',verificationAttemptId):originalDir;
  if(verificationAttemptId){
   this.reset();
   // Exclusive directory prevents a repeated action from replacing prior evidence.
   await mkdir(join(originalDir,'attempts'),{recursive:true});
   await mkdir(dir);
  }
  const table=await this.tableFactory(this.context(),task,this.guard,{onFailure:async diagnostic=>{
   // Best-effort evidence must never replace the original closed failure.
   try{await mkdir(dir,{recursive:true});await writeFile(join(dir,'table-failure-'+randomUUID()+'.json'),JSON.stringify({at:new Date().toISOString(),...diagnostic},null,2),{flag:'wx'});}catch{}
  }});
  await mkdir(dir,{recursive:true});
  if(itemId){
   const found=await table.search({itemId:String(itemId)}),row=found.records.find(r=>r.itemId===String(itemId));
   if(!row||row.title!==task.listing.title)throw issue('RESULT_UNKNOWN','原商品ID未能与当前后台标题交叉核实，禁止重发：'+itemId);
   return this.evidence(table,row,task,dir,{newSubmission:['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state)});
  }
  const duplicatePolicy=current.round.policies?.['ignore-destination-duplicates'];
  if(duplicatePolicy?.enabled===true&&duplicatePolicy.scope==='THIS_ROUND_ONLY'&&duplicatePolicy.manifestHash===current.round.manifest_hash&&duplicatePolicy.shop===task.shopId){
   const match={status:'bypassed-by-user-policy',policy:'ignore-destination-duplicates',scope:'THIS_ROUND_ONLY',taskHash:current.items.find(x=>x.key===key)?.task_hash||null,knownItemIdChecked:false};
   await writeFile(join(dir,'duplicate-check.json'),JSON.stringify({at:new Date().toISOString(),shop:task.shopId,key,match},null,2));
   return null;
  }
  const titleAliases=authorization.existingInventoryReview?.titleAliases||[],outOfScopeRows=authorization.existingInventoryReview?.outOfScopeRows||[];
  if(!this.inventory||this.verified>=50){
   this.inventory=await table.search();this.verified=0;
   const audit=auditInventoryIdentity(tasks,this.inventory.records,{titleAliases,outOfScopeRows});
   await writeFile(verificationAttemptId?join(dir,'inventory-check.json'):join(this.artifacts,roundId,'inventory-check.json'),JSON.stringify({at:this.inventory.at,total:this.inventory.total,rows:this.inventory.records,audit},null,2));
   if(!audit.coverageComplete){this.inventory=null;throw issue('INVENTORY_IDENTITY_UNRESOLVED','后台存在尚未对应清单的商品，无法安全判断新商品：'+audit.unassigned.map(r=>r.itemId+' '+r.title).join('；'));}
  }
  const queries=[task.listing.city||task.listing.country];
  if(task.listing.type==='city'&&/市$/.test(task.listing.city)&&task.listing.city.length>2)queries.push(task.listing.city.replace(/(?:广域)?市$/,''));
  if(task.listing.country===LOCATION_ALIAS_EVIDENCE.country){if(task.listing.type==='country')queries.push(...LOCATION_ALIAS_EVIDENCE.countryAliases);else if(task.listing.city===LOCATION_ALIAS_EVIDENCE.city)queries.push(...LOCATION_ALIAS_EVIDENCE.cityAliases);}
  const combined=new Map(this.inventory.records.map(r=>[r.itemId,r])),fresh=[];
  for(const title of new Set(queries)){
   const snapshot=await table.search({title});fresh.push({query:title,total:snapshot.total,at:snapshot.at,ids:snapshot.records.map(r=>r.itemId)});
   for(const row of snapshot.records)combined.set(row.itemId,row);
  }
  const rows=[...combined.values()],audit=auditInventoryIdentity(tasks,rows,{titleAliases,outOfScopeRows});
  if(!audit.coverageComplete){this.inventory=null;throw issue('INVENTORY_IDENTITY_UNRESOLVED','后台新增商品身份待核对，已暂停安全查重');}
  const match=classifyListingIdentity({task,tasks,rows,titleAliases});this.verified++;
  await writeFile(join(dir,'duplicate-check.json'),JSON.stringify({at:new Date().toISOString(),shop:task.shopId,key,inventoryAt:this.inventory.at,fullInventoryCount:this.inventory.total,fresh,match},null,2));
  if(match.status==='absent')return null;
  if(match.status==='candidates')throw issue('EXISTENCE_AMBIGUOUS','后台有地名或商品范围待核验候选，已隔离且未提交：'+match.candidates.map(r=>r.itemId+' '+r.title).join('；'),{isolated:true});
  const found=await table.search({itemId:match.match.itemId}),row=found.records.find(r=>r.itemId===match.match.itemId);
  if(!row||row.title!==match.match.title)throw issue('RESULT_UNKNOWN','后台商品在核验中变化，禁止发布');
  return this.evidence(table,row,task,dir,{newSubmission:['SUBMITTING','RESULT_UNKNOWN'].includes(run?.state)});
 }
}
