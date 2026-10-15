// IDs identify registered stores; names, file paths and UI selections cannot replace them.
export const DEFAULT_EXECUTION_SHOP='wuzhou-changyou';
export const validShopId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
export function assertShopInput(input,shopId){
 for(const field of ['shopId','executionShop'])if(Object.hasOwn(input||{},field)&&input[field]!==shopId)throw Object.assign(Error('请求店铺与当前资料/执行店铺不一致，请切换到对应店铺后重试'),{statusCode:409});
}
