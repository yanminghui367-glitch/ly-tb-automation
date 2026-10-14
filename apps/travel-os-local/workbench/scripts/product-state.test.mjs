import test from 'node:test';
import assert from 'node:assert/strict';
import {browserView,pauseView,classify,redact} from '../product-state.mjs';

test('expired, absent and unverified browser state never looks ready',()=>{
 const now=Date.now(),raw={running:true,loggedIn:true,loginState:'LOGGED_IN',checkedAt:new Date(now-16000).toISOString()};
 assert.equal(browserView(raw,now).label,'待检查');assert.equal(browserView(raw,now).loggedIn,false);
 assert.equal(browserView({},now).label,'待检查');assert.equal(browserView({...raw,checkedAt:new Date(now).toISOString()},now).loggedIn,true);
 assert.equal(browserView({running:true,loggedIn:false,loginState:'LOGIN_UNVERIFIED'},now,true).label,'待检查');
});
test('pause request cannot claim safe stop before work completes or result is reconciled',()=>{
 assert.deepEqual(pauseView({active:'batch',stopping:true},{active:'run',stop:true},[{state:'RUNNING'}]).saved,false);
 assert.equal(pauseView({active:'batch',stopping:true},{active:null},[{state:'PAUSED'}]).state,'PAUSING');
 assert.equal(pauseView({active:'batch'},{active:'run'},[{id:'run',state:'PAUSED_CAPTCHA'}]).state,'PAUSING');
 assert.equal(pauseView({active:null},{active:null},[{state:'PAUSED_CAPTCHA'}]).state,'PAUSED');
 assert.equal(pauseView({active:null},{active:null},[{state:'RESULT_UNKNOWN'}]).state,'VERIFY_REQUIRED');
 assert.equal(pauseView({active:null},{active:null},[{state:'SUBMITTING'}]).state,'CHECK_REQUIRED');
});
test('unknown failures preserve evidence without inventing a cause; credentials are masked',()=>{
 const x=classify('E_UNDOCUMENTED: unexpected response');assert.equal(x.category,'待人工确认');assert.match(x.raw,/E_UNDOCUMENTED/);
 assert.equal(classify('Timeout 8000').category,'待人工确认');assert.equal(classify('locator.click failed').category,'页面校验');
 const safe=redact('Authorization: Bearer abc-secret\nCookie: session=xyz; id=foo\npassword=hunter\nURL https://test/?token=other');
 for(const secret of ['abc-secret','xyz','foo','hunter','other'])assert(!safe.includes(secret));
});

test('old watermark locator error is a page issue while missing source remains a data issue',()=>{
 const old="expect(locator).not.toBeChecked() failed\nLocator: getByRole('dialog', { name: '上传素材', exact: true }).getByLabel('添加水印', { exact: true })\nError: element(s) not found";
 assert.equal(classify(old,'PAUSED').category,'上传页面异常');
 assert.equal(classify('MATERIAL_UPLOAD_PREFERENCES：添加水印控件状态不符','PAUSED').category,'上传页面异常');
 assert.equal(classify('ENOENT: no such file 上传素材-添加水印.png','PAUSED').category,'资料问题');
 assert.equal(classify('SOURCE_OR_ASSET_CHANGED','PAUSED').category,'资料问题');
 assert.equal(classify(old,'RESULT_UNKNOWN').category,'待核验');assert.equal(classify(old,'PAUSED_CAPTCHA').category,'验证码');
});
