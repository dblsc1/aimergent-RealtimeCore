// realtime_core · session/aggregate-runtime.test.mjs（P3b）
//
// createAggregateRuntime 的确定性单元测试：execute（成功/拒绝/no-op）、load
// （快照 present/absent/behind 三形态）、快照滚动、append 复用 delivery（wakeup
// emit）、CAS 响亮冲突、锁串行。领域无关的 "counter" 聚合。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAggregate, reject } from './aggregate.js';
import { createMemoryLogStore } from './memory-log-store.js';
import { createMemorySnapshotStore } from './memory-snapshot-store.js';
import { createAggregateRuntime } from './aggregate-runtime.js';
import { withLock } from '../concurrency/locks.js';

function fixedCtx () {
  let now = 0; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

function counter () {
  return defineAggregate({
    name: 'counter',
    initial: () => ({ value: 0, count: 0, stopped: false }),
    decide: {
      inc: (s, cmd) => (s.stopped ? reject('stopped') : [{ type: 'incremented', payload: { by: cmd.by ?? 1 } }]),
      stop: (s) => (s.stopped ? reject('already-stopped') : [{ type: 'stopped-evt', payload: {} }]),
      noop: () => [],
    },
    evolve: {
      incremented: (s, ev) => ({ ...s, value: s.value + ev.payload.by, count: s.count + 1 }),
      'stopped-evt': (s) => ({ ...s, stopped: true }),
    },
  });
}

function rig (opts = {}) {
  const store = createMemoryLogStore(fixedCtx());
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, ...opts });
  return { store, rt };
}

test('execute · 成功命令返回 { events, state }，日志落盘、状态推进', async () => {
  const { store, rt } = rig();
  const r = await rt.execute('s1', { type: 'inc', by: 4 });
  assert.deepEqual(r.state, { value: 4, count: 1, stopped: false });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'incremented');
  assert.equal(r.events[0].seq, 1);
  assert.equal(r.events[0].v, 1, '库盖当前版本章');
  assert.equal(store.read('s1', 0).length, 1);
});

test('execute · 多次 execute 累积状态、seq 连续', async () => {
  const { store, rt } = rig();
  await rt.execute('s1', { type: 'inc', by: 2 });
  await rt.execute('s1', { type: 'inc', by: 3 });
  const r = await rt.execute('s1', { type: 'inc', by: 1 });
  assert.deepEqual(r.state, { value: 6, count: 3, stopped: false });
  assert.deepEqual(store.read('s1', 0).map((e) => e.seq), [1, 2, 3]);
});

test('execute · 被 reject 的命令返回 { rejected }，且无事件/不动日志/不改状态（拒绝无痕）', async () => {
  const { store, rt } = rig();
  await rt.execute('s1', { type: 'stop' });
  const seqBefore = store.read('s1', 0).length;
  const stateBefore = rt.load('s1');

  const r = await rt.execute('s1', { type: 'inc', by: 9 }); // 已 stopped
  assert.equal(r.events, undefined);
  assert.deepEqual(r.rejected, { code: 'stopped', detail: undefined });
  assert.equal(store.read('s1', 0).length, seqBefore, 'reject 不写日志');
  assert.deepEqual(rt.load('s1'), stateBefore, 'reject 不改状态');
});

test('execute · decide 产出空事件 = 合法 no-op（不写日志，返回当前状态）', async () => {
  const { store, rt } = rig();
  await rt.execute('s1', { type: 'inc', by: 5 });
  const r = await rt.execute('s1', { type: 'noop' });
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.state, { value: 5, count: 1, stopped: false });
  assert.equal(store.read('s1', 0).length, 1, 'no-op 不写日志');
});

test('load · 缺快照：从日志全量重放', async () => {
  const { rt } = rig();
  await rt.execute('s1', { type: 'inc', by: 3 });
  await rt.execute('s1', { type: 'inc', by: 7 });
  assert.deepEqual(rt.load('s1'), { value: 10, count: 2, stopped: false });
  assert.deepEqual(rt.load('unknown'), { value: 0, count: 0, stopped: false }, '空流 = initial');
});

