// realtime_core · session/errors.js（P3a）
//
// 会话内核共享错误类型。端口契约（module_docs/contract.md §P3a）规定
// `append` 的 CAS 失手必须抛 ConflictError——未来的持久化适配器复用同一个
// 类，调用方以 `err.name === 'ConflictError'` 识别（不强依赖 instanceof，
// 便于跨 realm / 多份装载场景）。
//
// 游标违规（回退 / 越过日志末尾 / 越过已读高水位）统一用内建 RangeError，
// 不另设类——它们是调用方编程错误，不是可重试的并发冲突（保守决策，见
// worklog 2026-07-19-backend-p3a-log-cursors）。

/**
 * append 乐观并发（CAS）冲突：`expectedLastSeq` 与流当前 lastSeq 不一致。
 * 携带 `streamId` / `expected` / `actual` 供调用方决定重读重试还是放弃。
 */
export class ConflictError extends Error {
  /**
   * @param {{streamId: string, expected: number, actual: number}} info
   */
  constructor ({ streamId, expected, actual }) {
    super(`append conflict on stream "${streamId}": expectedLastSeq=${expected}, actual lastSeq=${actual}`);
    this.name = 'ConflictError';
    this.streamId = streamId;
    this.expected = expected;
    this.actual = actual;
  }
}
