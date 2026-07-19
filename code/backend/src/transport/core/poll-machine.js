// block-4 可复用实时引擎 · core/poll-machine.js（Wave 0 · P2 扩展）
//
// long-poll 生命周期的纯 reducer——`reduce(state, event) → { state, actions }`。
// 形式化老 `routes/student.js` 三个长轮询端点（next-task/next-question/next-scene）
// 共用的 `done` 标志 + `finish()` 守卫 + `cleanup()`（off listeners + clearTimeout +
// req close）三件套（设计文档 §4）。100% 纯：零 io、零 timer、零 Promise、
// 零 import——状态转移与副作用完全分离，副作用解释器留给 engine.js（Wave 1a）。
//
// ── P2 扩展（本期）─────────────────────────────────────────────────────────
// 覆盖 copycat block-9 当年绕开引擎的三种形态——周期轮询、同 key 顶替、延迟
// 首发。做法是在**不动 wakeup（事件驱动）形态一字节行为**的前提下叠加：
//   - 新事件 `POLL_TICK`（interval 触发）、`SUPERSEDE`（被同 key 新请求顶替）。
//   - 新动作 `ARM_INTERVAL` / `DISARM_INTERVAL`（周期定时器，和一次性 ARM_TIMER
//     语义分开：ARM_TIMER↔CLEANUP 清一次性超时，ARM_INTERVAL↔DISARM_INTERVAL
//     装/拆周期轮询）。
//   - 新终态 `SUPERSEDED`（第四终态），对应 `RESPOND{outcome:'superseded'}`；
//     终态后 DISCARD 规则对 POLL_TICK/SUPERSEDE 同样成立。
//   - 配置（initPoll 携带）：`mode: 'wakeup'|'interval'`；`immediateFirstAttempt`
//     （wakeup 默认 true 保持现行为；interval 默认 false 复现 block-9 的“先等一个
//     interval 才跑第一次 attempt”）。
//   - `RESPOND` 的 `outcome` 泛化：settled 之外还可透传 block-9 领域结局标签
//     （delivered/not_found/…），reducer 不认识其含义，只把 attempt 结果事件里
//     携带的 outcome 原样回传给壳层解释——保持领域无关。
//
// **向后兼容硬约束**：不带 config（或 mode 缺省=wakeup）时，六事件/六动作的行为
// 与 P1 逐字一致——ATTEMPT_RESULT{settled,result} 仍产出 RESPOND{outcome:'settled',
// payload:result}，终态 teardown 仍只 [CLEANUP]（wakeup 无 interval 可拆）。
//
// 状态图 · wakeup 形态（设计文档 §4，P1 原样）：
//   init ──START──▶ attempting_initial ──ATTEMPT_RESULT(settled)──▶ resolved
//                                       └─ATTEMPT_RESULT(pending)─▶ waiting
//   waiting ──WAKEUP──▶ waiting（派 ATTEMPT{retry}，inflight++，
//                                 timer 只 arm 一次、不因唤醒重置=老行为，
//                                 不 coalesce/不取消在飞 attempt=忠实新竞态）
//   waiting ──ATTEMPT_RESULT(settled)──▶ resolved（RESPOND+CLEANUP）
//   waiting ──ATTEMPT_ERROR──▶ resolved（RESPOND{error}+CLEANUP，老 500 路径）
//   任意非终态 ──TIMEOUT（仅 waiting 可达）──▶ timed_out（RESPOND{timeout}+CLEANUP）
//   任意非终态 ──CLIENT_CLOSE──▶ closed（CLEANUP，静默不 RESPOND）
//   任意非终态 ──SUPERSEDE──▶ superseded（RESPOND{superseded}+CLEANUP）
//   任意终态 ──任何事件──▶ 原地 DISCARD（=superseded 旧机制）
//
// 状态图 · interval 形态（P2 新增，复现 block-9 两 poller）：
//   init ──START──▶ waiting（ARM_INTERVAL + ARM_TIMER；immediateFirstAttempt 为
//                            true 时额外派一支 ATTEMPT{initial}，block-9 为 false）
//   waiting ──POLL_TICK──▶ waiting（派 ATTEMPT{poll}，inflight++）
//   waiting ──ATTEMPT_RESULT(settled,outcome)──▶ resolved
//                            （RESPOND{outcome,payload} + DISARM_INTERVAL + CLEANUP）
//   waiting ──ATTEMPT_RESULT(pending)──▶ waiting（等下一个 tick）
//   waiting ──ATTEMPT_ERROR──▶ resolved（RESPOND{error}+DISARM_INTERVAL+CLEANUP）
//   任意非终态 ──TIMEOUT──▶ timed_out（RESPOND{timeout}+DISARM_INTERVAL+CLEANUP）
//   任意非终态 ──CLIENT_CLOSE──▶ closed（DISARM_INTERVAL+CLEANUP，静默）
//   任意非终态 ──SUPERSEDE──▶ superseded（RESPOND{superseded}+DISARM_INTERVAL+CLEANUP）
//
// 新丢投递竞态（设计文档 §4 决策4，唤醒风暴下的老 bug）：waiting 态收到多次
// WAKEUP 会派发多支 retry attempt（不合并、不取消），若先到的一支已经把状态
// 机推进到终态（resolved/timed_out/closed/superseded），之后晚到的 attempt 结果
// 只会撞上顶部的「终态后任何事件 DISCARD」分支——不产生第二次 RESPOND、不产生
// 第二次 CLEANUP。这就是老代码 `finish()` 守卫（`if (done) return;`）在新模型里
// 的对应物，原样保留、不修——修复留给 Step 5。
//
// 可单测不变量（poll-machine{.property,.extended.property}.test.mjs 用随机事件
// 序列钉死）：
//   1. RESPOND 动作在任意事件序列里至多产生一次；
//   2. 到达终态路径后 CLEANUP 动作恰好产生一次（幂等）；
//   3. 到达终态后，任何后续事件都不会再产生 ATTEMPT/POLL_TICK 派发（DISCARD）；
//   4. SUPERSEDE 打进非终态：旧实例恰好 RESPOND 一次且 outcome=superseded；
//   5. interval 形态到达终态：CLEANUP 恰好一次且必伴随一次 DISARM_INTERVAL。

