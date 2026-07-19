// block-3 session-state · locks.mirror.test.mjs（Wave 1a）
//
// 镜像 characterization/01-session-state/locks.test.mjs 的全部 8 条断言，
// 指向新 locks.js（同函数面：withLock/sessionLockKey/skillLockKey），验证
// "只拆不改" 没有引入行为漂移。每条测试标题末尾用
// `[mirror: <老测试标题片段>]` 标注对应关系，方便审核对照。
//
// locks.js 零依赖（不需要 db/env fixture），故这里不走 helpers/old-src.mjs，
// 直接静态 import 新文件；sleep 就地内联（同 characterization/helpers/fixtures.mjs
// 的实现，避免从 src/ 深处相对 import characterization/ 带来路径脆弱性）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLock, sessionLockKey, skillLockKey } from './locks.js';

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('locks.js · sessionLockKey / skillLockKey 格式化 [mirror: sessionLockKey / skillLockKey 格式化]', () => {
  assert.equal(sessionLockKey('abc'), 'session:abc');
  assert.equal(skillLockKey('xyz'), 'skill:xyz');
});

test('locks.js · 边界：空/None/纯空白 key 统一落到 "unknown" [mirror: 边界：空/None/纯空白 key 统一落到 "unknown"]', () => {
  assert.equal(sessionLockKey(''), 'session:unknown');
  assert.equal(sessionLockKey(null), 'session:unknown');
  assert.equal(sessionLockKey(undefined), 'session:unknown');
  assert.equal(sessionLockKey('   '), 'session:unknown');
  assert.equal(skillLockKey(undefined), 'skill:unknown');
});

test('locks.js · withLock 同一 key 严格串行、按提交顺序执行（不是按完成顺序） [mirror: withLock 同一 key 严格串行、按提交顺序执行]', async () => {
  const order = [];
  const key = `k-${Date.now()}`;
  // 故意让先提交的任务耗时更长，如果不是真串行、只是简单 Promise.all 那种并发，
  // order 就会变成 [b, a, c] 而不是 [a, b, c]。
  const pA = withLock(key, async () => { await sleep(30); order.push('a'); });
  const pB = withLock(key, async () => { await sleep(5); order.push('b'); });
  const pC = withLock(key, async () => { order.push('c'); });
  await Promise.all([pA, pB, pC]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('locks.js · 不同 key 互不阻塞，可并发执行 [mirror: 不同 key 互不阻塞，可并发执行]', async () => {
  const start = Date.now();
  const keyA = `ka-${Date.now()}`;
  const keyB = `kb-${Date.now()}`;
  await Promise.all([
    withLock(keyA, async () => { await sleep(60); }),
    withLock(keyB, async () => { await sleep(60); }),
  ]);
  const elapsed = Date.now() - start;
  // 如果两个 key 串行了会 >=120ms；并发的话应该在一个 60ms 窗口左右完成。
  assert.ok(elapsed < 110, `expected concurrent keys to overlap, elapsed=${elapsed}ms`);
});

test('locks.js · 队列中某一环任务抛错，不阻断同 key 后续排队任务、也不影响其结果 [mirror: 队列中某一环任务抛错，不阻断同 key 后续排队任务]', async () => {
  const key = `err-${Date.now()}`;
  const order = [];
  const pA = withLock(key, async () => { order.push('a'); throw new Error('boom-a'); });
  const pB = withLock(key, async () => { order.push('b'); return 'b-result'; });
  const pC = withLock(key, async () => { order.push('c'); return 'c-result'; });

  await assert.rejects(pA, /boom-a/);
  assert.equal(await pB, 'b-result');
  assert.equal(await pC, 'c-result');
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('locks.js · withLock 返回值：调用方拿到的是 fn 自己的 resolve/reject，不是链条整体状态 [mirror: withLock 返回值：调用方拿到的是 fn 自己的 resolve/reject]', async () => {
  const key = `retval-${Date.now()}`;
  const r1 = await withLock(key, async () => 42);
  assert.equal(r1, 42);
});

test('locks.js · 并发读改写不损坏：多个任务对同一个内存计数器 +1，withLock 保证不丢更新 [mirror: 并发读改写不损坏]', async () => {
  const key = `counter-${Date.now()}`;
  const counter = { value: 0 };
  const N = 25;
  const tasks = Array.from({ length: N }, () => withLock(key, async () => {
    const before = counter.value;
    // 故意插入一次微任务让位，模拟读-await-改-写之间的竞态窗口
    await sleep(1);
    counter.value = before + 1;
  }));
  await Promise.all(tasks);
  assert.equal(counter.value, N, '如果 withLock 没能真正串行化，这里会因为丢更新而小于 N');
});

test('locks.js · 队列清空后 key 会被回收（不会无限增长内部 Map） [mirror: 队列清空后 key 会被回收]', async () => {
  const key = `gc-${Date.now()}`;
  await withLock(key, async () => {});
  // 给内部 finally 的微任务一个机会跑完
  await sleep(5);
  // 队列清空之后，同一个 key 上的下一次调用应该是"从头开始"，而不是排在一条越堆越长的链后面——
  // 通过时间来间接验证：单次任务不该被历史链条拖慢。
  const t0 = Date.now();
  await withLock(key, async () => {});
  assert.ok(Date.now() - t0 < 20);
});
