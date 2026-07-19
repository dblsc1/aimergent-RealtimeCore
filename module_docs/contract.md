# realtime_core · 对外接口契约

> 本文件是 realtime_core 对外行为的**唯一事实**。当前为**孵化期骨架**：realtime_core 位于 `dev/`（试验区），尚无外部消费方。v0.1 的公共 API 起点 = **逐字继承 copycat 已验证实时内核**，P2 起在其上**向后兼容地扩展**（P2：interval 形态 / 顶替语义 / keyed registry / awaitIdle；P3a：会话内核之日志+游标投递层，见下）；**正式契约 P5 定稿**（semver v1.0、经 CR 迁入 `0/` 平台层时冻结）。在正式定稿前，下列导出符号清单描述"当前提供了什么"，不构成对外冻结承诺（draft）。

## 契约索引声明（provides / consumes）

```yaml
provides:
  - id: realtime-core-kernel@v0.1
    summary: 领域无关的实时/状态机内核——long-poll 生命周期 reducer + 命令分发 + 频道广播 + keyed 锁；零 runtime 依赖。P5 前无对外冻结承诺。
consumes: []   # 零依赖是卖点：内核不依赖任何平台契约或第三方包
```

## 版本与定稿状态

- **v0.1（当前）**：copycat 实时内核逐字抽取 + P2/P3a 向后兼容扩展，孵化于 `dev/realtime_core/`。API 表面 = 下列各文件的导出符号，**未冻结**。
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
