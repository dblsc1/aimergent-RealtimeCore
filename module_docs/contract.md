# realtime_core · 对外接口契约

> 本文件是 realtime_core 对外行为的**唯一事实**。当前为**孵化期骨架**：realtime_core 位于 `dev/`（试验区），尚无外部消费方。v0.1 的公共 API 起点 = **逐字继承 copycat 已验证实时内核**，P2 起在其上**向后兼容地扩展**（P2：interval 形态 / 顶替语义 / keyed registry / awaitIdle；P3a：会话内核之日志+游标投递层；P3b：decide/evolve 聚合语义 + 事件版本化 upcaster + 崩溃重放运行时，见下）；**正式契约 P5 定稿**（semver v1.0、经 CR 迁入 `0/` 平台层时冻结）。在正式定稿前，下列导出符号清单描述"当前提供了什么"，不构成对外冻结承诺（draft）。

## 契约索引声明（provides / consumes）

```yaml
provides:
  - id: realtime-core-kernel@v0.1
    summary: 领域无关的实时/状态机内核——long-poll 生命周期 reducer + 命令分发 + 频道广播 + keyed 锁；零 runtime 依赖。P5 前无对外冻结承诺。
consumes: []   # 零依赖是卖点：内核不依赖任何平台契约或第三方包
```

## 版本与定稿状态

- **v0.1（当前）**：copycat 实时内核逐字抽取 + P2/P3a/P3b 向后兼容扩展，孵化于 `dev/realtime_core/`。API 表面 = 下列各文件的导出符号，**未冻结**。
- **P5（正式契约）**：semver v1.0、经 CR 迁 `0/` 平台层、补 SSE 参考适配器测试后，本契约定稿并启用冻结项标注。路线图见 `module_docs/rules.md`。

## v0.x 公共 API（copycat 实时内核 + P2/P3a 向后兼容扩展）

P1/P2 的七个文件 + P3a 会话内核四个文件及其导出符号（源见 worklog 映射表；P1 = 逐字继承 copycat，P2/P3a = 在其上**只增不改既有行为**地扩展，draft、未冻结）：

| 目标文件 | 导出符号 | 性质 |
|---|---|---|
| `code/backend/src/transport/core/poll-machine.js` | `PollPhase`、`PollMode`、`PollEventType`、`PollActionType`（枚举，draft）、`initPoll(config?)`、`isTerminalPhase(phase)`、`reduce(state, event)` | 纯 reducer，无 io/时钟/随机 |
| `code/backend/src/transport/core/dispatch.js` | `normalizeCommandTable(table)`、`lookupCommand(table, cmd)` | 纯命令表规整/查找 |
| `code/backend/src/transport/engine.js` | `longPoll({...})`、`createDispatcher(commandTable, {onUnknown, onError})`、`createPollRegistry()` | 引擎壳：解释 reducer 动作为副作用（注入 timers/wakeup/respond/registry） |
| `code/backend/src/transport/channels.js` | `createChannels()` | 频道广播注册表（订阅/发布） |
| `code/backend/src/concurrency/locks.js` | `withLock(key, fn)`、`sessionLockKey(sessionId)`、`skillLockKey(skillId)`、`awaitIdle()` | keyed 串行锁 + 键构造 + 优雅停机 |
| `code/backend/src/queue/ordering.js` | `orderedSessionEvents(session, options)`、`maxEventSeq(session)` | 纯事件排序/统计投影 |
| `code/backend/src/queue/ids.js` | `genEventId(ctx)`、`genTurnId(ctx)` | 注入式 id 生成（`ctx.clock`/`ctx.rng`，零全局） |

> `services/realtime/classroom.js`（copycat L2 糖层）**未抽取**：无生产消费方，v1 排除（P1 决策 2）。

### P2 扩展导出面（draft，向后兼容）

