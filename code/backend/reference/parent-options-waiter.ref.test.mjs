// 特征测试 · parent-options-waiter.ref.mjs（P2 验收）
//
// 与 next-question 同构（延迟首发 / 800ms 周期 / 同步 attempt 分类 / 60s 超时 /
// close 静默），另**重点钉死同 key 顶替**：同 key 新请求进场 → 旧请求恰好一次
// respond.superseded 并从 registry 摘除；异 key 互不影响；activeCount == registry.size。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParentOptionsWaiter } from './parent-options-waiter.ref.mjs';

function fakeTimers () {
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    setTimeout (fn, ms) { const id = 't' + nextId++; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout (id) { timeouts.delete(id); },
    setInterval (fn, ms) { const id = 'i' + nextId++; intervals.set(id, { fn, ms }); return id; },
    clearInterval (id) { intervals.delete(id); },
    timeoutIds () { return [...timeouts.keys()]; },
    intervalIds () { return [...intervals.keys()]; },
    intervalMs (id) { return intervals.get(id)?.ms; },
    timeoutMs (id) { return timeouts.get(id)?.ms; },
    fireTimeout (id) { const e = timeouts.get(id); if (e) { timeouts.delete(id); e.fn(); } },
    tick (id) { const e = intervals.get(id); if (e) e.fn(); },
  };
}

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
    ready: (round) => calls.push(['ready', round]),
    superseded: () => calls.push(['superseded']),
    error: (e) => calls.push(['error', e]),
  };
}

// ── 延迟首发 + 800ms 周期 + 60s 超时 ───────────────────────────────────────

test('延迟首发 + 参数：START 只装 800ms interval + 60000ms timeout，首 tick 前不 attempt', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const attempts = [];
  const waiter = createParentOptionsWaiter({ timers });
  waiter.wait({ key: 'k1', raw, attempt: () => { attempts.push(1); return { status: 'pending' }; }, respond });
  await flush();

  assert.equal(attempts.length, 0, '延迟首发');
  assert.equal(timers.intervalMs(timers.intervalIds()[0]), 800, 'interval 800ms');
  assert.equal(timers.timeoutMs(timers.timeoutIds()[0]), 60000, 'timeout 60000ms');
  assert.equal(waiter.activeCount(), 1, 'activeCount == registry.size == 1');
});

// ── ready 终止 ─────────────────────────────────────────────────────────────

test('ready 终止：respond.ready(round) 一次，清 interval + timeout，registry 摘除', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  let n = 0;
  const waiter = createParentOptionsWaiter({ timers });
  const done = waiter.wait({
    key: 'k1', raw,
    attempt: () => (++n >= 2 ? { status: 'ready', options: ['A', 'B'] } : { status: 'pending' }),
    respond,
  });
  await flush();
  const iv = timers.intervalIds()[0];
  timers.tick(iv); await flush();  // pending
  timers.tick(iv); await flush();  // ready

  assert.deepEqual(respond.calls, [['ready', { status: 'ready', options: ['A', 'B'] }]]);
  assert.equal(timers.intervalIds().length, 0);
  assert.equal(timers.timeoutIds().length, 0);
  await done;
  assert.equal(waiter.activeCount(), 0, 'ready 收尾后 registry 摘除该 key');
});

// ── !round → not_found 终止 ────────────────────────────────────────────────

test('无 round（attempt 返回 falsy）→ respond.notFound() 一次', async () => {
  const timers = fakeTimers();
  const raw = fakeRaw();
  const respond = recordingRespond();
  const waiter = createParentOptionsWaiter({ timers });
  const done = waiter.wait({ key: 'k1', raw, attempt: () => null, respond });
  await flush();
  timers.tick(timers.intervalIds()[0]); await flush();
  assert.deepEqual(respond.calls, [['notFound']]);
  await done;
});

// ── 行为⑧ 同 key 顶替（本参考的核心差异） ─────────────────────────────────

