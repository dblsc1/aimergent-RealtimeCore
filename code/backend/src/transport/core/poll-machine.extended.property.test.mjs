// block-4 可复用实时引擎 · core/poll-machine.extended.property.test.mjs（P2）
//
// 钉死 P2 新增的三条不变量（随机事件序列 property 测），覆盖 SUPERSEDE 顶替、
// interval 形态的 POLL_TICK/DISARM_INTERVAL、以及终态后新事件（POLL_TICK/
// SUPERSEDE）不再派发 ATTEMPT。P1 既有 property 测（poll-machine.property.test.mjs）
// 一行不动、继续守 wakeup 形态的旧不变量；本文件只加新词汇的新不变量。
//
// PRNG 沿用仓内既有约定（mulberry32，固定种子、零新依赖、CI 每次跑出相同用例集）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initPoll, reduce, isTerminalPhase,
  PollPhase, PollMode, PollEventType, PollActionType,
} from './poll-machine.js';

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function rand () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 全事件表（含 P2 新词汇），供随机序列使用。
const ALL_EVENT_TYPES = [
  PollEventType.START,
  PollEventType.ATTEMPT_RESULT,
  PollEventType.ATTEMPT_ERROR,
  PollEventType.WAKEUP,
  PollEventType.POLL_TICK,
  PollEventType.SUPERSEDE,
  PollEventType.TIMEOUT,
  PollEventType.CLIENT_CLOSE,
];

function randomEvent (rand) {
  const type = ALL_EVENT_TYPES[Math.floor(rand() * ALL_EVENT_TYPES.length)];
  if (type === PollEventType.ATTEMPT_RESULT) {
    // 偶尔携带 block-9 领域结局标签，交叉核 outcome 透传不破坏不变量计数。
    if (rand() > 0.66) return { type, settled: true, outcome: 'delivered', result: { body: rand() } };
    if (rand() > 0.5) return { type, settled: true, outcome: 'not_found', result: undefined };
    return { type, settled: rand() > 0.5, result: { tag: 'r', v: rand() } };
  }
  return { type };
}

/**
 * 把一串事件喂给 reducer，累计不变量需要的统计口径。`config` 决定初始形态
 * （wakeup / interval）。
 */
function run (events, config) {
  let state = initPoll(config);
  let respondCount = 0;
  let supersededRespondCount = 0;
  let cleanupCount = 0;
  let disarmIntervalCount = 0;
  let attemptAfterTerminalCount = 0;
  for (const event of events) {
    const wasTerminalBefore = isTerminalPhase(state.phase);
    const result = reduce(state, event);
    state = result.state;
    for (const action of result.actions) {
      if (action.type === PollActionType.RESPOND) {
        respondCount += 1;
        if (action.outcome === 'superseded') supersededRespondCount += 1;
      }
      if (action.type === PollActionType.CLEANUP) cleanupCount += 1;
      if (action.type === PollActionType.DISARM_INTERVAL) disarmIntervalCount += 1;
      if (action.type === PollActionType.ATTEMPT && wasTerminalBefore) attemptAfterTerminalCount += 1;
    }
  }
  return { state, respondCount, supersededRespondCount, cleanupCount, disarmIntervalCount, attemptAfterTerminalCount };
}

// ── 不变量①：SUPERSEDE 打进非终态 → 旧实例恰好 RESPOND 一次且 outcome=superseded ──
//
// 显式钉死（wakeup 与 interval 各一支非终态前缀），再叠随机序列的统计交叉核。

test('不变量① · SUPERSEDE 打进非终态：恰好一次 RESPOND{superseded} + 进入 superseded 终态', () => {
  // wakeup waiting 态被顶替。
  let s = initPoll();
  s = reduce(s, { type: PollEventType.START }).state;
  s = reduce(s, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  assert.equal(s.phase, PollPhase.WAITING);
  let r = reduce(s, { type: PollEventType.SUPERSEDE });
  assert.equal(r.state.phase, PollPhase.SUPERSEDED);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'superseded' },
    { type: PollActionType.CLEANUP },
  ], 'wakeup 形态顶替：RESPOND{superseded} + CLEANUP（无 interval 可拆）');

  // interval waiting 态被顶替：teardown 必含 DISARM_INTERVAL。
  let t = initPoll({ mode: PollMode.INTERVAL });
  t = reduce(t, { type: PollEventType.START }).state;
  assert.equal(t.phase, PollPhase.WAITING);
  r = reduce(t, { type: PollEventType.SUPERSEDE });
  assert.equal(r.state.phase, PollPhase.SUPERSEDED);
  assert.deepEqual(r.actions, [
    { type: PollActionType.RESPOND, outcome: 'superseded' },
    { type: PollActionType.DISARM_INTERVAL },
    { type: PollActionType.CLEANUP },
  ], 'interval 形态顶替：RESPOND{superseded} + DISARM_INTERVAL + CLEANUP');

  // 顶替后再喂事件：只 DISCARD，不二次 RESPOND。
  const after = reduce(r.state, { type: PollEventType.ATTEMPT_RESULT, settled: true, result: { late: true } });
  assert.equal(after.actions.length, 1);
  assert.equal(after.actions[0].type, PollActionType.DISCARD);
});