- **`PollMode`**（新枚举）：`{ WAKEUP:'wakeup', INTERVAL:'interval' }`。
- **`PollPhase.SUPERSEDED`**（新终态）：第四终态，对应 `RESPOND{outcome:'superseded'}`。
- **`PollEventType`** 新增 `POLL_TICK`（interval 触发）、`SUPERSEDE`（被同 key 新请求顶替）。
- **`PollActionType`** 新增 `ARM_INTERVAL` / `DISARM_INTERVAL`（周期定时器装/拆，与一次性 `ARM_TIMER` 分开）。
- **`initPoll(config?)`**：可选 `config = { mode?: 'wakeup'|'interval', immediateFirstAttempt?: boolean }`。缺省 = `wakeup` + `immediateFirstAttempt:true`（**与 P1 逐字一致**）；`interval` 默认 `immediateFirstAttempt:false`（复现 block-9 延迟首发）。非法 mode 抛 `TypeError`。
- **`reduce`** 语义扩展：`ATTEMPT_RESULT` 事件可携带 `outcome`（如 `delivered`/`not_found`），透传给 `RESPOND.outcome`；`outcome` 缺省仍为 `'settled'`。interval 形态终态 teardown 含 `DISARM_INTERVAL`；wakeup 形态 teardown 仍只 `CLEANUP`。
- **`longPoll`** 新增可选注入：`classify(result) → {terminal, outcome?, payload?}`（取代布尔 `isSettled` 支持多结局）、`mode`/`immediateFirstAttempt`/`pollIntervalMs`（interval 形态）、`timers.setInterval/clearInterval`（interval 形态所需）、`registry`+`key`（同 key 顶替）。`respond` 除 `settled/timeout/error` 外，其余 `outcome` 派发到同名 `respond[outcome](payload)`。**不传新参数时行为与 P1 逐字一致**。
- **`createPollRegistry()`**：返回一个 `Map<key, superseder>`，跨多次 `longPoll` 共享以实现同 key 顶替。
- **`awaitIdle()`**（locks.js）：优雅停机原语，等所有 key 的锁链排空后 resolve，永不 reject。

> **验收锚点**：`code/backend/reference/` 下两个参考实现（`child-ab-next-question.ref.mjs`、`parent-options-waiter.ref.mjs`）用上述扩展内核逐条复现 copycat block-9 两个 poller，配 fake-timers 特征测试——参考实现不属对外契约面，是"扩展内核能承载真实业务形态"的机械证明。

### P3a 扩展导出面（draft）：会话内核（上）——事实日志 + 游标投递

"记账本 + 书签"层：每个流（stream）一本 append-only 事件日志，每个消费组（group）一枚持久化游标；投递 = "给我 seq > 游标的事件"，从结构上消灭"丢投递"（取代 copycat delivered/done 单消费者标记模型的通用层）。新文件（`code/backend/src/session/`，均 draft）：

| 文件 | 导出符号 | 性质 |
|---|---|---|
| `session/errors.js` | `ConflictError` | append CAS 冲突错误（携带 `streamId`/`expected`/`actual`；调用方以 `err.name === 'ConflictError'` 识别） |
| `session/envelope.js` | `sealEnvelopes({streamId, lastSeq, events, clock, rng})` | 纯校验+构造：把调用方事件封成不可变信封（持久化适配器复用；一般消费方不直接用） |
| `session/memory-log-store.js` | `createMemoryLogStore({clock, rng})` | 存储端口内存参考实现（测试与轻量场景用） |
| `session/delivery.js` | `createDelivery({logStore, wakeup, longPoll})`、`WAKE_KIND_APPENDED` | 投递层：publish/pull/ack/subscribe |

**事件信封**（框架字段，库只认这些）：`{ streamId, seq, id, type, v, at, payload }`

- `seq`：流内严格单调、连续、从 1 起，由日志层分配（调用方带 `seq`/`at`/`streamId` = TypeError）。
- `v`：事件 schema 版本号，正整数，append 时由调用方声明（缺省 1）。P3a 只承载字段，升级函数（upcaster）是 P3b 的活——字段现在进信封，事件版本化不后补。
- `at`：注入 clock 的毫秒时间戳（库内零 Date.now）。`id`：调用方可自带，缺省 `evt-<clock>-<rand36>`（沿用 ids.js 格式约定）。
- `payload`：库完全不解释、不冻结（领域无关红线）；信封本身 `Object.freeze`。

**存储端口（port）**——真实持久化适配器照此实现（本期只交付内存参考实现）：

