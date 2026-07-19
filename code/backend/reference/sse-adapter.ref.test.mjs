// realtime_core · reference/sse-adapter.ref.test.mjs（P5）
//
// SSE 参考适配器的实测验证——把 0.6 号设计声明"端口形状对 SSE 成立"从理论
// 承诺变为实测事实：
//   ① 同一内核零改动承载 SSE：本套测试组装的是真 longPoll + 真 delivery +
//      真 memory-log-store（src/ 一行未动，兼容门另证）。
//   ② "RESPOND 后连接仍活着继续推" = 顺序复合多个 poll 生命周期；同一 conn
//      连收多帧、游标随 ack 前移、跨生命周期边界不丢事件。
//   ③ 长轮询"回完即终"与 SSE 持续推共存于同一 delivery/内核词汇。
//   ④ conn port 与 channels.js（WS 形态）同形状可互换。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longPoll } from '../src/transport/engine.js';
import { createChannels } from '../src/transport/channels.js';
import { createMemoryLogStore } from '../src/session/memory-log-store.js';
import { createDelivery } from '../src/session/delivery.js';
import { serveSse, formatSseFrame, formatSseComment } from './sse-adapter.ref.mjs';

function fixedCtx () {
  let now = 1000; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

function fakeWakeup () {
  const listeners = new Map();
  const toList = (kinds) => (Array.isArray(kinds) ? kinds : [kinds]);
  return {
    subscribe (kinds, listener) {
      const list = toList(kinds);
      for (const kind of list) {
        if (!listeners.has(kind)) listeners.set(kind, new Set());
        listeners.get(kind).add(listener);
      }
      let active = true;
      return () => {
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

/** 可手动触发的一次性假定时器（fire() = 触发当前所有待决超时）。 */
function fakeTimers () {
  let nextId = 1;
  const pending = new Map();
  return {
    set (fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear (id) { pending.delete(id); },
    fire () {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, t] of due) t.fn();
    },
    pendingCount () { return pending.size; },
  };
}

/** 模拟 res.write 的假 SSE 响应对象（conn port：send/isOpen + close 信号）。 */
function fakeSseConn () {
  const frames = [];
  let open = true;
  const closeListeners = new Set();
  return {
    conn: { send: (frame) => { frames.push(frame); }, isOpen: () => open },
    frames,
    close () { open = false; for (const fn of [...closeListeners]) fn(); },
    onClientClose (cb) { closeListeners.add(cb); return () => closeListeners.delete(cb); },
  };
}

function flush () { return new Promise((resolve) => setTimeout(resolve, 0)); }

function build () {
  const logStore = createMemoryLogStore(fixedCtx());
  const wakeup = fakeWakeup();
  const delivery = createDelivery({ logStore, wakeup, longPoll });
  return { logStore, wakeup, delivery };
}

const STREAM = 'stream-1';

test('SSE · 核心证明：RESPOND 后连接仍活着继续推——同一 conn 顺序复合多个 poll 生命周期收多帧', async () => {
  const { logStore, delivery } = build();
  const client = fakeSseConn();
  const timers = fakeTimers();

  // 连接前已有积压 2 条：第一个生命周期的 initial attempt 立即 settled。
  delivery.publish(STREAM, [{ type: 'e1' }, { type: 'e2' }]);

  const done = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: client.conn,
    timers, timeoutMs: 30_000, onClientClose: client.onClientClose,
  });
  await flush();
  assert.equal(client.frames.length, 1, '积压立即推第一帧');
  assert.match(client.frames[0], /^id: 2\n/, 'id 行 = 批尾 seq（Last-Event-ID 语义）');
  assert.equal(logStore.getCursor(STREAM, 'viewer'), 2, '推送即 ack，游标前移到批尾');

  // 第一帧已 RESPOND（该生命周期已终）——连接不关，继续推：跨生命周期第二批。
  delivery.publish(STREAM, [{ type: 'e3' }]);
  await flush();
  // 第三批：再证一次（RESPOND 至多一次是"每生命周期"的承诺，连接维度不受限）。
  delivery.publish(STREAM, [{ type: 'e4' }, { type: 'e5' }]);
  await flush();

  assert.equal(client.frames.length, 3, '同一 conn 连收 3 帧 = 3 个完整生命周期');
  assert.match(client.frames[1], /^id: 3\n/);
  assert.match(client.frames[2], /^id: 5\n/);
  assert.equal(logStore.getCursor(STREAM, 'viewer'), 5);

  const batch2 = JSON.parse(client.frames[1].replace(/^id: \d+\ndata: /, '').trim());
  assert.deepEqual(batch2.map((e) => e.type), ['e3']);

  client.close();
  const stats = await done;
  assert.equal(stats.pushes, 3);
  assert.equal(stats.lastError, null);
});

test('SSE · 跨生命周期边界不丢事件：上一帧 ack 后、下一生命周期靠 initial attempt 补课（不依赖唤醒）', async () => {
  const { delivery } = build();
  const client = fakeSseConn();
  const timers = fakeTimers();

  const done = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: client.conn,
    timers, timeoutMs: 30_000, onClientClose: client.onClientClose,
  });
  await flush();
  // publish 两次、只 flush 一次：第二次 publish 的唤醒可能落在"上一生命周期已终、
  // 下一生命周期尚未 SUBSCRIBE"的空窗——新生命周期的 initial attempt 立即 pull
  // 游标之后的积压，事件不丢。
  delivery.publish(STREAM, [{ type: 'a' }]);
  delivery.publish(STREAM, [{ type: 'b' }]);
  await flush();
  await flush();

  const all = client.frames.map((f) => JSON.parse(f.replace(/^id: \d+\ndata: /, '').trim()))
    .flat().map((e) => e.type);
  assert.deepEqual(all, ['a', 'b'], '两条事件全部送达（可能 1 帧或 2 帧，但零丢失）');

  client.close();
  await done;
});