/** long-poll reducer 的合法状态名。 */
export const PollPhase = Object.freeze({
  INIT: 'init',
  ATTEMPTING_INITIAL: 'attempting_initial',
  WAITING: 'waiting',
  RESOLVED: 'resolved',
  TIMED_OUT: 'timed_out',
  CLOSED: 'closed',
  SUPERSEDED: 'superseded',
});

const TERMINAL_PHASES = new Set([
  PollPhase.RESOLVED,
  PollPhase.TIMED_OUT,
  PollPhase.CLOSED,
  PollPhase.SUPERSEDED,
]);

/** reducer 识别的轮询形态。 */
export const PollMode = Object.freeze({
  WAKEUP: 'wakeup',
  INTERVAL: 'interval',
});

const KNOWN_MODES = new Set(Object.values(PollMode));

/** reducer 认识的事件类型（设计文档 §4 + P2）。 */
export const PollEventType = Object.freeze({
  START: 'START',
  ATTEMPT_RESULT: 'ATTEMPT_RESULT',
  ATTEMPT_ERROR: 'ATTEMPT_ERROR',
  WAKEUP: 'WAKEUP',
  POLL_TICK: 'POLL_TICK',
  SUPERSEDE: 'SUPERSEDE',
  TIMEOUT: 'TIMEOUT',
  CLIENT_CLOSE: 'CLIENT_CLOSE',
});

const KNOWN_EVENT_TYPES = new Set(Object.values(PollEventType));

/** reducer 可能产出的动作类型（设计文档 §4 + P2）。壳（engine.js）负责解释执行。 */
export const PollActionType = Object.freeze({
  ATTEMPT: 'ATTEMPT',
  SUBSCRIBE: 'SUBSCRIBE',
  ARM_TIMER: 'ARM_TIMER',
  ARM_INTERVAL: 'ARM_INTERVAL',
  DISARM_INTERVAL: 'DISARM_INTERVAL',
  RESPOND: 'RESPOND',
  CLEANUP: 'CLEANUP',
  DISCARD: 'DISCARD',
});

