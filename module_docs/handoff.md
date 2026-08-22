# realtime_core · handoff（冷启动接手便条）

> arbiter 独占维护、热更新。**面向未来接手**：新 AI 只读这一份就能上手——不是历史流水（那是 diary/worklog）。arbiter 每做完一个任务，检查这里要不要更新。

## 一句话

realtime_core 是**领域无关的实时/状态机内核库**（纯 ESM、零 runtime 依赖），现为 **`0/` 平台层受治理模块（governed，2026-07-20 起）**，仓根在 `/srv/aimergent/0/realtime_core/`。对外提供：long-poll 生命周期纯 reducer（`poll-machine.js`）+ 副作用引擎壳（`engine.js`）+ 命令分发 + 频道广播 + keyed 串行锁 + **完整会话内核（`session/`）：P3a 事件日志+游标投递层，P3b decide/evolve 聚合语义 + 事件版本化 upcaster + 崩溃重放运行时** + **声明式状态机工具（`machine/`）：P4 defineMachine 平表转移表 + 定义期全面校验（decide 内部合法转移判定的可选辅助）**。不依赖任何平台契约或第三方包（零依赖是卖点）。**P5 起契约已正式化为 v1.0.0 冻结基线**（35 导出符号 · 5 端口 · 15 条不变量承诺表，全部与测试互指——见 `module_docs/contract.md`）；`v1.0.0`/`v1.0.1` 两枚 tag 均已由 CFO 在 main 打好。**唯一已核实消费方**：`functions/copycat`（git tag 固定 `v1.0.1`；其实际消费了哪些面，唯一事实源是 contract.md「治理与变更控制」节的消费方清单表，本文件不复述）。仓根 `README.md` 是一页快速上手。

## 怎么跑 / 怎么测

- 无启动（库，无服务进程/端点/env/密钥）。无需 `npm install`（零依赖）。
- 测试：`cd code/backend && node --test --test-concurrency=1`（串行，内存紧）。当前 **201 用例全绿**（既有 187 零修改 = P1 48 + P2 24 + P3a 38 + P3b 43 + P4 34；P5 新增 14 = ordering 补测 8 + SSE 适配器 6）。
- 自检门：`node review/reviewcode/check-kernel-purity.mjs`（共 66 项须全 PASS：`transport/` 16 项——无跨层 import、无领域词、无 db.transaction、≤500 行；`session/` 40 项（8 文件×5）+ `machine/` 5 项（1 文件×5）——import 不出目录/零 transport import、零扩展领域词、**零 Date.now/Math.random**、无 db.transaction、≤500 行；**P5 起 session/ 有唯一受控白名单 `queue/ids.js`，该文件另占 5 项"白名单闭环"检查**；session/machine 共用 `checkStrictScope` helper）。
- **兼容门（取代 P1 已退役的逐字门）**：既有 187 个 node:test **一行不许改、必须全绿**；新功能只准新增测试。v1.0.0 起这同时是 semver 承诺（patch/minor 必须保持全绿）。

## 接口

