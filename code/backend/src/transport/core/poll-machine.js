// block-4 可复用实时引擎 · core/poll-machine.js（Wave 0）
//
// long-poll 生命周期的纯 reducer——`reduce(state, event) → { state, actions }`。
// 形式化老 `routes/student.js` 三个长轮询端点（next-task/next-question/next-scene）
// 共用的 `done` 标志 + `finish()` 守卫 + `cleanup()`（off listeners + clearTimeout +
// req close）三件套（设计文档 §4）。100% 纯：零 io、零 timer、零 Promise、
// 零 import——状态转移与副作用完全分离，副作用解释器留给 engine.js（Wave 1a）。
//
// 状态图（设计文档 §4）：
//   init ──START──▶ attempting_initial ──ATTEMPT_RESULT(settled)──▶ resolved
//                                       └─ATTEMPT_RESULT(pending)─▶ waiting
//   waiting ──WAKEUP──▶ waiting（派 ATTEMPT{retry}，inflight++，
//                                 timer 只 arm 一次、不因唤醒重置=老行为，
//                                 不 coalesce/不取消在飞 attempt=忠实新竞态）
//   waiting ──ATTEMPT_RESULT(settled)──▶ resolved（RESPOND+CLEANUP）
//   waiting ──ATTEMPT_ERROR──▶ resolved（RESPOND{error}+CLEANUP，老 500 路径）
//   任意非终态 ──TIMEOUT（仅 waiting 可达，因为 ARM_TIMER 只在进入 waiting 时发生）
//               ──▶ timed_out（RESPOND{timeout}+CLEANUP）
//   任意非终态 ──CLIENT_CLOSE──▶ closed（CLEANUP，静默不 RESPOND
//               = 老 `onClose = finish(() => {})`）
//   任意终态 ──任何事件──▶ 原地 DISCARD（=superseded）
//
// 新丢投递竞态（设计文档 §4 决策4，唤醒风暴下的老 bug）：waiting 态收到多次
// WAKEUP 会派发多支 retry attempt（不合并、不取消），若先到的一支已经把状态
// 机推进到终态（resolved/timed_out/closed），之后晚到的 attempt 结果只会撞上
// 顶部的「终态后任何事件 DISCARD」分支——不产生第二次 RESPOND、不产生第二次
// CLEANUP。这就是老代码 `finish()` 守卫（`if (done) return;`）在新模型里的对应
// 物，原样保留、不修——修复（避免晚到结果被静默丢弃）留给 Step 5。
//
// 可单测不变量（poll-machine.property.test.mjs 用随机事件序列钉死）：
//   1. RESPOND 动作在任意事件序列里至多产生一次；
//   2. 到达终态路径后 CLEANUP 动作恰好产生一次（幂等——reducer 只在首次进入
//      终态时发出，后续同状态收到的事件走 DISCARD 分支，不会再发第二次）；
//   3. 到达终态后，任何后续事件都不会再产生 ATTEMPT 动作。

/** long-poll reducer 的合法状态名。 */
export const PollPhase = Object.freeze({
  INIT: 'init',
  ATTEMPTING_INITIAL: 'attempting_initial',
  WAITING: 'waiting',
  RESOLVED: 'resolved',
  TIMED_OUT: 'timed_out',
  CLOSED: 'closed',
});

const TERMINAL_PHASES = new Set([
  PollPhase.RESOLVED,
  PollPhase.TIMED_OUT,
  PollPhase.CLOSED,
]);

/** reducer 认识的事件类型（设计文档 §4）。 */
export const PollEventType = Object.freeze({
  START: 'START',
  ATTEMPT_RESULT: 'ATTEMPT_RESULT',
  ATTEMPT_ERROR: 'ATTEMPT_ERROR',
  WAKEUP: 'WAKEUP',
  TIMEOUT: 'TIMEOUT',
  CLIENT_CLOSE: 'CLIENT_CLOSE',
});