/**
 * 返回一个全新的初始状态（`init` 相，尚未收到 START）。
 * `inflight` 是"已派发 ATTEMPT 但尚未结算（收到 RESULT/ERROR）的计数"，纯粹
 * 信息性字段，不驱动任何状态转移，只用于测试/调试观察在飞数量。
 *
 * P2 config（可选，默认还原 P1 wakeup 形态）：
 *   - `mode`：`'wakeup'`（默认，事件驱动）| `'interval'`（周期轮询）。
 *   - `immediateFirstAttempt`：START 时是否立即派首支 attempt。wakeup 语义上
 *     总是立即（进 attempting_initial）；interval 默认 false（先等一个 tick，
 *     复现 block-9），可显式设 true 让 interval 也立即先试一次。
 * @param {{mode?: string, immediateFirstAttempt?: boolean}} [config]
 * @returns {{phase: string, responded: boolean, cleanedUp: boolean,
 *            subscribed: boolean, timerArmed: boolean, intervalArmed: boolean,
 *            inflight: number, mode: string, immediateFirstAttempt: boolean}}
 */
export function initPoll (config = {}) {
  if (config.mode !== undefined && !KNOWN_MODES.has(config.mode)) {
    throw new TypeError(`poll-machine: unknown mode "${config.mode}" (expected 'wakeup'|'interval')`);
  }
  const mode = config.mode === PollMode.INTERVAL ? PollMode.INTERVAL : PollMode.WAKEUP;
  const immediateFirstAttempt = typeof config.immediateFirstAttempt === 'boolean'
    ? config.immediateFirstAttempt
    : (mode === PollMode.INTERVAL ? false : true);
  return {
    phase: PollPhase.INIT,
    responded: false,
    cleanedUp: false,
    subscribed: false,
    timerArmed: false,
    intervalArmed: false,
    inflight: 0,
    mode,
    immediateFirstAttempt,
  };
}

/** @param {string} phase @returns {boolean} 是否是终态（resolved/timed_out/closed/superseded）。 */
export function isTerminalPhase (phase) {
  return TERMINAL_PHASES.has(phase);
}

/**
 * 终态清理动作序列：interval 形态先 DISARM_INTERVAL 再 CLEANUP（周期定时器必须
 * 单独拆），wakeup 形态只 CLEANUP（无 interval 可拆，与 P1 逐字一致）。
 * @param {string} mode @returns {Array<{type: string}>}
 */
