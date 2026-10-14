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
