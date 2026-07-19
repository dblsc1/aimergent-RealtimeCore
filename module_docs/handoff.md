# realtime_core · handoff（冷启动接手便条）

> arbiter 独占维护、热更新。**面向未来接手**：新 AI 只读这一份就能上手——不是历史流水（那是 diary/worklog）。arbiter 每做完一个任务，检查这里要不要更新。

## 一句话

realtime_core 是**领域无关的实时/状态机内核库**（纯 ESM、零 runtime 依赖），孵化于 `dev/`。对外提供：long-poll 生命周期纯 reducer（`poll-machine.js`）+ 副作用引擎壳（`engine.js`）+ 命令分发 + 频道广播 + keyed 串行锁 + **会话内核投递层（P3a：append-only 事件日志 + 每消费组持久化游标，`session/`）**。不依赖任何平台契约或第三方包（零依赖是卖点）。当前无外部消费方，契约 draft、P5 定稿时冻结并迁 `0/` 平台层。

## 怎么跑 / 怎么测

- 无启动（库，无服务进程/端点/env/密钥）。无需 `npm install`（零依赖）。
- 测试：`cd code/backend && node --test --test-concurrency=1`（串行，内存紧）。当前 **110 用例全绿**（既有 72 零修改 = P1 48 + P2 24；P3a 新增 38）。
- 自检门：`node review/reviewcode/check-kernel-purity.mjs`（双 scope 共 36 项须全 PASS：`transport/` 16 项——无跨层 import、无领域词、无 db.transaction、≤500 行；`session/` 20 项——import 不出目录/零 transport import、零扩展领域词、**零 Date.now/Math.random**、无 db.transaction、≤500 行）。
- **兼容门（取代 P1 已退役的逐字门）**：既有 72 个 node:test **一行不许改、必须全绿**；新功能只准新增测试。

## 接口

对外行为唯一事实 = `module_docs/contract.md`。关键职责一句话：
- `poll-machine.js`：`reduce(state, event) → {state, actions}` 纯 reducer，两形态——**wakeup**（事件驱动，P1）与 **interval**（周期轮询，P2）；四终态 resolved/timed_out/closed/superseded。
- `engine.js`：`longPoll({...})` 解释 reducer 动作为真实副作用（注入 timers/wakeup/respond/registry）；`createDispatcher`、`createPollRegistry`。
- `locks.js`：`withLock`/`sessionLockKey`/`skillLockKey` + P2 `awaitIdle()`（优雅停机）。
- `session/`（P3a）：`createMemoryLogStore({clock, rng})`（存储端口内存实现：CAS append / read / getCursor / advanceCursor 只前进）、`createDelivery({logStore, wakeup, longPoll})`（publish/pull/ack 分离 at-least-once；`subscribe` 把注入的 P2 `longPoll` 组装成"有新事件即唤醒"的长轮询——**不 import transport，等待机制以能力注入复用**）、`ConflictError`、`sealEnvelopes`。信封 `{streamId,seq,id,type,v,at,payload}`，`v` = schema 版本（upcaster 留 P3b）。
- **参考实现**（`code/backend/reference/`）：`child-ab-next-question.ref.mjs`、`parent-options-waiter.ref.mjs` 用扩展内核复现 copycat block-9 两 poller；`classroom-feed.ref.mjs`（P3a）演示三消费组独立进度 + 断线重连续读。是"内核能承载真实业务"的机械证明——**不属对外契约面**，仅验收锚点。

## 避坑 / 冻结点 / 技术债

- **向后兼容硬约束**：`initPoll`/`reduce`/`longPoll`/`withLock` 及 P2 扩展面的既有调用面与行为已被 72 个既有测试钉死。P3+ 扩展**只增不改**——新形态走新参数、缺省即旧行为。改既有行为先记 worklog + 评估消费方 + 走 CR。
- **纯度红线**：`transport/` 生产代码零 import 越层、零领域词；`session/` 更严——import 不出目录（零 transport import，longPoll/wakeup 只许注入）、零扩展领域词、零 `Date.now`/`Math.random`。`concurrency/`、`queue/` 因含领域相邻词（`skillId`/`rounds`）不在纯度门内（与 copycat 老门 scope 一致）。
- **session/ 语义要点**（消费方避坑）：pull 不动游标（at-least-once，未 ack 必重投，消费侧需幂等）；ack 是前缀确认（游标跳到 seq 即确认 ≤seq 全部）；ack 越过本实例已 pull 高水位 = RangeError，崩溃重建后必须先重新 pull 再 ack；`publish` 缺省追加到尾（CAS 只兜底），要严格乐观并发就显式传 `expectedLastSeq`；信封冻结但 payload 是黑盒引用（库不拷贝——调用方别改已发布的 payload）。
- **微时序适配**（参考实现）：copycat block-9 的 attempt 在 interval 回调内**同步**结算；本内核经 attempt→Promise→ATTEMPT_RESULT 事件，结算落在 tick 后一个微任务。观测层行为一致，特征测试逐 tick 步进 + flush 微任务。
- **技术债**（P5 契约定稿时处理）：符号命名带领域味（`sessionLockKey`/`orderedSessionEvents`/`genEventId`），中性化重命名候选（破 API）；`ordering.js` 无专属测试（P1 遗留）；`locks.js` 形参 `skillId` 领域词；`sealEnvelopes` 的 id 生成与 `queue/ids.js` 格式重复实现（session/ 纯度门禁跨目录 import 所致，P5 统一）。
- **路线图**：P3b upcaster + `decide`/`evolve` 聚合语义（P3a 日志+游标已落地）、P4 `defineMachine` 转移表、P5 正式契约 + semver v1.0 + 迁平台层 + SSE 参考适配器。详见 `module_docs/rules.md`。
