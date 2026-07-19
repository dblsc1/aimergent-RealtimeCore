// realtime_core · session/aggregate-runtime.js（P3b）
//
// 聚合运行时 = 信箱（锁串行）+ 日志（CAS append）+ 快照（滚动检查点）。把纯
// 聚合（decide/evolve）接到 P3a 的日志/游标上，跑完整"命令 → 事件 → 状态"闭环。
//
//   execute(streamId, command, ctx) → { events, state } | { rejected }
//   load(streamId)                  → state（快照 + 尾部重放）
//
// execute 全程在 locks.withLock('stream:<id>') 内：load → decide → append(CAS,
// expectedLastSeq=重放高水位) → evolve 应用 → 可选存快照。**两道防线**：信箱串行
// 是第一道，CAS 是第二道（与 P3a 语义衔接）。CAS 冲突 = 编程错/并发漏网 →
// 响亮 throw（ConflictError 由 delivery.publish 原样上抛，绝不静默重试吞掉——
// 那会把"锁失效"这种 bug 藏起来）。
//
// **append 路径唯一**（任务单 §2 硬约束）：execute 不自写日志，而是**复用 P3a
// delivery.publish**（显式 expectedLastSeq 走严格 CAS + wakeup.emit('appended')）。
// 于是全库只有一条 append 路径，投递层与聚合层的写日志语义**逐字一致**，不存在
// 第二条可能漂移的写路径。wakeup 可选：未注入则用 no-op（纯聚合场景无订阅者）。
//
// **evolve 单一折叠路径**：execute 追加后**读回**刚落盘的信封，用与 load 完全
// 相同的 foldEvents(upcast→evolve) 折叠——保证"execute 后的内存态"逐字等于
// "崩溃后从日志重建的状态"（不变量 1），因为两者走的是同一段折叠代码。

import { createDelivery } from './delivery.js';

const noopWakeup = () => ({ emit () {}, subscribe () { return () => {}; } });

/**
 * @param {{
 *   aggregate: object,                 // defineAggregate(...) 的返回
 *   logStore: object,                  // P3a session/memory-log-store.js 形状
 *   locks?: {withLock: (key: string, fn: () => any) => Promise<any>},
 *   wakeup?: {emit: Function, subscribe: Function},
 *   snapshotStore?: {get: Function, put: Function},
 *   snapshotEvery?: number,            // 默认 50 事件滚动落快照
 * }} deps
 */
export function createAggregateRuntime ({
  aggregate, logStore, locks, wakeup, snapshotStore, snapshotEvery = 50,
} = {}) {
  if (aggregate === null || typeof aggregate !== 'object' || typeof aggregate.decideCommand !== 'function') {
    throw new TypeError('createAggregateRuntime requires an aggregate from defineAggregate()');
  }
  for (const method of ['append', 'read']) {
    if (typeof logStore?.[method] !== 'function') {
      throw new TypeError(`createAggregateRuntime requires a logStore with ${method}()`);
    }
  }
  if (snapshotStore !== undefined) {
    for (const method of ['get', 'put']) {
      if (typeof snapshotStore?.[method] !== 'function') {
        throw new TypeError(`createAggregateRuntime snapshotStore must have ${method}()`);
      }
    }
  }
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) {
    throw new TypeError('snapshotEvery must be a positive integer');
  }

  // 复用 P3a 投递层的 publish 作为唯一 append 路径（wakeup 可选）。
  const delivery = createDelivery({ logStore, wakeup: wakeup ?? noopWakeup() });

  /** 与 load 共用的折叠：逐条 upcast→evolve（不变量 1 的"单一折叠路径"）。 */
  function foldEvents (state, envelopes) {
    let next = state;
    for (const envelope of envelopes) next = aggregate.applyEvent(next, envelope);
    return next;
  }

  /** 快照 + 尾部重放，返回 { state, lastSeq }。lastSeq = 重放高水位（CAS 基准）。 */
  function replay (streamId) {
    let base = aggregate.initial();
    let baseSeq = 0;
    if (snapshotStore !== undefined) {
      const snap = snapshotStore.get(streamId);
      // schema 不匹配（聚合逻辑已演进）= 快照失效 → 丢弃、从 0 全量重建（保守）。
      if (snap !== undefined && snap.aggregateSchemaVersion === aggregate.schemaVersion) {
        base = snap.state;
        baseSeq = snap.lastSeq;
      }
    }
    const tail = logStore.read(streamId, baseSeq);
    const state = foldEvents(base, tail);
    const lastSeq = tail.length === 0 ? baseSeq : tail[tail.length - 1].seq;
    return { state, lastSeq };
  }

  /** 对外：只取重建后的状态。 */
  function load (streamId) {
    return replay(streamId).state;
  }

  function maybeSnapshot (streamId, priorSeq, newSeq, state) {
    if (snapshotStore === undefined) return;
    // 跨过 snapshotEvery 边界即滚动落快照（确定性：仅取决于 seq，不看时钟）。
    if (Math.floor(newSeq / snapshotEvery) > Math.floor(priorSeq / snapshotEvery)) {
      snapshotStore.put(streamId, {
        state,
        lastSeq: newSeq,
        aggregateSchemaVersion: aggregate.schemaVersion,
      });
    }
  }

  async function runExecute (streamId, command, ctx) {
    // await：真实 logStore 可能是异步适配器——这个让点也让"无锁并发"会真交错，
    // 于是不变量 4 的 CAS 兜底可被测（有锁则串行、零冲突；无锁则响亮冲突）。
    const { state, lastSeq } = await Promise.resolve(replay(streamId));

    const decided = aggregate.decideCommand(state, command, ctx);
    if (typeof decided === 'object' && !Array.isArray(decided) && decided.code !== undefined) {
      // reject：无事件、不动日志、不改状态（不变量 2「拒绝无痕」）。
      return { rejected: { code: decided.code, detail: decided.detail } };
    }
    if (decided.length === 0) {
      // decide 合法但产出零事件：无痕 no-op（当前状态原样返回）。
      return { events: [], state };
    }

    // 库给每个事件盖"当前版本"章（decide 不管版本）；publish 严格 CAS。
    const toAppend = decided.map((ev) => {
      const stamped = { type: ev.type, v: aggregate.currentVersion(ev.type), payload: ev.payload };
      if (ev.id !== undefined) stamped.id = ev.id;
      return stamped;
    });
    delivery.publish(streamId, toAppend, { expectedLastSeq: lastSeq });

    // 读回刚落盘的信封，用与 load 相同的折叠推进状态（单一折叠路径）。
    const sealed = logStore.read(streamId, lastSeq);
    const newState = foldEvents(state, sealed);
    const newSeq = sealed.length === 0 ? lastSeq : sealed[sealed.length - 1].seq;
    maybeSnapshot(streamId, lastSeq, newSeq, newState);
    return { events: sealed, state: newState };
  }

  function execute (streamId, command, ctx) {
    if (locks !== undefined) {
      if (typeof locks.withLock !== 'function') {
        throw new TypeError('createAggregateRuntime locks must have withLock()');
      }
      return locks.withLock(`stream:${streamId}`, () => runExecute(streamId, command, ctx));
    }
    return runExecute(streamId, command, ctx);
  }

  return { execute, load };
}
