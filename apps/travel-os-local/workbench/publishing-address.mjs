// Exact official publish origins observed in this project's retained browser.
// This recognizes an address, not shop identity, task identity or permission.
const origins=new Set(['https://item.upload.taobao.com','https://item.manager.taobao.com']);
export function isPublishOrigin(url){return origins.has(url.origin)&&!url.username&&!url.password;}
const editable=url=>['itemId','item_num_id','copyItem'].some(k=>url.searchParams.has(k))||url.searchParams.getAll('isEdit').some(v=>v!=='false');
export function isNewPublishUrl(value){try{const u=new URL(value);return isPublishOrigin(u)&&u.pathname==='/sell/v2/publish.htm'&&!editable(u);}catch{return false;}}
export function isNewSuccessUrl(value){try{const u=new URL(value);return isPublishOrigin(u)&&u.pathname==='/sell/v2/success.htm'&&!editable(u);}catch{return false;}}
