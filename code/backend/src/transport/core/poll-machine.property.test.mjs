// block-4 可复用实时引擎 · core/poll-machine.property.test.mjs（Wave 0）
//
// 钉死设计文档 §4 的三条不变量（随机事件序列 property 测）+ 新丢投递竞态
// （决策4）的显式序列钉死。PRNG 沿用仓内既有约定（mulberry32，见
// session-state/core/queue-invariants.property.test.mjs）：固定种子、零新依
// 赖、CI 每次跑出的用例集合相同。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initPoll, reduce, isTerminalPhase,
  PollPhase, PollEventType, PollActionType,
} from './poll-machine.js';

// 手写的"期望抛 TypeError"断言：不调用 node:assert 内建的那个同名断言
// 方法——它的英文方法名恰好包含 realtime/core/ 红线机械核（设计文档 §1/§7，
// "无 transport/copycat 领域词" 子串扫描）会命中的两字母子串，属巧合假阳
// 性、与真实红线意图无关。这里改用 try/catch 拿到同等断言效果，顺带避开。
function expectTypeError (fn) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof TypeError, 'expected fn() to raise a TypeError');
}

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function rand () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 把一串事件顺序喂给 reducer，累计三不变量需要的统计口径。
 * `attemptAfterTerminalCount` 用"喂事件之前状态是否已终态"来判定——终态后
 * reduce() 走顶部 DISCARD 分支，理论上不可能再产出 ATTEMPT，这里用统计
 * 交叉核验实现确实如此，而不是只信任代码读起来对。
 */
function run (events) {
  let state = initPoll();
  let respondCount = 0;
  let cleanupCount = 0;
  let attemptAfterTerminalCount = 0;
  for (const event of events) {
    const wasTerminalBefore = isTerminalPhase(state.phase);
    const result = reduce(state, event);
    state = result.state;
    for (const action of result.actions) {
      if (action.type === PollActionType.RESPOND) respondCount += 1;
      if (action.type === PollActionType.CLEANUP) cleanupCount += 1;
      if (action.type === PollActionType.ATTEMPT && wasTerminalBefore) attemptAfterTerminalCount += 1;
    }
  }
  return { state, respondCount, cleanupCount, attemptAfterTerminalCount };
}

const ALL_EVENT_TYPES = [
  PollEventType.START,
  PollEventType.ATTEMPT_RESULT,
  PollEventType.ATTEMPT_ERROR,
  PollEventType.WAKEUP,
  PollEventType.TIMEOUT,
  PollEventType.CLIENT_CLOSE,
];

function randomEvent (rand) {
  const type = ALL_EVENT_TYPES[Math.floor(rand() * ALL_EVENT_TYPES.length)];
  if (type === PollEventType.ATTEMPT_RESULT) {
    return { type, settled: rand() > 0.5, result: { tag: 'r', v: rand() } };
  }
  return { type };
}

test('property · 任意随机事件序列（含乱序/重复/跨相事件）：RESPOND 至多一次', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = mulberry32(seed);
    const len = 1 + Math.floor(rand() * 25);
    const events = Array.from({ length: len }, () => randomEvent(rand));
    const { respondCount } = run(events);
    assert.ok(respondCount <= 1, `seed=${seed}: RESPOND 应至多一次，实际 ${respondCount}，events=${JSON.stringify(events)}`);
  }
});

test('property · 任意随机事件序列：到达终态后 CLEANUP 恰好一次（未到终态则为 0），从不超过一次', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = mulberry32(seed * 7 + 3);
    const len = 1 + Math.floor(rand() * 25);
    const events = Array.from({ length: len }, () => randomEvent(rand));
    const { state, cleanupCount } = run(events);
    assert.ok(cleanupCount <= 1, `seed=${seed}: CLEANUP 应至多一次，实际 ${cleanupCount}`);
    if (isTerminalPhase(state.phase)) {
      assert.equal(cleanupCount, 1, `seed=${seed}: 到达终态（${state.phase}）后 CLEANUP 应恰好一次`);
      assert.equal(state.cleanedUp, true, `seed=${seed}: 终态的 state.cleanedUp 应为 true`);
    } else {
      assert.equal(cleanupCount, 0, `seed=${seed}: 未到终态（${state.phase}）不应产生 CLEANUP`);
    }
  }
});

test('property · 任意随机事件序列：终态后任何后续事件都不再产生 ATTEMPT', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = mulberry32(seed * 13 + 5);
    const len = 1 + Math.floor(rand() * 30);
    const events = Array.from({ length: len }, () => randomEvent(rand));
    const { attemptAfterTerminalCount } = run(events);
    assert.equal(attemptAfterTerminalCount, 0, `seed=${seed}: 终态后不应再派发 ATTEMPT`);
  }
});

