// realtime_core · machine/define-machine.js（P4）
//
// 声明式**平表**有限状态机：状态全集 + 合法转移表 + 纯谓词守卫。把"非法转移
// 当场响亮报错"从 decide 里散落的手写 if/else 升格为可声明、可查询、可测试的
// 表。词汇照抄 XState（states/on/target/guard/initial/final/guards），给未来迁移
// 留路径，但实现零依赖、纯函数、机器不可变。
//
// 本工具的**核心价值 = 定义期全面校验**：非法定义在 defineMachine() 调用时就
// 响亮 throw（MachineDefinitionError），错误信息带 machine id 与具体位置（哪个
// 状态、哪个事件）。运行期非法转移则抛 IllegalTransitionError（带 reason）。
//
// 明确不做（YAGNI，见 rules.md P4）：层级/并行状态、entry/exit actions 执行、
// invoke/actor、延迟(after)转移、字符串 target 简写。guard 只做纯谓词
// `(ctx, event) => boolean`——库调用它、不解释返回值以外的东西；guard 抛异常
// = 编程错误，原样上抛（不吞）。
//
// 与 decide 的组合边界（见 contract.md）：aggregate 的 decide 内用
// `machine.can(state.phase, EVENT)` 做守卫或 `machine.transition(...)` 求下一
// 状态——machine 只回答"允许吗 / 到哪去"，**不产出事件、不折叠领域状态**；
// decide 保持产出事件的职责，evolve 保持折叠状态的职责。
//
// 纯度红线（machine/ 纯度门）：零 import 越目录、零领域词、零 Date.now/
// Math.random、无 db.transaction、≤500 行。states/events 是通用词，天然领域无关。

/**
 * 定义期非法：defineMachine(spec) 校验失败时抛出。携带 machine id 与出错位置
 * （`where`：如 `states.asking.on.ANSWER.target`），可诊断性是本工具的验收项。
 */
export class MachineDefinitionError extends Error {
  /** @param {string} id @param {string} message @param {string} [where] */
  constructor (id, message, where) {
    const loc = where ? `（位置：${where}）` : '';
    super(`defineMachine "${id}": ${message}${loc}`);
    this.name = 'MachineDefinitionError';
    this.machineId = id;
    this.where = where;
  }
}

/**
 * 运行期非法转移：transition(state, event, ctx) 遇到状态不存在 / 该状态无此事件 /
 * 守卫拒绝 / 已在终态时抛出。`reason` 便于调用方分流：
 * `'unknown-state' | 'event-not-handled' | 'guard-rejected'`。
 */
export class IllegalTransitionError extends Error {
  /**
   * @param {string} id @param {string} reason
   * @param {{from?: string, event?: string, guard?: string, message: string}} info
   */
  constructor (id, reason, info) {
    super(`machine "${id}": ${info.message}`);
    this.name = 'IllegalTransitionError';
    this.machineId = id;
    this.reason = reason;
    this.from = info.from;
    this.event = info.event;
    this.guard = info.guard;
  }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 状态定义只许 on/type；转移定义只许 target/guard——未知键=定义期响亮 throw
// （把拼写错的 `gaurd`/`taget` 在定义期就照出来，而非运行时静默失效）。
const ALLOWED_STATE_KEYS = new Set(['on', 'type']);
const ALLOWED_TRANSITION_KEYS = new Set(['target', 'guard']);

function assertNoUnknownKeys (id, obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new MachineDefinitionError(id, `未知键「${key}」（只允许 ${[...allowed].join('/')}）`, where);
    }
  }
}

/**
 * 定义一个平表状态机。返回**不可变、无内部状态**的机器对象（Object.freeze）；
 * 全部方法为纯函数。非法定义立即抛 MachineDefinitionError。
 *
 * @param {{
 *   id: string,
 *   initial: string,
 *   states: Record<string, { on?: Record<string, { target: string, guard?: string }>, type?: 'final' }>,
 *   guards?: Record<string, (ctx: object, event: string) => boolean>,
 * }} spec
 * @returns {{
 *   id: string,
 *   states: readonly string[],
 *   finalStates: readonly string[],
 *   initial: string,
 *   transition: (state: string, event: string, ctx?: object) => { state: string, changed: boolean },
 *   can: (state: string, event: string, ctx?: object) => boolean,
 *   assertState: (value: string) => string,
 * }}
 */
