// realtime_core · session/delivery.subscribe.test.mjs（P3a · 复用考验）
//
// subscribe 与 **真实 P2 引擎** 的对接测试：注入 transport/engine.js 的
// longPoll（不是复制品），配同形状 wakeup port 与假 timers——证明投递层的
// 等待机制 100% 复用 P2（session/ 生产代码零 transport import、零自制轮询，
// longPoll 以能力注入进来；本测试文件不在纯度门 scope 内，import 引擎合法）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longPoll } from '../transport/engine.js';
import { createMemoryLogStore } from './memory-log-store.js';
import { createDelivery } from './delivery.js';

function fixedCtx () {
  let now = 1000; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

/** 与 engine.integration.test.mjs 的 fakeWakeup 同形状（createWakeupPort 形状）。 */
function fakeWakeup () {
  const listeners = new Map(); // kind -> Set<listener>
  const toList = (kinds) => (Array.isArray(kinds) ? kinds : [kinds]);
  return {
    subscribe (kinds, listener) {
      const list = toList(kinds);
      for (const kind of list) {
        if (!listeners.has(kind)) listeners.set(kind, new Set());
        listeners.get(kind).add(listener);
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const kind of list) listeners.get(kind)?.delete(listener);
      };
    },
    emit (pollKey, kinds) {
      for (const kind of toList(kinds)) {
        for (const listener of listeners.get(kind) || []) listener(pollKey);
      }
    },
  };
}

function fakeTimers () {
  let nextId = 1;
  const pending = new Map();
  return {
    set (fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear (id) { pending.delete(id); },
    fire (id) { const entry = pending.get(id); if (entry) { pending.delete(id); entry.fn(); } },
    pendingIds () { return [...pending.keys()]; },
  };
}

function flush () { return new Promise((resolve) => setTimeout(resolve, 0)); }

function rig () {
  const store = createMemoryLogStore(fixedCtx());
  const wakeup = fakeWakeup();
  const delivery = createDelivery({ logStore: store, wakeup, longPoll });
  return { store, wakeup, delivery };
}

function waiter (delivery, streamId, group, { timers, limit } = {}) {
  const responded = [];
  let closeHandler = null;
  const done = delivery.subscribe(streamId, group, {
    timers,
    timeoutMs: 5000,
    limit,
    respond: {
      settled: (batch) => responded.push(['settled', batch]),
      timeout: () => responded.push(['timeout']),
      error: (err) => responded.push(['error', err]),
    },
    onClientClose: (cb) => { closeHandler = cb; return () => { closeHandler = null; }; },
  });
  return { responded, done, triggerClose: () => closeHandler?.() };
}

test('subscribe · 无积压时等待，publish 经 wakeup 唤醒 → respond.settled(游标后的整批)', async () => {
  const { delivery } = rig();
  const timers = fakeTimers();
  const w = waiter(delivery, 's1', 'g1', { timers });
  await flush();
  assert.deepEqual(w.responded, [], '无事件时应保持等待');

  delivery.publish('s1', [{ type: 'noted', payload: { n: 1 } }]);
  await w.done;
  assert.equal(w.responded.length, 1);
  const [tag, batch] = w.responded[0];
  assert.equal(tag, 'settled');
  assert.deepEqual(batch.map((e) => e.seq), [1]);
  assert.equal(batch[0].payload.n, 1);
});

test('subscribe · 已有积压则首次 attempt 立即结算，不进入等待', async () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }]);
  const timers = fakeTimers();
  const w = waiter(delivery, 's1', 'g1', { timers });
  await w.done;
  assert.equal(w.responded[0][0], 'settled');
  assert.deepEqual(w.responded[0][1].map((e) => e.seq), [1, 2]);
  assert.deepEqual(timers.pendingIds(), [], '终态清理后不应残留 timer');
});

test('subscribe · 超时走 P2 timer 路径：respond.timeout，之后 publish 不再打扰', async () => {
  const { delivery } = rig();
  const timers = fakeTimers();
  const w = waiter(delivery, 's1', 'g1', { timers });
  await flush();
  const [timeoutTimer] = timers.pendingIds();
  timers.fire(timeoutTimer);
  await w.done;
  assert.deepEqual(w.responded, [['timeout']]);
  delivery.publish('s1', [{ type: 'late' }]);
  await flush();
  assert.deepEqual(w.responded, [['timeout']], '终态后唤醒已退订，不得二次 respond');
});

test('subscribe · client close 静默清理（不 respond），随后 publish 不唤醒旧订阅', async () => {
  const { delivery } = rig();
  const timers = fakeTimers();
  const w = waiter(delivery, 's1', 'g1', { timers });
  await flush();
  w.triggerClose();
  await w.done;
  delivery.publish('s1', [{ type: 'noted' }]);
  await flush();
  assert.deepEqual(w.responded, [], 'close 后应零 respond');
});

test('subscribe · 同 group 两个并发订阅都被同一次 publish 唤醒、拿到同一批；ack 一次即整组前移', async () => {
  const { delivery } = rig();
  const wA = waiter(delivery, 's1', 'g1', { timers: fakeTimers() });
  const wB = waiter(delivery, 's1', 'g1', { timers: fakeTimers() });
  await flush();
  delivery.publish('s1', [{ type: 'noted' }]);
  await Promise.all([wA.done, wB.done]);
  assert.deepEqual(wA.responded[0][1].map((e) => e.seq), [1], '订阅 A 收到');
  assert.deepEqual(wB.responded[0][1].map((e) => e.seq), [1], '订阅 B 收到同一批');
  delivery.ack('s1', 'g1', 1);
  assert.deepEqual(delivery.pull('s1', 'g1'), [], 'ack 一次即整组游标前移');
});

test('subscribe · pollKey=streamId 过滤：别的流 publish 不会误唤醒', async () => {
  const { delivery } = rig();
  const timers = fakeTimers();
  const w = waiter(delivery, 's1', 'g1', { timers });
  await flush();
  delivery.publish('s2', [{ type: 'noted' }]); // 另一条流
  await flush();
  assert.deepEqual(w.responded, [], 's2 的追加不应结算 s1 的订阅');
  delivery.publish('s1', [{ type: 'noted' }]);
  await w.done;
  assert.equal(w.responded[0][0], 'settled');
});

test('subscribe · 未 ack 就断线重来：再次 subscribe 立即拿到同一批（at-least-once 不丢投递）', async () => {
  const { delivery } = rig();
  const w1 = waiter(delivery, 's1', 'g1', { timers: fakeTimers() });
  await flush();
  delivery.publish('s1', [{ type: 'noted' }]);
  await w1.done;
  assert.deepEqual(w1.responded[0][1].map((e) => e.seq), [1]);
  // 消费方没 ack 就没了；新订阅（同 group）立即重见 seq 1。
  const w2 = waiter(delivery, 's1', 'g1', { timers: fakeTimers() });
  await w2.done;
  assert.deepEqual(w2.responded[0][1].map((e) => e.seq), [1], '未确认的事件必须重投');
});
