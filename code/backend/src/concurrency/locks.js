// block-3 session-state · locks.js（Wave 1a）
//
// byte-faithful 原样搬自老仓 copycat-v5 backend/src/services/locks.js
// （只读参考，未改一字函数面/语义）：keyed promise-chain 串行化，非重入、无超时、
// 错误不断链（`prev.then(fn, fn)` —— 前一环无论 resolve 还是 reject 都会继续跑
// 下一环）。这是进程内锁，不是 DB 事务；不加可重入/超时/事务（那是 Step 5）。
//
// 特征测试见 locks.mirror.test.mjs（镜像 characterization/01-session-state/locks.test.mjs
// 的全部 8 条断言，指向本文件）。

const chains = new Map();

export function withLock (key, fn) {
  const k = String(key || 'global');
  const prev = chains.get(k) || Promise.resolve();
  const next = prev.then(fn, fn);
  const stored = next.catch(() => {}).finally(() => {
    if (chains.get(k) === stored) chains.delete(k);
  });
  chains.set(k, stored);
  return next;
}

export function sessionLockKey (sessionId) {
  return `session:${String(sessionId || '').trim() || 'unknown'}`;
}

export function skillLockKey (skillId) {
  return `skill:${String(skillId || '').trim() || 'unknown'}`;
}