test('同 key 顶替：新请求进场 → 旧请求恰好一次 respond.superseded，旧 interval/timeout 清掉；新请求接管、activeCount 仍为 1', async () => {
  const timers = fakeTimers();
  const rawOld = fakeRaw();
  const rawNew = fakeRaw();
  const respondOld = recordingRespond();
  const respondNew = recordingRespond();
  const waiter = createParentOptionsWaiter({ timers });

  const doneOld = waiter.wait({ key: 'k1', raw: rawOld, attempt: () => ({ status: 'pending' }), respond: respondOld });
  await flush();
  assert.equal(waiter.activeCount(), 1);
  const oldIntervalId = timers.intervalIds()[0];
  const oldTimeoutId = timers.timeoutIds()[0];

  // 同 key 第二次进场：旧实例被顶替。
  waiter.wait({ key: 'k1', raw: rawNew, attempt: () => ({ status: 'pending' }), respond: respondNew });
  await flush();

  assert.deepEqual(respondOld.calls, [['superseded']], '旧请求恰好一次 superseded');
  assert.deepEqual(respondNew.calls, [], '新请求尚未结算');
  assert.equal(rawOld.closeListenerCount(), 0, '旧 close 监听已摘除');
  assert.ok(!timers.intervalIds().includes(oldIntervalId), '旧 interval 已清');
  assert.ok(!timers.timeoutIds().includes(oldTimeoutId), '旧 timeout 已清');
  assert.equal(waiter.activeCount(), 1, '顶替后仍恰好一个活跃（新接管旧位）');
  await doneOld;

  // 新实例仍在轮询，可正常 ready 收尾。
  const newIv = timers.intervalIds()[0];
  assert.ok(newIv, '新实例应有自己的 interval');
});

test('异 key 互不影响：两个不同 key 各自独立，activeCount == 2', async () => {
  const timers = fakeTimers();
  const respondA = recordingRespond();
  const respondB = recordingRespond();
  const waiter = createParentOptionsWaiter({ timers });
  waiter.wait({ key: 'kA', raw: fakeRaw(), attempt: () => ({ status: 'pending' }), respond: respondA });
  waiter.wait({ key: 'kB', raw: fakeRaw(), attempt: () => ({ status: 'pending' }), respond: respondB });
  await flush();
  assert.equal(waiter.activeCount(), 2, '两个不同 key 各占一位');
  assert.deepEqual(respondA.calls, [], 'kA 未被顶替');
  assert.deepEqual(respondB.calls, [], 'kB 未被顶替');
});

// ── close 静默 + 超时（与 next-question 同构，快速核对） ────────────────────

test('close 静默 + 超时：close 不 respond 只清理；超时 respond.timeout 一次并清 interval', async () => {
  const timers = fakeTimers();
  // close 静默
  const rawC = fakeRaw();
  const respondC = recordingRespond();
  const waiterC = createParentOptionsWaiter({ timers });
  const doneC = waiterC.wait({ key: 'kc', raw: rawC, attempt: () => ({ status: 'pending' }), respond: respondC });
  await flush();
  rawC.emitClose(); await flush();
  assert.deepEqual(respondC.calls, [], 'close 静默');
  assert.equal(waiterC.activeCount(), 0, 'close 后 registry 摘除');
  await doneC;

  // 超时
  const timers2 = fakeTimers();
  const rawT = fakeRaw();
  const respondT = recordingRespond();
  const waiterT = createParentOptionsWaiter({ timers: timers2 });
  const doneT = waiterT.wait({ key: 'kt', raw: rawT, attempt: () => ({ status: 'pending' }), respond: respondT });
  await flush();
  timers2.fireTimeout(timers2.timeoutIds()[0]); await flush();
  assert.deepEqual(respondT.calls, [['timeout']]);
  assert.equal(timers2.intervalIds().length, 0);
  await doneT;
});
