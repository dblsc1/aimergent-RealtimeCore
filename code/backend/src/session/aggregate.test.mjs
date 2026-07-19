// realtime_core · session/aggregate.test.mjs（P3b）
//
// defineAggregate / reject / decide / evolve / upcast 的确定性单元测试。
// 领域无关：用中性的 "counter" 聚合（inc/reset/stop → incremented/reset-done/stopped-evt）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAggregate, reject, isReject } from './aggregate.js';

function counter (overrides = {}) {
  return defineAggregate({
    name: 'counter',
    initial: () => ({ value: 0, count: 0, stopped: false }),
    decide: {
      inc: (state, cmd) => (state.stopped ? reject('stopped') : [{ type: 'incremented', payload: { by: cmd.by ?? 1 } }]),
      reset: (state) => (state.stopped ? reject('stopped', { was: state.value }) : [{ type: 'reset-done', payload: {} }]),
      stop: (state) => (state.stopped ? reject('already-stopped') : [{ type: 'stopped-evt', payload: {} }]),
      noop: () => [],
    },
    evolve: {
      incremented: (state, ev) => ({ ...state, value: state.value + ev.payload.by, count: state.count + 1 }),
      'reset-done': (state) => ({ ...state, value: 0 }),
      'stopped-evt': (state) => ({ ...state, stopped: true }),
    },
    ...overrides,
  });
}

test('reject · 构造结构化拒绝（非 throw），isReject 识别；空 code 抛 TypeError', () => {
  const r = reject('nope', { why: 1 });
  assert.equal(isReject(r), true);
  assert.equal(r.code, 'nope');
  assert.deepEqual(r.detail, { why: 1 });
  assert.equal(Object.isFrozen(r), true);
  assert.equal(isReject([{ type: 'x' }]), false);
  assert.throws(() => reject(''), TypeError);
  assert.throws(() => reject(42), TypeError);
});

test('decideCommand · 合法命令产出事件数组', () => {
  const agg = counter();
  const events = agg.decideCommand(agg.initial(), { type: 'inc', by: 3 });
  assert.deepEqual(events, [{ type: 'incremented', payload: { by: 3 } }]);
});

test('decideCommand · 守卫不满足时返回 reject（携带 code/detail）', () => {
  const agg = counter();
  const stopped = agg.applyEvent(agg.initial(), { type: 'stopped-evt', v: 1, payload: {} });
  const r = agg.decideCommand(stopped, { type: 'reset' });
  assert.equal(isReject(r), true);
  assert.equal(r.code, 'stopped');
  assert.deepEqual(r.detail, { was: 0 });
});

test('decideCommand · 未知命令 = 编程错误 → TypeError（不静默）', () => {
  const agg = counter();
  assert.throws(() => agg.decideCommand(agg.initial(), { type: 'teleport' }), TypeError);
});

test('decideCommand · 命令必须是带 string type 的对象', () => {
  const agg = counter();
  assert.throws(() => agg.decideCommand(agg.initial(), null), TypeError);
  assert.throws(() => agg.decideCommand(agg.initial(), { by: 1 }), TypeError);
});

test('decideCommand · decide 返回非数组非 reject = 编程错误 → TypeError', () => {
  const agg = defineAggregate({
    name: 'bad', initial: () => ({}),
    decide: { x: () => ({ not: 'an array' }) }, evolve: {},
  });
  assert.throws(() => agg.decideCommand({}, { type: 'x' }), TypeError);
});

test('decideCommand · decide 产出的事件必须是带 string type 的对象', () => {
  const agg = defineAggregate({
    name: 'bad', initial: () => ({}),
    decide: { x: () => [{ payload: {} }] }, evolve: {},
  });
  assert.throws(() => agg.decideCommand({}, { type: 'x' }), TypeError);
});

test('decideCommand · decide 可产出空事件数组（合法 no-op）', () => {
  const agg = counter();
  assert.deepEqual(agg.decideCommand(agg.initial(), { type: 'noop' }), []);
});

test('applyEvent · evolve 折叠推进状态', () => {
  const agg = counter();
  let s = agg.initial();
  s = agg.applyEvent(s, { type: 'incremented', v: 1, payload: { by: 2 } });
  s = agg.applyEvent(s, { type: 'incremented', v: 1, payload: { by: 5 } });
  assert.deepEqual(s, { value: 7, count: 2, stopped: false });
});

test('applyEvent · 未知事件类型默认 throw（响亮）', () => {
  const agg = counter();
  assert.throws(() => agg.applyEvent(agg.initial(), { type: 'mystery', v: 1 }), /no evolve handler/);
});

test('applyEvent · onUnknownEvent=ignore 时未知事件跳过（状态不变）', () => {
  const agg = counter({ onUnknownEvent: 'ignore' });
  const s0 = agg.initial();
  const s1 = agg.applyEvent(s0, { type: 'mystery', v: 1 });
  assert.equal(s1, s0);
});

test('currentVersion · eventVersions 声明覆盖，缺省 1', () => {
  const agg = counter({ eventVersions: { incremented: 3 } });
  assert.equal(agg.currentVersion('incremented'), 3);
  assert.equal(agg.currentVersion('reset-done'), 1);
});

test('defineAggregate · 参数校验（name/initial/decide/evolve/schemaVersion）', () => {
  assert.throws(() => defineAggregate({ initial: () => ({}), decide: {}, evolve: {} }), TypeError);
  assert.throws(() => defineAggregate({ name: 'x', decide: {}, evolve: {} }), TypeError);
  assert.throws(() => defineAggregate({ name: 'x', initial: () => ({}), decide: { a: 1 }, evolve: {} }), TypeError);
  assert.throws(() => defineAggregate({ name: 'x', initial: () => ({}), decide: {}, evolve: {}, onUnknownEvent: 'maybe' }), TypeError);
  assert.throws(() => defineAggregate({ name: 'x', initial: () => ({}), decide: {}, evolve: {}, schemaVersion: 0 }), TypeError);
  assert.throws(() => defineAggregate({ name: 'x', initial: () => ({}), decide: {}, evolve: {}, eventVersions: { e: 0 } }), TypeError);
});

test('defineAggregate · 返回的描述对象被冻结（纯描述，无可变状态）', () => {
  const agg = counter();
  assert.equal(Object.isFrozen(agg), true);
});
