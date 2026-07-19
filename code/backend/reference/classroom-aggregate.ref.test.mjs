// realtime_core · reference/classroom-aggregate.ref.test.mjs（P3b）
//
// 全链路自证：聚合（decide/evolve）+ 投递（游标三组）+ 传输（longPoll 唤醒）三层
// 串起来跑一堂最小课堂——注入**真实** P2 engine.js 的 longPoll（非复制品），证明
// 三层协同无缝。另含 decide 守卫拒绝、断线重连（仅凭 logStore 重建）、v1→v2 事件
// 演进重放。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longPoll } from '../src/transport/engine.js';
import { createMemoryLogStore } from '../src/session/memory-log-store.js';
import { createMemorySnapshotStore } from '../src/session/memory-snapshot-store.js';
import { createAggregateRuntime } from '../src/session/aggregate-runtime.js';
import {
  createClassroom, classroomAggregateV1, classroomAggregateV2, CLASSROOM_GROUPS,
} from './classroom-aggregate.ref.mjs';

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
      return () => { if (!active) return; active = false; for (const kind of list) listeners.get(kind)?.delete(listener); };
    },
    emit (pollKey, kinds) {
      for (const kind of toList(kinds)) for (const l of listeners.get(kind) || []) l(pollKey);
    },
  };
}

function fakeTimers () {
  let nextId = 1; const pending = new Map();
  return {
    set (fn, ms) { const id = nextId++; pending.set(id, { fn, ms }); return id; },
    clear (id) { pending.delete(id); },
    fire (id) { const e = pending.get(id); if (e) { pending.delete(id); e.fn(); } },
  };
}

function flush () { return new Promise((resolve) => setTimeout(resolve, 0)); }

function subscriber (room, group) {
  const received = [];
  const done = room.waitFor(group, {
    timers: fakeTimers(), timeoutMs: 5000,
    respond: {
      settled: (batch) => received.push(...batch),
      timeout: () => received.push('timeout'),
      error: (err) => received.push(['error', err]),
    },
    onClientClose: () => () => {},
  });
  return { received, done };
}

test('全链路自证 · 聚合+投递+传输三层：命令→decide→事件→append→三组订阅各自唤醒收到', async () => {
  const logStore = createMemoryLogStore(fixedCtx());
  const wakeup = fakeWakeup();
  const room = createClassroom({
    aggregate: classroomAggregateV2(), logStore, wakeup, longPoll, classId: 'C1',
  });

  // 三组（teacher/student/parent）各挂一个长轮询订阅，先进入等待。
  const subs = Object.fromEntries(CLASSROOM_GROUPS.map((g) => [g, subscriber(room, g)]));
  await flush();
  for (const g of CLASSROOM_GROUPS) assert.deepEqual(subs[g].received, [], `${g} 初始等待中`);

  // 老师推一道题：decide 守卫通过 → question-pushed 事件 append → wakeup 唤醒三组。
  const r = await room.send({ type: 'push-question', qid: 'q1', text: '2+2=?' });
  assert.equal(r.events.length, 1);
  assert.equal(r.state.phase, 'asking', 'evolve 把状态推进到 asking');
  await Promise.all(CLASSROOM_GROUPS.map((g) => subs[g].done));

  for (const g of CLASSROOM_GROUPS) {
    assert.equal(subs[g].received.length, 1, `${g} 收到一条`);
    assert.equal(subs[g].received[0].type, 'question-pushed');
    assert.equal(subs[g].received[0].seq, 1);
  }

  // 三组独立进度：student 确认，其余不确认。
  room.confirmFor('student', 1);
  assert.equal(room.progressOf('student'), 1);
  assert.equal(room.progressOf('teacher'), 0);
  assert.equal(room.progressOf('parent'), 0);

  // 学生作答：decide 通过（phase=asking）→ 状态到 awaiting-answer；student 已确认 q1，
  // 长轮询会拿到 seq2；teacher/parent 未订阅新轮询，稍后主动 fetch 仍能从各自游标补齐。
  const stu = subscriber(room, 'student');
  await flush();
  const r2 = await room.send({ type: 'submit-answer', qid: 'q1', student: 'alice', choice: 'B', via: 'app' });
  assert.equal(r2.state.phase, 'awaiting-answer');
  assert.deepEqual(r2.state.answers, [{ student: 'alice', choice: 'B', via: 'app' }]);
  await stu.done;
  assert.deepEqual(stu.received.map((e) => e.seq), [2], 'student 从自己游标(1)续到 seq2');

  // teacher 主动补拉：从游标 0 拿到全部两条（未确认 = 未丢）。
  assert.deepEqual(room.fetchFor('teacher').map((e) => e.seq), [1, 2], 'teacher 游标0 → 拿到 q1+answer');
});

