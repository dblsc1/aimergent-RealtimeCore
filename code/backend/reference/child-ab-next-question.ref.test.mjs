// 特征测试 · child-ab-next-question.ref.mjs（P2 验收）
//
// fake timers 逐 tick 步进 + flush 微任务，逐条断言参考实现的观测行为与 copycat
// block-9 next-question-poller 源一致：延迟首发、1000ms 周期、同步 attempt 分类、
// not_found/delivered 终止、60s 超时、close 静默、cleanup 拆 interval+timer。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChildAbNextQuestionPoller } from './child-ab-next-question.ref.mjs';

// ── 测试替身 ──────────────────────────────────────────────────────────────

/** block-9 shape 的假定时器：测试手动 fire 一次性超时 / 步进周期 tick。 */
function fakeTimers () {
  let nextId = 1;
  const timeouts = new Map();  // id -> {fn, ms}
  const intervals = new Map(); // id -> {fn, ms}
  return {
    setTimeout (fn, ms) { const id = 't' + nextId++; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout (id) { timeouts.delete(id); },
    setInterval (fn, ms) { const id = 'i' + nextId++; intervals.set(id, { fn, ms }); return id; },
    clearInterval (id) { intervals.delete(id); },
    // 测试控制面：
    timeoutIds () { return [...timeouts.keys()]; },
    intervalIds () { return [...intervals.keys()]; },
    timeoutMs (id) { return timeouts.get(id)?.ms; },
    intervalMs (id) { return intervals.get(id)?.ms; },
    fireTimeout (id) { const e = timeouts.get(id); if (e) { timeouts.delete(id); e.fn(); } },
    tick (id) { const e = intervals.get(id); if (e) e.fn(); },  // 周期触发：不移除
  };
}

/** 假 raw 连接：只需 on/off('close') + 手动 emitClose。 */
function fakeRaw () {
  const closeCbs = new Set();
  return {
    on (evt, cb) { if (evt === 'close') closeCbs.add(cb); },
    off (evt, cb) { if (evt === 'close') closeCbs.delete(cb); },
    emitClose () { for (const cb of [...closeCbs]) cb(); },
    closeListenerCount () { return closeCbs.size; },
  };
}

const flush = () => new Promise((r) => globalThis.setTimeout(r, 0));

function recordingRespond () {
  const calls = [];
  return {
    calls,
    timeout: () => calls.push(['timeout']),
    notFound: () => calls.push(['notFound']),
    delivered: (body) => calls.push(['delivered', body]),
    error: (e) => calls.push(['error', e]),
  };
}

// ── 行为⑥ 延迟首发 + 行为①⑦ 定时器参数 ────────────────────────────────────

test('延迟首发：START 只装 1000ms interval + 60000ms timeout，首个 tick 之前不跑 attempt', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const attempts = [];
  const poller = createChildAbNextQuestionPoller({ timers });

  poller.wait({ raw, attempt: () => { attempts.push(1); return { kind: 'pending' }; }, respond });
  await flush();

  assert.equal(attempts.length, 0, '首 tick 之前不应跑 attempt（延迟首发）');
  assert.equal(timers.intervalIds().length, 1, '应装恰好一个周期定时器');
  assert.equal(timers.timeoutIds().length, 1, '应装恰好一个一次性超时');
  assert.equal(timers.intervalMs(timers.intervalIds()[0]), 1000, 'interval 周期应为 1000ms');
  assert.equal(timers.timeoutMs(timers.timeoutIds()[0]), 60000, 'timeout 应为 60000ms');
  assert.equal(raw.closeListenerCount(), 1, '应挂上一个 close 监听');
  assert.equal(poller.activeCount(), 1);
});

// ── 行为①②⑤ 周期轮询 + 同步 attempt 分类（pending 继续等） ────────────────

