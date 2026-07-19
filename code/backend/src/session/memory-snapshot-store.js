// realtime_core · session/memory-snapshot-store.js（P3b）
//
// 快照存储端口（port）的内存参考实现——聚合状态的滚动检查点：
//   get(streamId) → {state, lastSeq, aggregateSchemaVersion} | undefined
//   put(streamId, {state, lastSeq, aggregateSchemaVersion})   （只保留最新一枚）
//
// 重放 = 取快照（若有）+ read(lastSeq 之后) 逐条 upcast+evolve。快照只是加速：
// 丢了快照也能从日志全量重建（不变量 1 的"缺快照"形态）。
//
// **防御性深拷贝**（保守取向，见 worklog）：put 时拷贝存入、get 时拷贝取出——
// 快照一旦落定就是与调用方内存态**隔离**的不可变检查点，即便调用方后续（误）
// 改了 state 引用也污染不到快照，反之亦然。这是"崩溃重建 === 一路 evolve"确定性
// 不变量的护栏。代价是拷贝开销；真实持久化适配器天然序列化，无此顾虑。
// 要求：state 必须是 structuredClone 可克隆的纯数据（无函数/类实例）。

function assertName (value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

/**
 * 创建一个独立的内存快照存储实例。
 * @returns {{
 *   get: (streamId: string) => {state: object, lastSeq: number, aggregateSchemaVersion: number} | undefined,
 *   put: (streamId: string, snapshot: {state: object, lastSeq: number, aggregateSchemaVersion?: number}) => void,
 * }}
 */
export function createMemorySnapshotStore () {
  const snapshots = new Map(); // streamId → {state, lastSeq, aggregateSchemaVersion}

  function get (streamId) {
    assertName(streamId, 'streamId');
    const snap = snapshots.get(streamId);
    if (snap === undefined) return undefined;
    return {
      state: structuredClone(snap.state),
      lastSeq: snap.lastSeq,
      aggregateSchemaVersion: snap.aggregateSchemaVersion,
    };
  }

  function put (streamId, snapshot) {
    assertName(streamId, 'streamId');
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new TypeError('snapshot must be an object { state, lastSeq, aggregateSchemaVersion? }');
    }
    const { state, lastSeq, aggregateSchemaVersion = 1 } = snapshot;
    if (!Number.isInteger(lastSeq) || lastSeq < 0) {
      throw new TypeError('snapshot.lastSeq must be a non-negative integer');
    }
    if (!Number.isInteger(aggregateSchemaVersion) || aggregateSchemaVersion < 1) {
      throw new TypeError('snapshot.aggregateSchemaVersion must be a positive integer');
    }
    snapshots.set(streamId, {
      state: structuredClone(state),
      lastSeq,
      aggregateSchemaVersion,
    });
  }

  return { get, put };
}
