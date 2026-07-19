// block-4 可复用实时引擎 · engine.integration.test.mjs（Wave 1a）
//
// 注入假 timers + 假 wakeup + 假 conn/onClientClose，驱动 engine.js 的
// longPoll 全生命周期与 createDispatcher，覆盖设计文档 §1/§4/§7 要求的场景：
//   - 全生命周期 initial(pending)→waiting(subscribe+arm timer)→wakeup 重试→settle→cleanup
//   - timeout（timer 触发时的 RESPOND+CLEANUP）
//   - client-close 静默（不 RESPOND、只 CLEANUP，老 `onClose=finish(()=>{})`）
//   - **新丢投递竞态**：两支唤醒 retry 同时在飞，第一支先 settle，第二支晚到
//     只 DISCARD，不二次 RESPOND/CLEANUP（决策4，poll-machine.js 已形式化，
//     这里在壳这一层再验证一遍真实副作用不会重复触发）
//   - createDispatcher：命中 / 未知命令 / handler 同步抛错 / handler reject 三类异常路径

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longPoll, createDispatcher } from './engine.js';

// ── 测试替身 ─────────────────────────────────────────────────────────────

/** 假唤醒 port：与 session-state/wakeup.js 的 createWakeupPort() 同形状。 */
function fakeWakeup () {
  const listeners = new Map(); // kind -> Set<listener>
  function toList (kinds) { return Array.isArray(kinds) ? kinds : [kinds]; }
  return {
    subscribe (kinds, listener) {
      const list = toList(kinds);
      for (const kind of list) {
        if (!listeners.has(kind)) listeners.set(kind, new Set());
        listeners.get(kind).add(listener);
      }
      let active = true;
      return function unsubscribe () {
        if (!active) return;
        active = false;
        for (const kind of list) listeners.get(kind)?.delete(listener);
      };
    },
    emit (pollKey, kinds) {
      for (const kind of toList(kinds)) {
        for (const listener of listeners.get(kind) || []) listener(pollKey);
      }
    },
  };
}

