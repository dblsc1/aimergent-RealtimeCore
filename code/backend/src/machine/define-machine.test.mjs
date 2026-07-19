// realtime_core · machine/define-machine.test.mjs（P4）
//
// 覆盖：①运行期 transition/can/assertState 全行为；②定义期全面校验逐条
// （每种非法定义一个用例，断言错误信息含 machine id 与具体位置）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defineMachine, MachineDefinitionError, IllegalTransitionError,
} from './define-machine.js';

// node:assert 的 grab() 返回 undefined；要断言错误字段需自捕获。
function grab (fn, Ctor) {
  try { fn(); } catch (e) {
    assert.ok(e instanceof Ctor, `期望抛 ${Ctor.name}，实际 ${e?.constructor?.name}: ${e?.message}`);
    return e;
  }
  assert.fail(`期望抛 ${Ctor.name}，但未抛出`);
}

// 一台带守卫的样机（词汇照抄任务单示例）。
function sampleMachine () {
  return defineMachine({
    id: 'session-status',
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'asking' } } },
      asking: {
        on: {
          ANSWER: { target: 'awaiting', guard: 'hasQuestion' },
          CLOSE: { target: 'closed' },
        },
      },
      awaiting: { on: { EXTRACTED: { target: 'asking' }, CLOSE: { target: 'closed' } } },
      closed: { type: 'final' },
    },
    guards: { hasQuestion: (ctx) => ctx?.hasQuestion === true },
  });
}

// ─────────────────────────── 运行期行为 ───────────────────────────

test('transition · 合法转移返回 {state, changed}', () => {
  const m = sampleMachine();
  assert.deepEqual(m.transition('idle', 'START'), { state: 'asking', changed: true });
  assert.deepEqual(m.transition('asking', 'CLOSE'), { state: 'closed', changed: true });
});

test('transition · guard 通过则转移，guard 拒绝则响亮 throw（reason=guard-rejected，信息含 id/位置/守卫名）', () => {
  const m = sampleMachine();
  assert.deepEqual(m.transition('asking', 'ANSWER', { hasQuestion: true }), { state: 'awaiting', changed: true });

  const err = grab(() => m.transition('asking', 'ANSWER', { hasQuestion: false }), IllegalTransitionError);
  assert.equal(err.reason, 'guard-rejected');
  assert.equal(err.guard, 'hasQuestion');
  assert.match(err.message, /session-status/);
  assert.match(err.message, /asking/);
  assert.match(err.message, /ANSWER/);
  assert.match(err.message, /hasQuestion/);
});

test('transition · 未知状态响亮 throw（reason=unknown-state，信息含 id 与状态）', () => {
  const m = sampleMachine();
  const err = grab(() => m.transition('nope', 'START'), IllegalTransitionError);
  assert.equal(err.reason, 'unknown-state');
  assert.match(err.message, /session-status/);
  assert.match(err.message, /nope/);
});

test('transition · 该状态无此事件响亮 throw（reason=event-not-handled，信息含状态与事件）', () => {
  const m = sampleMachine();
  const err = grab(() => m.transition('idle', 'CLOSE'), IllegalTransitionError);
  assert.equal(err.reason, 'event-not-handled');
  assert.match(err.message, /idle/);
  assert.match(err.message, /CLOSE/);
});

test('transition · final 状态任何事件均不接受（终态无出边，不可复活）', () => {
  const m = sampleMachine();
  const err = grab(() => m.transition('closed', 'START'), IllegalTransitionError);
  assert.equal(err.reason, 'event-not-handled');
});

test('transition · changed=false 当目标状态等于原状态（自转移）', () => {
  const m = defineMachine({
    id: 'self-loop',
    initial: 'a',
    states: { a: { on: { PING: { target: 'a' } } } },
  });
  assert.deepEqual(m.transition('a', 'PING'), { state: 'a', changed: false });
});

test('can · 合法返回 true、各类非法返回 false 且不抛', () => {
  const m = sampleMachine();
  assert.equal(m.can('idle', 'START'), true);
  assert.equal(m.can('asking', 'ANSWER', { hasQuestion: true }), true);
  assert.equal(m.can('asking', 'ANSWER', { hasQuestion: false }), false); // guard 拒绝
  assert.equal(m.can('idle', 'CLOSE'), false); // 事件未处理
  assert.equal(m.can('nope', 'START'), false); // 未知状态
  assert.equal(m.can('closed', 'START'), false); // 终态
});

test('can · guard 缺 ctx 不抛（守卫是纯谓词，自负处理 undefined）', () => {
  const m = sampleMachine();
  assert.equal(m.can('asking', 'ANSWER'), false);
});

test('guard 抛异常 = 编程错误，原样上抛（库不吞）', () => {
  const m = defineMachine({
    id: 'throwing-guard',
    initial: 'a',
    states: { a: { on: { GO: { target: 'a', guard: 'boom' } } } },
    guards: { boom: () => { throw new RangeError('guard blew up'); } },
  });
  grab(() => m.transition('a', 'GO'), RangeError);
  grab(() => m.can('a', 'GO'), RangeError);
});

test('states / finalStates · 枚举导出且冻结', () => {
  const m = sampleMachine();
  assert.deepEqual([...m.states].sort(), ['asking', 'awaiting', 'closed', 'idle']);
  assert.deepEqual([...m.finalStates], ['closed']);
  assert.equal(Object.isFrozen(m.states), true);
  assert.equal(Object.isFrozen(m.finalStates), true);
  grab(() => { m.states.push('x'); }, TypeError);
});

test('machine 不可变（Object.freeze）', () => {
  const m = sampleMachine();
  assert.equal(Object.isFrozen(m), true);
  grab(() => { m.id = 'hacked'; }, TypeError);
});

