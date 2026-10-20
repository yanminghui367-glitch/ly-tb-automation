import test from 'node:test';
import assert from 'node:assert/strict';
import '../ui-copy.js';

const copy=globalThis.LyUiCopy;
const hasLatin=value=>/[A-Za-z]{2,}/.test(value.replace(/\bChrome\b/g,''));

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
  ['MATERIAL_UPLOAD_NOT_READY',/没有确认/,/步骤截图/],
  ['TimeoutError: locator.click: timed out',/仍需核对/,/弹窗/],
  ['ECONNRESET',/连接未完成/,/先核验原商品结果/]
 ];
 for(const [reason,cause,action]of cases){const issue=copy.diagnose(reason);assert.match(issue.cause,cause);assert.match(issue.action,action);assert.equal(issue.known,true);assert.equal(hasLatin(issue.cause+issue.action),false);}
});

test('unknown diagnostics state uncertainty without inventing missing data or login problems',()=>{
 const issue=copy.diagnose('UNKNOWN_INTERNAL_FAULT');assert.equal(issue.known,false);
 assert.match(issue.title,/不能确定/);assert.match(issue.cause,/不足以确认/);assert.match(issue.action,/异常记录和步骤截图/);
 assert.doesNotMatch(issue.cause,/图片已改变|登录失效/);
});

test('image selection timeout identifies the exact step without inventing a root cause and lists website recovery actions',()=>{
 const issue=copy.diagnose('TimeoutError: locator.click timed out',{stage:'select-detail-1'});
 assert.match(issue.cause,/选择详情图 1/);assert.match(issue.cause,/还不能确定/);
 assert.match(issue.actions[0],/打开执行 Chrome/);assert.match(issue.actions[1],/加载|遮挡弹窗/);
 assert.match(issue.actions[2],/检查并继续本轮/);assert.match(issue.actions[3],/不一定能恢复/);
 assert.doesNotMatch(issue.cause,/图片尺寸不符|文件缺失|登录失效/);
 assert.equal(issue.action,issue.actions.join(' '));
});

test('uncertain or existing publication always routes through verification even when a page timeout is also present',()=>{
 for(const context of [{state:'RESULT_UNKNOWN',stage:'select-detail-1'},{submissionUncertain:true,stage:'select-detail-1'}]){
  const issue=copy.diagnose('TimeoutError: locator.click timed out',context);
  assert.match(issue.actions[0],/核验原商品/);assert.match(issue.actions[1],/只有.*核验.*后/);assert.match(issue.action,/不要再次提交/);
  assert.doesNotMatch(issue.action,/处理页面提示后.*检查并继续/);
 }
 const existing=copy.diagnose('已有商品记录未能在原店铺核实，禁止重新发布',{stage:'existing-listing-check'});
 assert.match(existing.cause,/当前店铺/);assert.match(existing.action,/核验原商品/);
});

test('maintenance-only failures name the limit of website recovery rather than promise a button can fix them',()=>{
 const kernel=copy.diagnose('KERNEL_CHANGED',{stage:'select-detail-1'});
 assert.match(kernel.action,/无法靠重复点击/);assert.match(kernel.action,/维护人员/);
 const source=copy.diagnose('SOURCE_OR_ASSET_CHANGED');assert.match(source.action,/不必反复上传/);assert.match(source.action,/版本绑定/);
 const unknown=copy.diagnose('UNKNOWN_INTERNAL_FAULT',{stage:'select-detail-1'});
 assert.equal(unknown.known,false);assert.match(unknown.cause,/不足以确认/);assert.match(unknown.action,/维护人员/);
});
