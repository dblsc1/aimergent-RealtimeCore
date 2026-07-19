// realtime_core · session/delivery.js（P3a）
//
// 投递层：把"日志 + 游标"组合成消费组视角的 publish / pull / ack / subscribe。
// 投递 = "给我 seq > 游标的事件"——从结构上消灭"丢投递"：漏掉的事件永远还在
// 游标后面等着，下次 pull 必然再见。
//
//   - pull/ack 分离 ⇒ at-least-once：pull 不动游标，ack 才前移；同 group 多
//     连接共享一枚游标（都收到，ack 一次即前移）。
//   - subscribe **复用 P2 transport 的 longPoll/wakeup 等待机制**——本文件不
//     import transport（纯度红线），而是把 longPoll 当能力注入：
//     `createDelivery({ logStore, wakeup, longPoll })`。subscribe 只做组装
//     （attempt=pull、classify=有事件即终、wakeOn='appended'、pollKey=streamId），
//     等待/唤醒/超时/断连全部由 P2 引擎执行，session/ 零自制轮询。
//   - publish 每次 append 后 `wakeup.emit(streamId, 'appended')`，正好命中
//     engine.js SUBSCRIBE 的 `sid === pollKey` 过滤。
//
// 崩溃恢复语义（不变量 4 的落点）：本层的内存态只有两样，且都可从 logStore
// 重建或安全归零——
//   - lastSeqCache（publish 用的尾指针缓存）：懒重建（全量 read 数一遍）；
//     缓存过期由 append 的 CAS 兜底（ConflictError → 重读重试一次；内存实现
//     同步无 await，重读后不可能再冲突）。
//   - pulledHigh（每 (stream,group) 已 pull 到的最高 seq）：崩溃即丢，重建后
//     基线回退到游标——于是"重启后未重新 pull 就 ack" = RangeError，强迫消费
//     方先重读再确认（不变量 3 的"ack 不得越过已 pull 高水位"）。

export const WAKE_KIND_APPENDED = 'appended';

/**
 * @param {{
 *   logStore: {append: Function, read: Function, getCursor: Function, advanceCursor: Function},
 *   wakeup: {emit: (pollKey: any, kinds: string|string[]) => void,
 *            subscribe: (kinds: string|string[], listener: (pollKey: any) => void) => (() => void)},
 *   longPoll?: (opts: object) => Promise<void>,
 * }} deps `longPoll` 只在用 subscribe 时必需（注入 P2 transport/engine.js 的同名函数）
 */
export function createDelivery ({ logStore, wakeup, longPoll } = {}) {
  for (const method of ['append', 'read', 'getCursor', 'advanceCursor']) {
    if (typeof logStore?.[method] !== 'function') {
      throw new TypeError(`createDelivery requires a logStore with ${method}()`);
    }
  }
  if (typeof wakeup?.emit !== 'function') {
    throw new TypeError('createDelivery requires a wakeup port with emit()');
  }

  const lastSeqCache = new Map(); // streamId → 已知 lastSeq（尾指针缓存）
  const pulledHigh = new Map();   // streamId → Map<group, 已 pull 最高 seq>

  function knownLastSeq (streamId) {
    if (!lastSeqCache.has(streamId)) {
      const all = logStore.read(streamId, 0); // 懒重建：崩溃后第一次 publish 走这里
      lastSeqCache.set(streamId, all.length === 0 ? 0 : all[all.length - 1].seq);
    }
    return lastSeqCache.get(streamId);
  }

  function publish (streamId, events, opts = {}) {
    let appended;
    if (opts.expectedLastSeq !== undefined) {
      // 调用方显式 CAS：冲突原样上抛，由它决定重试还是放弃。
      appended = logStore.append(streamId, opts.expectedLastSeq, events);
    } else {
      // 缺省"追加到尾"：用缓存的尾指针；缓存过期（外部写入者/崩溃重建）由
      // CAS 兜底——冲突即重读真实 lastSeq 再试一次，第二次的错误原样上抛。
      try {
        appended = logStore.append(streamId, knownLastSeq(streamId), events);
      } catch (err) {
        if (err?.name !== 'ConflictError') throw err;
        lastSeqCache.delete(streamId);
        appended = logStore.append(streamId, knownLastSeq(streamId), events);
      }
    }
    lastSeqCache.set(streamId, appended.lastSeq);
    wakeup.emit(streamId, WAKE_KIND_APPENDED);
    return appended;
  }

  function pull (streamId, group, opts = {}) {
    const cursor = logStore.getCursor(streamId, group);
    const batch = logStore.read(streamId, cursor, opts.limit);
    if (batch.length > 0) {
      if (!pulledHigh.has(streamId)) pulledHigh.set(streamId, new Map());
      const perGroup = pulledHigh.get(streamId);
      const high = batch[batch.length - 1].seq;
      if (high > (perGroup.get(group) ?? 0)) perGroup.set(group, high);
    }
    return batch;
  }

  function ack (streamId, group, seq) {
    if (!Number.isInteger(seq) || seq < 1) {
      throw new TypeError('seq must be a positive integer');
    }
    const cursor = logStore.getCursor(streamId, group);
    const high = pulledHigh.get(streamId)?.get(group) ?? cursor;
    if (seq > high) {
      throw new RangeError(`ack(${seq}) for (${streamId}, ${group}) passes the pulled high-water mark ${high}: pull before you ack`);
    }
    logStore.advanceCursor(streamId, group, seq); // 回退/越界在端口层再守一道
  }

  function subscribe (streamId, group, opts = {}) {
    if (typeof longPoll !== 'function') {
      throw new TypeError('subscribe requires createDelivery({ ..., longPoll }) — inject transport/engine.js longPoll');
    }
    if (typeof wakeup?.subscribe !== 'function') {
      throw new TypeError('subscribe requires a wakeup port with subscribe()');
    }
    const { timers, timeoutMs, respond, onClientClose, limit, registry, key } = opts;
    return longPoll({
      wakeup,
      timers,
      pollKey: streamId,
      wakeOn: WAKE_KIND_APPENDED,
      attempt: () => Promise.resolve(pull(streamId, group, { limit })),
      classify: (batch) => (batch.length > 0 ? { terminal: true, payload: batch } : { terminal: false }),
      timeoutMs,
      respond,
      onClientClose,
      registry,
      key,
    });
  }

  return { publish, pull, ack, subscribe };
}
