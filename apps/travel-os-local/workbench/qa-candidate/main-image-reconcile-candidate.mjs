import {expect} from 'playwright/test';
import assert from 'node:assert/strict';

export async function clickMainImageAndVerify(page,card,expectedUrls,guard,{onEvent=async()=>{},timeoutMs=5000}={}) {
 assert(Array.isArray(expectedUrls)&&expectedUrls.length>=1&&expectedUrls.length<=5,'MAIN_IMAGE_EXPECTATION_INVALID');
 assert(expectedUrls.every(u=>typeof u==='string'&&u.length>0),'MAIN_IMAGE_EXPECTATION_INVALID');
 const images=page.locator('#sell-field-mainImagesGroup img');
 const read=()=>images.evaluateAll(es=>es.map(e=>e.src));
 const imageKey=value=>{
  const u=new URL(value);
  assert(!u.username&&!u.password&&u.origin==='https://img.alicdn.com','MAIN_IMAGE_ORIGIN_CHANGED');
  const stableQuery=[...u.searchParams]
   .filter(([key,val])=>!(key==='t'&&/^\d{13}$/.test(val)))
   .sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv))
   .map(([key,val])=>`${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&');
  const stablePath=u.pathname.replace(/(\.(?:png|jpe?g))_320x320q80_\.webp$/i,'$1_320x320');
  return u.origin+stablePath+(stableQuery?`?${stableQuery}`:'')+u.hash;
 };
 const expected=expectedUrls.map(imageKey),formUrl=page.url();
 const check=async()=>{await guard();assert.equal(page.url(),formUrl,'MAIN_IMAGE_FORM_CHANGED');};
 const stableRead=async()=>{
  await check();const first=(await read()).map(imageKey);
  await check();const second=(await read()).map(imageKey);
  await check();assert.deepEqual(second,first,'MAIN_IMAGE_STATE_CHANGED');return second;
 };
 const initial=await stableRead();
 if(initial.length===expected.length&&initial.every((value,index)=>value===expected[index])){
  await onEvent({kind:'MAIN_IMAGE_ALREADY_SELECTED_RECONCILED',order:expectedUrls.length,clickRepeated:false,expectedUrls});
  return;
 }
 assert.deepEqual(initial,expected.slice(0,-1),'MAIN_IMAGE_PREFIX_CHANGED');
 let clickTimeout=null;
 try{await card.locator('.PicList_pic_imgBox__c0HXw').click();}
 catch(error){if(error.name!=='TimeoutError')throw error;clickTimeout=error;}
 try{
  await expect.poll(stableRead,{timeout:timeoutMs}).toEqual(expected);
  const final=await stableRead();assert.deepEqual(final,expected,'MAIN_IMAGE_PREFIX_CHANGED');
 }catch(error){if(clickTimeout)error.mainImageClickTimeout=clickTimeout.message;throw error;}
 if(clickTimeout)await onEvent({kind:'MAIN_IMAGE_CLICK_TIMEOUT_RECONCILED',order:expectedUrls.length,clickRepeated:false,expectedUrls,originalError:clickTimeout.message});
}