对外行为唯一事实 = `module_docs/contract.md`。关键职责一句话：
- `poll-machine.js`：`reduce(state, event) → {state, actions}` 纯 reducer，两形态——**wakeup**（事件驱动，P1）与 **interval**（周期轮询，P2）；四终态 resolved/timed_out/closed/superseded。
- `engine.js`：`longPoll({...})` 解释 reducer 动作为真实副作用（注入 timers/wakeup/respond/registry）；`createDispatcher`、`createPollRegistry`。
- `locks.js`：`withLock`/`sessionLockKey`/`skillLockKey` + P2 `awaitIdle()`（优雅停机）。
- `session/`（P3a）：`createMemoryLogStore({clock, rng})`（存储端口内存实现：CAS append / read / getCursor / advanceCursor 只前进）、`createDelivery({logStore, wakeup, longPoll})`（publish/pull/ack 分离 at-least-once；`subscribe` 把注入的 P2 `longPoll` 组装成"有新事件即唤醒"的长轮询——**不 import transport，等待机制以能力注入复用**）、`ConflictError`、`sealEnvelopes`。信封 `{streamId,seq,id,type,v,at,payload}`，`v` = schema 版本。
- `session/`（P3b · 聚合层）：`defineAggregate({name, initial, decide, evolve, upcasters?, eventVersions?, onUnknownEvent?, schemaVersion?})`（纯聚合描述）+ `reject(code, detail?)`（结构化业务拒绝，非 throw）；`upcastEvent`（事件版本化，逐级升级、缺升级函数/来自未来响亮 throw）；`createMemorySnapshotStore()`（快照端口内存实现）；`createAggregateRuntime({aggregate, logStore, locks?, wakeup?, snapshotStore?, snapshotEvery?})`——`execute(streamId, cmd, ctx) → {events, state} | {rejected}`（锁串行→CAS append→读回折叠→滚动快照）、`load(streamId) → state`（快照+尾部重放）。**append 路径唯一**：execute 复用 P3a `delivery.publish`。
- `machine/`（P4 · 状态机工具）：`defineMachine({id, initial, states, guards?})` → 不可变纯机器：`transition(state, event, ctx?) → {state, changed} | throw IllegalTransitionError`、`can(...) → boolean`（不抛）、`states`/`finalStates`（冻结枚举）、`initial`、`assertState(value)`。词汇照抄 XState（states/on/target/guard/final），**只做平表**（不做层级/并行/actor/actions/延迟）。核心价值 = 定义期全面校验（非法定义 `defineMachine()` 时响亮 throw，带 id + 位置）。错误类 `MachineDefinitionError`（定义期）/`IllegalTransitionError`（运行期，带 `reason`）。**组合定位**：decide 内做守卫用（`machine.can(phase, EVENT)`），machine 不产事件、不折叠状态。
- **参考实现**（`code/backend/reference/`）：`child-ab-next-question.ref.mjs`、`parent-options-waiter.ref.mjs` 用扩展内核复现 copycat block-9 两 poller；`classroom-feed.ref.mjs`（P3a）演示三消费组独立进度 + 断线重连续读；`classroom-aggregate.ref.mjs`（P3b→P4）**整库首次三层（聚合+投递+传输）串跑最小课堂全链路**（命令→事件→三组订阅各自唤醒收到），含 v1→v2 事件演进；**P4 起其 decide 守卫改用 `CLASSROOM_MACHINE.can(...)` 表驱动**（手写 phase if/else 下沉到 defineMachine 表，行为不变、4 参考测试零修改全绿）；`sse-adapter.ref.mjs`（P5）**实测 SSE 形态**——conn 抽象 + delivery.subscribe 顺序复合多个 poll 生命周期实现"RESPOND 后连接仍活着继续推"，证明 WS/long-poll/SSE 三形态共用同一内核零改动（0.6 号设计声明从理论变实测）。是"内核能承载真实业务"的机械证明——**不属对外契约面**，仅验收锚点。

## 避坑 / 冻结点 / 技术债

