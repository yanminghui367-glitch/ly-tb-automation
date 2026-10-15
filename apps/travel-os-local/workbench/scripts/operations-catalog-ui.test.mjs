import test from 'node:test';
import assert from 'node:assert/strict';
import {mountOperationsCatalog} from '../operations-catalog-ui.js';

const rows=[
 {key:'wait-1',status:'WAITING',destination:'东京',country:'日本',title:'东京服务',position:1},
 {key:'wait-2',status:'WAITING',destination:'巴黎',country:'法国',title:'巴黎服务',position:2},
 {key:'retry-1',status:'RETRYABLE',destination:'罗马',country:'意大利',title:'罗马服务',position:3},
 {key:'verified-1',status:'VERIFIED',destination:'伦敦',country:'英国',title:'伦敦服务',position:4},
];

function harness(t){
 const oldDocument=globalThis.document;globalThis.document={activeElement:null,hidden:true};
 const listeners=new Map(),root={innerHTML:'',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),contains:()=>false,querySelector:()=>null};
 const payload={items:rows,counts:{WAITING:2,RETRYABLE:1,VERIFIED:1},packages:[{id:'pkg',name:'资料包',total:4,executionSupported:true,roundId:'round',manifestHash:'hash'}],selectedPackage:{id:'pkg',name:'资料包',total:4,executionSupported:true,roundId:'round',manifestHash:'hash'}};
 const ui=mountOperationsCatalog(root,{shops:[{id:'shop',name:'测试店铺'}],initialShop:'shop',request:async()=>({ok:true,json:async()=>payload})});
 t.after(()=>{ui.dispose();globalThis.document=oldDocument;});
 return {root,ui,click(action,value){listeners.get('click')({target:{closest:()=>({dataset:{ops:action,value},disabled:false})}});},change(target){listeners.get('change')({target});}};
}

test('status chips contain no per-status select-all buttons; header select-all covers every state',async t=>{
 const h=harness(t);await h.ui.ready;
 assert.doesNotMatch(h.root.innerHTML,/data-ops="select-status"/);
 assert.match(h.root.innerHTML,/aria-label="全选当前筛选结果（包括所有状态和分页）"/);
 for(const key of ['wait-1','retry-1','verified-1'])assert.doesNotMatch(h.root.innerHTML,new RegExp(`data-ops-key="${key}"[^>]*disabled`));
});

test('header select-all selects and clears all statuses in the current result set',async t=>{
 const h=harness(t);await h.ui.ready;
 h.change({id:'opsSelectAll',checked:true});
 assert.match(h.root.innerHTML,/已选 4 条/);
 for(const key of ['wait-1','wait-2','retry-1','verified-1'])assert.match(h.root.innerHTML,new RegExp(`data-ops-key="${key}"[^>]*checked`));
 h.change({id:'opsSelectAll',checked:false});
 assert.match(h.root.innerHTML,/已选 0 条/);
});
