// block-4 可复用实时引擎 · channels.test.mjs（Wave 1a）
//
// 覆盖：join/leave/count、broadcast 只发 `isOpen()===true` 的连接、单连接
// send 失败吞掉不影响其余连接、payload 只序列化一次（同一字符串引用发给
// 每个连接）、空/未知 scopeKey 广播是 no-op。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannels } from './channels.js';

function fakeConn ({ open = true, throwOnSend = false } = {}) {
  const sent = [];
  return {
    sent,
    isOpen: () => open,
    send (payload) {
      if (throwOnSend) throw new Error('boom');
      sent.push(payload);
    },
  };
}

test('join/leave/count · 注册表按 scopeKey 隔离', () => {
  const channels = createChannels();
  const a = fakeConn();
  const b = fakeConn();
  channels.join('class-1', a);
  channels.join('class-1', b);
  channels.join('class-2', fakeConn());
  assert.equal(channels.count('class-1'), 2);
  assert.equal(channels.count('class-2'), 1);
  assert.equal(channels.count('never-joined'), 0);

  channels.leave('class-1', a);
  assert.equal(channels.count('class-1'), 1);
  // leave 一个从未 join 过的连接是 no-op，不抛
  channels.leave('class-1', fakeConn());
  assert.equal(channels.count('class-1'), 1);
});

test('broadcast · 只发给 isOpen()===true 的连接，closed 连接跳过且不报错', () => {
  const channels = createChannels();
  const open1 = fakeConn({ open: true });
  const open2 = fakeConn({ open: true });
  const closed = fakeConn({ open: false });
  channels.join('room', open1);
  channels.join('room', open2);
  channels.join('room', closed);

  channels.broadcast('room', { type: 'ping' });

  assert.equal(open1.sent.length, 1);
  assert.equal(open2.sent.length, 1);
  assert.equal(closed.sent.length, 0);
});

test('broadcast · 单连接 send 抛错被吞掉，不阻断其余连接接收', () => {
  const channels = createChannels();
  const broken = fakeConn({ open: true, throwOnSend: true });
  const healthy = fakeConn({ open: true });
  channels.join('room', broken);
  channels.join('room', healthy);

  assert.doesNotThrow(() => channels.broadcast('room', { type: 'x' }));
  assert.equal(healthy.sent.length, 1, '坏连接的异常不应阻断其余连接收到广播');
});

test('broadcast · payload 只序列化一次，所有连接收到同一字符串引用', () => {
  const channels = createChannels();
  const a = fakeConn();
  const b = fakeConn();
  channels.join('room', a);
  channels.join('room', b);

  channels.broadcast('room', { n: 1 });

  assert.equal(a.sent[0], b.sent[0], '两个连接应收到完全相同的已序列化字符串（同一次 JSON.stringify 的结果）');
  assert.equal(a.sent[0], JSON.stringify({ n: 1 }));
});

test('broadcast · 空 scopeKey / 未知 scopeKey 是 no-op，不抛', () => {
  const channels = createChannels();
  assert.doesNotThrow(() => channels.broadcast('nobody-here', { x: 1 }));
  const conn = fakeConn();
  channels.join('room', conn);
  channels.leave('room', conn);
  assert.doesNotThrow(() => channels.broadcast('room', { x: 1 }));
  assert.equal(conn.sent.length, 0);
});