- **向后兼容硬约束**：`initPoll`/`reduce`/`longPoll`/`withLock` 及 P2 扩展面的既有调用面与行为已被 72 个既有测试钉死。P3+ 扩展**只增不改**——新形态走新参数、缺省即旧行为。改既有行为先记 worklog + 评估消费方 + 走 CR。
- **纯度红线**：`transport/` 生产代码零 import 越层、零领域词；`session/` 更严——import 不出目录（零 transport import，longPoll/wakeup 只许注入）、零扩展领域词、零 `Date.now`/`Math.random`。`concurrency/`、`queue/` 因含领域相邻词（`skillId`/`rounds`）不在纯度门内（与 copycat 老门 scope 一致）。
- **session/ 语义要点**（消费方避坑）：pull 不动游标（at-least-once，未 ack 必重投，消费侧需幂等）；ack 是前缀确认（游标跳到 seq 即确认 ≤seq 全部）；ack 越过本实例已 pull 高水位 = RangeError，崩溃重建后必须先重新 pull 再 ack；`publish` 缺省追加到尾（CAS 只兜底），要严格乐观并发就显式传 `expectedLastSeq`；信封冻结但 payload 是黑盒引用（库不拷贝——调用方别改已发布的 payload）。
- **P3b 聚合层要点**（消费方避坑）：`decide`/`evolve`/`upcaster` 必须纯——非确定性走 `ctx`（clock/rng/actor）注入，`evolve` 禁 throw/副作用（否则重放不确定）。`reject(code)` = 业务拒绝（不写日志、无痕），`throw` = 编程错误（未知命令/decide 非法返回/evolve 缺 handler）——别混用。**事件版本化不可后补**：加事件字段就升 `eventVersions[type]` 并注册 upcaster，否则旧日志重放**响亮 throw**（这是特性不是 bug——宁炸不静默放行旧 schema）；库拥有版本号，upcaster 只变换 payload、不用管 `v`。快照 state 必须 structuredClone 可克隆（纯数据，无函数/类实例）；聚合逻辑演进就升 `schemaVersion`，旧 schema 快照会被丢弃、从日志全量重建。**execute 必带锁**（`locks: {withLock}`）才有串行保证——无锁并发写同 stream 会撞 CAS 响亮 `ConflictError`（这是兜底不是常态）。
- **微时序适配**（参考实现）：copycat block-9 的 attempt 在 interval 回调内**同步**结算；本内核经 attempt→Promise→ATTEMPT_RESULT 事件，结算落在 tick 后一个微任务。观测层行为一致，特征测试逐 tick 步进 + flush 微任务。
- **微任务窗口（契约已如实入契）**：wakeup 形态下 publish 落在 initial attempt（已 pull 空）与 SUBSCRIBE 生效之间的微任务窗口时，本生命周期不再主动 attempt——延迟到 TIMEOUT 或下一生命周期 initial pull 可见（上限 timeoutMs）。P1 起即有、非 SSE 特有；消费方不得假设"publish 后必即时唤醒"。
- **技术债（P5 收账后的余额）**：✅已清偿——信封 id 去重（envelope 复用 `queue/ids.js::genEventId`，纯度门白名单闭环）、`ordering.js` 补 8 专属测试。⏭移交——**符号中性化**（`sessionLockKey`/`skillLockKey`/`orderedSessionEvents`/`genTurnId` 等遗产兼容面，与"187 零修改"兼容门硬冲突，冻结如现状、v2/迁平台层专项）；**真实持久化适配器**（触发条件已修正为"`session/` 端口出现生产环境实际消费者"，非"任意消费方存在"，详见 rules.md P5 节；copycat 实际消费范围见 contract.md 消费方清单表）；**defineMachine YAGNI 项**（已评估：明确留在 v1.0 之外，contract 非目标节冻结）。详见 `module_docs/rules.md` P5 节。
- **路线图**：P1–P4 全部落地；**P5 库内收尾已完成**（正式契约 v1.0.0、SSE 参考适配器、收债、README、version 1.0.0）。**移交 CFO 的两件事均已完成**：①`v1.0.0`/`v1.0.1` 两枚 tag 已在合并后的 main squash commit 上打好；②迁 `0/` 平台层治理流程已于 2026-07-20 完成（CR + `0/AGENTS.md` 顶层结构 + CONTRACTS-INDEX + CI 白名单，PR #27/#28，consulter 独立审核 APPROVED），模式已正式切 `governed`（2026-08-12 本模块三份 module_docs 补齐"治理状态"措辞同步，分支 `chore/governance-promotion`）。详见 `module_docs/rules.md`「工作模式」与 `module_docs/contract.md`「治理与变更控制」。
