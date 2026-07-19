// realtime_core · 参考实现 · child-ab-next-question.ref.mjs（P2 验收物）
//
// 用扩展后的通用内核（transport/engine.js 的 longPoll，interval 形态）**逐条复现**
// copycat block-9 `domains/child-ab/next-question-poller.js` 的全部行为——证明通用
// 内核能无损承载真实业务的实时形态。copycat 源只读、仅作对照阅读，未被 import。
//
// block-9 next-question-poller 行为逐条对照（源 → 本参考如何复现）：
//   1. setInterval 1000ms 周期 attempt        → mode:'interval' + pollIntervalMs:1000（ARM_INTERVAL）
//   2. attempt() 同步返回 {kind}               → attempt:()=>Promise.resolve(sync()) + classify 读 kind
//   3. kind==='not_found' → finish(notFound)   → classify {terminal:true, outcome:'not_found'} → respond.notFound
//   4. kind==='delivered' → finish(delivered)  → classify {terminal:true, outcome:'delivered', payload:body} → respond.delivered(body)
//   5. 其余 kind → 继续等下一个 interval        → classify {terminal:false} → 留在 waiting
//   6. **先等一个 interval 才跑第一次 attempt**  → immediateFirstAttempt:false（START 只 ARM_INTERVAL+ARM_TIMER）
//   7. setTimeout 60000ms → finish(timeout)    → timeoutMs:60000（ARM_TIMER → TIMEOUT → respond.timeout）
//   8. raw.on('close') → finish(()=>{}) 静默    → onClientClose 挂 raw close → CLIENT_CLOSE → 只 CLEANUP 不 RESPOND
//   9. cleanup: clearInterval+clearTimeout+off  → DISARM_INTERVAL + CLEANUP（终态 teardown 严格配对）
//  10. active 计数（wait++ / 结束--）           → 本参考同样 wait 时 +1、done 后 -1
//
// 已知微时序适配（记 worklog）：block-9 的 attempt 在 interval 回调内**同步**结算，
// 本参考经内核走 attempt→Promise→ATTEMPT_RESULT 事件，结算落在 tick 后一个微任务。
// 观测层（fire tick → flush microtasks → 断言）行为一致；特征测试逐 tick 步进 + flush。

import { longPoll } from '../src/transport/engine.js';

/** 默认真实定时器（block-9 shape：setTimeout/clearTimeout/setInterval/clearInterval）。 */
function defaultTimers () {
  return {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
}

/**
 * 复现 block-9 next-question-poller。接口与源一致：`wait({ raw, attempt, respond })`，
 * `attempt()` 同步返回 `{ kind: 'not_found'|'delivered'|... , body? }`，
 * `respond` = `{ timeout, notFound, delivered, error? }`。
 * @param {{timers?: object, timeoutMs?: number, pollIntervalMs?: number}} [opts]
 */
export function createChildAbNextQuestionPoller ({
  timers = defaultTimers(),
  timeoutMs = 60000,
  pollIntervalMs = 1000,
} = {}) {
  let active = 0;

  // block-9 timers（setTimeout/clearTimeout/setInterval/clearInterval）→ 内核 timers
  // port（set/clear 一次性 + setInterval/clearInterval 周期）。
  const engineTimers = {
    set: (fn, ms) => timers.setTimeout(fn, ms),
    clear: (h) => timers.clearTimeout(h),
    setInterval: (fn, ms) => timers.setInterval(fn, ms),
    clearInterval: (h) => timers.clearInterval(h),
  };

  function wait ({ raw, attempt, respond }) {
    active += 1;
    const done = longPoll({
      timers: engineTimers,
      mode: 'interval',
      immediateFirstAttempt: false,   // 行为⑥：先等一个 interval
      pollIntervalMs,                 // 行为①：1000ms
      timeoutMs,                      // 行为⑦：60000ms
      attempt: () => Promise.resolve(attempt()),   // 行为②：同步 attempt 包成 Promise
      classify: (r) => {
        if (r && r.kind === 'not_found') return { terminal: true, outcome: 'not_found' }; // 行为③
        if (r && r.kind === 'delivered') return { terminal: true, outcome: 'delivered', payload: r.body }; // 行为④
        return { terminal: false };  // 行为⑤：继续等
      },
      respond: {
        timeout: () => respond.timeout(),
        error: (err) => { if (respond.error) respond.error(err); },
        not_found: () => respond.notFound(),
        delivered: (body) => respond.delivered(body),
      },
      onClientClose: (cb) => {         // 行为⑧：close 静默收尾
        raw.on('close', cb);
        return () => raw.off('close', cb);
      },
    });
    return done.finally(() => { active -= 1; });  // 行为⑩
  }

  return Object.freeze({ wait, activeCount: () => active });
}
