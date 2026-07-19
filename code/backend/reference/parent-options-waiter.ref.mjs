// realtime_core · 参考实现 · parent-options-waiter.ref.mjs（P2 验收物）
//
// 用扩展后的通用内核（transport/engine.js 的 longPoll，interval 形态 + keyed
// registry）**逐条复现** copycat block-9 `domains/parent/options-waiter.js` 的全部
// 行为。与 next-question-poller 同构，**多一个同 key 顶替（Map<key, cancel>）**。
// copycat 源只读、仅作对照阅读，未被 import。
//
// block-9 options-waiter 行为逐条对照（源 → 本参考如何复现）：
//   1. setInterval 800ms 周期 attempt           → mode:'interval' + pollIntervalMs:800
//   2. attempt() 同步返回 round               → attempt:()=>Promise.resolve(sync()) + classify 读 round
//   3. !round → finish(notFound)              → classify {terminal:true, outcome:'not_found'} → respond.notFound
//   4. round.status==='ready' → finish(ready) → classify {terminal:true, outcome:'ready', payload:round} → respond.ready(round)
//   5. 其余 → 继续等下一个 interval             → classify {terminal:false}
//   6. 先等一个 interval 才首 attempt          → immediateFirstAttempt:false
//   7. setTimeout 60000ms → finish(timeout)   → timeoutMs:60000
//   8. **Map<key, cancel> 同 key 顶替**：新请求进 → 旧请求 finish(respond.superseded)
//                                             → 注入 registry + key；内核在 START 前向旧实例喂 SUPERSEDE
//   9. raw.on('close') 静默收尾               → onClientClose → CLIENT_CLOSE → 只 CLEANUP
//  10. cleanup 同时按身份摘除 active.get(key)  → 内核 CLEANUP 按 superseder 身份 registry.delete（不误删后来者）
//  11. activeCount = active.size             → registry.size
//
// 顶替顺序照抄 block-9：`const previous = active.get(key); if (previous) previous();`
// 先顶掉旧的（旧实例同步 respond.superseded + 从 registry 摘除），再 `active.set(key, …)`
// 登记新的——内核 longPoll 在 feed(START) 前做同序的 prev()→set。

import { longPoll, createPollRegistry } from '../src/transport/engine.js';

/** 默认真实定时器（block-9 shape）。 */
function defaultTimers () {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
}

/**
 * 复现 block-9 options-waiter。接口与源一致：`wait({ key, raw, attempt, respond })`，
 * `attempt()` 同步返回 `round`（`round.status==='ready'` 即就绪，falsy 即无 round），
 * `respond` = `{ timeout, notFound, ready, superseded, error? }`。
 * @param {{timers?: object, timeoutMs?: number, pollIntervalMs?: number}} [opts]
 */
export function createParentOptionsWaiter ({
  timers = defaultTimers(),
  timeoutMs = 60000,
  pollIntervalMs = 800,
} = {}) {
  const registry = createPollRegistry();   // 行为⑧：Map<key, cancel>

  const engineTimers = {
    set: (fn, ms) => timers.setTimeout(fn, ms),
    clear: (h) => timers.clearTimeout(h),
    setInterval: (fn, ms) => timers.setInterval(fn, ms),
    clearInterval: (h) => timers.clearInterval(h),
  };

  function wait ({ key, raw, attempt, respond }) {
    return longPoll({
      timers: engineTimers,
      mode: 'interval',
      immediateFirstAttempt: false,   // 行为⑥
      pollIntervalMs,                 // 行为①：800ms
      timeoutMs,                      // 行为⑦：60000ms
      registry,                       // 行为⑧/⑩：同 key 顶替 + 按身份摘除
      key,
      attempt: () => Promise.resolve(attempt()),  // 行为②
      classify: (round) => {
        if (!round) return { terminal: true, outcome: 'not_found' };            // 行为③
        if (round.status === 'ready') return { terminal: true, outcome: 'ready', payload: round }; // 行为④
        return { terminal: false };                                             // 行为⑤
      },
      respond: {
        timeout: () => respond.timeout(),
        error: (err) => { if (respond.error) respond.error(err); },
        superseded: () => respond.superseded(),   // 行为⑧结局
        not_found: () => respond.notFound(),
        ready: (round) => respond.ready(round),
      },
      onClientClose: (cb) => {         // 行为⑨
        raw.on('close', cb);
        return () => raw.off('close', cb);
      },
    });
  }

  return Object.freeze({ wait, activeCount: () => registry.size });  // 行为⑪
}
