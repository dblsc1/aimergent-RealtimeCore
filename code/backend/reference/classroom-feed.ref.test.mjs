// realtime_core · reference/classroom-feed.ref.test.mjs（P3a）
//
// 课堂事件流参考示例的特征测试：三组独立进度 / 断线重连从游标续读 /
// 订阅唤醒（真实 P2 longPoll）——演示层验收，领域词合法出现于 reference/。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longPoll } from '../src/transport/engine.js';
import { createMemoryLogStore } from '../src/session/memory-log-store.js';
import { createClassroomFeed, CLASSROOM_GROUPS } from './classroom-feed.ref.mjs';

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

function fakeTimers () {
  let nextId = 1;
  const pending = new Map();
  return {
    set (fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear (id) { pending.delete(id); },
  };
}

function flush () { return new Promise((resolve) => setTimeout(resolve, 0)); }

function build () {
  const logStore = createMemoryLogStore(fixedCtx());
  const wakeup = fakeWakeup();
  const feed = createClassroomFeed({ logStore, wakeup, longPoll, classId: 'class-42' });
  return { logStore, wakeup, feed };
}

test('classroom-feed · teacher/student/parent 三组订阅同一流，各自独立进度互不干扰', () => {
  const { feed } = build();
  feed.post('lesson-started', { lessonId: 'L1' });
  feed.post('answer-submitted', { student: 'stu-1', correct: true });
  feed.post('answer-submitted', { student: 'stu-2', correct: false });

  // teacher 全部处理完；student 只处理到第 1 条；parent 还没上线。
  const teacherBatch = feed.fetchFor('teacher');
  assert.equal(teacherBatch.length, 3);
  feed.confirmFor('teacher', 3);
  feed.fetchFor('student');
  feed.confirmFor('student', 1);

  assert.equal(feed.progressOf('teacher'), 3);
  assert.equal(feed.progressOf('student'), 1);
  assert.equal(feed.progressOf('parent'), 0);

  // student 续读只见未确认的 2..3；parent 从头见全部。
  assert.deepEqual(feed.fetchFor('student').map((e) => e.seq), [2, 3]);
  assert.deepEqual(feed.fetchFor('parent').map((e) => e.seq), [1, 2, 3]);
  assert.equal(CLASSROOM_GROUPS.length, 3);
});

test('classroom-feed · 断线重连：丢弃 feed 内存、仅凭 logStore 重建，各组从持久化游标续读不重不漏', () => {
  const { logStore, feed } = build();
  feed.post('lesson-started', { lessonId: 'L1' });
  feed.post('answer-submitted', { student: 'stu-1' });
  feed.fetchFor('teacher');
  feed.confirmFor('teacher', 1);

  // "断线"：老 feed 直接丢弃，仅 logStore 幸存；重建后继续。
  const rebuilt = createClassroomFeed({ logStore, wakeup: fakeWakeup(), longPoll, classId: 'class-42' });
  assert.equal(rebuilt.progressOf('teacher'), 1, '游标持久化在 logStore，重建后进度还在');
  assert.deepEqual(rebuilt.fetchFor('teacher').map((e) => e.seq), [2], '已确认的 seq 1 不重放，未确认的 seq 2 必重见');
  rebuilt.post('lesson-ended', {});
  assert.deepEqual(rebuilt.fetchFor('teacher').map((e) => e.seq), [2, 3], '重建后继续发布，续读无缝衔接');
});

test('classroom-feed · waitFor 经真实 P2 longPoll 等待：post 即唤醒，收到自己游标后的批次', async () => {
  const { feed } = build();
  const responded = [];
  const done = feed.waitFor('parent', {
    timers: fakeTimers(),
    timeoutMs: 5000,
    respond: {
      settled: (batch) => responded.push(batch),
      timeout: () => responded.push('timeout'),
      error: (err) => responded.push(err),
    },
    onClientClose: () => () => {},
  });
  await flush();
  assert.deepEqual(responded, [], '无新事件时保持长轮询等待');

  feed.post('lesson-started', { lessonId: 'L2' });
  await done;
  assert.equal(responded.length, 1);
  assert.deepEqual(responded[0].map((e) => e.type), ['lesson-started']);
});
