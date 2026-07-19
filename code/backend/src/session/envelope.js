// realtime_core · session/envelope.js（P3a）
//
// 事件信封（框架字段，库只认这些）：`{ streamId, seq, id, type, v, at, payload }`
//   - `streamId` / `seq` / `at`：日志层分配，调用方**不可指定**（出现即 TypeError，
//     严格失败优于静默覆盖——保守决策）。`seq` 流内严格单调、连续、从 1 起。
//   - `id`：调用方可自带（跨系统去重场景）；缺省由注入的 clock/rng 生成，
//     直接复用 `queue/ids.js::genEventId`（`evt-<clock>-<rand36>`）。P5 收债：
//     原本地重复实现已去重——纯度门对 session/ 开受控白名单（仅 `../queue/ids.js`
//     一个纯工具文件，该文件本身纳入同 5 项严格检查），格式的唯一事实回到 ids.js。
//   - `type`：非空字符串，库不解释。
//   - `v`：事件 schema 版本号，正整数，调用方声明，缺省 1。P3a 只承载字段，
//     升级函数（upcaster）是 P3b 的活——但字段必须现在进信封（版本化不可后补）。
//   - `payload`：库完全不解释、不校验、不冻结（领域无关红线：对库是黑盒）。
// 信封对象本身 Object.freeze——日志是事实，写入后不可变。
//
// 非确定性一律走注入（ctx 约定同 queue/ids.js）：clock() → 毫秒时间戳，
// rng() → [0,1) 浮点。session/ 生产代码零全局时钟/零全局随机数（纯度门机械核）。

import { genEventId } from '../queue/ids.js';

const ALLOWED_INPUT_KEYS = new Set(['type', 'v', 'id', 'payload']);
const ASSIGNED_KEYS = ['streamId', 'seq', 'at'];

/**
 * 校验一批调用方事件并封成不可变信封（分配 seq/at/缺省 id/缺省 v）。
 * 纯校验+构造：不写任何存储——原子性由调用方（日志层）负责"先全部封好、
 * 再一次性提交"。
 * @param {{
 *   streamId: string,
 *   lastSeq: number,
 *   events: Array<{type: string, v?: number, id?: string, payload?: any}>,
 *   clock: () => number,
 *   rng: () => number,
 * }} input
 * @returns {ReadonlyArray<object>} 冻结的信封数组，seq 从 lastSeq+1 起连续
 */
export function sealEnvelopes ({ streamId, lastSeq, events, clock, rng }) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('events must be a non-empty array');
  }
  const sealed = [];
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError(`events[${i}] must be a plain object`);
    }
    for (const key of ASSIGNED_KEYS) {
      if (key in event) {
        throw new TypeError(`events[${i}].${key} is assigned by the log layer and must not be supplied`);
      }
    }
    for (const key of Object.keys(event)) {
      if (!ALLOWED_INPUT_KEYS.has(key)) {
        throw new TypeError(`events[${i}] has unsupported key "${key}" (allowed: type, v, id, payload)`);
      }
    }
    if (typeof event.type !== 'string' || event.type.length === 0) {
      throw new TypeError(`events[${i}].type must be a non-empty string`);
    }
    const v = event.v === undefined ? 1 : event.v;
    if (!Number.isInteger(v) || v < 1) {
      throw new TypeError(`events[${i}].v must be a positive integer (schema version)`);
    }
    if (event.id !== undefined && (typeof event.id !== 'string' || event.id.length === 0)) {
      throw new TypeError(`events[${i}].id must be a non-empty string when supplied`);
    }
    // 缺省 id 复用 ids.js 的生成器；clock 传"已取的 at"——保持 P3a 既有行为逐字
    // 不变（id 的时间戳分量 === 信封 at，同一次 seal 不二次读钟）。
    const at = clock();
    const id = event.id !== undefined ? event.id : genEventId({ clock: () => at, rng });
    sealed.push(Object.freeze({
      streamId,
      seq: lastSeq + i + 1,
      id,
      type: event.type,
      v,
      at,
      payload: event.payload,
    }));
  }
  return sealed;
}