```
logStore = {
  append(streamId, expectedLastSeq, events[]) -> {lastSeq} | throw ConflictError,  // CAS 乐观并发；整批原子
  read(streamId, fromSeqExclusive, limit?) -> events[],                            // seq > fromSeqExclusive 的冻结信封
  getCursor(streamId, group) -> seq,          // 无记录 = 0
  advanceCursor(streamId, group, seq) -> void // 只许前进：回退=RangeError；同 seq 幂等 no-op；越过日志末尾=RangeError
}
```

`append` 的 `expectedLastSeq` CAS 是并发安全第二道防线（信箱串行是第一道），同构于铁律 15④"远端拒非 fast-forward"。

**投递层**：

- `createDelivery({logStore, wakeup, longPoll})`：`logStore` 与 `wakeup`（`createWakeupPort` 形状 `{emit, subscribe}`）必注入；`longPoll` 只在用 `subscribe` 时必需（注入 `transport/engine.js` 的同名函数——session/ 生产代码零 transport import，等待机制以能力注入方式**复用 P2 引擎**，零自制轮询）。
- `publish(streamId, events, {expectedLastSeq?})`：append + `wakeup.emit(streamId, 'appended')`。缺省"追加到尾"（尾指针缓存 + CAS 兜底重读重试一次）；显式 `expectedLastSeq` 走严格 CAS，冲突原样上抛且不发唤醒。
- `pull(streamId, group, {limit?})`：读游标后的事件，**不动游标**（at-least-once：未 ack 必重投）。
- `ack(streamId, group, seq)`：前缀确认语义，游标前移到 seq。越过本实例已 pull 高水位 = RangeError（崩溃重建后高水位归游标——先重新 pull 再 ack）；回退 = RangeError；同 seq 幂等。
- `subscribe(streamId, group, {timers, timeoutMs, respond, onClientClose, limit?, registry?, key?})`：经注入的 P2 `longPoll` 长轮询等待——有积压立即 `respond.settled(batch)`，否则等 publish 唤醒；超时/断连语义 = P2 引擎原生。同 group 多订阅共享一枚游标（都收到，ack 一次即整组前移）。

> **验收锚点**：`reference/classroom-feed.ref.mjs` + 特征测试——teacher/student/parent 三组订阅同一流、独立进度、断线重连（仅凭 logStore 重建、从游标续读）。领域词只出现在 reference/。四条不变量（已确认序列=日志连续前缀 / seq 连续+CAS 唯一胜者 / 游标只前进 / 崩溃重建后仍成立）由 `session/log-cursors.property.test.mjs` 固定种子 property 测钉死。

### P3b 扩展导出面（draft）：会话内核（下）——decide/evolve 聚合 + 事件版本化 + 崩溃重放

"记账规则"层：命令经守卫判定产出事件（decide），事件折叠出状态（evolve），崩溃后快照+重放恢复，并落地**事件版本化**（旧信封经 upcaster 逐级升到当前版本再交 evolve）。新文件（`code/backend/src/session/`，均 draft）：

| 文件 | 导出符号 | 性质 |
|---|---|---|
| `session/aggregate.js` | `defineAggregate({name, initial, decide, evolve, upcasters?, eventVersions?, onUnknownEvent?, schemaVersion?})`、`reject(code, detail?)`、`isReject(v)` | 纯聚合描述：decide/evolve 全纯函数；`reject` = 结构化业务拒绝（非 throw） |
| `session/upcaster.js` | `upcastEvent(event, {upcasters, currentVersion})` | 纯事件版本升级（逐级 v→v+1；缺升级函数/来自未来 = 响亮 throw） |
| `session/memory-snapshot-store.js` | `createMemorySnapshotStore()` | 快照存储端口内存参考实现（get/put，防御性深拷贝） |
| `session/aggregate-runtime.js` | `createAggregateRuntime({aggregate, logStore, locks?, wakeup?, snapshotStore?, snapshotEvery?})` | 运行时：`execute`（锁串行 + CAS append + 快照）/ `load`（快照+尾部重放） |

**聚合语义**：

