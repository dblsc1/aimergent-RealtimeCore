// block-3 session-state · core/ordering.js（Wave 0）
//
// 老源 services/sessionEvents.js 的 orderedSessionEvents/maxEventSeq 逐字节
// 搬迁——两者都是 100% 纯函数（不读时钟/随机数/io），直接读 session.rounds
// 结构做投影/统计。`currentSessionEvent`（老源同文件里紧邻这两个函数）
// 需要先跑 `ensureSessionEventQueue`（懒迁移+补 seq+折叠，会改 session），
// 因此改放进 core/transitions.js 与其余"读前先规整"的函数放一起，避免
// ordering.js↔normalize.js 出现循环依赖（行为不变，只是文件边界比 arbiter
// 设计文档 §1 的建议表更靠"依赖方向不回头"，已在 worklog 记录这处偏移）。

/**
 * 按 seq → createdAt → round 排序展开全部事件（跨 round 摊平）。
 * `options.assignMissing` 是老源留下的哑参数——老代码两个分支的 push 逻辑
 * 完全相同（死代码），这里保留参数位保证调用签名兼容，但不再分支。
 * @param {object} session
 * @param {{assignMissing?: boolean}} [options]
 * @returns {Array<{event: object, slot: object, round: number}>}
 */
export function orderedSessionEvents (session, options = {}) {
  void options; // 老源里的哑分支保留参数位、不再分支（见上方注释）
  const out = [];
  for (const [idx, slot] of (session?.rounds || []).entries()) {
    if (!slot) continue;
    const round = Number(slot.round || idx + 1);
    for (const event of slot._events || []) {
      if (!event?.type) continue;
      out.push({ event, slot, round });
    }
  }
  return out.sort((a, b) =>
    Number(a.event.seq || 0) - Number(b.event.seq || 0) ||
    Number(a.event.createdAt || 0) - Number(b.event.createdAt || 0) ||
    a.round - b.round
  );
}

/**
 * 全 session 里出现过的最大 seq（未出现任何事件时为 0）。
 * 老源对 `session` 不做 null 兜底（直接 `session.rounds || []`）——保留同样
 * 的崩溃行为：传 null 会抛，调用方（ensureSessionEventQueue）已经在更早
 * 处理了 null session，不会把 null 递进来。
 * @param {object} session
 * @returns {number}
 */
export function maxEventSeq (session) {
  let max = 0;
  for (const slot of session.rounds || []) {
    for (const event of slot?._events || []) {
      const seq = Number(event.seq || 0);
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  }
  return max;
}
