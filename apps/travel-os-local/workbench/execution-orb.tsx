import React, {Component, useEffect, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {Shdr12} from './components/orbkit/shdr-12';

// Keep one mounted canvas per location across workbench SSE redraws.
// This module only reads execution status; it never starts or changes a task.
const instances=new Map<string,{root:Root;element:HTMLDivElement;lastState:string}>();
export function executionOrbState(round:{state?:string;active?:unknown}|null,connected:boolean){
  return connected&&round?.state==='RUNNING'&&Boolean(round.active)?'speaking':'idle';
}
class OrbBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?null:this.props.children;}
}
function StatusOrb({state,owner}:{state:'idle'|'speaking';owner:HTMLDivElement}){
  useEffect(()=>{
    const canvas=owner.querySelector('canvas');if(!canvas)return;
    const update=()=>{const gl=canvas.getContext('webgl');owner.dataset.renderer=gl&&!gl.isContextLost()&&Number(getComputedStyle(canvas).opacity)>0?'webgl':'fallback';};
    const reveal=new MutationObserver(update);reveal.observe(canvas,{attributes:true,attributeFilter:['style']});
    update();canvas.addEventListener('webglcontextlost',update);canvas.addEventListener('webglcontextrestored',update);
    return()=>{reveal.disconnect();owner.dataset.renderer='fallback';canvas.removeEventListener('webglcontextlost',update);canvas.removeEventListener('webglcontextrestored',update);};
  },[owner]);
  return <Shdr12 size={110} state={state} maxDpr={1.5}/>;
}
export function syncExecutionOrb(host:HTMLElement|null,round:{state?:string;active?:unknown}|null,connected:boolean,location='monitor'){
  let instance=instances.get(location);
  if(!host){instance?.root.unmount();instances.delete(location);return;}
  const state=executionOrbState(round,connected);
  if(!instance){const element=document.createElement('div');element.className='execution-orb-canvas';instance={element,root:createRoot(element),lastState:''};instances.set(location,instance);}
  const {element,root}=instance;
  host.append(element);
  host.dataset.state=state;host.setAttribute('role','img');host.setAttribute('aria-label',state==='speaking'?'执行状态球：执行中':'执行状态球：怠速');
  element.dataset.state=state;
  if(instance.lastState!==state){root.render(<OrbBoundary><StatusOrb state={state} owner={element}/></OrbBoundary>);instance.lastState=state;}
}