- `defineAggregate(spec)` → 冻结的**纯描述对象**（无可变状态、无 io）。`decide[cmdType](state, cmd, ctx) → events[] | reject(code)`；`evolve[evType](state, event) → newState`（纯折叠，禁 throw/副作用）。`ctx` 注入 clock/rng/actor（actor 库不解释，透传）。
- `reject(code, detail?)`：结构化业务拒绝（非 throw）。**throw 只留给编程错误**：未知命令（decide 表无此 key）、decide 返回非数组非 reject、evolve 缺 handler。
- `eventVersions: {type: n}` 声明每类事件的**当前版本**（缺省 1）；`upcasters: {type: {fromV: (ev)=>ev'}}` 声明升级函数。**库拥有版本号**——升级函数只变换 payload/形状，库强制盖 `v = fromV+1`（版本单调有硬保证，永不因忘 bump 而死循环）。
- `evolve` 对未知事件类型：`onUnknownEvent: 'throw'|'ignore'`，**默认 throw**（响亮）。
- `schemaVersion`（缺省 1）：聚合逻辑版本，随快照落盘；重建时快照 schema 不匹配 → 丢弃快照、从日志全量重建（保守）。

**事件版本化**（本期验收重点）：append 时库给事件盖当前版本章；重放/投递读取时，`applyEvent` 自动把低版本信封经 upcasters 链**逐级**升到当前版本再交 evolve（v1→v2→v3 可链式）。**缺升级函数遇旧版本 = 响亮 throw**（禁静默）；事件 `v > 当前版本`（回滚到旧代码读新日志）= 响亮 throw。于是 decide/evolve **永远只见最新 schema**。

**运行时**：

```
rt = createAggregateRuntime({ aggregate, logStore, locks?, wakeup?, snapshotStore?, snapshotEvery? })
await rt.execute(streamId, command, ctx) -> { events, state } | { rejected: {code, detail} }
rt.load(streamId) -> state          // 快照 + 尾部重放
```

- `execute` 全程在 `locks.withLock('stream:<id>')` 内（未注入 locks 则裸跑）：load → decide → append(CAS, `expectedLastSeq`=重放高水位) → 读回落盘信封折叠出新态 → 可选滚动落快照。**信箱串行是第一道防线，CAS 是第二道**；CAS 冲突 = 编程错/并发漏网 → **响亮 throw**（`ConflictError` 原样上抛，不静默重试）。
- **append 路径唯一**：`execute` 不自写日志，**复用 P3a `delivery.publish`**（显式 `expectedLastSeq` 走严格 CAS + `wakeup.emit(streamId,'appended')`）——全库只有一条 append 路径，聚合层与投递层写日志语义逐字一致。`wakeup` 可选（未注入 = no-op，纯聚合场景无订阅者）。
- `execute` 追加后**读回**刚落盘的信封，用与 `load` **完全相同**的折叠（upcast→evolve）推进状态——保证"execute 后的内存态"逐字等于"崩溃后从日志重建的状态"。
- **快照**：`snapshotStore` 端口（`get(streamId)`/`put(streamId, {state, lastSeq, aggregateSchemaVersion})`）+ 内存参考实现（防御性深拷贝，state 须 structuredClone 可克隆）；`snapshotEvery`（缺省 50 事件）跨边界滚动落快照。重放 = 取快照 + `read(lastSeq 之后)` 逐条 upcast+evolve。

> **验收锚点**：`reference/classroom-aggregate.ref.mjs` + 特征测试——最小课堂聚合（states idle/asking/awaiting-answer/closed；命令 push-question/submit-answer/close；含一次 v1→v2 事件演进），**整库第一次三层（聚合+投递+传输）串起来跑通全链路**（命令→事件→三组订阅各自唤醒收到）。领域词只出现在 reference/。四条不变量（重放确定性含快照 present/absent/behind 三形态 / 拒绝无痕 / evolve 只见升级后事件 / execute 串行等价且 CAS 零冲突）由 `session/aggregate.property.test.mjs` 固定种子 property 测钉死。

### P4 扩展导出面（draft）：defineMachine 声明式转移表工具

`code/backend/src/machine/define-machine.js`（新目录 `machine/`，draft）——百行级、零依赖的**平表**有限状态机：状态全集 + 合法转移表 + 纯谓词守卫。词汇照抄 XState（states/on/target/guard/initial/final/guards），但只做平表，**明确不做层级/并行/actor/entry-exit-actions/延迟转移**（YAGNI，见 rules.md P4）。核心价值 = **定义期全面校验**：非法定义在 `defineMachine()` 调用时就响亮 throw。