test('SSE · 空转超时 = 心跳注释帧，连接不关；随后 publish 仍在同一 conn 送达', async () => {
  const { delivery } = build();
  const client = fakeSseConn();
  const timers = fakeTimers();

  const done = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: client.conn,
    timers, timeoutMs: 15_000, onClientClose: client.onClientClose,
  });
  await flush();
  assert.equal(timers.pendingCount(), 1, '空转生命周期已 ARM_TIMER');

  timers.fire(); // 触发 TIMEOUT → RESPOND{timeout} → 心跳
  await flush();
  assert.equal(client.frames.length, 1);
  assert.equal(client.frames[0], formatSseComment('keep-alive'));

  delivery.publish(STREAM, [{ type: 'after-heartbeat' }]);
  await flush();
  assert.equal(client.frames.length, 2, '心跳后同一 conn 继续收数据帧');
  assert.match(client.frames[1], /after-heartbeat/);

  client.close();
  const stats = await done;
  assert.equal(stats.heartbeats, 1);
  assert.equal(stats.pushes, 1);
});

test('SSE · 客户端断连：CLIENT_CLOSE 静默终止（无多余帧），serveSse resolve、监听清零', async () => {
  const { delivery } = build();
  const client = fakeSseConn();
  const timers = fakeTimers();

  const done = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: client.conn,
    timers, timeoutMs: 30_000, onClientClose: client.onClientClose,
  });
  await flush();

  client.close(); // 等待中断连 → 该生命周期走 closed 终态（静默，无 RESPOND）
  const stats = await done;
  assert.equal(client.frames.length, 0, '断连不产生任何帧');
  assert.equal(stats.pushes, 0);
  assert.equal(timers.pendingCount(), 0, 'CLEANUP 已拆一次性定时器');

  // 断连后 publish 不再送达（引擎已注销唤醒订阅、循环已退出）。
  delivery.publish(STREAM, [{ type: 'late' }]);
  await flush();
  assert.equal(client.frames.length, 0);
});

test('SSE · 断线重连从游标续读：新连接（模拟进程重建的新 delivery）只收未 ack 的事件', async () => {
  const { logStore, delivery } = build();
  const first = fakeSseConn();
  const timers = fakeTimers();

  delivery.publish(STREAM, [{ type: 'seen-1' }, { type: 'seen-2' }]);
  const done1 = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: first.conn,
    timers, timeoutMs: 30_000, onClientClose: first.onClientClose,
  });
  await flush();
  assert.equal(logStore.getCursor(STREAM, 'viewer'), 2);
  first.close();
  await done1;

  // 掉线期间又发了 2 条；"进程崩溃重建" = 同一 logStore、全新 delivery 实例。
  delivery.publish(STREAM, [{ type: 'missed-1' }]);
  const rebuilt = createDelivery({ logStore, wakeup: fakeWakeup(), longPoll });
  rebuilt.publish(STREAM, [{ type: 'missed-2' }]);

  const second = fakeSseConn();
  const done2 = serveSse({
    delivery: rebuilt, streamId: STREAM, group: 'viewer', conn: second.conn,
    timers: fakeTimers(), timeoutMs: 30_000, onClientClose: second.onClientClose,
  });
  await flush();
  const types = second.frames.map((f) => JSON.parse(f.replace(/^id: \d+\ndata: /, '').trim()))
    .flat().map((e) => e.type);
  assert.deepEqual(types, ['missed-1', 'missed-2'], '重连只补游标之后的事件，已 ack 的不重推');

  second.close();
  await done2;
});

test('SSE · conn port 与 channels（WS 形态）同形状互换：同一个 conn 对象既收广播帧又收 SSE 帧', async () => {
  const { delivery } = build();
  const client = fakeSseConn();
  const timers = fakeTimers();

  // 同一个 conn 对象接入 WS 形态的 channels 广播——port 形状 {send, isOpen} 通用。
  const channels = createChannels();
  channels.join('room-1', client.conn);
  channels.broadcast('room-1', { hello: 'ws-shape' });
  assert.equal(client.frames.length, 1);
  assert.equal(client.frames[0], JSON.stringify({ hello: 'ws-shape' }));

  const done = serveSse({
    delivery, streamId: STREAM, group: 'viewer', conn: client.conn,
    timers, timeoutMs: 30_000, onClientClose: client.onClientClose,
  });
  await flush(); // 让第一个生命周期完成 SUBSCRIBE（见 contract：initial pull→SUBSCRIBE 微任务窗口由超时兜底）
  delivery.publish(STREAM, [{ type: 'sse-shape' }]);
  await flush();
  assert.equal(client.frames.length, 2, '广播帧 + SSE 帧落在同一 conn');
  assert.match(client.frames[1], /^id: 1\ndata: /, 'SSE 帧形状（formatSseFrame）');
  assert.match(client.frames[1], /sse-shape/);

  client.close();
  await done;
});
