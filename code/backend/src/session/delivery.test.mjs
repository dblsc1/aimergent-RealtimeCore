// realtime_core · session/delivery.test.mjs（P3a）
//
// 投递层单测（不含 subscribe——那是 delivery.subscribe.test.mjs 的复用考验）：
// publish 唤醒 / pull-ack 分离（at-least-once）/ 同 group 共享游标 / 崩溃重建。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLogStore } from './memory-log-store.js';
import { createDelivery, WAKE_KIND_APPENDED } from './delivery.js';
import { ConflictError } from './errors.js';

function fixedCtx () {
  let now = 1000; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

function recordingWakeup () {
  const emitted = [];
  return { emitted, emit: (pollKey, kinds) => emitted.push([pollKey, kinds]), subscribe: () => () => {} };
}

function rig () {
  const store = createMemoryLogStore(fixedCtx());
  const wakeup = recordingWakeup();
  const delivery = createDelivery({ logStore: store, wakeup });
  return { store, wakeup, delivery };
}

function expectThrow (fn, ctor, snippet) {
  let caught;
  try { fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected fn() to throw');
  assert.ok(caught instanceof ctor, `expected ${ctor.name}, got ${caught?.constructor?.name}: ${caught?.message}`);
  if (snippet) assert.ok(caught.message.includes(snippet), `message "${caught.message}" should include "${snippet}"`);
}

// ── publish ──────────────────────────────────────────────────────────────

test('publish · append 后 emit(streamId, "appended")；返回 {lastSeq}；连发 seq 连续', () => {
  const { delivery, wakeup, store } = rig();
  const r1 = delivery.publish('s1', [{ type: 'noted' }]);
  const r2 = delivery.publish('s1', [{ type: 'noted' }, { type: 'noted' }]);
  assert.equal(r1.lastSeq, 1);
  assert.equal(r2.lastSeq, 3);
  assert.deepEqual(wakeup.emitted, [['s1', WAKE_KIND_APPENDED], ['s1', WAKE_KIND_APPENDED]]);
  assert.deepEqual(store.read('s1', 0).map((e) => e.seq), [1, 2, 3]);
});

test('publish · 显式 expectedLastSeq 走严格 CAS：冲突原样上抛 ConflictError 且不 emit', () => {
  const { delivery, wakeup } = rig();
  delivery.publish('s1', [{ type: 'noted' }]);
  const before = wakeup.emitted.length;
  expectThrow(() => delivery.publish('s1', [{ type: 'noted' }], { expectedLastSeq: 0 }), ConflictError);
  assert.equal(wakeup.emitted.length, before, '冲突的 publish 不应发出唤醒');
  const ok = delivery.publish('s1', [{ type: 'noted' }], { expectedLastSeq: 1 });
  assert.equal(ok.lastSeq, 2);
});

test('publish · 尾指针缓存过期（外部直写 store）→ CAS 兜底重读重试一次，仍追加到真实尾部', () => {
  const { delivery, store } = rig();
  delivery.publish('s1', [{ type: 'noted' }]);            // 缓存 lastSeq=1
  store.append('s1', 1, [{ type: 'noted', id: 'oob' }]);  // 外部写入者，真实尾=2
  const r = delivery.publish('s1', [{ type: 'noted', id: 'after' }]);
  assert.equal(r.lastSeq, 3);
  assert.deepEqual(store.read('s1', 0).map((e) => e.seq), [1, 2, 3]);
});

// ── pull / ack 分离（at-least-once）──────────────────────────────────────

test('pull · 只读游标之后的事件、不动游标：未 ack 重复 pull 返回同一批（at-least-once）', () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }]);
  const first = delivery.pull('s1', 'g1');
  const again = delivery.pull('s1', 'g1');
  assert.deepEqual(first.map((e) => e.seq), [1, 2]);
  assert.deepEqual(again.map((e) => e.seq), [1, 2]);
});