| 文件 | 导出符号 | 性质 |
|---|---|---|
| `machine/define-machine.js` | `defineMachine(spec)`、`MachineDefinitionError`、`IllegalTransitionError` | 纯、不可变、零依赖状态机工厂；机器全部方法为纯函数 |

**API**：

```
const machine = defineMachine({
  id: 'session-status',          // 诊断用；所有错误信息都带它
  initial: 'idle',
  states: {
    idle:     { on: { START:  { target: 'asking' } } },
    asking:   { on: { ANSWER: { target: 'awaiting', guard: 'hasQuestion' },
                      CLOSE:  { target: 'closed' } } },
    awaiting: { on: { EXTRACTED: { target: 'asking' }, CLOSE: { target: 'closed' } } },
    closed:   { type: 'final' },
  },
  guards: { hasQuestion: (ctx, event) => Boolean },   // 纯谓词
})
```

- `machine.transition(state, event, ctx?) → { state, changed } | throw IllegalTransitionError`——非法转移（状态不存在 / 该状态无此事件 / 守卫拒绝 / 已在终态）默认响亮 throw；`changed` = 目标状态 ≠ 原状态。
- `machine.can(state, event, ctx?) → boolean`——查询不抛错（未知状态/未知事件/守卫拒绝一律 false）；`can(...)===true ⟺ transition(...)` 成功。
- `machine.states` / `machine.finalStates`——枚举导出（`Object.freeze`）；`machine.initial`。
- `machine.assertState(value) → value | throw`——值不在状态全集 = 响亮 throw（给"裸字符串逃逸"运行时断言用），合法则原样返回以便链式。
- 机器对象本身 `Object.freeze`，无内部可变状态。
- **guard 契约**：`(ctx, event) → boolean` 纯谓词；库只看真假值，不解释其它；guard 抛异常 = 编程错误，**原样上抛（库不吞）**——`can` 也不吞。
- **错误类型**：定义期非法 → `MachineDefinitionError`（携 `machineId`/`where` 出错位置，如 `states.asking.on.ANSWER.target`）；运行期非法转移 → `IllegalTransitionError`（携 `machineId`/`reason ∈ {unknown-state,event-not-handled,guard-rejected}`/`from`/`event`/`guard`）。

**定义期全面校验**（每条非法 = `defineMachine()` 时响亮 throw，信息带 id 与位置）：`id`/`initial`/状态名/事件名非空字符串；`initial` 不在 states；`target` 指向不存在的状态；final 状态却声明 `on`（终态无出边，防复活）；`type` 非 `'final'`；`guard` 引用未在 guards 表中定义；状态/转移出现未知键（如拼错的 `gaurd`）；`guards` 非对象或 guard 非函数。JS 对象字面量会静默折叠重复键，**运行时无法检测重复键**——改以"未知键严格拒绝"作为响亮校验的等价收益（见 worklog P4 决策）。

**与 decide 的组合边界**（本工具定位）：aggregate 的 `decide` 内用 `machine.can(state.phase, EVENT)` 做守卫、或 `machine.transition(...)` 求下一状态——**machine 只回答"允许吗 / 到哪去"，不产出事件、不折叠领域状态**；`decide` 保持产出事件的职责，`evolve` 保持折叠状态的职责。machine 是 decide 内部合法转移判定的**可选辅助**，不是聚合的替代。

> **验收锚点**：`reference/classroom-aggregate.ref.mjs` 把 P3b 示例里手写的 phase if/else（`state.phase === 'closed'` / `ANSWERING_PHASES.has(...)`）改为 `CLASSROOM_MACHINE.can(...)` 表驱动守卫，行为逐字不变——既有 4 个参考测试**零修改全绿**即为"表驱动与手写等价"的机械证明。两条不变量（任意事件序列下 transition 结果恒 ∈ states 全集 / final 后任何事件恒 throw 且 can=false，机器不可复活）由 `machine/define-machine.property.test.mjs` 固定种子 property 测钉死。

## 入口与路由

