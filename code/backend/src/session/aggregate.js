// realtime_core · session/aggregate.js（P3b）
//
// "记账规则"层：命令经守卫判定产出事件（decide），事件折叠出状态（evolve）。
// 与 P3a 的日志+游标（"记账本 + 书签"）合起来 = 完整会话内核。
//
//   decide(state, cmd, ctx) → events[] | reject(code)   守卫判定，纯函数
//   evolve(state, event)    → newState                  纯折叠，禁 throw/副作用
//
// 纯度红线（session/ 纯度门）：decide/evolve/upcaster 全纯函数——非确定性一律
// 走 ctx 注入（clock/rng/actor），库内零全局时钟/随机。
//
// 保守取向（见 worklog 2026-07-19-backend-p3b）：
//   - reject(code, detail?) 是**结构化业务拒绝**（非 throw）；throw 只留给编程
//     错误（未知命令/decide 返回非法值/evolve 缺 handler）——响亮，不静默。
//   - decide 表缺命令 = 编程错误 → TypeError（调用方发了聚合不认识的命令）。
//   - evolve 对未知事件类型：默认 throw（响亮），可配 onUnknownEvent:'ignore'。
//   - 版本号由库拥有：eventVersions[type] 声明当前版本（缺省 1），append 时库
//     给事件盖当前版本章，重放时 upcaster 把旧版本升上来（见 upcaster.js）。

import { upcastEvent } from './upcaster.js';

const REJECT = Symbol('realtime-core.reject');

/**
 * 构造一个结构化业务拒绝（非 throw）。decide 守卫用它表达"这命令此刻不合法"。
 * @param {string} code 稳定的拒绝码（非空字符串）
 * @param {any} [detail] 可选诊断附加信息（库不解释）
 * @returns {{code: string, detail: any}} 冻结的拒绝标记
 */
export function reject (code, detail) {
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError('reject(code) requires a non-empty string code');
  }
  return Object.freeze({ [REJECT]: true, code, detail });
}

/** 判断 decide 的返回是否为 reject 标记。 */
export function isReject (value) {
  return value !== null && typeof value === 'object' && value[REJECT] === true;
}

function assertHandlerTable (table, label) {
  if (table === null || typeof table !== 'object') {
    throw new TypeError(`defineAggregate: ${label} must be an object of handler functions`);
  }
  for (const [key, fn] of Object.entries(table)) {
    if (typeof fn !== 'function') {
      throw new TypeError(`defineAggregate: ${label}["${key}"] must be a function`);
    }
  }
}

/**
 * 定义一个聚合（decide/evolve/upcasters/版本声明）。返回一个**纯**描述对象——
 * 不持有任何可变状态、不做 io；运行时（createAggregateRuntime）负责把它接到
 * 日志/快照/锁上。
 *
 * @param {{
 *   name: string,
 *   initial: () => object,
 *   decide: Record<string, (state: object, cmd: object, ctx: object) => object[] | object>,
 *   evolve: Record<string, (state: object, event: object) => object>,
 *   upcasters?: Record<string, Record<number, (ev: object) => object>>,
 *   eventVersions?: Record<string, number>,
 *   onUnknownEvent?: 'throw'|'ignore',
 *   schemaVersion?: number,
 * }} spec
 */
export function defineAggregate (spec = {}) {
  const {
    name, initial, decide, evolve,
    upcasters = {}, eventVersions = {},
    onUnknownEvent = 'throw', schemaVersion = 1,
  } = spec;

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('defineAggregate: name must be a non-empty string');
  }
  if (typeof initial !== 'function') {
    throw new TypeError('defineAggregate: initial must be a factory function');
  }
  assertHandlerTable(decide, 'decide');
  assertHandlerTable(evolve, 'evolve');
  if (upcasters === null || typeof upcasters !== 'object') {
    throw new TypeError('defineAggregate: upcasters must be an object');
  }
  if (eventVersions === null || typeof eventVersions !== 'object') {
    throw new TypeError('defineAggregate: eventVersions must be an object');
  }
  if (onUnknownEvent !== 'throw' && onUnknownEvent !== 'ignore') {
    throw new TypeError("defineAggregate: onUnknownEvent must be 'throw' or 'ignore'");
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError('defineAggregate: schemaVersion must be a positive integer');
  }
  for (const [type, v] of Object.entries(eventVersions)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new TypeError(`defineAggregate: eventVersions["${type}"] must be a positive integer`);
    }
  }

  const currentVersion = (type) => {
    const v = eventVersions[type];
    return v === undefined ? 1 : v;
  };

  /** 命令 → 事件[] 或 reject。未知命令/非法返回 = 编程错误 → throw。 */
  function decideCommand (state, command, ctx) {
    if (command === null || typeof command !== 'object' || typeof command.type !== 'string') {
      throw new TypeError('command must be an object with a string "type"');
    }
    const handler = decide[command.type];
    if (typeof handler !== 'function') {
      throw new TypeError(`aggregate "${name}" has no decide handler for command "${command.type}"`);
    }
    const out = handler(state, command, ctx);
    if (isReject(out)) return out;
    if (!Array.isArray(out)) {
      throw new TypeError(
        `aggregate "${name}" decide["${command.type}"] must return an events array or reject(code); got ${typeof out}`,
      );
    }
    out.forEach((ev, i) => {
      if (ev === null || typeof ev !== 'object' || typeof ev.type !== 'string') {
        throw new TypeError(`aggregate "${name}" decide["${command.type}"] event[${i}] must be an object with a string "type"`);
      }
    });
    return out;
  }

  /** 升级一个事件到当前版本（重放/投递读取路径统一走这里）。 */
  function upcast (event) {
    return upcastEvent(event, { upcasters, currentVersion });
  }

  /** 折叠一个事件到状态：先 upcast 到当前版本，再交 evolve。未知类型按配置。 */
  function applyEvent (state, event) {
    const handler = evolve[event.type];
    if (typeof handler !== 'function') {
      if (onUnknownEvent === 'ignore') return state;
      throw new Error(`aggregate "${name}" has no evolve handler for event type "${event.type}" (onUnknownEvent='throw')`);
    }
    return handler(state, upcast(event));
  }

  return Object.freeze({
    name,
    schemaVersion,
    initial,
    currentVersion,
    decideCommand,
    upcast,
    applyEvent,
  });
}
