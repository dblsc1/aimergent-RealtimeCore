// realtime_core · session/memory-log-store.test.mjs（P3a）
//
// 内存日志存储的单测：信封分配（seq/at/id/v）、严格校验、CAS、read 语义、
// 游标只前进。fake clock/rng 全注入，零全局非确定性。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLogStore } from './memory-log-store.js';
import { ConflictError } from './errors.js';

function fixedCtx () {
  let now = 1000;
  let n = 0;
  return {
    clock: () => { now += 1; return now; },
    rng: () => { n += 1; return (n % 97) / 97; },
  };
}

function makeStore () {
  const ctx = fixedCtx();
  return createMemoryLogStore(ctx);
}

function expectThrow (fn, ctor, snippet) {
  let caught;
  try { fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected fn() to throw');
  assert.ok(caught instanceof ctor, `expected ${ctor.name}, got ${caught.constructor.name}: ${caught.message}`);
  if (snippet) assert.ok(caught.message.includes(snippet), `message "${caught.message}" should include "${snippet}"`);
}

// ── 信封分配 ─────────────────────────────────────────────────────────────

test('append · seq 流内连续从 1 起，at 来自注入 clock，v 缺省 1，id 自动生成 evt- 格式', () => {
  const store = makeStore();
  const r = store.append('s1', 0, [
    { type: 'noted', payload: { a: 1 } },
    { type: 'noted', payload: { a: 2 } },
  ]);
  assert.equal(r.lastSeq, 2);
  const events = store.read('s1', 0);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.seq), [1, 2]);
  assert.deepEqual(events.map((e) => e.streamId), ['s1', 's1']);
  assert.deepEqual(events.map((e) => e.v), [1, 1]);
  assert.ok(events[0].at > 1000 && events[1].at > events[0].at, 'at 应来自注入 clock 且单调');
  for (const e of events) assert.match(e.id, /^evt-\d+-/);
});

test('append · 调用方自带 v 与 id 原样保留；payload 黑盒（引用原样、不冻结）', () => {
  const store = makeStore();
  const payload = { deep: { x: 1 } };
  store.append('s1', 0, [{ type: 'noted', v: 3, id: 'my-id-1', payload }]);
  const [e] = store.read('s1', 0);
  assert.equal(e.v, 3);
  assert.equal(e.id, 'my-id-1');
  assert.equal(e.payload, payload, 'payload 应为同一引用（库不解释不拷贝）');
  assert.ok(!Object.isFrozen(e.payload), 'payload 不冻结（对库是黑盒）');
});

test('append · 信封冻结：写入后不可变（严格模式下改字段抛 TypeError）', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'noted' }]);
  const [e] = store.read('s1', 0);
  assert.ok(Object.isFrozen(e));
  expectThrow(() => { 'use strict'; e.seq = 99; }, TypeError);
  assert.equal(store.read('s1', 0)[0].seq, 1);
});

test('append · 调用方不可指定框架分配字段（seq/at/streamId），未知键与坏 type/v/id 全部 TypeError 且日志分毫未动', () => {
  const store = makeStore();
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', seq: 5 }]), TypeError, 'seq');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', at: 123 }]), TypeError, 'at');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', streamId: 's2' }]), TypeError, 'streamId');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', extra: 1 }]), TypeError, 'unsupported key');
  expectThrow(() => store.append('s1', 0, [{ type: '' }]), TypeError, 'type');
  expectThrow(() => store.append('s1', 0, [{}]), TypeError, 'type');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', v: 0 }]), TypeError, 'positive integer');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', v: 1.5 }]), TypeError, 'positive integer');
  expectThrow(() => store.append('s1', 0, [{ type: 'noted', id: '' }]), TypeError, 'id');
  expectThrow(() => store.append('s1', 0, []), TypeError, 'non-empty');
  expectThrow(() => store.append('s1', 0, [null]), TypeError);
  // 批内第二个事件非法 ⇒ 整批不落（原子）
  expectThrow(() => store.append('s1', 0, [{ type: 'ok' }, { type: '' }]), TypeError);
  assert.deepEqual(store.read('s1', 0), [], '任何非法 append 后日志都应为空');
});

// ── CAS 乐观并发 ─────────────────────────────────────────────────────────

test('append · CAS：expectedLastSeq 过期 → ConflictError（带 expected/actual/streamId），日志不变', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'noted' }]);
  let caught;
  try { store.append('s1', 0, [{ type: 'noted' }]); } catch (err) { caught = err; }
  assert.ok(caught instanceof ConflictError);
  assert.equal(caught.name, 'ConflictError');
  assert.equal(caught.streamId, 's1');
  assert.equal(caught.expected, 0);
  assert.equal(caught.actual, 1);
  assert.equal(store.read('s1', 0).length, 1);
});

