import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';

// One shared context avoids allocating an async hook per run/step timer.
// The chain keeps nested timers independent when both wrap the same operation.
const context = new AsyncLocalStorage();
const add = (a, b) => Math.min(Number.MAX_VALUE, a + b);

function childCoverage(span, end) {
  const intervals = span.children
    .map(child => [child.start, Math.min(end, child.end ?? end)])
    .filter(([start, stop]) => stop > start)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, right = span.start;
  for (const [start, stop] of intervals) {
    covered = add(covered, Math.max(0, stop - Math.max(right, start)));
    right = Math.max(right, stop);
  }
  return covered;
}

/**
 * In-memory, async wall-clock attribution for one run or step (not CPU time).
 * Snapshots contain completed calls only; elapsedMs includes idle/in-flight time.
 * totalMs is inclusive; selfMs excludes the union of direct child intervals.
 * Concurrent root calls stay independent, so their totals can exceed elapsedMs.
 */
export class ExecutionTiming {
  #clock;
  #last = 0;
  #start;
  #categories = new Map();

  constructor({clock = () => performance.now()} = {}) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.#clock = clock;
    this.#start = this.#now();
  }

  #now() {
    // Instrumentation must not replace a business result/error. A broken clock
    // freezes at the last valid tick; backwards/invalid samples cannot go negative.
    try {
      const tick = this.#clock();
      if (typeof tick === 'number' && Number.isFinite(tick) && tick >= this.#last) {
        this.#last = tick;
      }
    } catch {
      // Clock failures are not business failures and do not increment errors.
    }
    return this.#last;
  }

  async measure(category, fn) {
    if (typeof category !== 'string' || !category.trim()) {
      throw new TypeError('category must be a non-empty string');
    }
    if (typeof fn !== 'function') throw new TypeError('fn must be a function');

    const inherited = context.getStore();
    let ancestor = inherited;
    while (ancestor && (ancestor.owner !== this || ancestor.span.end !== null)) {
      ancestor = ancestor.parent;
    }
    const span = {start: this.#now(), end: null, children: []};
    ancestor?.span.children.push(span);
    let failed = false;
    return context.run({owner: this, span, parent: inherited}, async () => {
      try {
        return await fn();
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        span.end = this.#now();
        const totalMs = span.end - span.start;
        const selfMs = Math.max(0, totalMs - childCoverage(span, span.end));
        const prior = this.#categories.get(category) ?? {calls: 0, totalMs: 0, selfMs: 0, errors: 0};
        this.#categories.set(category, {
          calls: add(prior.calls, 1),
          totalMs: add(prior.totalMs, totalMs),
          selfMs: add(prior.selfMs, selfMs),
          errors: add(prior.errors, failed ? 1 : 0),
        });
        span.children.length = 0;
      }
    });
  }

  snapshot() {
    return {
      elapsedMs: this.#now() - this.#start,
      categories: Object.fromEntries([...this.#categories].map(([name, values]) => [name, {...values}])),
    };
  }
}
