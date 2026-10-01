import {chromium,expect} from 'playwright/test';
import {writeFile} from 'node:fs/promises';
const root='http://127.0.0.1:4318',out='output/batch20-20260921';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(root);
 await expect(page.locator('#batchRows tr')).toHaveCount(20);
 await expect(page.locator('#batchStart')).toBeEnabled();
 await page.locator('.batch-flow').screenshot({path:out+'/ui-queue-desktop.png'});
 const base=await (await fetch(root+'/api/batch/state')).json();
 for(const status of ['RUNNING','WAITING_HUMAN','COMPLETED']){
  const data=structuredClone(base);data.active=status==='RUNNING'?data.batch.id:null;data.batch.state=status;
  data.batch.current=status==='COMPLETED'?null:data.batch.items[0].id;
  data.batch.items[0].state=status==='COMPLETED'?'FAILED':status;data.batch.items[0].attempts=1;
  data.batch.items[0].reason=status==='WAITING_HUMAN'?'人工验证码处理后可继续':'';
  await page.route('**/api/batch/state',route=>route.fulfill({json:data}));
  await page.reload();await expect(page.locator('#batchStatus')).toContainText({RUNNING:'运行中',WAITING_HUMAN:'等待人工',COMPLETED:'本批结束'}[status]);
  await expect(page.locator(status==='RUNNING'?'#batchPause':status==='WAITING_HUMAN'?'#batchContinue':'#batchRetry')).toBeEnabled();
  await page.locator('.batch-flow').screenshot({path:out+'/ui-'+status+'.png'});
  await page.unroute('**/api/batch/state');
 }
 await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('#batchRows tr')).toHaveCount(20);
 await page.locator('.batch-flow').screenshot({path:out+'/ui-queue-mobile.png'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow||errors.length)throw Error(JSON.stringify({overflow,errors}));
 await writeFile(out+'/ui-check.json',JSON.stringify({passed:true,errors,overflow,states:['READY','RUNNING','WAITING_HUMAN','COMPLETED with failed retry'],desktop:1440,mobile:390},null,2));
 console.log('Batch UI states and mobile check passed');
}finally{await browser.close();}