test('append · CAS：同一快照 expectedLastSeq 的两个并发 append，恰好第一个成功、第二个 ConflictError', () => {
  const store = makeStore();
  const snapshot = store.append('s1', 0, [{ type: 'noted' }]).lastSeq; // 1
  const a = store.append('s1', snapshot, [{ type: 'noted', id: 'winner' }]);
  assert.equal(a.lastSeq, 2);
  expectThrow(() => store.append('s1', snapshot, [{ type: 'noted', id: 'loser' }]), ConflictError);
  const ids = store.read('s1', 1).map((e) => e.id);
  assert.deepEqual(ids, ['winner']);
});

// ── read 语义 ────────────────────────────────────────────────────────────

test('read · fromSeqExclusive 语义 + limit；末尾之后/未知流 = []', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'a' }, { type: 'b' }, { type: 'c' }, { type: 'd' }]);
  assert.deepEqual(store.read('s1', 0).map((e) => e.seq), [1, 2, 3, 4]);
  assert.deepEqual(store.read('s1', 2).map((e) => e.seq), [3, 4]);
  assert.deepEqual(store.read('s1', 1, 2).map((e) => e.seq), [2, 3]);
  assert.deepEqual(store.read('s1', 4), []);
  assert.deepEqual(store.read('s1', 99), []);
  assert.deepEqual(store.read('nope', 0), []);
  expectThrow(() => store.read('s1', -1), TypeError);
  expectThrow(() => store.read('s1', 0, 0), TypeError, 'limit');
});

// ── 游标 ─────────────────────────────────────────────────────────────────

test('cursor · 无记录 = 0；前进生效；同 seq 重复 ack 幂等 no-op', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'a' }, { type: 'b' }]);
  assert.equal(store.getCursor('s1', 'g1'), 0);
  store.advanceCursor('s1', 'g1', 1);
  assert.equal(store.getCursor('s1', 'g1'), 1);
  store.advanceCursor('s1', 'g1', 1); // 幂等
  assert.equal(store.getCursor('s1', 'g1'), 1);
  store.advanceCursor('s1', 'g1', 2);
  assert.equal(store.getCursor('s1', 'g1'), 2);
});

test('cursor · 回退 = RangeError；越过日志末尾 = RangeError；游标不动', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'a' }, { type: 'b' }]);
  store.advanceCursor('s1', 'g1', 2);
  expectThrow(() => store.advanceCursor('s1', 'g1', 1), RangeError, 'rollback');
  expectThrow(() => store.advanceCursor('s1', 'g1', 3), RangeError, 'log end');
  expectThrow(() => store.advanceCursor('s1', 'g2', 3), RangeError, 'log end');
  assert.equal(store.getCursor('s1', 'g1'), 2);
  assert.equal(store.getCursor('s1', 'g2'), 0);
});

test('cursor/流 独立性：流各自 seq 记账，(stream, group) 各自一枚游标', () => {
  const store = makeStore();
  store.append('s1', 0, [{ type: 'a' }]);
  store.append('s2', 0, [{ type: 'b' }, { type: 'c' }]);
  assert.deepEqual(store.read('s1', 0).map((e) => e.seq), [1]);
  assert.deepEqual(store.read('s2', 0).map((e) => e.seq), [1, 2]);
  store.advanceCursor('s2', 'g1', 2);
  assert.equal(store.getCursor('s1', 'g1'), 0);
  assert.equal(store.getCursor('s2', 'g1'), 2);
  assert.equal(store.getCursor('s2', 'g2'), 0);
});

// ── 构造与参数校验 ───────────────────────────────────────────────────────

test('createMemoryLogStore · clock/rng 注入缺失 = TypeError（无弱默认值兜底）', () => {
  expectThrow(() => createMemoryLogStore(), TypeError, 'clock');
  expectThrow(() => createMemoryLogStore({ clock: () => 1 }), TypeError, 'rng');
});

test('参数校验 · streamId/group/seq 类型不对全部 TypeError', () => {
  const store = makeStore();
  expectThrow(() => store.append('', 0, [{ type: 'a' }]), TypeError, 'streamId');
  expectThrow(() => store.append('s1', -1, [{ type: 'a' }]), TypeError, 'expectedLastSeq');
  expectThrow(() => store.getCursor('s1', ''), TypeError, 'group');
  expectThrow(() => store.advanceCursor('s1', 'g1', 0), TypeError, 'positive integer');
  expectThrow(() => store.advanceCursor('s1', 'g1', 1.5), TypeError, 'positive integer');
});
