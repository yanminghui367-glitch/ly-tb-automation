import {captureTaskScreenshot} from './task-screenshot.mjs';

export const EVIDENCE_POLICY_VERSION='key-nodes-20261016';
const critical=new Set(['open-new-form','close-main-image-menu','freight-template','attribute-size','insert-details','pre-submit-review','submit-once','verify-platform-result']);
const routine=new Set(['title','guide-title','price','inventory','brand','custom-service','listing-state','shipping-time','logistics','shipping-region','single-origin','ship-from','procurement','region-restriction','open-details','attribute-pattern','attribute-subject','attribute-style','attribute-people']);
export function evidenceMode(value='key'){
 return value==='key'||value==='full'?value:'full';
}
export function evidenceDecision(name,{mode='key',failed=false,recovery=false}={}){
 mode=evidenceMode(mode);
 const reason=failed?'STEP_FAILED':recovery?'RECOVERY_BOUNDARY':mode==='full'?'DIAGNOSTIC_FULL':critical.has(name)?'KEY_NODE':routine.has(name)||/^main-image-[1-5]$/.test(name)||/^select-detail-([1-9]|[1-4][0-9]|50)$/.test(name)?'STRUCTURED_LOG':'UNKNOWN_STEP';
 return {evidencePolicy:EVIDENCE_POLICY_VERSION,evidenceMode:mode,evidenceReason:reason,screenshotRequested:reason!=='STRUCTURED_LOG'};
}
export async function captureStepEvidence(page,dir,name,options={}){
 const decision=evidenceDecision(name,options);
 if(!decision.screenshotRequested)return {...decision,screenshot:null,screenshotAt:null,screenshotError:null};
 return {...decision,...await captureTaskScreenshot(page,dir,name)};
}
