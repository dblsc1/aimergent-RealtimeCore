// block-4 可复用实时引擎 · channels.js（Wave 1a）
//
// 老源 `services/broadcast.js` 的领域无关化版本：`Map<scopeKey, Set<conn>>`
// 注册表，负责 join/leave/broadcast(scopeKey,payload)/count。逐字节忠实老
// `broadcastToClass` 语义（老源只读参考，不是 import）：
//   - classCode → 抽象 scopeKey（调用方决定粒度：班级/学生/任意分组）；
//   - `ws.send` → 注入的 `conn.send`，`ws.readyState === 1` → `conn.isOpen()`；
//   - payload 只 `JSON.stringify` **一次**，复用同一个字符串发给集合里每个连接；
//   - 单个连接 send 失败（抛错）直接吞掉（`try/catch` 忽略），继续发下一个，
//     不从集合里摘除——摘除只在 `leave()` 显式调用时发生（对应老源
//     `close`/`error` 事件里的 `removeTeacher`，那是 L2/调用方接线的职责，
//     不是 channels 本身的职责）。
//
// `conn` 形状：`{ send(payload: string): void, isOpen(): boolean }`——transport
// 无关，测试可注入假 conn（`isOpen()` 返回 false 或 `send` 抛错）。

/**
 * 创建一个独立的 channels 注册表实例（每次调用得到全新的 `Map`，互不干扰，
 * 便于测试与未来多租户场景各自持有一份）。
 * @returns {{
 *   join: (scopeKey: any, conn: {send: Function, isOpen: () => boolean}) => void,
 *   leave: (scopeKey: any, conn: any) => void,
 *   broadcast: (scopeKey: any, payload: any) => void,
 *   count: (scopeKey: any) => number,
 * }}
 */
export function createChannels () {
  const registry = new Map(); // scopeKey → Set<conn>

  function join (scopeKey, conn) {
    if (!registry.has(scopeKey)) registry.set(scopeKey, new Set());
    registry.get(scopeKey).add(conn);
  }

  function leave (scopeKey, conn) {
    registry.get(scopeKey)?.delete(conn);
  }

  function broadcast (scopeKey, payload) {
    const set = registry.get(scopeKey);
    if (!set || set.size === 0) return;
    const serialized = JSON.stringify(payload);
    for (const conn of set) {
      if (!conn.isOpen()) continue;
      try {
        conn.send(serialized);
      } catch {
        // 忽略单个失效连接的发送失败——老源 `catch (_) { /* ignore broken sockets */ }`。
      }
    }
  }

  function count (scopeKey) {
    return registry.get(scopeKey)?.size ?? 0;
  }

  return { join, leave, broadcast, count };
}