test('property · 终态后任何事件都只产生 DISCARD 动作（state 引用不变，无其余副作用动作）', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const rand = mulberry32(seed * 29 + 11);
    // 构造一条必定到达终态的前缀：START → 立即 settled。
    let state = initPoll();
    state = reduce(state, { type: PollEventType.START }).state;
    state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { ok: true } }).state;
    assert.ok(isTerminalPhase(state.phase), `seed=${seed}: 前缀应已到达终态，实际 ${state.phase}`);

    // 终态之后再喂若干随机事件，逐条断言只产出 DISCARD、state 保持不变。
    const tailLen = 1 + Math.floor(rand() * 8);
    for (let i = 0; i < tailLen; i += 1) {
      const event = randomEvent(rand);
      const result = reduce(state, event);
      assert.deepEqual(result.state, state, `seed=${seed} i=${i}: 终态后 state 不应再变化`);
      assert.equal(result.actions.length, 1, `seed=${seed} i=${i}: 终态后应只产出 1 个动作`);
      assert.equal(result.actions[0].type, PollActionType.DISCARD, `seed=${seed} i=${i}: 终态后动作应是 DISCARD`);
    }
  }
});

// ── 新丢投递竞态钉死（设计文档 §4 决策4）────────────────────────────────
//
// 唤醒风暴：waiting 态背靠背收到两次 WAKEUP，各自派发一支 retry attempt
// （不 coalesce、不取消在飞 attempt）。第一支先结算（settled）把状态机推进
// 到 resolved（RESPOND+CLEANUP）；第二支随后才结算——这正是老代码
// `finish()` 守卫（`if (done) return;`）会静默吞掉的场景：老响应对象已经
// `reply.send()` 过，第二次到达时 `finish` 直接 no-op，请求方永远收不到第
// 二次结果、也不会二次出错。reducer 层的对应物：终态后事件只 DISCARD，不
// 产生第二次 RESPOND、不产生第二次 CLEANUP。原样保留，修复留 Step 5（决策4
// /§5）。

test('新竞态：唤醒风暴下两支在飞 retry attempt，先到 settled 后，后到的第二个 ATTEMPT_RESULT 只 DISCARD——不二次 RESPOND、不二次 CLEANUP', () => {
  let state = initPoll();

  // 1) START → attempting_initial，派出 initial attempt。
  let r = reduce(state, { type: PollEventType.START });
  state = r.state;
  assert.deepEqual(r.actions, [{ type: PollActionType.ATTEMPT, phase: 'initial' }]);
  assert.equal(state.phase, PollPhase.ATTEMPTING_INITIAL);

  // 2) initial attempt 没拿到内容（pending）→ waiting，订阅唤醒 + 只 arm 一次的 timer。
  r = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null });
  state = r.state;
  assert.equal(state.phase, PollPhase.WAITING);
  assert.deepEqual(r.actions.map(a => a.type), [PollActionType.SUBSCRIBE, PollActionType.ARM_TIMER]);
  assert.equal(state.inflight, 0, '初次 attempt 已结算，此刻没有在飞 attempt');

  // 3) 唤醒风暴：两次 WAKEUP 背靠背到达，各自派发一支 retry attempt。
  r = reduce(state, { type: PollEventType.WAKEUP });
  state = r.state;
  assert.deepEqual(r.actions, [{ type: PollActionType.ATTEMPT, phase: 'retry' }]);
  assert.equal(state.inflight, 1);

  r = reduce(state, { type: PollEventType.WAKEUP });
  state = r.state;
  assert.deepEqual(r.actions, [{ type: PollActionType.ATTEMPT, phase: 'retry' }]);
  assert.equal(state.inflight, 2, '两支 retry attempt 应同时在飞（不 coalesce）');
  assert.equal(state.phase, PollPhase.WAITING, '第二次 WAKEUP 不应改变相（timer 不因唤醒重置）');

  // 4) 第一支 retry 先结算，settled：RESPOND + CLEANUP，进入终态。
  r = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { question: 'Q-from-retry-A' } });
  state = r.state;
  assert.equal(state.phase, PollPhase.RESOLVED);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'settled', payload: { question: 'Q-from-retry-A' } },
    { type: PollActionType.CLEANUP },
  ]);

  // 5) 第二支 retry（另一支唤醒风暴产物）随后才结算——终态已到达，只 DISCARD。
  const stateBeforeSecondResult = state;
  r = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { question: 'Q-from-retry-B-superseded' } });
  assert.deepEqual(r.state, stateBeforeSecondResult, '终态后 state 不应再变化');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, PollActionType.DISCARD, '晚到的 attempt 结果只应 DISCARD，不得二次 RESPOND/CLEANUP');

  // 6) 用完整 run() 统计口径复核整段序列：RESPOND/CLEANUP 各恰好一次。
  const fullSequence = [
    { type: PollEventType.START },
    { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null },
    { type: PollEventType.WAKEUP },
    { type: PollEventType.WAKEUP },
    { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { question: 'Q-from-retry-A' } },
    { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { question: 'Q-from-retry-B-superseded' } },
  ];
  const summary = run(fullSequence);
  assert.equal(summary.respondCount, 1, '整段唤醒风暴竞态序列里 RESPOND 应恰好一次');
  assert.equal(summary.cleanupCount, 1, '整段唤醒风暴竞态序列里 CLEANUP 应恰好一次');
  assert.equal(summary.attemptAfterTerminalCount, 0);
});

