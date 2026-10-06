import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {redact} from './product-state.mjs';

// Evidence errors must never replace a business outcome or advertise an old file.
export async function captureTaskScreenshot(page,dir,label){
 const screenshotAt=new Date().toISOString();
 const name=String(label).replace(/[^a-zA-Z0-9-]/g,'-').slice(0,80);
 const screenshot=join(dir,`${name}-${randomUUID()}.png`);
 try{
  if(!page)throw Error('当前没有可截图的页面');
  await page.screenshot({path:screenshot,timeout:5000});
  const bytes=await readFile(screenshot);
  if(bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('截图文件未完整保存');
  return {screenshot,screenshotAt,screenshotError:null};
 }catch(error){return {screenshot:null,screenshotAt,screenshotError:redact(error.message).slice(0,500)};}
}
