// block-3 session-state · core/ids.js（Wave 0）
//
// 老源 services/sessionEvents.js 里唯二的非确定性来源：模块顶部的
// "读全局时钟"的 now() 和"读全局时钟+全局随机数"的 eventId()。老函数在
// 同一次调用里各自直接读时钟/随机数，本文件把它们换成"调用方注入"的形式，
// 让 core/ 全体保持零 io、零全局、可重放（arbiter 设计文档 §1 红线：core
// 里不许出现字面的全局时钟/全局随机数调用，一律走注入）。
//
// ctx 契约（本文件是唯一事实源，core/ 其余文件都复用同一个 ctx 形状）：
//   ctx.clock: () => number   —— 毫秒时间戳，等价于全局时钟的当前值
//   ctx.rng:   () => number   —— [0,1) 区间浮点数，等价于全局随机数生成器
// 调用方（Wave 2 service.js 或测试）负责提供真实/可控实现；core 内部永远
// 不直接调用全局时钟/全局随机数。

/**
 * 事件 id 生成（老源 `eventId()`，格式 `evt-<clock>-<rand36>` 逐字节保留）。
 * @param {{clock: () => number, rng: () => number}} ctx
 * @returns {string}
 */
export function genEventId (ctx) {
  return `evt-${ctx.clock()}-${ctx.rng().toString(36).slice(2, 8)}`;
}

/**
 * 回合/两段式操作稳定 id 生成（`q-<clock>-<rand36>`）。老源 sessionEvents.js
 * 没有这个函数——它是给 §3 两段式 prepare/merge（extract-skill/finalize/
 * voice-clone，Wave 2 operations/ 落地）准备的"稳定 turn id"，本波只备好、
 * 不接线（arbiter 设计文档 §1：ids.js 职责包含 eventId + turnId）。
 * @param {{clock: () => number, rng: () => number}} ctx
 * @returns {string}
 */
export function genTurnId (ctx) {
  return `q-${ctx.clock()}-${ctx.rng().toString(36).slice(2, 8)}`;
}
