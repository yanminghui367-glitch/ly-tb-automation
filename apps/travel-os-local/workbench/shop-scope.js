// Scope is carried in each request, never in a shared server-wide selection.
export function executionShop(){return new URL(globalThis.location?.href||'http://localhost/').searchParams.get('shop')||'wuzhou-changyou';}
export function shopUrl(path,shop=executionShop()){
 if(!shop||!String(path).startsWith('/api/'))return path;
 const url=new URL(path,'http://localhost');if(!url.searchParams.has('executionShop'))url.searchParams.set('executionShop',shop);return url.pathname+url.search;
}
export function shopFetch(path,options){return fetch(shopUrl(path),options);}
export function selectExecutionShop(shop,section='settings'){
 const url=new URL(location.href);url.searchParams.set('shop',shop);url.hash=section;location.assign(url.href);
}