test('周期轮询：每个 tick 跑一次 attempt；pending 继续等（不 respond、interval/timeout 不动）', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const attempts = [];
  const poller = createChildAbNextQuestionPoller({ timers });
  poller.wait({ raw, attempt: () => { attempts.push(1); return { kind: 'pending' }; }, respond });
  await flush();

  const intervalId = timers.intervalIds()[0];
  timers.tick(intervalId); await flush();
  assert.equal(attempts.length, 1, '第一个 tick 跑第一次 attempt');
  assert.deepEqual(respond.calls, [], 'pending 不 respond');
  assert.equal(timers.intervalIds().length, 1, 'pending 后 interval 仍在（继续轮询）');
  assert.equal(timers.timeoutIds().length, 1, 'pending 后超时仍在');

  timers.tick(intervalId); await flush();
  assert.equal(attempts.length, 2, '第二个 tick 跑第二次 attempt');
});

// ── 行为④ delivered 终止 + 行为⑨ cleanup 拆 interval+timer ─────────────────

test('delivered 终止：respond.delivered(body) 一次，interval + timeout 全部清掉，close 监听摘除，done resolve', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  let round = 0;
  const poller = createChildAbNextQuestionPoller({ timers });
  const done = poller.wait({
    raw,
    attempt: () => (++round >= 2 ? { kind: 'delivered', body: { q: 'Q-1' } } : { kind: 'pending' }),
    respond,
  });
  await flush();
  const intervalId = timers.intervalIds()[0];

  timers.tick(intervalId); await flush(); // pending
  timers.tick(intervalId); await flush(); // delivered

  assert.deepEqual(respond.calls, [['delivered', { q: 'Q-1' }]], 'delivered 恰好一次，携带 body');
  assert.equal(timers.intervalIds().length, 0, 'cleanup 应 clearInterval');
  assert.equal(timers.timeoutIds().length, 0, 'cleanup 应 clearTimeout');
  assert.equal(raw.closeListenerCount(), 0, 'cleanup 应摘除 close 监听');
  await done;
  assert.equal(poller.activeCount(), 0, 'done 后 active 归 0');

  // 终态后再 tick 也不该二次 respond（interval 已清，但强制再触发一次核对幂等）。
  timers.tick(intervalId); await flush();
  assert.equal(respond.calls.length, 1, '终态后不二次 respond');
});

// ── 行为③ not_found 终止 ───────────────────────────────────────────────────

test('not_found 终止：respond.notFound() 一次，清 interval + timeout', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const poller = createChildAbNextQuestionPoller({ timers });
  const done = poller.wait({ raw, attempt: () => ({ kind: 'not_found' }), respond });
  await flush();

  timers.tick(timers.intervalIds()[0]); await flush();
  assert.deepEqual(respond.calls, [['notFound']]);
  assert.equal(timers.intervalIds().length, 0);
  assert.equal(timers.timeoutIds().length, 0);
  await done;
});

// ── 行为⑦ 60s 超时 ────────────────────────────────────────────────────────

test('超时：60000ms 一次性定时器触发 → respond.timeout() 一次，清 interval', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const poller = createChildAbNextQuestionPoller({ timers });
  const done = poller.wait({ raw, attempt: () => ({ kind: 'pending' }), respond });
  await flush();

  const timeoutId = timers.timeoutIds()[0];
  timers.fireTimeout(timeoutId); await flush();
  assert.deepEqual(respond.calls, [['timeout']]);
  assert.equal(timers.intervalIds().length, 0, '超时后应 clearInterval');
  await done;
});

// ── 行为⑧ close 静默 ──────────────────────────────────────────────────────

test('close 静默：raw 关闭 → 不 respond，只清 interval + timeout，done resolve', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const poller = createChildAbNextQuestionPoller({ timers });
  const done = poller.wait({ raw, attempt: () => ({ kind: 'pending' }), respond });
  await flush();

  raw.emitClose(); await flush();
  assert.deepEqual(respond.calls, [], 'close 静默：不产生任何 respond');
  assert.equal(timers.intervalIds().length, 0, 'close 后清 interval');
  assert.equal(timers.timeoutIds().length, 0, 'close 后清 timeout');
  await done;
  assert.equal(poller.activeCount(), 0);
});
