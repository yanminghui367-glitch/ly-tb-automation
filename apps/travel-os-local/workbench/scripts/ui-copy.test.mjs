import test from 'node:test';
import assert from 'node:assert/strict';
import '../ui-copy.js';

const copy=globalThis.LyUiCopy;
const hasLatin=value=>/[A-Za-z]{2,}/.test(value);

test('pause reason and embedded status codes render as actionable Chinese',()=>{
  const text=copy.reason('PAUSED_CAPTCHA');
  assert.match(text,/验证码/);
  assert.equal(hasLatin(text),false);
  assert.equal(hasLatin(copy.reason('系统已暂停：SYSTEM_BLOCKED · PAUSED_CAPTCHA')),false);
  assert.equal(copy.state('PAUSED_CAPTCHA'),'遇到验证码，等待人工处理');
  assert.equal(copy.state('WAITING_FOR_REVIEW'),'等待审核');
});

test('log labels, technical steps and unknown internal codes do not leak English tokens',()=>{
  assert.equal(copy.event('','STEP_VERIFIED'),'步骤核对通过');
  assert.equal(copy.step('main-image-2'),'核对主图 2');
  assert.equal(hasLatin(copy.reason('ATTRIBUTE_SELECTION_MISMATCH')),false);
  assert.equal(hasLatin(copy.reason('TypeError: navigation failed')),false);
  assert.equal(hasLatin(copy.step('unexpectedEnglishStep')),false);
  assert.equal(hasLatin(copy.state('UNRECOGNIZED_STATE')),false);
  assert.equal(hasLatin(copy.step('PAUSED_RISK_CONTROL')),false);
});

test('changed source explains the stale task and does not discard the cause because of assertion hashes',()=>{
 const raw="系统问题已暂停：SOURCE_OR_ASSET_CHANGED\n+ actual - expected\n+ '22f7d9f5'\n- '3164349c'";
 const issue=copy.diagnose(raw,{state:'PENDING',stage:'preflight'});
 assert.match(issue.cause,/原任务.*修改前/);assert.match(issue.action,/资料设置/);assert.match(issue.action,/版本绑定/);
 assert.match(issue.action,/重新开始一轮不会自动更新/);assert.equal(issue.known,true);
 assert.match(copy.reason(raw),/资料版本/);assert.doesNotMatch(issue.cause+issue.action,/22f7|3164|actual|expected/);
});

test('human and submission protections take priority over an underlying source error',()=>{
 assert.match(copy.diagnose('SOURCE_OR_ASSET_CHANGED',{state:'RESULT_UNKNOWN'}).action,/不要再次提交/);
 assert.match(copy.diagnose('SOURCE_OR_ASSET_CHANGED',{submissionUncertain:true}).action,/不要再次提交/);
 assert.match(copy.diagnose('PAUSED_CAPTCHA SOURCE_OR_ASSET_CHANGED').action,/人工完成验证/);
});

test('common failures expose a cause and a concrete handling action without granting retries',()=>{
 const cases=[
  ['上架内核发生变化，执行已阻止',/版本记录/,/重载/],
  ['ENOENT',/找不到/,/文件目录/],
  ['运费模板不存在',/运费模板/,/实际模板名称/],
  ['NO_SKU_UNVERIFIED ROOT_ANCESTRY_CHANGED',/销售规格/,/维护人员/],
  ['详情图片尺寸超长',/图片尺寸/,/调整原资料图片/],
  ['CONTENT_MISMATCH',/目的地/,/平台实际内容/],
  ['ITEM_RETRY_BUDGET_EXHAUSTED',/恢复条件/,/不重置次数/],
  ['LOGIN_REQUIRED',/登录身份/,/当前店铺/],
  ['MATERIAL_UPLOAD_NOT_READY',/回读核对/,/步骤截图/],
  ['TimeoutError: locator.click: timed out',/仍需核对/,/弹窗/],
  ['ECONNRESET',/连接未完成/,/先核验原商品结果/]
 ];
 for(const [reason,cause,action]of cases){const issue=copy.diagnose(reason);assert.match(issue.cause,cause);assert.match(issue.action,action);assert.equal(issue.known,true);assert.equal(hasLatin(issue.cause+issue.action),false);}
});

test('unknown diagnostics state uncertainty without inventing missing data or login problems',()=>{
 const issue=copy.diagnose('UNKNOWN_INTERNAL_FAULT');assert.equal(issue.known,false);
 assert.match(issue.title,/待确认/);assert.match(issue.cause,/不足以确认/);assert.match(issue.action,/异常记录和步骤截图/);
 assert.doesNotMatch(issue.cause,/图片已改变|登录失效/);
});
