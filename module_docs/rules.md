# realtime_core · 模块专属规则

> 框架根为 `/srv/aimergent/0`；项目级铁律见 `/srv/aimergent/0/AGENTS.md`。完整治理时此处只能加严，并由 arbiter 执笔维护；独立实验可按《新模块与新项目开设指南》选择轻量模式。

## 工作模式

- 模式：`lightweight`（孵化于 `dev/`，尚无外部消费方；P5 迁 `0/` 平台层时升级为 `governed`）。
- 升级条件：出现第一个外部消费方，或经 CR 迁入 `0/` 平台层——届时切 `governed`，契约冻结、变更走 CR。

## 技术与目录

1. **纯 ESM、零 runtime 依赖**是本库的卖点：`package.json` `"type":"module"`，`npm test` = `node --test`，不引第三方 runtime 包（devDependencies 也尽量为零）。新增代码不得破坏"内核零依赖"。
2. 代码分区（`code/backend/src/`）：`transport/`（实时引擎壳 + long-poll reducer + 命令分发 + 频道）、`concurrency/`（keyed 锁）、`queue/`（事件排序 + id 生成）、`session/`（P3a 起：会话内核——事件日志 + 消费组游标投递，"记账本 + 书签"）。测试 `.test.mjs`/`.property.test.mjs` 旁置于被测模块同目录。
3. **纯度门**：`review/reviewcode/check-kernel-purity.mjs` 双 scope——①`transport/` 生产 .js：无 transport/存储/领域层 import、无 copycat 领域词、无 `db.transaction(`、单文件 ≤500 行；②`session/` 生产 .js（P3a 扩展 scope，更严）：import 不出 session/ 目录（**零 transport import**，对 longPoll/wakeup 的依赖只许以 port 形状注入）、零领域词（扩展词表 scenario/question/skill/scene/round）、**零 `Date.now(`/`Math.random(`**（clock/rng 一律注入）、无 `db.transaction(`、≤500 行。`concurrency/`、`queue/` **不在纯度门覆盖内**（含领域相邻词 `rounds`/`skillId`，与 copycat 老门 scope 一致）。
4. **逐字抽取纪律（v0.1 遗产 → P2 兼容门）**：`code/backend/src/` 七文件起点是 copycat 内核的逐字节抽取。P1 的 `check-verbatim-extraction.mjs` 逐字门**已于 P2 退役并删除**——它的使命（证明抽取忠实）已完成；抽取一旦叠加功能扩展，逐字比对必然失真，继续留着只会误报。接任的**兼容门 = P1 移植的既有 48 个 node:test 用例一行不改、必须全绿**（新功能只准新增测试，不准改既有测试）。P2+ 功能扩展在既有导出行为之上**只增不改**：`initPoll`/`reduce`/`longPoll`/`withLock` 等的既有调用面与行为保持逐字兼容，新增形态（interval / 顶替 / classify / registry / awaitIdle）走新参数、缺省即旧行为（要改既有行为先记 worklog + 评估消费方 + 走 CR）。

## 跨仓依赖机制

- 未来消费方引用 realtime_core：**用 git tag 固定版本**（本单决策 3）。P1 无消费方，机制暂不落地，仅此记录。P5 定稿时随 semver v1.0 tag 正式启用。

## 启动与自检

- 安装：无（零 runtime 依赖；`code/backend/` 无需 `npm install`）。
- 启动：不适用（库，无服务进程）。
- lint / typecheck：暂无（v0.1 纯抽取，未引入 lint 工具链）。
- test：`cd code/backend && npm test`（= `node --test`，串行；P3b = 153 个 node:test 用例全绿，其中 P1 既有 48 + P2 新增 24 + P3a 新增 38（合计 110 个既有零修改）+ P3b 新增 43 个）。串行跑：`node --test --test-concurrency=1`（内存紧）。
- 审核脚本：`node review/reviewcode/check-kernel-purity.mjs`（须全 PASS；双 scope = transport 16 项 + session 40 项（P3b 起 8 文件×5）= 56 项）。逐字门 `check-verbatim-extraction.mjs` 已于 P2 退役删除（见技术与目录 §4），兼容改由"既有测试零修改全绿"接任（P3b 兼容门 = 既有 110 个零修改全绿）。

## 演进路线图（P2→P5）

> 本单（P1）只做建仓 + 逐字抽取 + 测试落位，**不做任何功能扩展**。以下为已拍板的后续路线，每项含动机，供后续任务单展开。

