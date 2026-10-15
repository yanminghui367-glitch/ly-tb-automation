import {AsyncLocalStorage} from 'node:async_hooks';
import {join} from 'node:path';
import {SourceWorkflow} from './source-workflow.mjs';
import {BatchWorkflow} from './batch-workflow.mjs';
import {ProductApi} from './product-api.mjs';
import {DEFAULT_EXECUTION_SHOP,validShopId} from './shop-identity.mjs';

export {DEFAULT_EXECUTION_SHOP};
// All registered stores can use the standard template adapter. Actual category,
// data, login and publishing gates still run separately for each store.
export const supportsExecution=validShopId;
export class ShopExecutions {
 constructor({runtime,artifacts,owner,shops,launch,isShopRemoved,integrity,checkFiles}) {
  Object.assign(this,{runtime,artifacts,owner,shops,launch,isShopRemoved,integrity,checkFiles});
  this.scope=new AsyncLocalStorage();this.entries=new Map();
 }
 id(){return this.scope.getStore()||DEFAULT_EXECUTION_SHOP;}
 run(id,fn){return this.scope.run(id||DEFAULT_EXECUTION_SHOP,fn);}
 current(){const entry=this.entries.get(this.id());if(!entry)throw Error('店铺执行环境尚未初始化');return entry;}
 async product(id=this.id()) {
  if(!supportsExecution(id)||this.isShopRemoved?.(id))throw Object.assign(Error('此店铺尚未完成执行适配或已移除'),{statusCode:409});
  const shops=await this.shops(),shop=shops.find(s=>s.id===id);
  if(!shop)throw Object.assign(Error('执行店铺不存在，尚未登记资料与执行适配'),{statusCode:409});
  if(!this.entries.has(id)){
   const runtime=id===DEFAULT_EXECUTION_SHOP?this.runtime:join(this.runtime,'shop-execution',id);
   const source=new SourceWorkflow(this.owner,{runtime:join(runtime,'source-workflow'),artifacts:this.artifacts});
   const batch=new BatchWorkflow(source);
   const product=new ProductApi({batch,source,owner:this.owner,shop,launch:this.launch,runtime,isShopRemoved:this.isShopRemoved,
    integrity:this.integrity,checkFiles:this.checkFiles});
   product.executionAdapterSupported=true;
   if(id!==DEFAULT_EXECUTION_SHOP)product.websiteSettingsFile=join(this.runtime,'product-v1','settings.json');
   this.entries.set(id,{product,source,batch});
  }
  const product=this.entries.get(id).product;product.shop=shop;return product;
 }
 active(){return [...this.entries.values()].some(e=>e.source.active||e.batch.active);}
 async shutdown(){for(const e of this.entries.values()){await e.batch.shutdown();await e.source.shutdown();e.product.closeStreams();}}
}