export function defineMachine (spec = {}) {
  if (!isPlainObject(spec)) {
    throw new MachineDefinitionError('<unknown>', 'spec 必须是对象');
  }

  const { id, initial, states, guards = {} } = spec;

  // ── id：先校验（后续所有错误信息都要带它）──
  if (!isNonEmptyString(id)) {
    throw new MachineDefinitionError('<unknown>', 'id 必须是非空字符串');
  }
  assertNoUnknownKeys(id, spec, new Set(['id', 'initial', 'states', 'guards']), 'spec');

  // ── guards 表：必须是对象，每个 guard 是函数 ──
  if (!isPlainObject(guards)) {
    throw new MachineDefinitionError(id, 'guards 必须是对象', 'guards');
  }
  for (const [name, fn] of Object.entries(guards)) {
    if (!isNonEmptyString(name)) {
      throw new MachineDefinitionError(id, 'guard 名必须是非空字符串', 'guards');
    }
    if (typeof fn !== 'function') {
      throw new MachineDefinitionError(id, `guard「${name}」必须是纯谓词函数`, `guards.${name}`);
    }
  }

  // ── states：非空对象 ──
  if (!isPlainObject(states)) {
    throw new MachineDefinitionError(id, 'states 必须是对象', 'states');
  }
  const stateNames = Object.keys(states);
  if (stateNames.length === 0) {
    throw new MachineDefinitionError(id, 'states 不能为空', 'states');
  }
  const stateSet = new Set(stateNames);
  if (stateSet.has('')) {
    throw new MachineDefinitionError(id, '状态名必须是非空字符串', 'states');
  }

  // ── initial：非空字符串且在 states 内 ──
  if (!isNonEmptyString(initial)) {
    throw new MachineDefinitionError(id, 'initial 必须是非空字符串', 'initial');
  }
  if (!stateSet.has(initial)) {
    throw new MachineDefinitionError(id, `initial「${initial}」不在 states 中`, 'initial');
  }

  // ── 逐状态、逐转移校验 ──
  const finalStates = [];
  // 规整后的转移表：Map<state, Map<event, {target, guard?}>>；final 状态记入 finalStates。
  const table = new Map();

  for (const stateName of stateNames) {
    const def = states[stateName];
    const whereState = `states.${stateName}`;
    if (!isPlainObject(def)) {
      throw new MachineDefinitionError(id, `状态「${stateName}」的定义必须是对象`, whereState);
    }
    assertNoUnknownKeys(id, def, ALLOWED_STATE_KEYS, whereState);

    // type：只许 'final'
    const isFinal = def.type !== undefined;
    if (isFinal && def.type !== 'final') {
      throw new MachineDefinitionError(id, `状态「${stateName}」的 type 只能是 'final'（得到「${def.type}」）`, `${whereState}.type`);
    }
    if (isFinal) finalStates.push(stateName);

    const on = def.on;
    // final 状态不许声明 on（终态无出边——防"复活"）
    if (isFinal && on !== undefined) {
      throw new MachineDefinitionError(id, `final 状态「${stateName}」不得声明 on（终态无出边）`, `${whereState}.on`);
    }
    if (on === undefined) {
      table.set(stateName, new Map());
      continue;
    }
    if (!isPlainObject(on)) {
      throw new MachineDefinitionError(id, `状态「${stateName}」的 on 必须是对象`, `${whereState}.on`);
    }

    const events = new Map();
    for (const eventName of Object.keys(on)) {
      const whereEvent = `${whereState}.on.${eventName}`;
      if (!isNonEmptyString(eventName)) {
        throw new MachineDefinitionError(id, `状态「${stateName}」的事件名必须是非空字符串`, `${whereState}.on`);
      }
      const trans = on[eventName];
      if (!isPlainObject(trans)) {
        throw new MachineDefinitionError(id, `转移定义必须是对象 { target, guard? }`, whereEvent);
      }
      assertNoUnknownKeys(id, trans, ALLOWED_TRANSITION_KEYS, whereEvent);

      if (!isNonEmptyString(trans.target)) {
        throw new MachineDefinitionError(id, 'target 必须是非空字符串', `${whereEvent}.target`);
      }
      if (!stateSet.has(trans.target)) {
        throw new MachineDefinitionError(id, `target「${trans.target}」指向不存在的状态`, `${whereEvent}.target`);
      }
      if (trans.guard !== undefined) {
        if (!isNonEmptyString(trans.guard)) {
          throw new MachineDefinitionError(id, 'guard 必须是非空字符串（引用 guards 表中的名字）', `${whereEvent}.guard`);
        }
        if (!Object.prototype.hasOwnProperty.call(guards, trans.guard)) {
          throw new MachineDefinitionError(id, `guard「${trans.guard}」未在 guards 表中定义`, `${whereEvent}.guard`);
        }
      }
      events.set(eventName, { target: trans.target, guard: trans.guard });
    }
    table.set(stateName, events);
  }

  // ── 求解一次转移：返回 {ok:true, target, changed} 或 {ok:false, reason, guard?} ──
  // guard 抛异常不在此吞（编程错误响亮上抛）。
  function resolve (state, event, ctx) {
    if (!stateSet.has(state)) return { ok: false, reason: 'unknown-state' };
    const events = table.get(state);
    const trans = events.get(event);
    if (trans === undefined) return { ok: false, reason: 'event-not-handled' };
    if (trans.guard !== undefined) {
      const verdict = guards[trans.guard](ctx, event);
      if (!verdict) return { ok: false, reason: 'guard-rejected', guard: trans.guard };
    }
    return { ok: true, target: trans.target, changed: trans.target !== state };
  }

  const frozenStates = Object.freeze([...stateNames]);
  const frozenFinal = Object.freeze([...finalStates]);

  const machine = {
    id,
    initial,
    states: frozenStates,
    finalStates: frozenFinal,

    /**
     * 执行一次转移。非法（状态不存在 / 该状态无此事件 / 守卫拒绝）响亮抛
     * IllegalTransitionError。合法返回 `{ state, changed }`（changed=目标≠原状态）。
     */
    transition (state, event, ctx) {
      const r = resolve(state, event, ctx);
      if (r.ok) return { state: r.target, changed: r.changed };
      if (r.reason === 'unknown-state') {
        throw new IllegalTransitionError(id, r.reason, { from: state, event, message: `状态「${state}」不在状态全集中` });
      }
      if (r.reason === 'event-not-handled') {
        throw new IllegalTransitionError(id, r.reason, { from: state, event, message: `状态「${state}」不接受事件「${event}」` });
      }
      // guard-rejected
      throw new IllegalTransitionError(id, r.reason, {
        from: state, event, guard: r.guard,
        message: `状态「${state}」的事件「${event}」被守卫「${r.guard}」拒绝`,
      });
    },

    /** 查询某转移是否合法，**不抛错**（未知状态/未知事件/守卫拒绝一律返回 false）。 */
    can (state, event, ctx) {
      return resolve(state, event, ctx).ok;
    },

    /** 断言一个值属于状态全集；不属于 = 响亮抛 IllegalTransitionError（给"裸字符串逃逸"兜底）。返回该值以便链式。 */
    assertState (value) {
      if (!stateSet.has(value)) {
        throw new IllegalTransitionError(id, 'unknown-state', {
          from: typeof value === 'string' ? value : String(value),
          message: `值「${String(value)}」不在状态全集 [${frozenStates.join(', ')}] 中`,
        });
      }
      return value;
    },
  };

  return Object.freeze(machine);
}