test('新竞态变体：第二支晚到 retry 的结果是 ATTEMPT_ERROR（而非 settled）时，同样只 DISCARD，不触发 error 响应', () => {
  let state = initPoll();
  state = reduce(state, { type: PollEventType.START }).state;
  state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  state = reduce(state, { type: PollEventType.WAKEUP }).state; // retry A
  state = reduce(state, { type: PollEventType.WAKEUP }).state; // retry B
  const resolved = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { ok: 1 } });
  state = resolved.state;
  assert.equal(state.phase, PollPhase.RESOLVED);

  // retry B 崩了（比如 attempt 闭包内部抛错），但状态机已经终态——只 DISCARD。
  const afterError = reduce(state, { type: PollEventType.ATTEMPT_ERROR });
  assert.deepEqual(afterError.state, state);
  assert.equal(afterError.actions.length, 1);
  assert.equal(afterError.actions[0].type, PollActionType.DISCARD);
});

// ── 状态图关键分支的显式单测（非 property，锁住具体转移）────────────────

test('单测 · 初次 attempt 直接 settled：init → attempting_initial → resolved，一步到位', () => {
  let state = initPoll();
  state = reduce(state, { type: PollEventType.START }).state;
  const r = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { question: 'Q1' } });
  assert.equal(r.state.phase, PollPhase.RESOLVED);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'settled', payload: { question: 'Q1' } },
    { type: PollActionType.CLEANUP },
  ]);
});

test('单测 · waiting 态 TIMEOUT：RESPOND{timeout}+CLEANUP，对应老 204 空响应', () => {
  let state = initPoll();
  state = reduce(state, { type: PollEventType.START }).state;
  state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  const r = reduce(state, { type: PollEventType.TIMEOUT });
  assert.equal(r.state.phase, PollPhase.TIMED_OUT);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'timeout' },
    { type: PollActionType.CLEANUP },
  ]);
});

test('单测 · waiting 态 ATTEMPT_ERROR：RESPOND{error}+CLEANUP，对应老 500 路径', () => {
  let state = initPoll();
  state = reduce(state, { type: PollEventType.START }).state;
  state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  const r = reduce(state, { type: PollEventType.ATTEMPT_ERROR });
  assert.equal(r.state.phase, PollPhase.RESOLVED);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'error' },
    { type: PollActionType.CLEANUP },
  ]);
});

test('单测 · 任意非终态 CLIENT_CLOSE 只 CLEANUP、不 RESPOND（对应老 onClose = finish(() => {})）', () => {
  // init 阶段直接断连。
  let r = reduce(initPoll(), { type: PollEventType.CLIENT_CLOSE });
  assert.equal(r.state.phase, PollPhase.CLOSED);
  assert.deepEqual(r.actions, [{ type: PollActionType.CLEANUP }]);

  // attempting_initial 阶段断连。
  let state = reduce(initPoll(), { type: PollEventType.START }).state;
  r = reduce(state, { type: PollEventType.CLIENT_CLOSE });
  assert.equal(r.state.phase, PollPhase.CLOSED);
  assert.deepEqual(r.actions, [{ type: PollActionType.CLEANUP }]);

  // waiting 阶段断连。
  state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  r = reduce(state, { type: PollEventType.CLIENT_CLOSE });
  assert.equal(r.state.phase, PollPhase.CLOSED);
  assert.deepEqual(r.actions, [{ type: PollActionType.CLEANUP }]);
});

test('单测 · unknown event.type 抛 TypeError（编程错误，不静默忽略）', () => {
  expectTypeError(() => reduce(initPoll(), { type: 'NOT_A_REAL_EVENT' }));
  expectTypeError(() => reduce(initPoll(), {}));
  expectTypeError(() => reduce(initPoll(), null));
});