- 无 HTTP/nginx 表面：realtime_core 是**库**（ESM 模块集），由消费方 `import`，不自带服务进程或路由。
- 内部服务名 / 端口：不适用（无进程）。

## 依赖的外部契约

| 依赖 | 契约位置 | 用途 |
|---|---|---|
| 无 | — | 内核零依赖（含零第三方 runtime 依赖），不消费任何平台契约 |

## 数据与存储

- realtime_core 不拥有持久化数据：reducer/ordering 为纯函数，锁/频道为进程内内存态。P3a 的日志/游标存储只交付**内存参考实现**；真实持久化由消费方按 `logStore` 端口契约自带适配器（数据落在消费方名下，铁律 7）。无 data root、无备份/清理需求。

## 配置与密钥

> 本模块无 env/密钥表面。

| 环境变量 | 必填 | 用途 | 安全约束 |
|---|---|---|---|
| 无 | — | — | — |

## 跨仓依赖机制（预定，P1 未落地）

- 未来消费方引用 realtime_core 时，**用 git tag 固定版本**（本单决策 3）；P1 无消费方，机制不落地，仅在 `rules.md` 记一笔。

## 变更记录

| 日期 | CR | 变更 |
|---|---|---|
| 2026-07-19 | 无（dev 孵化，无 CR） | v0.1 骨架建立：copycat 实时内核逐字抽取，七文件导出符号登记，正式契约留待 P5 |
| 2026-07-19 | 无（dev 孵化，无 CR） | P2 内核扩展（向后兼容）：新增 `PollMode`、`PollPhase.SUPERSEDED`、`POLL_TICK`/`SUPERSEDE` 事件、`ARM_INTERVAL`/`DISARM_INTERVAL` 动作；`initPoll(config)` 携带 mode/immediateFirstAttempt；`longPoll` 加 classify/registry/key/interval 注入；新增 `createPollRegistry()`、`awaitIdle()`。既有导出行为逐字不变（48 既有测试零修改全绿）。参考实现 + 特征测验收 block-9 两 poller。仍 draft，P5 定稿 |
| 2026-07-19 | 无（dev 孵化，无 CR） | P3a 会话内核（上）：新增 `session/`——事件信封（`{streamId,seq,id,type,v,at,payload}`，`v` 版本字段即刻承载）、存储端口 + `createMemoryLogStore`、`ConflictError`（CAS）、`createDelivery`（publish/pull/ack/subscribe，subscribe 复用 P2 longPoll/wakeup 注入）。既有导出零改动（72 既有测试零修改全绿）。四不变量 property 测钉死。仍 draft，upcaster/decide-evolve 留 P3b，P5 定稿 |
| 2026-07-19 | 无（dev 孵化，无 CR） | P3b 会话内核（下）：新增 `session/aggregate.js`（`defineAggregate`/`reject`/`isReject`）、`session/upcaster.js`（`upcastEvent` 事件版本化，缺升级函数/来自未来响亮 throw）、`session/memory-snapshot-store.js`（`createMemorySnapshotStore`）、`session/aggregate-runtime.js`（`createAggregateRuntime`：execute 锁串行+CAS+滚动快照 / load 快照+尾部重放）。**append 路径唯一**：execute 复用 P3a delivery.publish。既有导出零改动（110 既有测试零修改全绿）。四不变量（重放确定性/拒绝无痕/evolve 只见升级后事件/execute 串行）property 测钉死；`reference/classroom-aggregate.ref.mjs` 三层全链路自证。仍 draft，P4 defineMachine、P5 定稿 |
| 2026-07-19 | 无（dev 孵化，无 CR） | P4 defineMachine 声明式转移表：新增 `machine/define-machine.js`（`defineMachine`/`MachineDefinitionError`/`IllegalTransitionError`）——平表状态机 + 纯谓词守卫，词汇照抄 XState，定义期全面校验（非法定义响亮 throw 带 id/位置）。既有导出零改动（153 既有测试零修改全绿）；`reference/classroom-aggregate.ref.mjs` 手写 phase if/else 改表驱动守卫、既有 4 参考测试零修改全绿（等价证明）。两不变量（状态封闭性/终态吸收性）property 测钉死。纯度门扩展 machine/ scope（同 session 5 项），56→61 项全 PASS。仍 draft，P5 定稿 |
