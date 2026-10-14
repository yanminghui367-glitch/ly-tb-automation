// Diagnose a copied business database. No production browser or item mutation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SourceStore} from '../source-store.mjs';
import {BatchWorkflow} from '../batch-workflow.mjs';
import {ListingRound} from '../listing-round.mjs';
import {RoundManualSkip} from '../round-manual-skip.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/skip-candidate-fix-20261014');
const store=new SourceStore(resolve(out,'production-clone.sqlite'));
try{
 const row=store.db.prepare('SELECT id,shop,current_item FROM rounds ORDER BY rowid DESC LIMIT 1').get();
 const flow={store,active:null,queueLease:null,artifacts:out,launch(){throw Error('NO_EXECUTION_IN_CLONE');},resume(){throw Error('NO_EXECUTION_IN_CLONE');}};
 const batch=new BatchWorkflow(flow),round=new ListingRound({source:flow,batch,shop:{id:row.shop},assertExecution:async()=>{throw Error('NO_EXECUTION_IN_CLONE');},verifyExisting:async()=>null,checkFiles:async()=>{},contentReviews:{assertApproved:()=>({decision:'PASS',isolated:true})},artifacts:out});
 const window=round.windows.open(row.id),scope={roundId:row.id,windowId:window.id,key:row.current_item};
 let original=await readFile(resolve(out,'before/round-manual-skip.mjs'),'utf8');
 original=original.replace("'./round-item-attempts.mjs'",JSON.stringify(pathToFileURL(resolve(root,'workbench/round-item-attempts.mjs')).href));
 const Before=(await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'))).RoundManualSkip;
 const oldAction=new Before(round),newAction=new RoundManualSkip(round);
 const before=oldAction.inspect(scope),after=newAction.inspect(scope),oldRead=oldAction.read(scope),newRead=newAction.read(scope);
 assert.equal(before.allowed,false);assert.equal(before.reason,'ITEM_SKIP_SUBMISSION_PROTECTED');assert.equal(oldRead.hasSubmit,true);
 assert.equal(after.allowed,true);assert.equal(newRead.hasSubmit,false);assert.equal(newRead.run.checkpoint.step,'main-image-5');
 const evidence={scope,destination:newRead.x.task.listing.city,before,after,beforeSubmissionEvidence:oldRead.hasSubmit,afterSubmissionEvidence:newRead.hasSubmit,step:newRead.run.checkpoint.step,sourceSubmissionEvents:store.events(newRead.run.id).filter(x=>['SUBMITTING','SUBMIT_CLICKED','SUBMIT_EVIDENCE','RESULT_UNKNOWN','VERIFIED'].includes(x.kind)).length,productionDatabaseWritten:false,itemSkipCalled:false};
 await writeFile(resolve(out,'clone-verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{store.close();}
