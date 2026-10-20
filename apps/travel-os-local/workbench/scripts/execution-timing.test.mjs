import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionTiming} from '../execution-timing.mjs';

function manualTimer() {
  let now = 0;
  return {timing: new ExecutionTiming({clock: () => now}), at: value => {now = value;}};
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

function assertFiniteNonNegative(snapshot) {
  assert.ok(Number.isFinite(snapshot.elapsedMs) && snapshot.elapsedMs >= 0);
  for (const metrics of Object.values(snapshot.categories)) {
    for (const value of Object.values(metrics)) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(metrics.selfMs <= metrics.totalMs);
    assert.ok(metrics.errors <= metrics.calls);
  }
}

test('returns the original value and records elapsed/inclusive/self milliseconds', async () => {
  const {timing, at} = manualTimer();
  const value = {ok: true};
  at(2);
  assert.strictEqual(await timing.measure('action', () => {at(12); return value;}), value);
  at(20);
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: 20,
    categories: {action: {calls: 1, totalMs: 10, selfMs: 10, errors: 0}},
  });
});

test('preserves original synchronous and asynchronous thrown values', async () => {
  const {timing, at} = manualTimer();
  for (const [index, original] of [new Error('business'), null, undefined, 'reason'].entries()) {
    at(index * 10);
    let caught = false;
    try {
      await timing.measure('guard', index % 2
        ? async () => {at(index * 10 + 4); throw original;}
        : () => {at(index * 10 + 4); throw original;});
    } catch (error) {
      caught = true;
      assert.strictEqual(error, original);
    }
    assert.equal(caught, true);
  }
  assert.deepEqual(timing.snapshot().categories.guard, {calls: 4, totalMs: 16, selfMs: 16, errors: 4});
});

test('attributes nested calls without double-counting child time in parent self time', async () => {
  const {timing, at} = manualTimer();
  await timing.measure('guard', async () => {
    at(3);
    await timing.measure('action', async () => {
      at(5);
      await timing.measure('evidence', () => {at(9);});
      at(13);
    });
    at(20);
  });
  assert.deepEqual(timing.snapshot().categories, {
    evidence: {calls: 1, totalMs: 4, selfMs: 4, errors: 0},
    action: {calls: 1, totalMs: 10, selfMs: 6, errors: 0},
    guard: {calls: 1, totalMs: 20, selfMs: 10, errors: 0},
  });
});

test('default clock works using only Node built-ins', async () => {
  const timing = new ExecutionTiming();
  assert.equal(await timing.measure('action', () => 42), 42);
  const snapshot = timing.snapshot();
  assert.equal(snapshot.categories.action.calls, 1);
  assert.equal(snapshot.categories.action.errors, 0);
  assert.ok(Number.isFinite(snapshot.elapsedMs) && snapshot.elapsedMs >= 0);
  assert.ok(snapshot.categories.action.totalMs >= 0);
  assert.ok(snapshot.elapsedMs >= snapshot.categories.action.totalMs);
});

test('concurrent root calls remain independent when they settle out of start order', async () => {
  const {timing, at} = manualTimer();
  const firstGate = deferred(), secondGate = deferred();
  const first = timing.measure('action', async () => {await firstGate.promise; return 'first';});
  at(2);
  const second = timing.measure('guard', async () => {await secondGate.promise; return 'second';});
  at(5);
  secondGate.resolve();
  assert.equal(await second, 'second');
  at(10);
  firstGate.resolve();
  assert.equal(await first, 'first');
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: 10,
    categories: {
      guard: {calls: 1, totalMs: 3, selfMs: 3, errors: 0},
      action: {calls: 1, totalMs: 10, selfMs: 10, errors: 0},
    },
  });
});

test('overlapping concurrent children subtract their union once from parent self time', async () => {
  const {timing, at} = manualTimer();
  const firstGate = deferred(), secondGate = deferred();
  await timing.measure('action', async () => {
    at(2);
    const first = timing.measure('first', () => firstGate.promise);
    at(4);
    const second = timing.measure('second', () => secondGate.promise);
    at(8);
    firstGate.resolve();
    await first;
    at(12);
    secondGate.resolve();
    await second;
    at(15);
  });
  assert.deepEqual(timing.snapshot().categories, {
    first: {calls: 1, totalMs: 6, selfMs: 6, errors: 0},
    second: {calls: 1, totalMs: 8, selfMs: 8, errors: 0},
    action: {calls: 1, totalMs: 15, selfMs: 5, errors: 0},
  });
});

