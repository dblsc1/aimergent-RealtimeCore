// realtime_core · reference/classroom-feed.ref.mjs（P3a · scope 外参考示例）
//
// 最小"课堂事件流"示例：teacher / student / parent 三个消费组订阅同一条课堂
// 流，各自独立进度；断线重连 = 丢内存、仅凭 logStore 重建、从游标续读。
// 领域词只许出现在 reference/（任务单 §6）——本文件是领域适配薄壳，不属对外
// 契约面，是"游标投递层能承载真实多组消费形态"的机械证明。
//
// 组装方式即消费方最佳实践：logStore（持久化幸存者）与 delivery（可弃内存壳）
// 分开持有；等待机制经 longPoll 注入复用 P2 引擎，不自制轮询。

import { createDelivery } from '../src/session/delivery.js';

export const CLASSROOM_GROUPS = Object.freeze(['teacher', 'student', 'parent']);

/**
 * @param {{
 *   logStore: object,           // session/memory-log-store.js 形状（真实场景换持久化适配器）
 *   wakeup: object,             // createWakeupPort 形状 {emit, subscribe}
 *   longPoll?: Function,        // transport/engine.js 的 longPoll（用 waitFor 时必需）
 *   classId: string,
 * }} deps
 */
export function createClassroomFeed ({ logStore, wakeup, longPoll, classId }) {
  const delivery = createDelivery({ logStore, wakeup, longPoll });
  const streamId = `classroom-${classId}`;

  return {
    streamId,

    /** 老师端发布一条课堂事件（lesson-started / answer-submitted / …）。 */
    post (type, payload, v = 1) {
      return delivery.publish(streamId, [{ type, v, payload }]);
    },

    /** 某组拉取自己游标之后的未确认事件（不自动 ack——收到 ≠ 确认）。 */
    fetchFor (group, limit) {
      return delivery.pull(streamId, group, { limit });
    },

    /** 某组确认已处理到 seq（前缀确认，游标前移）。 */
    confirmFor (group, seq) {
      delivery.ack(streamId, group, seq);
    },

    /** 某组长轮询等待新事件（复用 P2 longPoll/wakeup，有新事件即唤醒）。 */
    waitFor (group, opts) {
      return delivery.subscribe(streamId, group, opts);
    },

    /** 某组当前进度（= 持久化游标，重启后依旧）。 */
    progressOf (group) {
      return logStore.getCursor(streamId, group);
    },
  };
}
