import test from 'node:test';
import assert from 'node:assert/strict';
import {isNewPublishUrl,isNewSuccessUrl} from '../publishing-address.mjs';
import {newForm,readSubmissionReceipt} from '../taobao-publisher.mjs';
const hosts=['item.upload.taobao.com','item.manager.taobao.com'];
for(const host of hosts){
 test('new form exact origin: '+host,()=>{const url=`https://${host}/sell/v2/publish.htm?catId=50014945&newRouter=true`;assert(isNewPublishUrl(url));assert(newForm({url:()=>url}));});
 test('edit and copy rejected on '+host,()=>{for(const query of ['itemId=','item_num_id=123','copyItem=1','isEdit=true','isEdit=false&isEdit=true','isEdit=']){assert(!isNewPublishUrl(`https://${host}/sell/v2/publish.htm?${query}`));assert(!isNewSuccessUrl(`https://${host}/sell/v2/success.htm?primaryId=123456&${query}`));}});
 test('matching saved success ID on '+host,async()=>{const p={url:()=>`https://${host}/sell/v2/success.htm?primaryId=123456&isEdit=false`,locator:()=>({innerText:async()=> '商品提交成功 商品ID：123456'})};assert.equal(await readSubmissionReceipt(p,`https://${host}/sell/v2/publish.htm`),'123456');});
}
test('lookalikes, insecure schemes, ports, credentials and changed paths rejected',()=>{
 for(const url of ['https://item.manager.taobao.com.evil.test/sell/v2/publish.htm','http://item.manager.taobao.com/sell/v2/publish.htm','https://item.manager.taobao.com:444/sell/v2/publish.htm','https://user:pass@item.manager.taobao.com/sell/v2/publish.htm','https://item.manager.taobao.com/sell/v2/edit.htm','https://taobao.com/sell/v2/publish.htm','not-url'])assert(!isNewPublishUrl(url),url);
});
test('same official host still refuses an unrelated form after submission',async()=>{
 const p={url:()=> 'https://item.manager.taobao.com/sell/v2/publish.htm?other=1'};
 await assert.rejects(readSubmissionReceipt(p,'https://item.manager.taobao.com/sell/v2/publish.htm'),/SUBMISSION_FORM_CHANGED/);
});