const KNOWN_EVENT_TYPES = new Set(Object.values(PollEventType));

/** reducer 可能产出的动作类型（设计文档 §4）。壳（engine.js）负责解释执行。 */
export const PollActionType = Object.freeze({
  ATTEMPT: 'ATTEMPT',
  SUBSCRIBE: 'SUBSCRIBE',
  ARM_TIMER: 'ARM_TIMER',
  RESPOND: 'RESPOND',
  CLEANUP: 'CLEANUP',
  DISCARD: 'DISCARD',
});

/**
 * 返回一个全新的初始状态（`init` 相，尚未收到 START）。
 * `inflight` 是"已派发 ATTEMPT 但尚未结算（收到 RESULT/ERROR）的计数"，纯粹
 * 信息性字段，不驱动任何状态转移，只用于测试/调试观察唤醒风暴下的在飞数量。
 * @returns {{phase: string, responded: boolean, cleanedUp: boolean,
 *            subscribed: boolean, timerArmed: boolean, inflight: number}}
 */
export function initPoll () {
  return {
    phase: PollPhase.INIT,
    responded: false,
    cleanedUp: false,
    subscribed: false,
    timerArmed: false,
    inflight: 0,
  };
}

/** @param {string} phase @returns {boolean} 是否是终态（resolved/timed_out/closed）。 */
export function isTerminalPhase (phase) {
  return TERMINAL_PHASES.has(phase);
}

/**
 * 纯 reducer：`(state, event) → { state, actions[] }`。不修改传入的 `state`
 * （每次转移返回新对象），不做任何 io。未知 `event.type` 直接抛
 * `TypeError`——这是调用方的编程错误，不是"忽略的合法情况"，不能静默吞。
 * @param {ReturnType<typeof initPoll>} state
 * @param {{type: string, [key: string]: any}} event
 * @returns {{state: ReturnType<typeof initPoll>, actions: Array<{type: string, [key: string]: any}>}}
 */
export function reduce (state, event) {
  if (!event || typeof event.type !== 'string') {
    throw new TypeError('poll-machine: event must be an object with a string `type`');
  }
  if (!KNOWN_EVENT_TYPES.has(event.type)) {
    throw new TypeError(`poll-machine: unknown event type "${event.type}"`);
  }

  // 终态后任何事件原地 DISCARD——新丢投递竞态（决策4）的核心机制：晚到的
  // attempt 结果不会被误判成"新的一次交付"，只会在这里被标记为 superseded。
  if (isTerminalPhase(state.phase)) {
    return { state, actions: [{ type: PollActionType.DISCARD, event }] };
  }

  switch (event.type) {
    case PollEventType.START: return reduceStart(state);
    case PollEventType.ATTEMPT_RESULT: return reduceAttemptResult(state, event);
    case PollEventType.ATTEMPT_ERROR: return reduceAttemptError(state);
    case PollEventType.WAKEUP: return reduceWakeup(state);
    case PollEventType.TIMEOUT: return reduceTimeout(state);
    case PollEventType.CLIENT_CLOSE: return reduceClientClose(state);
    /* c8 ignore next 2 -- KNOWN_EVENT_TYPES 已经守住上面的 switch，这里是防御性兜底 */
    default:
      throw new TypeError(`poll-machine: unhandled event type "${event.type}"`);
  }
}

function reduceStart (state) {
  if (state.phase !== PollPhase.INIT) {
    // 重复 START（正常调用方只会发一次）：防御性忽略，不产生第二支 ATTEMPT。
    return { state, actions: [] };
  }
  const next = { ...state, phase: PollPhase.ATTEMPTING_INITIAL, inflight: state.inflight + 1 };
  return { state: next, actions: [{ type: PollActionType.ATTEMPT, phase: 'initial' }] };
}

