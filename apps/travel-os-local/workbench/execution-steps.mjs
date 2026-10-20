import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ExecutionTiming} from './execution-timing.mjs';
import {captureStepEvidence,evidenceMode} from './execution-evidence-policy.mjs';

// The workflow still awaits every guard, evidence capture, event and checkpoint.
// Step snapshots precede their own persistence; the attempt total includes it.
export class ExecutionSteps {
 constructor({store,id,dir,guard,getPage,checkpoint,errorText,timing=new ExecutionTiming(),mode='key',recovery=false,attemptId=null}){
  Object.assign(this,{store,id,dir,guard,getPage,checkpoint,errorText,timing,recovery,attemptId});
  this.mode=evidenceMode(mode);this.activeTiming=null;
 }
 measure(category,fn){
  return this.timing.measure(category,()=>this.activeTiming?this.activeTiming.measure(category,fn):fn());
 }
 async run(name,fn){
  if(this.activeTiming)throw Error('执行步骤必须串行');
  const timing=new ExecutionTiming();this.activeTiming=timing;
  let failed=false,error,errorCode=null;
  try{
   this.store.event(this.id,'STEP_INTENT',{name,...(this.attemptId?{attemptId:this.attemptId}:{})});
   try{await this.guard();await this.measure('action',fn);await this.guard();}
   catch(e){failed=true;error=this.errorText(e);errorCode=/^(?:SAFE_RETRY|PRODUCT|TASK_DATA|ATTRIBUTE_VALUE_INVALID|MATERIAL|ATTRIBUTE|FORM|CONTENT)(?:_[A-Z0-9]+)*$/.test(e.code||'')?e.code:null;throw e;}
   finally{
    const evidence=await this.measure('evidence',()=>captureStepEvidence(this.getPage(),this.dir,name,{mode:this.mode,failed,recovery:this.recovery}));
    this.recovery=false;
    const snapshot=timing.snapshot();
    const data={name,...(this.attemptId?{attemptId:this.attemptId}:{}),durationMs:snapshot.elapsedMs,...evidence,error,errorCode,timing:snapshot};
    await this.measure('persistence',async()=>{
     this.store.event(this.id,failed?'STEP_PAUSED':'STEP_VERIFIED',data);
     this.checkpoint({step:name,...data});
     await writeFile(join(this.dir,'checkpoint.json'),JSON.stringify(this.store.run(this.id).checkpoint,null,2));
    });
   }
  }finally{this.activeTiming=null;}
 }
}