test('load · 快照 present（当前）：只取快照不重放尾部', async () => {
  const store = createMemoryLogStore(fixedCtx());
  const snaps = createMemorySnapshotStore();
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, snapshotStore: snaps, snapshotEvery: 2 });
  await rt.execute('s1', { type: 'inc', by: 1 });
  await rt.execute('s1', { type: 'inc', by: 1 }); // seq=2，跨边界 → 落快照
  const snap = snaps.get('s1');
  assert.equal(snap.lastSeq, 2);
  assert.deepEqual(snap.state, { value: 2, count: 2, stopped: false });
  // load 用快照（lastSeq=2）+ 尾部（空）。
  assert.deepEqual(rt.load('s1'), { value: 2, count: 2, stopped: false });
});

test('load · 快照 behind（落后）：快照 + 尾部重放追上', async () => {
  const store = createMemoryLogStore(fixedCtx());
  const snaps = createMemorySnapshotStore();
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, snapshotStore: snaps, snapshotEvery: 2 });
  await rt.execute('s1', { type: 'inc', by: 1 });
  await rt.execute('s1', { type: 'inc', by: 1 }); // 快照 @ seq2, value2
  await rt.execute('s1', { type: 'inc', by: 5 }); // seq3，未跨新边界，快照仍 @2
  assert.equal(snaps.get('s1').lastSeq, 2, '快照落后于日志');
  assert.deepEqual(rt.load('s1'), { value: 7, count: 3, stopped: false }, '快照 + 尾部 seq3 追上');
});

test('快照滚动 · snapshotEvery 边界处落快照（确定性，只看 seq）', async () => {
  const store = createMemoryLogStore(fixedCtx());
  const snaps = createMemorySnapshotStore();
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, snapshotStore: snaps, snapshotEvery: 3 });
  await rt.execute('s1', { type: 'inc', by: 1 });
  assert.equal(snaps.get('s1'), undefined, 'seq1 未跨边界');
  await rt.execute('s1', { type: 'inc', by: 1 });
  assert.equal(snaps.get('s1'), undefined, 'seq2 未跨边界');
  await rt.execute('s1', { type: 'inc', by: 1 });
  assert.equal(snaps.get('s1').lastSeq, 3, 'seq3 跨 [0,3) → [3,6) 边界，落快照');
});

test('execute · append 复用 delivery：注入 wakeup 时 emit(streamId, "appended")', async () => {
  const emitted = [];
  const wakeup = { emit: (pollKey, kinds) => emitted.push([pollKey, kinds]), subscribe: () => () => {} };
  const store = createMemoryLogStore(fixedCtx());
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, wakeup });
  await rt.execute('s1', { type: 'inc', by: 1 });
  assert.deepEqual(emitted, [['s1', 'appended']], 'append 后经 delivery 发唤醒');
});

test('execute · 锁串行：并发 execute 同一 stream 结果等价于串行、零 CAS 冲突', async () => {
  const store = createMemoryLogStore(fixedCtx());
  const rt = createAggregateRuntime({ aggregate: counter(), logStore: store, locks: { withLock } });
  // 不逐个 await：同时发起 20 个 inc。锁把它们串起来。
  const results = await Promise.all(
    Array.from({ length: 20 }, () => rt.execute('s1', { type: 'inc', by: 1 })),
  );
  // 无一 rejected、无一 throw（若 CAS 冲突会 throw ConflictError 使 Promise.all reject）。
  assert.equal(results.every((r) => r.events && r.events.length === 1), true);
  const seqs = store.read('s1', 0).map((e) => e.seq);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1), 'seq 连续无空洞（无交织写入）');
  assert.equal(rt.load('s1').value, 20);
});

test('createAggregateRuntime · 参数校验', () => {
  const store = createMemoryLogStore(fixedCtx());
  assert.throws(() => createAggregateRuntime({ logStore: store }), TypeError);
  assert.throws(() => createAggregateRuntime({ aggregate: counter() }), TypeError);
  assert.throws(() => createAggregateRuntime({ aggregate: counter(), logStore: store, snapshotEvery: 0 }), TypeError);
  assert.throws(() => createAggregateRuntime({ aggregate: counter(), logStore: store, snapshotStore: { get: () => {} } }), TypeError);
});