function reduceAttemptResult (state, event) {
  const settled = !!event.settled;

  if (state.phase === PollPhase.ATTEMPTING_INITIAL) {
    const inflight = Math.max(0, state.inflight - 1);
    if (settled) return resolveWith(state, inflight, event.result);
    // 首次 attempt 没拿到内容：转入 waiting，SUBSCRIBE 唤醒信号 + ARM_TIMER
    // 只在这一步发生一次——之后的 WAKEUP 不会重复这两个动作（老行为：timer
    // 不因唤醒重置）。
    const next = { ...state, phase: PollPhase.WAITING, inflight, subscribed: true, timerArmed: true };
    return { state: next, actions: [{ type: PollActionType.SUBSCRIBE }, { type: PollActionType.ARM_TIMER }] };
  }

  if (state.phase === PollPhase.WAITING) {
    const inflight = Math.max(0, state.inflight - 1);
    if (settled) return resolveWith(state, inflight, event.result);
    // 仍未 settled：可能是唤醒风暴里某支 retry attempt 先回来但还没数据，继续
    // 等下一次 WAKEUP/TIMEOUT/另一支 attempt 的结果。不是 DISCARD——DISCARD
    // 专指"终态后收到的事件"，这里状态机仍处于非终态。
    return { state: { ...state, inflight }, actions: [] };
  }

  // phase === init：尚未 START 就收到结算结果，属不可达调用序列，防御性忽略。
  return { state, actions: [] };
}

function reduceAttemptError (state) {
  if (state.phase === PollPhase.ATTEMPTING_INITIAL || state.phase === PollPhase.WAITING) {
    const inflight = Math.max(0, state.inflight - 1);
    const next = { ...state, phase: PollPhase.RESOLVED, inflight, responded: true, cleanedUp: true };
    return {
      state: next,
      actions: [{ type: PollActionType.RESPOND, outcome: 'error' }, { type: PollActionType.CLEANUP }],
    };
  }
  // phase === init：尚未派出任何 attempt，不可能收到其错误，防御性忽略。
  return { state, actions: [] };
}

function reduceWakeup (state) {
  if (state.phase === PollPhase.WAITING) {
    // 不 coalesce、不取消在飞 attempt：唤醒风暴下会有多支 retry attempt 同时
    // 在飞，这正是新丢投递竞态（决策4）需要忠实建模的前提条件。
    const next = { ...state, inflight: state.inflight + 1 };
    return { state: next, actions: [{ type: PollActionType.ATTEMPT, phase: 'retry' }] };
  }
  // init/attempting_initial 阶段尚未 SUBSCRIBE（只在进入 waiting 时发生），
  // 此时收到 WAKEUP 是不可达调用序列，防御性忽略。
  return { state, actions: [] };
}

function reduceTimeout (state) {
  if (state.phase === PollPhase.WAITING) {
    const next = { ...state, phase: PollPhase.TIMED_OUT, responded: true, cleanedUp: true };
    return {
      state: next,
      actions: [{ type: PollActionType.RESPOND, outcome: 'timeout' }, { type: PollActionType.CLEANUP }],
    };
  }
  // 计时器只在进入 waiting 时 ARM_TIMER 一次，其余阶段不可能收到 TIMEOUT。
  return { state, actions: [] };
}

function reduceClientClose (state) {
  // 任意非终态（init/attempting_initial/waiting）收到断连都直接清理、不响应
  // ——老代码 `onClose = finish(() => {})`：resolve 但不 reply.send，静默结束。
  const next = { ...state, phase: PollPhase.CLOSED, cleanedUp: true };
  return { state: next, actions: [{ type: PollActionType.CLEANUP }] };
}

function resolveWith (state, inflight, payload) {
  const next = { ...state, phase: PollPhase.RESOLVED, inflight, responded: true, cleanedUp: true };
  return {
    state: next,
    actions: [{ type: PollActionType.RESPOND, outcome: 'settled', payload }, { type: PollActionType.CLEANUP }],
  };
}
