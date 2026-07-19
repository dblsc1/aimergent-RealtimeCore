// realtime_core · session/memory-log-store.js（P3a）
//
// 存储端口（port）的内存参考实现——"记账本 + 书签"：
//   - 记账本：每个流（streamId）一本 append-only 事件日志，seq 连续从 1 起。
//   - 书签：每个 (streamId, group) 一枚持久化游标（无记录 = 0），只许前进。
//
// 端口契约（真实持久化适配器照此实现，本期不交付）：
//   append(streamId, expectedLastSeq, events) → {lastSeq} | throw ConflictError
//     CAS 乐观并发：expectedLastSeq ≠ 当前 lastSeq 即冲突（信箱串行是第一道
//     防线，CAS 是第二道，同构于铁律 15④"远端拒非 fast-forward"）。原子：
//     一批事件先全部封好、再一次性提交，不存在半批可见状态。
//   read(streamId, fromSeqExclusive, limit?) → events[]
//     返回 seq > fromSeqExclusive 的事件（冻结信封），最多 limit 条。
//   getCursor(streamId, group) → seq（无记录 = 0）
//   advanceCursor(streamId, group, seq) → void
//     只许前进：seq < 当前游标 = throw RangeError（回退）；seq === 当前游标 =
//     幂等 no-op（重复 ack 合法，at-least-once 语义的自然结果）；seq > 日志
//     lastSeq = throw RangeError（不能给不存在的事件立书签）。
//
// 非确定性走注入：createMemoryLogStore({ clock, rng })，缺失即 TypeError
// （铁律 2 精神：关键注入缺失 = 启动报错，不做弱默认值兜底）。

import { ConflictError } from './errors.js';
import { sealEnvelopes } from './envelope.js';

function assertName (value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInt (value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

/**
 * 创建一个独立的内存日志存储实例（每次调用得到全新状态，互不干扰）。
 * @param {{clock: () => number, rng: () => number}} ctx 注入的时钟与随机源
 * @returns {{
 *   append: (streamId: string, expectedLastSeq: number, events: object[]) => {lastSeq: number},
 *   read: (streamId: string, fromSeqExclusive: number, limit?: number) => object[],
 *   getCursor: (streamId: string, group: string) => number,
 *   advanceCursor: (streamId: string, group: string, seq: number) => void,
 * }}
 */
export function createMemoryLogStore ({ clock, rng } = {}) {
  if (typeof clock !== 'function') throw new TypeError('createMemoryLogStore requires an injected clock() function');
  if (typeof rng !== 'function') throw new TypeError('createMemoryLogStore requires an injected rng() function');

  const streams = new Map(); // streamId → envelope[]（seq = index+1，连续）
  const cursors = new Map(); // streamId → Map<group, seq>

  function append (streamId, expectedLastSeq, events) {
    assertName(streamId, 'streamId');
    assertNonNegativeInt(expectedLastSeq, 'expectedLastSeq');
    const log = streams.get(streamId) ?? [];
    const actual = log.length; // seq 连续从 1 起 ⇒ lastSeq === length
    if (expectedLastSeq !== actual) {
      throw new ConflictError({ streamId, expected: expectedLastSeq, actual });
    }
    // 先全部封好（校验失败在此抛出，日志分毫未动），再一次性提交。
    const sealed = sealEnvelopes({ streamId, lastSeq: actual, events, clock, rng });
    if (!streams.has(streamId)) streams.set(streamId, log);
    for (const envelope of sealed) log.push(envelope);
    return { lastSeq: log.length };
  }

  function read (streamId, fromSeqExclusive, limit) {
    assertName(streamId, 'streamId');
    assertNonNegativeInt(fromSeqExclusive, 'fromSeqExclusive');
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new TypeError('limit must be a positive integer when supplied');
    }
    const log = streams.get(streamId) ?? [];
    const end = limit === undefined ? log.length : fromSeqExclusive + limit;
    return log.slice(fromSeqExclusive, end);
  }

  function getCursor (streamId, group) {
    assertName(streamId, 'streamId');
    assertName(group, 'group');
    return cursors.get(streamId)?.get(group) ?? 0;
  }

  function advanceCursor (streamId, group, seq) {
    assertName(streamId, 'streamId');
    assertName(group, 'group');
    if (!Number.isInteger(seq) || seq < 1) {
      throw new TypeError('seq must be a positive integer');
    }
    const current = getCursor(streamId, group);
    if (seq < current) {
      throw new RangeError(`cursor for (${streamId}, ${group}) may only advance: ${current} → ${seq} is a rollback`);
    }
    if (seq === current) return; // 幂等重 ack
    const lastSeq = (streams.get(streamId) ?? []).length;
    if (seq > lastSeq) {
      throw new RangeError(`cursor for (${streamId}, ${group}) cannot pass the log end: seq=${seq} > lastSeq=${lastSeq}`);
    }
    if (!cursors.has(streamId)) cursors.set(streamId, new Map());
    cursors.get(streamId).set(group, seq);
  }

  return { append, read, getCursor, advanceCursor };
}