/** 假 timer：`set`/`clear` 手动可控，测试自己决定何时"触发"。 */
function fakeTimers () {
  let nextId = 1;
  const pending = new Map(); // id -> fn
  return {
    set (fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear (id) { pending.delete(id); },
    fire (id) { const entry = pending.get(id); if (entry) { pending.delete(id); entry.fn(); } },
    pendingIds () { return [...pending.keys()]; },
  };
}

function deferred () {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** 让微任务队列（attempt promise 的 .then 链）在断言前完全排空。 */
function flush () {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 组一套完整的 longPoll 测试夹具：假 wakeup/timers/attempt(受控)/respond 记录/onClientClose 钩子。 */
function harness ({ pollKey = 'sess-1', wakeOn = 'ready', timeoutMs = 5000, isSettled } = {}) {
  const wakeup = fakeWakeup();
  const timers = fakeTimers();
  const attempts = [];       // ['initial'] / ['initial', 'retry', ...]
  const deferreds = [];      // 每次 attempt() 对应一个可手动 resolve/reject 的 deferred
  const responded = [];      // [['settled', payload] | ['timeout'] | ['error']]
  let closeHandler = null;

  const attempt = (phase) => {
    attempts.push(phase);
    const d = deferred();
    deferreds.push(d);
    return d.promise;
  };
  const respond = {
    settled: (payload) => responded.push(['settled', payload]),
    timeout: () => responded.push(['timeout']),
    error: (err) => responded.push(['error', err]),
  };
  const onClientClose = (cb) => {
    closeHandler = cb;
    return () => { closeHandler = null; };
  };

  const done = longPoll({
    wakeup, timers, pollKey, attempt,
    isSettled: isSettled || ((r) => r?.kind === 'delivered'),
    wakeOn, timeoutMs, respond, onClientClose,
  });

  return {
    wakeup, timers, attempts, deferreds, responded, done,
    triggerClose: () => closeHandler?.(),
    pollKey,
  };
}

// ── 全生命周期 ───────────────────────────────────────────────────────────

test('longPoll · 全生命周期：initial pending → waiting(subscribe+arm timer) → wakeup 重试 → settle → cleanup', async () => {
  const h = harness();

  // START 同步派发 initial attempt。
  assert.deepEqual(h.attempts, ['initial']);

  // initial 未拿到内容：转 waiting，SUBSCRIBE + ARM_TIMER 各恰好一次。
  h.deferreds[0].resolve({ kind: 'pending' });
  await flush();
  assert.equal(h.timers.pendingIds().length, 1, '进入 waiting 应恰好 arm 一次 timer');
  assert.equal(h.responded.length, 0);

  // 唤醒：派发一支 retry attempt（timer 不因唤醒重置——仍是同一个 handle）。
  const armedTimerId = h.timers.pendingIds()[0];
  h.wakeup.emit(h.pollKey, 'ready');
  await flush();
  assert.deepEqual(h.attempts, ['initial', 'retry']);
  assert.deepEqual(h.timers.pendingIds(), [armedTimerId], 'WAKEUP 不应重新 arm 计时器');

  // retry 结算为 delivered：RESPOND(settled) + CLEANUP。
  h.deferreds[1].resolve({ kind: 'delivered', body: { hello: 'world' } });
  await flush();
  assert.deepEqual(h.responded, [['settled', { kind: 'delivered', body: { hello: 'world' } }]]);
  assert.equal(h.responded.length, 1, 'RESPOND 至多一次');

  // CLEANUP 幂等生效：timer 已清、断连监听已 off、唤醒已取消订阅。
  assert.equal(h.timers.pendingIds().length, 0, 'cleanup 应清掉 timer');
  h.wakeup.emit(h.pollKey, 'ready'); // 若还订阅着会再派一支 attempt——不该发生
  await flush();
  assert.deepEqual(h.attempts, ['initial', 'retry'], 'cleanup 后不应再响应唤醒');

  await h.done; // 生命周期已 resolve
});

test('longPoll · timeout：waiting 态计时器触发 → RESPOND(timeout) + CLEANUP', async () => {
  const h = harness({ timeoutMs: 1234 });
  h.deferreds[0].resolve({ kind: 'pending' });
  await flush();

  const [timerId] = h.timers.pendingIds();
  assert.ok(timerId !== undefined);
  h.timers.fire(timerId);
  await flush();

  assert.deepEqual(h.responded, [['timeout']]);
  assert.equal(h.timers.pendingIds().length, 0);
  await h.done;
});

test('longPoll · client-close 静默：非终态收到断连 → 只 CLEANUP，不 RESPOND（老 onClose=finish(()=>{})）', async () => {
  const h = harness();
  h.deferreds[0].resolve({ kind: 'pending' });
  await flush();
  assert.equal(h.timers.pendingIds().length, 1);

  h.triggerClose();
  await flush();

  assert.deepEqual(h.responded, [], 'client-close 不应产生任何 RESPOND');
  assert.equal(h.timers.pendingIds().length, 0, 'client-close 仍应清理 timer');

  await h.done;
});

test('longPoll · 新丢投递竞态：两支唤醒 retry 同时在飞，第一支先 settle，第二支晚到只 DISCARD，不二次 RESPOND/CLEANUP', async () => {
  const h = harness();
  h.deferreds[0].resolve({ kind: 'pending' });
  await flush();

  // 唤醒风暴：两次 WAKEUP 派发两支不合并、不取消的 retry attempt。
  h.wakeup.emit(h.pollKey, 'ready');
  await flush();
  h.wakeup.emit(h.pollKey, 'ready');
  await flush();
  assert.deepEqual(h.attempts, ['initial', 'retry', 'retry'], '唤醒风暴应派出两支独立 retry');

  // 第一支（deferreds[1]）先结算为 delivered：状态机进入终态，RESPOND+CLEANUP 各一次。
  h.deferreds[1].resolve({ kind: 'delivered', body: { first: true } });
  await flush();
  assert.equal(h.responded.length, 1);
  assert.deepEqual(h.responded[0], ['settled', { kind: 'delivered', body: { first: true } }]);

  // 第二支（deferreds[2]）晚到——即便它也判定为 delivered，终态后收到的事件
  // 走 DISCARD 分支：不应产生第二次 RESPOND，也不应重新触发 cleanup 的副作用。
  h.deferreds[2].resolve({ kind: 'delivered', body: { first: false, late: true } });
  await flush();
  assert.equal(h.responded.length, 1, '晚到的第二支 attempt 结果不应触发第二次 RESPOND（新丢投递竞态原样保留）');

  await h.done;
});

test('longPoll · initial attempt 直接 settled（无需进入 waiting）：不 SUBSCRIBE/不 ARM_TIMER', async () => {
  const h = harness();
  h.deferreds[0].resolve({ kind: 'delivered', body: { fast: true } });
  await flush();

  assert.deepEqual(h.responded, [['settled', { kind: 'delivered', body: { fast: true } }]]);
  assert.equal(h.timers.pendingIds().length, 0, 'initial 直接 settled 不应 arm 计时器');
  await h.done;
});

test('longPoll · ATTEMPT_ERROR：attempt() reject → RESPOND(error) + CLEANUP（老 500 路径）', async () => {
  const h = harness();
  h.deferreds[0].resolve({ kind: 'pending' });
  await flush();
  h.wakeup.emit(h.pollKey, 'ready');
  await flush();

  const boom = new Error('boom');
  h.deferreds[1].reject(boom);
  await flush();

  assert.equal(h.responded.length, 1);
  assert.equal(h.responded[0][0], 'error');
  assert.equal(h.responded[0][1], boom, 'respond.error 应收到 attempt() reject 的原始错误对象');
  assert.equal(h.timers.pendingIds().length, 0);
  await h.done;
});

// ── createDispatcher ─────────────────────────────────────────────────────

test('createDispatcher · 命中已知命令 → 调用对应 handler，透传额外上下文参数', () => {
  const seen = [];
  const dispatch = createDispatcher({
    ping: (cmd, ctx) => seen.push(['ping', cmd, ctx]),
  });
  dispatch({ cmd: 'ping', n: 1 }, { who: 'teacher-1' });
  assert.deepEqual(seen, [['ping', { cmd: 'ping', n: 1 }, { who: 'teacher-1' }]]);
});

test('createDispatcher · 未知命令 → 走 onUnknown，不调用任何 handler', () => {
  const calledHandler = [];
  const unknowns = [];
  const dispatch = createDispatcher(
    { known: () => calledHandler.push('known') },
    { onUnknown: (error, cmd) => unknowns.push([error, cmd]) },
  );
  dispatch({ cmd: 'nope' });
  assert.deepEqual(calledHandler, []);
  assert.equal(unknowns.length, 1);
  assert.deepEqual(unknowns[0][0], { kind: 'unknown_command', cmd: 'nope', detail: 'unknown cmd nope' });
});

test('createDispatcher · handler 同步抛错 → 走 onError，不向外传播异常', () => {
  const errors = [];
  const dispatch = createDispatcher(
    { boom: () => { throw new Error('sync-boom'); } },
    { onError: (err) => errors.push(err.message) },
  );
  assert.doesNotThrow(() => dispatch({ cmd: 'boom' }));
  assert.deepEqual(errors, ['sync-boom']);
});

test('createDispatcher · handler 返回 rejected promise → 走 onError（异步异常同样被捕获）', async () => {
  const errors = [];
  const dispatch = createDispatcher(
    { asyncBoom: async () => { throw new Error('async-boom'); } },
    { onError: (err) => errors.push(err.message) },
  );
  dispatch({ cmd: 'asyncBoom' });
  await flush();
  assert.deepEqual(errors, ['async-boom']);
});

test('createDispatcher · 无 onUnknown/onError 时静默（不抛），只是不产生副作用', () => {
  const dispatch = createDispatcher({ known: () => { throw new Error('x'); } });
  assert.doesNotThrow(() => dispatch({ cmd: 'unknown' }));
  assert.doesNotThrow(() => dispatch({ cmd: 'known' }));
});