test('ack · 前移游标后 pull 只见新事件；limit 分页续拉', () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  const page = delivery.pull('s1', 'g1', { limit: 2 });
  assert.deepEqual(page.map((e) => e.seq), [1, 2]);
  delivery.ack('s1', 'g1', 2);
  assert.deepEqual(delivery.pull('s1', 'g1').map((e) => e.seq), [3]);
  delivery.ack('s1', 'g1', 3);
  assert.deepEqual(delivery.pull('s1', 'g1'), []);
});

test('ack · 越过已 pull 高水位 = RangeError；回退 = RangeError；重复 ack 同 seq 幂等', () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }]);
  delivery.pull('s1', 'g1', { limit: 1 }); // 只 pull 到 seq 1
  expectThrow(() => delivery.ack('s1', 'g1', 2), RangeError, 'high-water');
  delivery.ack('s1', 'g1', 1);
  delivery.ack('s1', 'g1', 1); // 幂等
  expectThrow(() => delivery.ack('s1', 'g1', 0), TypeError);
  delivery.pull('s1', 'g1');
  delivery.ack('s1', 'g1', 2);
  expectThrow(() => delivery.ack('s1', 'g1', 1), RangeError, 'rollback');
});

// ── 消费组语义 ───────────────────────────────────────────────────────────

test('同 group 两条连接共享一枚游标：都收到同一批，任一 ack 一次即为整组前移', () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }]);
  const connA = delivery.pull('s1', 'g1');
  const connB = delivery.pull('s1', 'g1');
  assert.deepEqual(connA.map((e) => e.seq), [1, 2], '连接 A 收到全批');
  assert.deepEqual(connB.map((e) => e.seq), [1, 2], '连接 B 收到同一批');
  delivery.ack('s1', 'g1', 2); // 任一连接 ack 一次
  assert.deepEqual(delivery.pull('s1', 'g1'), [], '整组游标已前移');
});

test('不同 group 各自独立进度：一组 ack 不影响另一组', () => {
  const { delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }]);
  delivery.pull('s1', 'g1');
  delivery.pull('s1', 'g2');
  delivery.ack('s1', 'g1', 2);
  assert.deepEqual(delivery.pull('s1', 'g1'), []);
  assert.deepEqual(delivery.pull('s1', 'g2').map((e) => e.seq), [1, 2], 'g2 进度不受 g1 影响');
});

// ── 崩溃重建 ─────────────────────────────────────────────────────────────

test('崩溃重建 · 仅保留 logStore 重建 delivery：游标续读不重不漏；未重新 pull 就 ack = RangeError；publish 尾指针懒重建', () => {
  const { store, delivery } = rig();
  delivery.publish('s1', [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  delivery.pull('s1', 'g1');
  delivery.ack('s1', 'g1', 2);

  // "崩溃"：丢弃 delivery 内存态，仅 logStore 幸存。
  const rebuilt = createDelivery({ logStore: store, wakeup: recordingWakeup() });
  expectThrow(() => rebuilt.ack('s1', 'g1', 3), RangeError, 'high-water'); // 高水位随内存丢失，先 pull 再 ack
  assert.deepEqual(rebuilt.pull('s1', 'g1').map((e) => e.seq), [3], '从游标续读，已确认的 1-2 不重放');
  rebuilt.ack('s1', 'g1', 3);
  const r = rebuilt.publish('s1', [{ type: 'd' }]); // 尾指针懒重建 + CAS 兜底
  assert.equal(r.lastSeq, 4);
  assert.deepEqual(store.read('s1', 3).map((e) => e.seq), [4]);
});

// ── 构造校验 ─────────────────────────────────────────────────────────────

test('createDelivery · logStore 四方法齐全 + wakeup.emit 必须存在；subscribe 未注入 longPoll = TypeError', () => {
  const { store } = rig();
  expectThrow(() => createDelivery(), TypeError, 'logStore');
  expectThrow(() => createDelivery({ logStore: { append () {} }, wakeup: recordingWakeup() }), TypeError, 'read');
  expectThrow(() => createDelivery({ logStore: store, wakeup: {} }), TypeError, 'emit');
  const d = createDelivery({ logStore: store, wakeup: recordingWakeup() });
  expectThrow(() => d.subscribe('s1', 'g1', {}), TypeError, 'longPoll');
});
