// Candidate only: non-publishing mutation guards from the existing ProductApi.
// Caller still needs the original server network, Origin and mutationBusy gates.
const fail=code=>{throw Object.assign(Error(code),{code});};
export class RoundItemHostGuard {
 constructor(product,{isShopRemoved}={}){
  if(!product?.round||typeof product.integrity!=='function'||typeof isShopRemoved!=='function')fail('ITEM_HOST_NOT_CONFIGURED');
  this.product=product;this.round=product.round;this.isShopRemoved=isShopRemoved;
  // Pin the original instances, not just equality between mutable properties.
  this.source=product.source;this.batch=product.batch;this.store=product.source?.store;
  this.batchStore=product.batch?.store;this.db=product.round.db;this.shopId=product.shop?.id;
 }
 assertCurrent(){
  const p=this.product,o=this.round;
  if(p.round!==o||p.source!==this.source||o.source!==this.source||p.batch!==this.batch||o.batch!==this.batch
   ||p.source?.store!==this.store||p.batch?.store!==this.batchStore||this.store?.db!==this.db||o.db!==this.db
   ||this.batch?.flow!==this.source||this.batchStore?.source!==this.store||this.batchStore?.db!==this.db
   ||p.shop?.id!==this.shopId||o.shop?.id!==this.shopId)fail('ITEM_HOST_SCOPE_MISMATCH');
  const removed=this.isShopRemoved(p.shop.id);
  if(typeof removed!=='boolean')fail('ITEM_HOST_NOT_CONFIGURED');
  if(removed)fail('ITEM_HOST_SHOP_REMOVED');
  if(p.capturing||p.reconciling)fail('ITEM_HOST_CONFIG_BUSY');
  o.assertIdle();
  if(o.creating||o.hasUnsettledExecution())fail('ITEM_SKIP_EXECUTION_NOT_SETTLED');
 }
 async inspect(){
  try{
   this.assertCurrent();
   const result=await this.product.integrity();
   this.assertCurrent();
   if(result?.ok!==true)fail('ITEM_HOST_INTEGRITY_FAILED');
   return null;
  }catch(e){return {code:e.code||(/已有执行任务或轮次|禁止第二发布者/.test(e.message||'')?'ITEM_OWNER_BUSY':'ITEM_HOST_CHECK_FAILED')};}
 }
 async assert(){const problem=await this.inspect();if(problem)fail(problem.code);this.assertCurrent();}
}
