// 特征测试 · locks.js P2 新增 awaitIdle()（优雅停机原语）。
// 既有 8 条锁语义断言在 locks.mirror.test.mjs（P1 逐字），本文件只测新增导出。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLock, awaitIdle } from './locks.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('awaitIdle · 无在飞锁时同步 resolve', async () => {
  await awaitIdle();  // 不挂起
  assert.ok(true);
});

test('awaitIdle · 等所有 key 的链排空后才 resolve', async () => {
  const order = [];
  let releaseA;
  const a = withLock('key-a', () => new Promise((res) => { releaseA = () => { order.push('a'); res(); }; }));
  const b = withLock('key-b', () => new Promise((res) => setTimeout(() => { order.push('b'); res(); }, 5)));

  let idleResolved = false;
  const idle = awaitIdle().then(() => { idleResolved = true; });

  await tick();
  assert.equal(idleResolved, false, 'A 未释放前不应 idle');

  releaseA();
  await idle;
  assert.equal(idleResolved, true, '两条链都排空后 idle resolve');
  assert.deepEqual(order.sort(), ['a', 'b']);
  await a; await b;
});

test('awaitIdle · 错误不断链也能排空（withLock 用 prev.then(fn,fn)，reject 不卡 idle）', async () => {
  const failing = withLock('key-x', () => Promise.reject(new Error('boom')));
  await failing.catch(() => {});
  // 即便上一环 reject，链尾自吞错，awaitIdle 不 reject、正常 resolve。
  await awaitIdle();
  assert.ok(true);
});
