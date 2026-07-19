// realtime_core · reference/classroom-aggregate.ref.mjs（P3b · scope 外参考示例）
//
// 最小"课堂聚合"示例——**整库第一次三层串起来跑**：
//   聚合层（decide/evolve，本文件的 aggregate）
//     → 日志/游标投递层（P3a delivery：publish/pull/ack/subscribe）
//       → 传输层（P2 longPoll：有新事件即唤醒三组订阅者）
//
// 状态机：idle → (push-question) → asking → (submit-answer) → awaiting-answer
//         任意非 closed → (close) → closed。
// 命令：push-question / submit-answer / close；均经 decide 守卫（不合法 = reject）。
// 含一次 v1→v2 事件演进示例（answer-submitted 加 `via` 字段，upcaster 补 'legacy'）。
//
// 领域词只许出现在 reference/（任务单 §6）——本文件是领域适配薄壳，不属对外契约
// 面，是"聚合内核能承载真实课堂形态、且三层能协同"的机械证明。
//
// 组装即消费方最佳实践：logStore/snapshotStore（持久化幸存者）与 runtime/delivery
// （可弃内存壳）分开持有；等待机制经 longPoll 注入复用 P2 引擎，不自制轮询。

import { defineAggregate, reject } from '../src/session/aggregate.js';
import { createAggregateRuntime } from '../src/session/aggregate-runtime.js';
import { createDelivery } from '../src/session/delivery.js';

export const CLASSROOM_GROUPS = Object.freeze(['teacher', 'student', 'parent']);

const ANSWERING_PHASES = new Set(['asking', 'awaiting-answer']);

// 共享的 decide/evolve（版本无关部分）；answerVersion 决定 answer-submitted 的当前
// 版本与 evolve 读法，用来演示 v1→v2 演进。
function classroomSpec (answerVersion) {
  return {
    name: 'classroom',
    initial: () => ({ phase: 'idle', currentQuestion: null, answers: [] }),
    decide: {
      'push-question': (state, cmd) => (
        state.phase === 'closed'
          ? reject('classroom-closed')
          : [{ type: 'question-pushed', payload: { qid: cmd.qid, text: cmd.text } }]
      ),
      'submit-answer': (state, cmd) => (
        ANSWERING_PHASES.has(state.phase)
          ? [{ type: 'answer-submitted', payload: { qid: cmd.qid, student: cmd.student, choice: cmd.choice } }]
          : reject('no-open-question')
      ),
      close: (state) => (
        state.phase === 'closed' ? reject('already-closed') : [{ type: 'classroom-closed', payload: {} }]
      ),
    },
    evolve: {
      'question-pushed': (state, ev) => ({
        phase: 'asking',
        currentQuestion: { qid: ev.payload.qid, text: ev.payload.text },
        answers: [],
      }),
      'answer-submitted': (state, ev) => ({
        ...state,
        phase: 'awaiting-answer',
        // v2 起 payload 带 `via`（渠道）——旧 v1 事件经 upcaster 补 'legacy'。
        answers: [...state.answers, { student: ev.payload.student, choice: ev.payload.choice, via: ev.payload.via }],
      }),
      'classroom-closed': (state) => ({ ...state, phase: 'closed' }),
    },
    eventVersions: { 'answer-submitted': answerVersion },
    upcasters: {
      // v1（无 via）→ v2（via 缺省 'legacy'）。旧课堂日志重放时消费方永远只见 v2。
      'answer-submitted': { 1: (ev) => ({ ...ev, payload: { ...ev.payload, via: 'legacy' } }) },
    },
    schemaVersion: answerVersion,
  };
}

/** v1 课堂聚合（answer-submitted 当前版本 = 1，payload 无 via）。 */
export function classroomAggregateV1 () {
  const spec = classroomSpec(1);
  // v1 的 decide 不产 via 字段（那时还没这个概念）。
  return defineAggregate(spec);
}

/** v2 课堂聚合（answer-submitted 当前版本 = 2，decide 产 via，evolve 读 via）。 */
export function classroomAggregateV2 () {
  const spec = classroomSpec(2);
  spec.decide = {
    ...spec.decide,
    'submit-answer': (state, cmd) => (
      ANSWERING_PHASES.has(state.phase)
        ? [{ type: 'answer-submitted', payload: { qid: cmd.qid, student: cmd.student, choice: cmd.choice, via: cmd.via ?? 'app' } }]
        : reject('no-open-question')
    ),
  };
  return defineAggregate(spec);
}

/**
 * 组装一间课堂：聚合运行时（写侧）+ 投递（读侧三组订阅），共享同一 logStore/wakeup。
 * @param {{
 *   aggregate: object, logStore: object, wakeup: object,
 *   longPoll?: Function, snapshotStore?: object, locks?: object, classId: string,
 * }} deps
 */
export function createClassroom ({ aggregate, logStore, wakeup, longPoll, snapshotStore, locks, classId }) {
  const streamId = `classroom-${classId}`;
  const runtime = createAggregateRuntime({ aggregate, logStore, wakeup, snapshotStore, locks });
  const delivery = createDelivery({ logStore, wakeup, longPoll });

  return {
    streamId,
    /** 写侧：老师/学生发命令，经 decide→事件→append（复用同一 append 路径）。 */
    send (command, ctx) { return runtime.execute(streamId, command, ctx); },
    /** 当前聚合状态（快照 + 尾部重放；断线重连仅凭 logStore 重建）。 */
    state () { return runtime.load(streamId); },
    /** 读侧：某组拉取自己游标后的未确认事件（不自动 ack）。 */
    fetchFor (group, limit) { return delivery.pull(streamId, group, { limit }); },
    /** 读侧：某组确认到 seq（前缀确认，游标前移）。 */
    confirmFor (group, seq) { delivery.ack(streamId, group, seq); },
    /** 读侧：某组长轮询等待新事件（复用 P2 longPoll/wakeup，有新事件即唤醒）。 */
    waitFor (group, opts) { return delivery.subscribe(streamId, group, opts); },
    /** 某组当前进度（= 持久化游标）。 */
    progressOf (group) { return logStore.getCursor(streamId, group); },
  };
}
