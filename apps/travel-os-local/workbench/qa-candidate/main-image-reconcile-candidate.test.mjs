import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {clickMainImageAndVerify} from './main-image-reconcile-candidate.mjs';

const expected = 'https://img.alicdn.com/imgextra/i4/2215038760087/image.png_320x320';

function fixture(reads, {guard = async () => {}, url = 'https://item.upload.taobao.com/sell/v2/publish.htm'} = {}) {
  let readIndex = 0;
  let clicks = 0;
  const page = {
    url: () => url,
    locator: () => ({evaluateAll: async () => reads[Math.min(readIndex++, reads.length - 1)]}),
  };
  const card = {locator: () => ({click: async () => { clicks++; }})};
  return {page, card, guard, clicks: () => clicks, reads: () => readIndex};
}

test('reconciles exact expected image already selected without clicking again', async () => {
  const f = fixture([[expected + '?t=1791781640000'], [expected + '?t=1791781640000']]);
  const events = [];
  await clickMainImageAndVerify(f.page, f.card, [expected], f.guard, {onEvent: async event => events.push(event)});
  assert.equal(f.clicks(), 0);
  assert.equal(events[0].kind, 'MAIN_IMAGE_ALREADY_SELECTED_RECONCILED');
  assert.equal(events[0].clickRepeated, false);
});

test('reconciles the exact observed Taobao CDN thumbnail variant', async () => {
  const expectedReceipt = expected + '?t=1791781640000';
  const actualDom = expected.replace('.png_320x320', '.png_320x320q80_.webp');
  const f = fixture([[actualDom], [actualDom]]);
  await clickMainImageAndVerify(f.page, f.card, [expectedReceipt], f.guard);
  assert.equal(f.clicks(), 0);
});

test('reconciles through an isolated real Chromium DOM without touching executor Chrome', async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage();
    const expectedReceipt = expected + '?t=1791781640000';
    const actualDom = expected.replace('.png_320x320', '.png_320x320q80_.webp');
    await page.setContent(`<div id="sell-field-mainImagesGroup"><img src="${actualDom}"></div>`);
    const f = {clicks: 0};
    const card = {locator: () => ({click: async () => { f.clicks++; }})};
    await clickMainImageAndVerify(page, card, [expectedReceipt], async () => {});
    assert.equal(f.clicks, 0);
  } finally {
    await browser.close();
  }
});

function clickPathFixture(initial, afterClick, {timeoutClick = false, guard = async () => {}} = {}) {
  let images = [...initial];
  let clicks = 0;
  const page = {url: () => 'https://item.upload.taobao.com/sell/v2/publish.htm', locator: () => ({evaluateAll: async () => [...images]})};
  const card = {locator: () => ({click: async () => {
    clicks++;
    if (afterClick !== null) images = [...afterClick];
    if (timeoutClick) { const error = new Error('click timed out'); error.name = 'TimeoutError'; throw error; }
  }})};
  return {page, card, guard, clicks: () => clicks};
}

test('normal click advances a valid prefix exactly once', async () => {
  const expectedTwo = [expected, expected.replace('image.png', 'image-2.png')];
  const f = clickPathFixture([expectedTwo[0]], expectedTwo);
  await clickMainImageAndVerify(f.page, f.card, expectedTwo, f.guard, {timeoutMs: 50});
  assert.equal(f.clicks(), 1);
});

test('a timed-out click that applied the image is reconciled without a second click', async () => {
  const f = clickPathFixture([], [expected], {timeoutClick: true});
  const events = [];
  await clickMainImageAndVerify(f.page, f.card, [expected], f.guard, {timeoutMs: 50, onEvent: async event => events.push(event)});
  assert.equal(f.clicks(), 1);
  assert.equal(events[0].kind, 'MAIN_IMAGE_CLICK_TIMEOUT_RECONCILED');
  assert.equal(events[0].clickRepeated, false);
});

test('a timed-out click that did not apply stays failed and is never clicked twice', async () => {
  const f = clickPathFixture([], null, {timeoutClick: true});
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard, {timeoutMs: 30}));
  assert.equal(f.clicks(), 1);
});

test('rejects reordered and extra images after the click, with one click only', async () => {
  const first = expected;
  const second = expected.replace('image.png', 'image-2.png');
  for (const after of [[second, first], [first, first + '-extra']]) {
    const f = clickPathFixture([first], after);
    await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [first, second], f.guard, {timeoutMs: 30}));
    assert.equal(f.clicks(), 1);
  }
});

test('a guard failure during post-click verification never causes a second click', async () => {
  let checks = 0;
  const f = clickPathFixture([], [expected], {guard: async () => { if (++checks >= 4) throw new Error('POST_CLICK_GUARD_FAILED'); }});
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard, {timeoutMs: 30}));
  assert.equal(f.clicks(), 1);
});

test('does not reconcile when non-cache query parameters differ', async () => {
  const f = fixture([[expected + '?quality=low'], [expected + '?quality=low']]);
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard), /MAIN_IMAGE_STATE_CHANGED|MAIN_IMAGE_PREFIX_CHANGED/);
  assert.equal(f.clicks(), 0);
});

test('does not ignore non-timestamp t transformation parameters', async () => {
  const f = fixture([[expected + '?t=resize_320x320'], [expected + '?t=resize_320x320']]);
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard), /MAIN_IMAGE_STATE_CHANGED|MAIN_IMAGE_PREFIX_CHANGED/);
  assert.equal(f.clicks(), 0);
});

test('requires complete ordered list and rejects extra or wrong-account assets', async () => {
  for (const images of [
    [expected, expected + '-extra'],
    ['https://img.alicdn.com/imgextra/i4/999999/other.png_320x320'],
  ]) {
    const f = fixture([images, images]);
    await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard));
    assert.equal(f.clicks(), 0);
  }
});

test('rejects when publish page changes during the stable reread', async () => {
  let calls = 0;
  const f = fixture([[expected], [expected]], {guard: async () => { if (++calls === 3) throw new Error('PAGE_GUARD_CHANGED'); }});
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard), /PAGE_GUARD_CHANGED/);
  assert.equal(f.clicks(), 0);
});

test('rejects when the form navigates between DOM reads', async () => {
  let reads = 0;
  const f = fixture([[expected], [expected]]);
  const originalUrl = f.page.url;
  f.page.url = () => (++reads >= 3 ? 'https://item.upload.taobao.com/sell/v2/other.htm' : originalUrl());
  await assert.rejects(() => clickMainImageAndVerify(f.page, f.card, [expected], f.guard), /MAIN_IMAGE_FORM_CHANGED/);
  assert.equal(f.clicks(), 0);
});
