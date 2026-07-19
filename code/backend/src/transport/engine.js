// block-4 可复用实时引擎 · engine.js（Wave 1a）
//
// 副作用壳：把 `core/poll-machine.js` 的纯 reducer 动作解释成真实副作用
// （订阅唤醒 / 排定超时 / 发起 attempt / 调 responder / 幂等清理），把
// `core/dispatch.js` 的纯表查找解释成"调用 handler + 吞异常"。100% 领域
// 无关——只 import node: 内建 + realtime/core 兄弟模块，不 import
// session-state/fastify/ws/operations（设计文档 §1，reviewer 机械核
// `check-realtime-engine-purity.mjs`）。
//
// 注入物（全部由调用方传入，engine.js 本身零全局状态）：
//   - `wakeup`：block-3 `session-state/wakeup.js` 的 `createWakeupPort()` 实例
//     形状 `{ emit(pollKey, kinds), subscribe(kinds, listener) → unsubscribe }`。
//   - `timers`：`{ set(fn, ms) → handle, clear(handle) }`，测试注入假 timer。
//   - `attempt`：`(phase) => Promise<result>` 闭包，调用方通常在其内部做
//     `service.mutate(sessionId, op)`——engine 不感知锁/repo/领域。

import { reduce, initPoll, isTerminalPhase, PollEventType, PollActionType } from './core/poll-machine.js';
import { normalizeCommandTable, lookupCommand } from './core/dispatch.js';

/**
 * 驱动一次 long-poll 生命周期，直到进入终态（resolved/timed_out/closed）并
 * 完成清理后才 resolve——调用方（L1 手排 / L2 `classroom.js`）await 它即可，
 * 不需要自己管定时器/监听器的生命周期。
 * @param {{
 *   wakeup: {subscribe: (kinds: string|string[], listener: (pollKey: any) => void) => (() => void)},
 *   timers: {set: (fn: () => void, ms: number) => any, clear: (handle: any) => void},
 *   pollKey: any,
 *   attempt: (phase: 'initial'|'retry') => Promise<any>,
 *   isSettled: (result: any) => boolean,
 *   wakeOn: string|string[],
 *   timeoutMs: number,
 *   respond: {settled: (payload: any) => void, timeout: () => void, error: (err: any) => void},
 *   onClientClose: (onClose: () => void) => (() => void),
 * }} opts
 * @returns {Promise<void>}
 */
export function longPoll ({ wakeup, timers, pollKey, attempt, isSettled, wakeOn, timeoutMs, respond, onClientClose }) {
  return new Promise((resolve) => {
    let state = initPoll();
    let unsubscribe = null;
    let timerHandle = null;
    let offClose = null;
    // poll-machine 的 ATTEMPT_ERROR/RESPOND{outcome:'error'} 动作本身不携带
    // 原始错误对象（reducer 是纯状态机，不认识 Error 这种 io 副产物）——这里
    // 用一个闭包变量在"设置错误→同步 feed()→同步处理 RESPOND 动作"这一条不
    // 间断的调用链里传递它，供 respond.error(err) 拿到真实错误。
    let pendingError = null;

    // 三者各自独立幂等：每个都在"用过就置空"，第二次调用（哪怕理论上不该
    // 发生）看到已是 null 就什么都不做——不依赖外层的单一 cleanedUp 标志。
    function cleanup () {
      if (unsubscribe) { const fn = unsubscribe; unsubscribe = null; fn(); }
      if (timerHandle !== null) { const h = timerHandle; timerHandle = null; timers.clear(h); }
      if (offClose) { const fn = offClose; offClose = null; fn(); }
    }

    function runAction (action) {
      switch (action.type) {
        case PollActionType.ATTEMPT:
          attempt(action.phase).then(
            (result) => feed({ type: PollEventType.ATTEMPT_RESULT, settled: isSettled(result), result }),
            (err) => { pendingError = err; feed({ type: PollEventType.ATTEMPT_ERROR }); },
          );
          break;
        case PollActionType.SUBSCRIBE:
          unsubscribe = wakeup.subscribe(wakeOn, (sid) => {
            if (sid === pollKey) feed({ type: PollEventType.WAKEUP });
          });
          break;
        case PollActionType.ARM_TIMER:
          timerHandle = timers.set(() => feed({ type: PollEventType.TIMEOUT }), timeoutMs);
          break;
        case PollActionType.RESPOND:
          if (action.outcome === 'settled') respond.settled(action.payload);
          else if (action.outcome === 'timeout') respond.timeout();
          else if (action.outcome === 'error') respond.error(pendingError);
          break;
        case PollActionType.CLEANUP:
          cleanup();
          break;
        case PollActionType.DISCARD:
          // 终态后晚到的事件——新丢投递竞态（决策4）的核心机制，原样不响应、
          // 不二次清理。
          break;
        /* c8 ignore next 2 -- reduce() 已经守住合法动作集合，这里是防御性兜底 */
        default:
          break;
      }
    }

    function feed (event) {
      const { state: next, actions } = reduce(state, event);
      state = next;
      for (const action of actions) runAction(action);
      if (isTerminalPhase(state.phase)) resolve();
    }

    // 断连监听先挂上再 START：即便 attempt 同步落地也不会错过一次极早的
    // client-close（onClientClose 的 off 由 CLEANUP 负责，"三者各自幂等"之一）。
    offClose = onClientClose(() => feed({ type: PollEventType.CLIENT_CLOSE }));
    feed({ type: PollEventType.START });
  });
}

/**
 * 表驱动命令分发器：查表命中 → 调用 handler（吞异常，走 onError）；未命中 →
 * 走 onUnknown。复刻老 WS L335-338 语义（`unknown cmd <name>` 走 default 分
 * 支）。`dispatch(cmd, ...ctx)` 的其余参数原样透传给 handler——engine 不关心
 * 领域上下文长什么样。
 * @param {Record<string, Function>} commandTable
 * @param {{onUnknown?: (error: {kind: string, cmd: any, detail: string}, cmd: any, ...ctx: any[]) => void,
 *          onError?: (err: any, cmd: any, ...ctx: any[]) => void}} [handlers]
 * @returns {(cmd: {cmd?: unknown}, ...ctx: any[]) => void}
 */
export function createDispatcher (commandTable, { onUnknown, onError } = {}) {
  const table = normalizeCommandTable(commandTable);
  return function dispatch (cmd, ...ctx) {
    const found = lookupCommand(table, cmd);
    if (!found.ok) { onUnknown?.(found.error, cmd, ...ctx); return; }
    let result;
    try {
      result = found.handler(cmd, ...ctx);
    } catch (err) {
      onError?.(err, cmd, ...ctx);
      return;
    }
    if (result && typeof result.then === 'function') {
      result.catch((err) => onError?.(err, cmd, ...ctx));
    }
  };
}