function teardown (mode) {
  return mode === PollMode.INTERVAL
    ? [{ type: PollActionType.DISARM_INTERVAL }, { type: PollActionType.CLEANUP }]
    : [{ type: PollActionType.CLEANUP }];
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
  // attempt 结果 / POLL_TICK / SUPERSEDE 都不会被误判成"新的一次交付"，只会在
  // 这里被标记为 superseded。
  if (isTerminalPhase(state.phase)) {
    return { state, actions: [{ type: PollActionType.DISCARD, event }] };
  }

  switch (event.type) {
    case PollEventType.START: return reduceStart(state);
    case PollEventType.ATTEMPT_RESULT: return reduceAttemptResult(state, event);
    case PollEventType.ATTEMPT_ERROR: return reduceAttemptError(state);
    case PollEventType.WAKEUP: return reduceWakeup(state);
    case PollEventType.POLL_TICK: return reducePollTick(state);
    case PollEventType.SUPERSEDE: return reduceSupersede(state);
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

  if (state.mode === PollMode.INTERVAL) {
    // interval 形态：进 waiting，装周期轮询 + 一次性超时。immediateFirstAttempt
    // 为 true 时额外立即派一支 attempt（block-9 为 false：先等一个 interval）。
    const doImmediate = state.immediateFirstAttempt;
    const next = {
      ...state,
      phase: PollPhase.WAITING,
      intervalArmed: true,
      timerArmed: true,
      inflight: doImmediate ? state.inflight + 1 : state.inflight,
    };
    const actions = [{ type: PollActionType.ARM_INTERVAL }, { type: PollActionType.ARM_TIMER }];
    if (doImmediate) actions.push({ type: PollActionType.ATTEMPT, phase: 'initial' });
    return { state: next, actions };
  }

  // wakeup 形态（P1 逐字）：进 attempting_initial，立即派 initial attempt。
  const next = { ...state, phase: PollPhase.ATTEMPTING_INITIAL, inflight: state.inflight + 1 };
  return { state: next, actions: [{ type: PollActionType.ATTEMPT, phase: 'initial' }] };
}

function reduceAttemptResult (state, event) {
  const settled = !!event.settled;

  if (state.phase === PollPhase.ATTEMPTING_INITIAL) {
    const inflight = Math.max(0, state.inflight - 1);
    if (settled) return resolveWith(state, inflight, event);
    // 首次 attempt 没拿到内容：转入 waiting，SUBSCRIBE 唤醒信号 + ARM_TIMER
    // 只在这一步发生一次——之后的 WAKEUP 不会重复这两个动作（老行为：timer
    // 不因唤醒重置）。仅 wakeup 形态可达（interval 形态不经 attempting_initial）。
    const next = { ...state, phase: PollPhase.WAITING, inflight, subscribed: true, timerArmed: true };
    return { state: next, actions: [{ type: PollActionType.SUBSCRIBE }, { type: PollActionType.ARM_TIMER }] };
  }

  if (state.phase === PollPhase.WAITING) {
    const inflight = Math.max(0, state.inflight - 1);
    if (settled) return resolveWith(state, inflight, event);
    // 仍未 settled：wakeup 形态是唤醒风暴里某支 retry 先回来但还没数据；interval
    // 形态是这一 tick 的 attempt 判为 pending。都继续等下一个信号。不是 DISCARD
    // ——DISCARD 专指"终态后收到的事件"，这里状态机仍处于非终态。
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
      actions: [{ type: PollActionType.RESPOND, outcome: 'error' }, ...teardown(state.mode)],
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

function reducePollTick (state) {
  // 周期轮询触发：仅 interval 形态的 waiting 态派一支 attempt。wakeup 形态收到
  // POLL_TICK（不该发生）防御性忽略，不派 attempt。
  if (state.phase === PollPhase.WAITING && state.mode === PollMode.INTERVAL) {
    const next = { ...state, inflight: state.inflight + 1 };
    return { state: next, actions: [{ type: PollActionType.ATTEMPT, phase: 'poll' }] };
  }
  return { state, actions: [] };
}

function reduceSupersede (state) {
  // 被同 key 新请求顶替：任意非终态（终态由顶部 DISCARD 守卫拦下）→ superseded
  // 终态，回复 superseded 结局并清理（interval 形态含 DISARM_INTERVAL）。
  const next = { ...state, phase: PollPhase.SUPERSEDED, responded: true, cleanedUp: true };
  return {
    state: next,
    actions: [{ type: PollActionType.RESPOND, outcome: 'superseded' }, ...teardown(state.mode)],
  };
}

function reduceTimeout (state) {
  if (state.phase === PollPhase.WAITING) {
    const next = { ...state, phase: PollPhase.TIMED_OUT, responded: true, cleanedUp: true };
    return {
      state: next,
      actions: [{ type: PollActionType.RESPOND, outcome: 'timeout' }, ...teardown(state.mode)],
    };
  }
  // 计时器只在进入 waiting 时 ARM_TIMER 一次，其余阶段不可能收到 TIMEOUT。
  return { state, actions: [] };
}

function reduceClientClose (state) {
  // 任意非终态（init/attempting_initial/waiting）收到断连都直接清理、不响应
  // ——老代码 `onClose = finish(() => {})`：resolve 但不 reply.send，静默结束。
  const next = { ...state, phase: PollPhase.CLOSED, cleanedUp: true };
  return { state: next, actions: teardown(state.mode) };
}

function resolveWith (state, inflight, event) {
  // 结算结局标签：event.outcome 缺省 = 'settled'（P1 逐字行为）；interval 形态
  // 下壳层可携带 block-9 领域结局（delivered/not_found/…），reducer 不解释其义，
  // 只把 outcome + payload 原样回传给 RESPOND 动作。payload 沿用 event.result。
  const outcome = event.outcome || 'settled';
  const next = { ...state, phase: PollPhase.RESOLVED, inflight, responded: true, cleanedUp: true };
  return {
    state: next,
    actions: [{ type: PollActionType.RESPOND, outcome, payload: event.result }, ...teardown(state.mode)],
  };
}
