// realtime_core · session/upcaster.js（P3b）
//
// 事件版本升级（本库唯一被标记为"现在不设计、将来必翻车"的项）——纯函数。
// 日志是不可变事实：v1 事件一旦落盘就永远是 v1。代码演进（给事件类型加字段、
// 当前版本升为 2）后，重放旧日志时必须把每个低版本信封**逐级**升到当前版本，
// 再交 evolve——于是 evolve/decide 永远只见最新 schema（不变量 3）。
//
// 契约要点（保守取向，见 worklog 2026-07-19-backend-p3b）：
//   - **库拥有版本号**：升级函数只负责变换 payload/形状，返回什么都由库把 `v`
//     强制写成 fromVersion+1。这样版本单调递增有硬保证，永不会因升级函数忘了
//     bump `v` 而死循环。
//   - **缺升级函数 = 响亮 throw**：遇到 `v < 当前版本` 却没有对应 upcaster，
//     绝不静默放行旧 schema（那会让 evolve 收到自己不认识的旧字段）。
//   - **事件来自未来 = 响亮 throw**：`v > 当前版本`（日志里的事件比代码还新，
//     典型是回滚到旧代码读新日志）无法降级，宁可炸也不猜。
//   - 升级链可级联：v1→v2→v3 逐级调用，每级一个 upcaster。
//   - 纯函数：无 io、无时钟、无随机、无副作用（纳入 session/ 纯度门）。

/**
 * 把一个事件信封升到其类型的当前版本。
 * @param {{type: string, v?: number}} event 冻结信封（或等价形状）
 * @param {{
 *   upcasters?: Record<string, Record<number, (ev: object) => object>>,
 *   currentVersion: (type: string) => number,
 * }} deps `upcasters[type][fromVersion]` = 把该类型 fromVersion 升到 fromVersion+1
 * @returns {object} 版本 === 当前版本的事件（新对象，未冻结——喂给 evolve 的临时视图）
 */
export function upcastEvent (event, { upcasters, currentVersion }) {
  const type = event.type;
  const target = currentVersion(type);
  let from = event.v === undefined ? 1 : event.v;

  if (from > target) {
    throw new Error(
      `event "${type}" is v${from} but current schema is only v${target}: ` +
      'refusing to downgrade an event from a newer code version (rolled back too far?)',
    );
  }

  let current = event;
  while (from < target) {
    const fn = upcasters?.[type]?.[from];
    if (typeof fn !== 'function') {
      throw new Error(
        `no upcaster for event "${type}" v${from}→v${from + 1} ` +
        `(current v${target}): refusing to replay a stale event silently`,
      );
    }
    const upgraded = fn(current);
    if (upgraded === null || typeof upgraded !== 'object') {
      throw new TypeError(`upcaster for "${type}" v${from}→v${from + 1} must return an object`);
    }
    // 库强制递增版本号（升级函数只管变换 payload/形状），版本单调有硬保证。
    current = Object.assign({}, upgraded, { v: from + 1 });
    from += 1;
  }
  return current;
}
