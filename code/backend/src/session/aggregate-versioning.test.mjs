// realtime_core · session/aggregate-versioning.test.mjs（P3b · 验收重点）
//
// 事件版本化演进的核心验收：构造"schema 演进"场景——用 v1 事件写满日志 → 模拟
// 代码升级（事件类型加字段、当前版本升为 2、注册 upcaster）→ 重放旧日志：状态
// 正确、不变量成立；同流混合 v1/v2 重放正确；v1→v2→v3 级联；缺 upcaster 响亮
// 失败；事件来自未来（v > 当前）响亮失败。
//
// 场景：counter 聚合的 `incremented` 事件演进——
//   v1 payload = { by }                （单纯加 by）
//   v2 payload = { by, weight }         （加权：value += by * weight）
//   upcaster v1→v2：weight 缺省 1（旧事件语义 = 加 by*1，与 v1 逐字等价）
//   v3 payload = { by, weight, sign }   （带符号：value += by * weight * sign）
//   upcaster v2→v3：sign 缺省 +1

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAggregate } from './aggregate.js';
import { createMemoryLogStore } from './memory-log-store.js';
import { createMemorySnapshotStore } from './memory-snapshot-store.js';
import { createAggregateRuntime } from './aggregate-runtime.js';
import { upcastEvent } from './upcaster.js';