test('全链路 · decide 守卫拒绝：closed 后 push-question / 无题时 submit-answer 被拒且无痕', async () => {
  const logStore = createMemoryLogStore(fixedCtx());
  const room = createClassroom({ aggregate: classroomAggregateV2(), logStore, wakeup: fakeWakeup(), classId: 'C2' });

  // idle 时作答 → 无开放题 → reject。
  const bad = await room.send({ type: 'submit-answer', qid: 'q1', student: 'bob', choice: 'A' });
  assert.deepEqual(bad.rejected, { code: 'no-open-question', detail: undefined });
  assert.equal(logStore.read(room.streamId, 0).length, 0, '拒绝无痕：日志为空');

  await room.send({ type: 'push-question', qid: 'q1', text: 'x?' });
  await room.send({ type: 'close' });
  assert.equal(room.state().phase, 'closed');
  const closedPush = await room.send({ type: 'push-question', qid: 'q2', text: 'y?' });
  assert.deepEqual(closedPush.rejected, { code: 'classroom-closed', detail: undefined });
  const closedAgain = await room.send({ type: 'close' });
  assert.deepEqual(closedAgain.rejected, { code: 'already-closed', detail: undefined });
});

test('全链路 · 断线重连：丢 runtime 内存壳，仅凭 logStore(+snapshot) 重建聚合状态', async () => {
  const logStore = createMemoryLogStore(fixedCtx());
  const snaps = createMemorySnapshotStore();
  const room1 = createClassroom({
    aggregate: classroomAggregateV2(), logStore, wakeup: fakeWakeup(), snapshotStore: snaps, classId: 'C3',
  });
  await room1.send({ type: 'push-question', qid: 'q1', text: 'a?' });
  await room1.send({ type: 'submit-answer', qid: 'q1', student: 'ann', choice: 'A', via: 'app' });
  await room1.send({ type: 'submit-answer', qid: 'q1', student: 'ben', choice: 'C', via: 'sms' });
  const before = room1.state();

  // "崩溃"：全新 runtime（弃内存壳），只有 logStore + snapshot 幸存。
  const revived = createAggregateRuntime({
    aggregate: classroomAggregateV2(), logStore, snapshotStore: snaps,
  });
  assert.deepEqual(revived.load(room1.streamId), before, '重建态逐字等于崩溃前');
  assert.equal(before.answers.length, 2);
});

test('全链路 · v1→v2 事件演进：v1 课堂日志（answer-submitted 无 via）经 upcaster 重放，消费方只见 v2（via=legacy）', async () => {
  const logStore = createMemoryLogStore(fixedCtx());
  // 旧代码（v1）写课堂日志：answer-submitted 落盘为 v1（payload 无 via）。
  const roomV1 = createClassroom({ aggregate: classroomAggregateV1(), logStore, wakeup: fakeWakeup(), classId: 'C4' });
  await roomV1.send({ type: 'push-question', qid: 'q1', text: 'z?' });
  await roomV1.send({ type: 'submit-answer', qid: 'q1', student: 'cid', choice: 'D' });
  const raw = logStore.read(roomV1.streamId, 0);
  assert.equal(raw.find((e) => e.type === 'answer-submitted').v, 1, '旧日志里 answer-submitted 是 v1');

  // 代码升级到 v2（answer-submitted 加 via、注册 upcaster）：重放旧日志。
  const roomV2 = createClassroom({ aggregate: classroomAggregateV2(), logStore, wakeup: fakeWakeup(), classId: 'C4' });
  const state = roomV2.state();
  assert.equal(state.phase, 'awaiting-answer');
  assert.deepEqual(state.answers, [{ student: 'cid', choice: 'D', via: 'legacy' }],
    'v1 答案经 upcaster 补 via=legacy，evolve 只见 v2 形状');
});