test('contained parallel children and gaps between siblings leave correct parent self time', async () => {
  const {timing, at} = manualTimer();
  const outerGate = deferred(), innerGate = deferred();
  await timing.measure('action', async () => {
    at(2);
    const outer = timing.measure('parallel', () => outerGate.promise);
    at(4);
    const inner = timing.measure('parallel', () => innerGate.promise);
    at(7);
    innerGate.resolve();
    await inner;
    at(10);
    outerGate.resolve();
    await outer;
    at(12);
    await timing.measure('separate', () => {at(15);});
    at(20);
  });
  assert.deepEqual(timing.snapshot().categories, {
    parallel: {calls: 2, totalMs: 11, selfMs: 11, errors: 0},
    separate: {calls: 1, totalMs: 3, selfMs: 3, errors: 0},
    action: {calls: 1, totalMs: 20, selfMs: 9, errors: 0},
  });
});

test('same-category recursion counts each invocation with inclusive and self totals', async () => {
  const {timing, at} = manualTimer();
  await timing.measure('action', async () => {
    at(2);
    await timing.measure('action', () => {at(6);});
    at(10);
  });
  assert.deepEqual(timing.snapshot().categories.action, {calls: 2, totalMs: 14, selfMs: 10, errors: 0});
});

test('counts only calls which reject, including propagated child errors', async () => {
  const {timing, at} = manualTimer();
  const original = Object.assign(new Error('verification required'), {code: 'PAUSED_CAPTCHA'});
  await timing.measure('caught-parent', async () => {
    at(1);
    await assert.rejects(timing.measure('caught-child', () => {at(3); throw original;}), error => error === original);
    at(5);
  });
  at(6);
  await assert.rejects(timing.measure('failed-parent', async () => {
    at(7);
    await timing.measure('failed-child', () => {at(10); throw original;});
  }), error => error === original);
  assert.deepEqual(timing.snapshot().categories, {
    'caught-child': {calls: 1, totalMs: 2, selfMs: 2, errors: 1},
    'caught-parent': {calls: 1, totalMs: 5, selfMs: 3, errors: 0},
    'failed-child': {calls: 1, totalMs: 3, selfMs: 3, errors: 1},
    'failed-parent': {calls: 1, totalMs: 4, selfMs: 1, errors: 1},
  });
});

test('nested run and step instances attribute their own descendants independently', async () => {
  let now = 0;
  const run = new ExecutionTiming({clock: () => now});
  const step = new ExecutionTiming({clock: () => now});
  await run.measure('action', () => step.measure('action', async () => {
    now = 2;
    await run.measure('guard', () => step.measure('guard', () => {now = 8;}));
    now = 10;
  }));
  const expected = {
    elapsedMs: 10,
    categories: {
      guard: {calls: 1, totalMs: 6, selfMs: 6, errors: 0},
      action: {calls: 1, totalMs: 10, selfMs: 4, errors: 0},
    },
  };
  assert.deepEqual(run.snapshot(), expected);
  assert.deepEqual(step.snapshot(), expected);
});

test('snapshot excludes in-flight calls and returns detached metric copies', async () => {
  let now = 100;
  const timing = new ExecutionTiming({clock: () => now});
  const gate = deferred();
  now = 110;
  const pending = timing.measure('action', () => gate.promise);
  now = 112;
  assert.deepEqual(timing.snapshot(), {elapsedMs: 12, categories: {}});
  now = 120;
  gate.resolve();
  await pending;
  const earlier = timing.snapshot();
  earlier.categories.action.totalMs = -1;
  earlier.categories.other = {calls: Infinity};
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: 20,
    categories: {action: {calls: 1, totalMs: 10, selfMs: 10, errors: 0}},
  });
});

