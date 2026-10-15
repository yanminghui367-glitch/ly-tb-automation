import React, {Component, useEffect, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {Shdr12} from './components/orbkit/shdr-12';

// Keep one mounted canvas while the workbench replaces its task panel on SSE.
// This module only reads execution status; it never starts or changes a task.
let root:Root|null=null,element:HTMLDivElement|null=null,lastState='';
export function executionOrbState(round:{state?:string;active?:unknown}|null,connected:boolean){
  return connected&&round?.state==='RUNNING'&&Boolean(round.active)?'speaking':'idle';
}
class OrbBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?null:this.props.children;}
}
function StatusOrb({state}:{state:'idle'|'speaking'}){
  useEffect(()=>{
    const owner=element,canvas=owner?.querySelector('canvas');if(!canvas||!owner)return;
    const update=()=>{const gl=canvas.getContext('webgl');owner.dataset.renderer=gl&&!gl.isContextLost()&&Number(getComputedStyle(canvas).opacity)>0?'webgl':'fallback';};
    const reveal=new MutationObserver(update);reveal.observe(canvas,{attributes:true,attributeFilter:['style']});
    update();canvas.addEventListener('webglcontextlost',update);canvas.addEventListener('webglcontextrestored',update);
    return()=>{reveal.disconnect();owner.dataset.renderer='fallback';canvas.removeEventListener('webglcontextlost',update);canvas.removeEventListener('webglcontextrestored',update);};
  },[]);
  return <Shdr12 size={110} state={state} maxDpr={1.5}/>;
}
export function syncExecutionOrb(host:HTMLElement|null,round:{state?:string;active?:unknown}|null,connected:boolean){
  if(!host){root?.unmount();root=null;element=null;lastState='';return;}
  const state=executionOrbState(round,connected);
  if(!element){element=document.createElement('div');element.className='execution-orb-canvas';root=createRoot(element);}
  host.append(element);
  host.dataset.state=state;host.setAttribute('role','img');host.setAttribute('aria-label',state==='speaking'?'执行状态球：执行中':'执行状态球：怠速');
  element.dataset.state=state;
  if(lastState!==state){root!.render(<OrbBoundary><StatusOrb state={state}/></OrbBoundary>);lastState=state;}
}