function fixedCtx () {
  let now = 0; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

// ── v1 聚合（当前版本 = 1）─────────────────────────────────────────────────
function counterV1 () {
  return defineAggregate({
    name: 'counter',
    initial: () => ({ value: 0 }),
    decide: { inc: (_s, cmd) => [{ type: 'incremented', payload: { by: cmd.by } }] },
    evolve: { incremented: (s, ev) => ({ value: s.value + ev.payload.by }) },
    // eventVersions 缺省 => incremented 当前版本 = 1
  });
}

// ── v2 聚合（当前版本 = 2；evolve 读 weight；注册 v1→v2 upcaster）──────────
function counterV2 () {
  return defineAggregate({
    name: 'counter',
    schemaVersion: 2,
    initial: () => ({ value: 0 }),
    decide: { inc: (_s, cmd) => [{ type: 'incremented', payload: { by: cmd.by, weight: cmd.weight ?? 1 } }] },
    evolve: { incremented: (s, ev) => ({ value: s.value + ev.payload.by * ev.payload.weight }) },
    eventVersions: { incremented: 2 },
    upcasters: {
      incremented: { 1: (ev) => ({ ...ev, payload: { ...ev.payload, weight: 1 } }) },
    },
  });
}

// ── v3 聚合（当前版本 = 3；带 sign；v1→v2→v3 级联）─────────────────────────
function counterV3 () {
  return defineAggregate({
    name: 'counter',
    schemaVersion: 3,
    initial: () => ({ value: 0 }),
    decide: { inc: (_s, cmd) => [{ type: 'incremented', payload: { by: cmd.by, weight: cmd.weight ?? 1, sign: cmd.sign ?? 1 } }] },
    evolve: { incremented: (s, ev) => ({ value: s.value + ev.payload.by * ev.payload.weight * ev.payload.sign }) },
    eventVersions: { incremented: 3 },
    upcasters: {
      incremented: {
        1: (ev) => ({ ...ev, payload: { ...ev.payload, weight: 1 } }),
        2: (ev) => ({ ...ev, payload: { ...ev.payload, sign: 1 } }),
      },
    },
  });
}

test('版本化① · v1 日志 → 代码升级到 v2 → 重放：状态正确（旧事件按 weight=1 折叠）', async () => {
  const store = createMemoryLogStore(fixedCtx());
  // 用 v1 聚合写满日志（落盘信封 v=1）。
  const rtV1 = createAggregateRuntime({ aggregate: counterV1(), logStore: store });
  await rtV1.execute('s1', { type: 'inc', by: 3 });
  await rtV1.execute('s1', { type: 'inc', by: 5 });
  assert.deepEqual(store.read('s1', 0).map((e) => e.v), [1, 1], '日志里是 v1 事件');

  // 代码升级：换 v2 聚合（同一个 logStore），重放旧日志。
  const rtV2 = createAggregateRuntime({ aggregate: counterV2(), logStore: store });
  const state = rtV2.load('s1');
  assert.deepEqual(state, { value: 8 }, 'v1 事件经 upcaster 补 weight=1，加权后 3*1+5*1=8');
});

test('版本化② · 同流混合 v1/v2 事件重放正确', async () => {
  const store = createMemoryLogStore(fixedCtx());
  // 先用 v1 写两条（v=1）。
  const rtV1 = createAggregateRuntime({ aggregate: counterV1(), logStore: store });
  await rtV1.execute('s1', { type: 'inc', by: 10 });
  // 再用 v2 追加两条（v=2，含 weight）。
  const rtV2 = createAggregateRuntime({ aggregate: counterV2(), logStore: store });
  await rtV2.execute('s1', { type: 'inc', by: 4, weight: 3 }); // +12
  await rtV2.execute('s1', { type: 'inc', by: 2, weight: 5 }); // +10
  assert.deepEqual(store.read('s1', 0).map((e) => e.v), [1, 2, 2], '混合版本落盘');

  const state = rtV2.load('s1');
  // v1(by=10 → weight 补 1 → +10) + v2(+12) + v2(+10) = 32
  assert.deepEqual(state, { value: 32 }, '混合 v1/v2 重放：旧事件 upcast、新事件原样');
});

test('版本化③ · v1→v2→v3 级联升级：旧 v1 事件逐级升到 v3', () => {
  const agg = counterV3();
  const v1Event = { streamId: 's1', seq: 1, id: 'e1', type: 'incremented', v: 1, at: 1, payload: { by: 7 } };
  const upgraded = agg.upcast(v1Event);
  assert.equal(upgraded.v, 3, 'v1 逐级升到当前版本 v3');
  assert.deepEqual(upgraded.payload, { by: 7, weight: 1, sign: 1 }, 'weight 与 sign 逐级补齐');
  // 折叠：7 * 1 * 1 = 7
  assert.deepEqual(agg.applyEvent(agg.initial(), v1Event), { value: 7 });
});

test('版本化④ · decide/evolve 只见当前版本事件（不变量 3 的直接断言）', () => {
  const seenVersions = [];
  const spyAgg = defineAggregate({
    name: 'counter', schemaVersion: 3,
    initial: () => ({ value: 0 }),
    decide: { inc: () => [] },
    evolve: { incremented: (s, ev) => { seenVersions.push(ev.v); return s; } },
    eventVersions: { incremented: 3 },
    upcasters: {
      incremented: {
        1: (ev) => ({ ...ev, payload: { ...ev.payload, weight: 1 } }),
        2: (ev) => ({ ...ev, payload: { ...ev.payload, sign: 1 } }),
      },
    },
  });
  spyAgg.applyEvent({ value: 0 }, { type: 'incremented', v: 1, payload: { by: 1 } });
  spyAgg.applyEvent({ value: 0 }, { type: 'incremented', v: 2, payload: { by: 1, weight: 1 } });
  spyAgg.applyEvent({ value: 0 }, { type: 'incremented', v: 3, payload: { by: 1, weight: 1, sign: 1 } });
  assert.deepEqual(seenVersions, [3, 3, 3], 'evolve 收到的每个事件 v 恒 === 当前版本 3');
});

test('版本化⑤ · 缺 upcaster 遇旧版本 = 响亮 throw（禁静默）', () => {
  // 当前版本 2，但没注册 v1→v2 upcaster。
  const agg = defineAggregate({
    name: 'counter', schemaVersion: 2,
    initial: () => ({ value: 0 }),
    decide: { inc: (_s, cmd) => [{ type: 'incremented', payload: { by: cmd.by, weight: 1 } }] },
    evolve: { incremented: (s, ev) => ({ value: s.value + ev.payload.by * ev.payload.weight }) },
    eventVersions: { incremented: 2 },
    // upcasters 缺失！
  });
  assert.throws(
    () => agg.applyEvent(agg.initial(), { type: 'incremented', v: 1, payload: { by: 3 } }),
    /no upcaster for event "incremented" v1→v2/,
  );
});

test('版本化⑥ · 事件来自未来（v > 当前版本）= 响亮 throw（回滚到旧代码读新日志）', () => {
  const agg = counterV1(); // 当前版本 1
  assert.throws(
    () => agg.applyEvent(agg.initial(), { type: 'incremented', v: 2, payload: { by: 1, weight: 1 } }),
    /refusing to downgrade an event from a newer code version/,
  );
});

test('版本化⑦ · upcastEvent 直接单元：升级函数返回非对象 = TypeError', () => {
  assert.throws(
    () => upcastEvent(
      { type: 'x', v: 1 },
      { upcasters: { x: { 1: () => null } }, currentVersion: () => 2 },
    ),
    TypeError,
  );
});

test('版本化⑧ · 库强制递增版本号：即便 upcaster 忘了 bump v，也不死循环', () => {
  // upcaster 返回的对象里 v 仍是 1（忘了 bump）——库负责盖 v=2 章。
  const upgraded = upcastEvent(
    { type: 'x', v: 1, payload: { a: 1 } },
    { upcasters: { x: { 1: (ev) => ({ ...ev, payload: { a: ev.payload.a, b: 2 } }) } }, currentVersion: () => 2 },
  );
  assert.equal(upgraded.v, 2, '库强制盖 v=2');
  assert.deepEqual(upgraded.payload, { a: 1, b: 2 });
});

test('版本化⑨ · 快照 schema 不匹配 → 丢弃快照、从日志全量重建', async () => {
  const store = createMemoryLogStore(fixedCtx());
  const snaps = createMemorySnapshotStore();
  // v1 写日志 + 每 2 事件落快照。
  const rtV1 = createAggregateRuntime({ aggregate: counterV1(), logStore: store, snapshotStore: snaps, snapshotEvery: 2 });
  await rtV1.execute('s1', { type: 'inc', by: 3 });
  await rtV1.execute('s1', { type: 'inc', by: 5 }); // 落 v1 快照 {value:8, schemaVersion:1}
  assert.deepEqual(snaps.get('s1').state, { value: 8 });
  assert.equal(snaps.get('s1').aggregateSchemaVersion, 1);

  // 升级到 v2（schemaVersion 2）：旧快照 schemaVersion=1 不匹配 → 丢弃，从日志全量 upcast 重建。
  const rtV2 = createAggregateRuntime({ aggregate: counterV2(), logStore: store, snapshotStore: snaps, snapshotEvery: 2 });
  const state = rtV2.load('s1');
  assert.deepEqual(state, { value: 8 }, '丢弃 v1 快照后从日志重建：3*1+5*1=8（若误用旧快照也是 8，但路径是全量重放）');

  // 证明确实没用旧快照：污染快照 state 到错值，仍能重建正确（因 schema 不匹配被丢弃）。
  snaps.put('s1', { state: { value: 9999 }, lastSeq: 2, aggregateSchemaVersion: 1 });
  assert.deepEqual(rtV2.load('s1'), { value: 8 }, 'schema 不匹配的脏快照被丢弃，重建仍正确');
});