test('不变量① · 随机序列（含 SUPERSEDE）：RESPOND 至多一次；若终态=superseded 则该唯一 RESPOND 的 outcome=superseded', () => {
  for (const mode of [PollMode.WAKEUP, PollMode.INTERVAL]) {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed * 17 + 2);
      const len = 1 + Math.floor(rand() * 25);
      const events = Array.from({ length: len }, () => randomEvent(rand));
      const { state, respondCount, supersededRespondCount } = run(events, { mode });
      assert.ok(respondCount <= 1, `mode=${mode} seed=${seed}: RESPOND 应至多一次，实际 ${respondCount}`);
      if (state.phase === PollPhase.SUPERSEDED) {
        assert.equal(respondCount, 1, `mode=${mode} seed=${seed}: superseded 终态应恰好一次 RESPOND`);
        assert.equal(supersededRespondCount, 1, `mode=${mode} seed=${seed}: 该 RESPOND 的 outcome 应为 superseded`);
      }
    }
  }
});

// ── 不变量②：任何终态后不再产生 ATTEMPT/POLL_TICK 派发 ──

test('不变量② · 随机序列（wakeup+interval）：终态后任何后续事件都不再派发 ATTEMPT', () => {
  for (const mode of [PollMode.WAKEUP, PollMode.INTERVAL]) {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed * 23 + 7);
      const len = 1 + Math.floor(rand() * 30);
      const events = Array.from({ length: len }, () => randomEvent(rand));
      const { attemptAfterTerminalCount } = run(events, { mode });
      assert.equal(attemptAfterTerminalCount, 0, `mode=${mode} seed=${seed}: 终态后不应再派发 ATTEMPT`);
    }
  }
});

test('不变量② · 显式：终态后喂 POLL_TICK / SUPERSEDE 只产出 DISCARD、state 不变', () => {
  for (const mode of [PollMode.WAKEUP, PollMode.INTERVAL]) {
    // 构造终态前缀（interval：START→POLL_TICK→settled；wakeup：START→settled）。
    let state = initPoll({ mode });
    state = reduce(state, { type: PollEventType.START }).state;
    if (mode === PollMode.INTERVAL) {
      state = reduce(state, { type: PollEventType.POLL_TICK }).state;
    }
    state = reduce(state, { type: PollEventType.ATTEMPT_RESULT, settled: true, outcome: 'delivered', result: { ok: 1 } }).state;
    assert.ok(isTerminalPhase(state.phase), `mode=${mode}: 前缀应到终态`);

    for (const evt of [PollEventType.POLL_TICK, PollEventType.SUPERSEDE, PollEventType.WAKEUP]) {
      const r = reduce(state, { type: evt });
      assert.deepEqual(r.state, state, `mode=${mode} evt=${evt}: 终态后 state 不应变化`);
      assert.equal(r.actions.length, 1, `mode=${mode} evt=${evt}: 应只 1 个动作`);
      assert.equal(r.actions[0].type, PollActionType.DISCARD, `mode=${mode} evt=${evt}: 应是 DISCARD`);
    }
  }
});

// ── 不变量③：interval 形态到达终态 → CLEANUP 恰好一次且必含一次 DISARM_INTERVAL ──