test('assertState · 属于全集返回原值、不属于响亮 throw', () => {
  const m = sampleMachine();
  assert.equal(m.assertState('asking'), 'asking');
  const err = grab(() => m.assertState('bogus'), IllegalTransitionError);
  assert.equal(err.reason, 'unknown-state');
  assert.match(err.message, /session-status/);
  assert.match(err.message, /bogus/);
});

// ─────────────────────────── 定义期校验逐条 ───────────────────────────
// 每条断言：抛 MachineDefinitionError、machineId 正确、message 含 id 与位置。

test('定义期 · spec 非对象 → throw', () => {
  grab(() => defineMachine(null), MachineDefinitionError);
  grab(() => defineMachine(42), MachineDefinitionError);
});

test('定义期 · id 非非空字符串 → throw', () => {
  grab(() => defineMachine({ initial: 'a', states: { a: {} } }), MachineDefinitionError);
  grab(() => defineMachine({ id: '', initial: 'a', states: { a: {} } }), MachineDefinitionError);
  grab(() => defineMachine({ id: 123, initial: 'a', states: { a: {} } }), MachineDefinitionError);
});

test('定义期 · spec 顶层未知键 → throw（位置=spec）', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: {} }, context: {} }),
    MachineDefinitionError,
  );
  assert.equal(err.machineId, 'm');
  assert.match(err.message, /context/);
  assert.match(err.message, /spec/);
});

test('定义期 · states 非对象 / 为空 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: null }), MachineDefinitionError);
  grab(() => defineMachine({ id: 'm', initial: 'a', states: [] }), MachineDefinitionError);
  const err = grab(() => defineMachine({ id: 'm', initial: 'a', states: {} }), MachineDefinitionError);
  assert.match(err.message, /states/);
});

test('定义期 · 状态名为空字符串 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { '': {}, a: {} } }), MachineDefinitionError);
});

test('定义期 · initial 非非空字符串 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: '', states: { a: {} } }), MachineDefinitionError);
  grab(() => defineMachine({ id: 'm', states: { a: {} } }), MachineDefinitionError);
});

test('定义期 · initial 不在 states → throw（位置=initial，含 id）', () => {
  const err = grab(
    () => defineMachine({ id: 'sm', initial: 'ghost', states: { a: {} } }),
    MachineDefinitionError,
  );
  assert.equal(err.machineId, 'sm');
  assert.equal(err.where, 'initial');
  assert.match(err.message, /sm/);
  assert.match(err.message, /ghost/);
});

test('定义期 · 状态定义非对象 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: 'nope' } }), MachineDefinitionError);
});

test('定义期 · 状态未知键 → throw', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { onn: {} } } }),
    MachineDefinitionError,
  );
  assert.match(err.message, /onn/);
  assert.match(err.message, /states\.a/);
});

test('定义期 · type 非 final → throw', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { type: 'terminal' } } }),
    MachineDefinitionError,
  );
  assert.match(err.message, /terminal/);
  assert.match(err.message, /states\.a\.type/);
});

test('定义期 · final 状态声明 on → throw（终态无出边）', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: { target: 'b' } } }, b: { type: 'final', on: { X: { target: 'a' } } } } }),
    MachineDefinitionError,
  );
  assert.match(err.message, /final/);
  assert.match(err.message, /states\.b\.on/);
});

test('定义期 · on 非对象 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: { on: 'x' } } }), MachineDefinitionError);
});

test('定义期 · 转移定义非对象 → throw', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: 'b' } } } }),
    MachineDefinitionError,
  );
  assert.match(err.message, /states\.a\.on\.GO/);
});

test('定义期 · 转移未知键 → throw（拼错 gaurd 被照出）', () => {
  const err = grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: { target: 'a', gaurd: 'x' } } } } }),
    MachineDefinitionError,
  );
  assert.match(err.message, /gaurd/);
});

test('定义期 · target 非非空字符串 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: {} } } } }), MachineDefinitionError);
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: { target: '' } } } } }), MachineDefinitionError);
});

test('定义期 · target 指向不存在的状态 → throw（含 id 与位置）', () => {
  const err = grab(
    () => defineMachine({ id: 'flow', initial: 'a', states: { a: { on: { GO: { target: 'nowhere' } } } } }),
    MachineDefinitionError,
  );
  assert.equal(err.machineId, 'flow');
  assert.equal(err.where, 'states.a.on.GO.target');
  assert.match(err.message, /nowhere/);
});

test('定义期 · guard 非字符串 → throw', () => {
  grab(
    () => defineMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: { target: 'a', guard: 123 } } } }, guards: {} }),
    MachineDefinitionError,
  );
});

test('定义期 · guard 引用未定义 → throw（位置=...guard，含 guard 名）', () => {
  const err = grab(
    () => defineMachine({ id: 'g', initial: 'a', states: { a: { on: { GO: { target: 'a', guard: 'missing' } } } } }),
    MachineDefinitionError,
  );
  assert.equal(err.machineId, 'g');
  assert.equal(err.where, 'states.a.on.GO.guard');
  assert.match(err.message, /missing/);
});

test('定义期 · guards 非对象 / guard 非函数 → throw', () => {
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: {} }, guards: 'x' }), MachineDefinitionError);
  grab(() => defineMachine({ id: 'm', initial: 'a', states: { a: {} }, guards: { g: 'notfn' } }), MachineDefinitionError);
});

test('定义期 · 合法最小定义（无 on / 无 guards）通过', () => {
  const m = defineMachine({ id: 'min', initial: 'only', states: { only: {} } });
  assert.deepEqual([...m.states], ['only']);
  assert.deepEqual([...m.finalStates], []);
});