### P2 · reducer 扩展 + engine keyed registry ✅ 已完成（feat/p2-kernel-extension）
在逐字继承的 `poll-machine.js` reducer 之上扩展新事件/动作/终态：`POLL_TICK`、`SUPERSEDE` 事件，`ARM_INTERVAL`/`DISARM_INTERVAL` 动作，`SUPERSEDED` 终态，`PollMode` 形态开关 + `immediateFirstAttempt` 首发开关；`engine.js` 加 interval 形态解释 + keyed poller registry（`createPollRegistry`，按 key 顶替并发 long-poll）；`locks.js` 加 `awaitIdle()` 优雅停机。
**动机 + 验收（已达成）**：`code/backend/reference/` 两个参考实现用扩展内核逐条复现 copycat block-9 next-question-poller（1000ms/延迟首发/not_found·delivered 终止/60s/close 静默）与 options-waiter（800ms + keyed supersede），配 fake-timers 特征测试——证明扩展后的通用内核能无损承载真实业务的实时形态。property test 加 3 条新不变量（SUPERSEDE 顶替 / 终态后不派发 / interval CLEANUP 含 DISARM_INTERVAL）。既有 48 测试零修改全绿。

### P3 · 会话内核（游标投递模型）——拆 P3a/P3b
引入会话状态内核，**采用"游标投递模型"**（日志 + 每消费组游标）**替代** copycat 现有的 delivered/done 标记模型：事件写入 append-only 日志，每个消费组维护自己的读游标，投递进度 = 游标位置。**事件版本化为 P3 必含设计**（每事件带 schema version，消费方可前向兼容）。
**动机**：delivered/done 模型在多消费组、重放、审计场景下会互相打架；游标模型让"谁读到哪"独立可查，且事件版本化是长寿命内核不返工的前提。

#### P3a · 事实日志 + 游标投递 ✅ 已完成（feat/p3a-log-cursors）
`src/session/`：事件信封（`{streamId,seq,id,type,v,at,payload}`，`v` 版本字段即刻进信封）、存储端口 + `createMemoryLogStore`（CAS append / read / getCursor / advanceCursor 只前进）、`createDelivery`（publish/pull/ack 分离 at-least-once + subscribe **注入复用 P2 longPoll/wakeup**，零自制轮询）。四条不变量（已确认序列=日志连续前缀 / seq 连续+CAS 唯一胜者 / 游标只前进 / 崩溃重建后仍成立）固定种子 property 测钉死；`reference/classroom-feed.ref.mjs` 演示三消费组独立进度与断线重连。纯度门扩展 session/ scope（零 transport import、零 Date.now/Math.random、扩展领域词表）。

#### P3b · upcaster + decide/evolve 聚合语义 ✅ 已完成（feat/p3b-decide-evolve）
`src/session/` 新增：`aggregate.js`（`defineAggregate` 纯聚合描述：decide/evolve 全纯函数、`reject` 结构化业务拒绝、`onUnknownEvent` 未知事件默认响亮 throw）、`upcaster.js`（`upcastEvent` 事件版本化：库拥有版本号、逐级 v→v+1 升级、缺升级函数/来自未来响亮 throw，消费方永远只见最新 schema）、`memory-snapshot-store.js`（快照端口内存实现，防御性深拷贝）、`aggregate-runtime.js`（`createAggregateRuntime`：execute = 锁串行→CAS append→读回折叠→滚动快照，load = 快照+尾部重放）。**append 路径唯一**：execute 复用 P3a `delivery.publish`，全库仅一条写日志路径。四条不变量（重放确定性含快照 present/absent/behind 三形态 / 拒绝无痕 / evolve 只见升级后事件 / execute 串行等价且 CAS 零冲突——去锁反证响亮 ConflictError）固定种子 property 测钉死；`reference/classroom-aggregate.ref.mjs` **整库首次三层（聚合+投递+传输）串跑最小课堂全链路**，含 v1→v2 事件演进。既有 110 测试零修改全绿，纯度门扩展至 56 项全 PASS。真实持久化适配器（照端口契约）仍留随消费方落地。

### P4 · defineMachine 转移表工具
提供声明式状态机构造工具 `defineMachine`（转移表：states / events / guards / actions）。**词汇照抄 XState**（states/events/guards/actions/context），降低学习成本、便于未来对接生态，但实现保持零依赖、纯函数内核。
**动机**：P2 手写 reducer 能跑但难维护；转移表把状态机结构显式化、可静态校验、可可视化，是内核从"能用"到"好用"的关键。

### P5 · 正式契约 + semver v1.0 + 迁平台层
定稿 `module_docs/contract.md` 正式契约、打 semver **v1.0** tag、**经 CR 迁入 `0/` 平台层**（触及 `0/AGENTS.md` 顶层结构，需用户逐字确认）、补 **SSE 参考适配器测试**（证明内核能驱动 SSE 传输，不止 long-poll）。
**动机**：迁 `0/` 平台层意味着对外承诺冻结、多模块可依赖——必须先有稳定契约、版本号、跨传输验证，才能承担平台层的复用责任。
