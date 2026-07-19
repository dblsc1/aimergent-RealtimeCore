// block-3 session-state · locks.js（Wave 1a · P2 加 awaitIdle）
//
// keyed promise-chain 串行化，非重入、无超时、错误不断链（`prev.then(fn, fn)`
// —— 前一环无论 resolve 还是 reject 都会继续跑下一环）。这是进程内锁，不是 DB
// 事务；不加可重入/超时/事务（那是 Step 5）。`withLock`/`sessionLockKey`/
// `skillLockKey` 三个导出的函数面/语义与 P1 逐字继承的 copycat-v5
// backend/src/services/locks.js 完全一致（byte-faithful，只读参考）。
//
// P2 **新增**导出 `awaitIdle()`——优雅停机原语，等所有 key 的锁链排空后 resolve
// （借鉴 zero-overhead-keyed-promise-lock 的 API 思想，自实现零依赖）。它是
// **纯新增**，不改上述三个函数的既有行为（rules.md §4 逐字遗产：只加不回改）。
//
// 特征测试见 locks.mirror.test.mjs（镜像 characterization/01-session-state/
// locks.test.mjs 的 8 条断言）+ locks.awaitidle.test.mjs（新增原语）。

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

/**
 * 优雅停机：等当前所有 key 的锁链全部排空后 resolve。链尾（`stored`）在结算时
 * 会把自己从 `chains` 摘除，故一轮 allSettled 后 `chains` 通常已空；若等待期间
 * 又有新工作入链（`chains` 非空），递归再等一轮，直到彻底 idle。永不 reject
 * （`stored` 已吞错），可安全用于 shutdown。空闲时同步 resolve。
 * @returns {Promise<void>}
 */
export function awaitIdle () {
  if (chains.size === 0) return Promise.resolve();
  return Promise.allSettled([...chains.values()]).then(() => awaitIdle());
}

export function sessionLockKey (sessionId) {
  return `session:${String(sessionId || '').trim() || 'unknown'}`;
}

export function skillLockKey (skillId) {
  return `skill:${String(skillId || '').trim() || 'unknown'}`;
}