test('不变量③ · 随机序列（interval 形态）：到终态则 CLEANUP==1 且 DISARM_INTERVAL==1；未到终态则均为 0；从不超过一次', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = mulberry32(seed * 31 + 13);
    const len = 1 + Math.floor(rand() * 28);
    const events = Array.from({ length: len }, () => randomEvent(rand));
    const { state, cleanupCount, disarmIntervalCount } = run(events, { mode: PollMode.INTERVAL });
    assert.ok(cleanupCount <= 1, `seed=${seed}: CLEANUP 应至多一次，实际 ${cleanupCount}`);
    assert.ok(disarmIntervalCount <= 1, `seed=${seed}: DISARM_INTERVAL 应至多一次，实际 ${disarmIntervalCount}`);
    if (isTerminalPhase(state.phase)) {
      assert.equal(cleanupCount, 1, `seed=${seed}: interval 终态（${state.phase}）CLEANUP 应恰好一次`);
      assert.equal(disarmIntervalCount, 1, `seed=${seed}: interval 终态（${state.phase}）DISARM_INTERVAL 应恰好一次`);
    } else {
      assert.equal(cleanupCount, 0, `seed=${seed}: interval 未到终态（${state.phase}）不应 CLEANUP`);
      assert.equal(disarmIntervalCount, 0, `seed=${seed}: interval 未到终态（${state.phase}）不应 DISARM_INTERVAL`);
    }
  }
});

test('不变量③ · 对照：wakeup 形态终态不产生 DISARM_INTERVAL（interval 语义不外溢）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 41 + 19);
    const len = 1 + Math.floor(rand() * 28);
    const events = Array.from({ length: len }, () => randomEvent(rand));
    const { disarmIntervalCount } = run(events, { mode: PollMode.WAKEUP });
    assert.equal(disarmIntervalCount, 0, `seed=${seed}: wakeup 形态不应出现 DISARM_INTERVAL`);
  }
});

// ── initPoll config 校验与默认值（保底钉死向后兼容默认） ──

test('config · initPoll 默认 = wakeup + immediateFirstAttempt:true；interval 默认 immediateFirstAttempt:false；非法 mode 抛 TypeError', () => {
  const def = initPoll();
  assert.equal(def.mode, PollMode.WAKEUP);
  assert.equal(def.immediateFirstAttempt, true);
  assert.equal(def.intervalArmed, false);

  const iv = initPoll({ mode: PollMode.INTERVAL });
  assert.equal(iv.mode, PollMode.INTERVAL);
  assert.equal(iv.immediateFirstAttempt, false);

  const ivEager = initPoll({ mode: PollMode.INTERVAL, immediateFirstAttempt: true });
  assert.equal(ivEager.immediateFirstAttempt, true);

  let caught;
  try { initPoll({ mode: 'bogus' }); } catch (e) { caught = e; }
  assert.ok(caught instanceof TypeError, '非法 mode 应抛 TypeError');
});

test('config · interval START：immediateFirstAttempt=false 只 ARM_INTERVAL+ARM_TIMER（不派 attempt）；=true 额外派 initial attempt', () => {
  // 延迟首发（block-9 默认）。
  let s = initPoll({ mode: PollMode.INTERVAL });
  let r = reduce(s, { type: PollEventType.START });
  assert.equal(r.state.phase, PollPhase.WAITING);
  assert.deepEqual(r.actions, [
    { type: PollActionType.ARM_INTERVAL },
    { type: PollActionType.ARM_TIMER },
  ], 'interval + 延迟首发：START 只装 interval + timer，不立即 attempt');
  assert.equal(r.state.inflight, 0);

  // 立即首发（可选）。
  let e = initPoll({ mode: PollMode.INTERVAL, immediateFirstAttempt: true });
  r = reduce(e, { type: PollEventType.START });
  assert.deepEqual(r.actions, [
    { type: PollActionType.ARM_INTERVAL },
    { type: PollActionType.ARM_TIMER },
    { type: PollActionType.ATTEMPT, phase: 'initial' },
  ], 'interval + 立即首发：额外派一支 initial attempt');
  assert.equal(r.state.inflight, 1);
});

test('config · interval POLL_TICK 在 waiting 派 ATTEMPT{poll}；wakeup 形态 POLL_TICK 被忽略（不派 attempt）', () => {
  let iv = initPoll({ mode: PollMode.INTERVAL });
  iv = reduce(iv, { type: PollEventType.START }).state;
  const r = reduce(iv, { type: PollEventType.POLL_TICK });
  assert.deepEqual(r.actions, [{ type: PollActionType.ATTEMPT, phase: 'poll' }]);
  assert.equal(r.state.inflight, 1);

  // wakeup 形态收到 POLL_TICK（不该发生）：防御性忽略。
  let wk = initPoll();
  wk = reduce(wk, { type: PollEventType.START }).state;
  wk = reduce(wk, { type: PollEventType.ATTEMPT_RESULT, settled: false, result: null }).state;
  const r2 = reduce(wk, { type: PollEventType.POLL_TICK });
  assert.deepEqual(r2.actions, [], 'wakeup 形态 POLL_TICK 不派 attempt');
});