test('clips unawaited child coverage at parent completion without changing past totals', async () => {
  const {timing, at} = manualTimer();
  const gate = deferred();
  let pending;
  await timing.measure('parent', () => {
    at(2);
    pending = timing.measure('child', () => gate.promise);
    at(5);
  });
  assert.deepEqual(timing.snapshot().categories.parent, {calls: 1, totalMs: 5, selfMs: 2, errors: 0});
  at(10);
  gate.resolve();
  await pending;
  assert.deepEqual(timing.snapshot().categories, {
    parent: {calls: 1, totalMs: 5, selfMs: 2, errors: 0},
    child: {calls: 1, totalMs: 8, selfMs: 8, errors: 0},
  });
});

test('async work starting after its inherited parent has completed becomes a root call', async () => {
  const {timing, at} = manualTimer();
  const gate = deferred();
  let pending;
  await timing.measure('parent', () => {
    pending = (async () => {
      await gate.promise;
      at(10);
      await timing.measure('later', () => {at(15);});
    })();
    at(5);
  });
  gate.resolve();
  await pending;
  assert.deepEqual(timing.snapshot().categories, {
    parent: {calls: 1, totalMs: 5, selfMs: 5, errors: 0},
    later: {calls: 1, totalMs: 5, selfMs: 5, errors: 0},
  });
});

test('clock exceptions cannot replace a successful result or an original business error', async () => {
  const original = new Error('original business failure');
  const value = {ok: true};
  const timing = new ExecutionTiming({clock: () => {throw new Error('clock unavailable');}});
  assert.strictEqual(await timing.measure('action', () => value), value);
  await assert.rejects(timing.measure('guard', () => {throw original;}), error => error === original);
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: 0,
    categories: {
      action: {calls: 1, totalMs: 0, selfMs: 0, errors: 0},
      guard: {calls: 1, totalMs: 0, selfMs: 0, errors: 1},
    },
  });
});

test('invalid and backwards clock samples freeze the previous valid monotonic tick', async () => {
  let sample = 100;
  const timing = new ExecutionTiming({clock: () => sample});
  sample = 110;
  await timing.measure('action', async () => {
    for (sample of [NaN, Infinity, -Infinity, -1, 105, '120', null, undefined, 12n, {}]) {
      assert.equal(timing.snapshot().elapsedMs, 10);
      assertFiniteNonNegative(timing.snapshot());
    }
    sample = 125;
  });
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: 25,
    categories: {action: {calls: 1, totalMs: 15, selfMs: 15, errors: 0}},
  });
});

test('saturates concurrent accumulated durations instead of exposing Infinity', async () => {
  const {timing, at} = manualTimer();
  const gate = deferred();
  const first = timing.measure('action', () => gate.promise);
  const second = timing.measure('action', () => gate.promise);
  at(Number.MAX_VALUE);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(timing.snapshot(), {
    elapsedMs: Number.MAX_VALUE,
    categories: {action: {calls: 2, totalMs: Number.MAX_VALUE, selfMs: Number.MAX_VALUE, errors: 0}},
  });
  assertFiniteNonNegative(timing.snapshot());
});

test('special category names remain own JSON properties without prototype mutation', async () => {
  const {timing, at} = manualTimer();
  for (const [index, name] of ['__proto__', 'constructor', 'toString'].entries()) {
    at(index * 2);
    await timing.measure(name, () => {at(index * 2 + 1);});
  }
  const categories = timing.snapshot().categories;
  assert.strictEqual(Object.getPrototypeOf(categories), Object.prototype);
  for (const name of ['__proto__', 'constructor', 'toString']) {
    assert.equal(Object.hasOwn(categories, name), true);
    assert.deepEqual(categories[name], {calls: 1, totalMs: 1, selfMs: 1, errors: 0});
  }
  assert.deepEqual(JSON.parse(JSON.stringify(timing.snapshot())), timing.snapshot());
});

test('invalid instrumentation parameters fail explicitly before running business code', async () => {
  assert.throws(() => new ExecutionTiming({clock: 123}), TypeError);
  const {timing} = manualTimer();
  let called = false;
  for (const category of ['', ' ', null, undefined, 1, {}]) {
    await assert.rejects(timing.measure(category, () => {called = true;}), TypeError);
  }
  await assert.rejects(timing.measure('action', null), TypeError);
  assert.equal(called, false);
  assert.deepEqual(timing.snapshot(), {elapsedMs: 0, categories: {}});
});
