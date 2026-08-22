# realtime_core · 模块专属规则

> 框架根为 `/srv/aimergent/0`；项目级铁律见 `/srv/aimergent/0/AGENTS.md`。完整治理时此处只能加严，并由 arbiter 执笔维护；独立实验可按《新模块与新项目开设指南》选择轻量模式。

## 工作模式

- 模式：**`governed`**（2026-07-20 起，从 `lightweight` 正式切换；2026-08-12 本次任务补齐三份 module_docs 的措辞同步，模式切换本身早已落地，非本次新发生）。
- 原定两个升级条件回顾（均已满足，经本次复核逐项核实证据）：
  1. **出现第一个外部消费方**：`functions/copycat` 已通过 git tag（当前 `v1.0.1`）真实消费本库——`code/backend/package.json` 固定依赖；具体消费了哪些面，以 `contract.md`「治理与变更控制」节的消费方清单表为唯一事实源。
  2. **经 CR 迁入 `0/` 平台层**：L0 doc-sync 已于 2026-07-20 完成（`0/` 仓 commit `e19d903` PR#27 + `86d3057` PR#28，consulter 独立审核 `APPROVED`，见 `0/CFO_agent/consulter/docs/findings/2026-07-20-realtime-core-promotion-review.md`），三项转正证据：
     - 物理迁移：仓已在 `/srv/aimergent/0/realtime_core/`（`/srv/aimergent/dev/realtime_core/` 已不存在，`find` 确认）。
     - `0/deploy/CONTRACTS-INDEX.md`：模块矩阵第 13 行 + 反查表第 33 行均已登记本模块。
     - CI 白名单：`0/ci/repo-status.sh:136`（PR#27）、`0/ci/install-ci.sh:26,62` 与 `0/ci/merge-to-main.sh:18`（PR#28）均已放行 `0/realtime_core` 走 L1 治理路径；`0/AGENTS.md` 顶层结构、`0/docs/1 structure/README.md`、`0/docs/manual/README.md` 均已列出本模块。
- **governed 模式规则**：契约冻结（`module_docs/contract.md` 是唯一事实，破坏性改动 = major）；**任何改变对外行为的改动先停、写 CR 交项目 arbiter/CFO，批准后先改 `contract.md` 再改代码**（`AGENTS.md`「接口纪律」+ 项目铁律4「契约至上」，具体流程见 `contract.md`「治理与变更控制」节）；本模块继续走"完整治理模式"工作流（模块根 `AGENTS.md`「完整治理模式」一节）——arbiter 开单 → 实现+自测 → reviewagent 审核 → `merge-to-main.sh` 合 main。此前 lightweight 模式"无需 CFO/独立 reviewagent/worktree/CONTRACTS-INDEX"的豁免自本次切换起失效。

## 技术与目录

1. **纯 ESM、零 runtime 依赖**是本库的卖点：`package.json` `"type":"module"`，`npm test` = `node --test`，不引第三方 runtime 包（devDependencies 也尽量为零）。新增代码不得破坏"内核零依赖"。
2. 代码分区（`code/backend/src/`）：`transport/`（实时引擎壳 + long-poll reducer + 命令分发 + 频道）、`concurrency/`（keyed 锁）、`queue/`（事件排序 + id 生成）、`session/`（P3a 起：会话内核——事件日志 + 消费组游标投递，"记账本 + 书签"）、`machine/`（P4 起：defineMachine 声明式转移表工具，纯逻辑）。测试 `.test.mjs`/`.property.test.mjs` 旁置于被测模块同目录。
3. **纯度门**：`review/reviewcode/check-kernel-purity.mjs` 三 scope——①`transport/` 生产 .js：无 transport/存储/领域层 import、无 copycat 领域词、无 `db.transaction(`、单文件 ≤500 行；②`session/` 生产 .js（P3a 扩展 scope，更严）：import 不出 session/ 目录（**零 transport import**，对 longPoll/wakeup 的依赖只许以 port 形状注入；**P5 收债起唯一受控白名单 = `queue/ids.js`**——envelope 缺省 id 生成去重到唯一事实源，白名单文件本身纳入同 5 项严格检查即"白名单闭环"，不留纯度盲区）、零领域词（扩展词表 scenario/question/skill/scene/round）、**零 `Date.now(`/`Math.random(`**（clock/rng 一律注入）、无 `db.transaction(`、≤500 行；③`machine/` 生产 .js（P4 扩展 scope，与 session 同 5 项检查，内部共用 `checkStrictScope` helper）。`concurrency/`、`queue/` 的其余文件**不在纯度门覆盖内**（`ordering.js` 含领域相邻词 `rounds`，与 copycat 老门 scope 一致）。
4. **逐字抽取纪律（v0.1 遗产 → P2 兼容门）**：`code/backend/src/` 七文件起点是 copycat 内核的逐字节抽取。P1 的 `check-verbatim-extraction.mjs` 逐字门**已于 P2 退役并删除**——它的使命（证明抽取忠实）已完成；抽取一旦叠加功能扩展，逐字比对必然失真，继续留着只会误报。接任的**兼容门 = P1 移植的既有 48 个 node:test 用例一行不改、必须全绿**（新功能只准新增测试，不准改既有测试）。P2+ 功能扩展在既有导出行为之上**只增不改**：`initPoll`/`reduce`/`longPoll`/`withLock` 等的既有调用面与行为保持逐字兼容，新增形态（interval / 顶替 / classify / registry / awaitIdle）走新参数、缺省即旧行为（要改既有行为先记 worklog + 评估消费方 + 走 CR）。

## 跨仓依赖机制

- 消费方引用 realtime_core：**用 git tag 固定版本**（P1 决策 3）。机制自 v1.0.0 起正式启用；`v1.0.0`（2026-07-19）与 `v1.0.1`（2026-07-20，仅补仓根 `package.json` exports map 使库可作 git 依赖安装，无 API 变化，属 patch）两枚 tag 均已由 CFO 在合并后的 main squash commit 上打（本仓不自打 tag，`git for-each-ref refs/tags` 可查）。
- 当前唯一已核实消费方：`functions/copycat`（`code/backend/package.json` 固定 `#v1.0.1`）。消费方清单与实际消费范围以 `contract.md`「治理与变更控制」节为准，随消费关系变化时两处同步更新。

## 启动与自检

- 安装：无（零 runtime 依赖；`code/backend/` 无需 `npm install`）。
- 启动：不适用（库，无服务进程）。
- lint / typecheck：暂无（v0.1 纯抽取，未引入 lint 工具链）。
- test：`cd code/backend && npm test`（= `node --test`，串行；P5 = 201 个 node:test 用例全绿，其中 P1 既有 48 + P2 新增 24 + P3a 新增 38 + P3b 新增 43 + P4 新增 34（合计 187 个既有零修改）+ P5 新增 14 个（`queue/ordering.test.mjs` 8 清 P1 遗留债 + `reference/sse-adapter.ref.test.mjs` 6 实测 SSE 形态））。串行跑：`node --test --test-concurrency=1`（内存紧）。
- 审核脚本：`node review/reviewcode/check-kernel-purity.mjs`（须全 PASS；P5 = 66 项：transport 16 + session 40（8 文件×5）+ machine 5（1 文件×5）+ 白名单闭环 5（queue/ids.js×5，P5 收债起——session/ 获准 import 的唯一域外文件本身纳入同 5 项严格检查））。逐字门 `check-verbatim-extraction.mjs` 已于 P2 退役删除（见技术与目录 §4），兼容改由"既有测试零修改全绿"接任（P5 兼容门 = 既有 187 个零修改全绿）。

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
`src/session/` 新增：`aggregate.js`（`defineAggregate` 纯聚合描述：decide/evolve 全纯函数、`reject` 结构化业务拒绝、`onUnknownEvent` 未知事件默认响亮 throw）、`upcaster.js`（`upcastEvent` 事件版本化：库拥有版本号、逐级 v→v+1 升级、缺升级函数/来自未来响亮 throw，消费方永远只见最新 schema）、`memory-snapshot-store.js`（快照端口内存实现，防御性深拷贝）、`aggregate-runtime.js`（`createAggregateRuntime`：execute = 锁串行→CAS append→读回折叠→滚动快照，load = 快照+尾部重放）。**append 路径唯一**：execute 复用 P3a `delivery.publish`，全库仅一条写日志路径。四条不变量（重放确定性含快照 present/absent/behind 三形态 / 拒绝无痕 / evolve 只见升级后事件 / execute 串行等价且 CAS 零冲突——去锁反证响亮 ConflictError）固定种子 property 测钉死；`reference/classroom-aggregate.ref.mjs` **整库首次三层（聚合+投递+传输）串跑最小课堂全链路**，含 v1→v2 事件演进。既有 110 测试零修改全绿，纯度门扩展至 56 项全 PASS。真实持久化适配器（照端口契约）仍未落地，触发条件与现状见 P5 节技术债。

### P4 · defineMachine 转移表工具 ✅ 已完成（feat/p4-define-machine）
`src/machine/define-machine.js`：`defineMachine(spec)` 平表状态机 + 纯谓词守卫 + `MachineDefinitionError`/`IllegalTransitionError`。**词汇照抄 XState**（states/on/target/guard/initial/final/guards），但只做平表。核心价值 = **定义期全面校验**（非法定义在 `defineMachine()` 调用时响亮 throw，错误信息带 machine id 与具体位置）。方法：`transition`（非法响亮 throw）/`can`（查询不抛）/`states`·`finalStates`（冻结枚举）/`assertState`（裸字符串逃逸断言）。
**明确不做（YAGNI，本决策记账）**：层级/并行状态、entry/exit actions 执行、invoke/actor、延迟(after)转移、字符串 target 简写——需要时再走 CR 扩展，当前 decide 组合只需"允许吗/到哪去"。guard 只做纯谓词 `(ctx, event)→boolean`，抛异常即编程错误原样上抛。JS 对象字面量静默折叠重复键 → 运行时无法检测重复键定义，改以"未知键严格拒绝"作响亮校验的等价收益。
**与 decide 的组合边界**：machine 只回答"允许吗/到哪去"，不产事件、不折叠领域状态；decide 产事件、evolve 折叠状态。`reference/classroom-aggregate.ref.mjs` 把手写 phase if/else 改 `can(...)` 表驱动守卫、既有 4 参考测试零修改全绿（等价证明）。两不变量（状态封闭性/终态吸收性）property 测钉死。纯度门加 machine/ scope（56→61）。
**动机（已达成）**：P2 手写 reducer 能跑但难维护；转移表把状态机结构显式化、可静态校验，是内核从"能用"到"好用"的关键；也是 copycat Step-5 收编 session.status 五值散落问题的预备工具。

### P5 · 正式契约 + semver v1.0 + 迁平台层 ◐ 库内部分已完成（feat/p5-contract-v1）
**已完成（本分支）**：`module_docs/contract.md` 定稿为 **v1.0.0 正式契约**（35 导出符号 · 5 端口 · 15 条不变量承诺表与测试互指、semver 政策、信封只加不改、遗产兼容面标注）；**SSE 参考适配器 + 6 测试**（`reference/sse-adapter.ref.mjs`——实测三形态共用内核零改动，"RESPOND 后连接仍活着继续推" = 顺序复合多个 poll 生命周期，无内核缺口）；package.json → 1.0.0；README 快速上手。
**移交项（不属本分支职权，均已完成，见上方「工作模式」）**：① **`git tag v1.0.0` 由 CFO 在合并后的 main squash commit 上打**（本分支不打 tag）——✅ 已打，且随后 `v1.0.1` 补打；② **迁 `0/` 平台层**（CR、`0/AGENTS.md` 顶层结构、CONTRACTS-INDEX 登记、模式切 `governed`）**待 CFO 治理流程**（需用户逐字确认）——✅ L0 doc-sync 已于 2026-07-20 完成（PR#27/#28），模式已正式切 `governed`（本三份 module_docs 的措辞同步见 2026-08-12 `chore/governance-promotion`）。
P5 技术债逐条下落：
- **信封 id 与 `queue/ids.js` 去重** ✅ **P5 已清偿**：`session/envelope.js` 改为 import `queue/ids.js::genEventId`（唯一事实源），以"clock 传已取 at"保持既有行为逐字不变（id 时间戳分量 === 信封 at）；纯度门开受控白名单（仅此一个文件）并把 ids.js 本身纳入同 5 项严格检查（白名单闭环，61→66 项）。既有测试零修改全绿为兼容证明。
- **符号中性化** ⏭ **移交 v2/迁平台层专项（P5 决策，未清偿）**：`sessionLockKey`/`skillLockKey`/`orderedSessionEvents`/`maxEventSeq`/`genTurnId` 等领域味命名**未**在 v1.0 中性化——本单兼容门为"既有 187 测试零修改全绿"（最高优先级纪律），重命名必改测试，二者硬冲突；且 `ordering.js` 读 copycat `session.rounds` 结构，是 copycat 换装期的硬依赖遗产面，此刻改名徒增换装成本。处置：契约把它们标注为**遗产兼容面**（冻结如现状、新消费方不应用于新数据建模），中性化 = major，随 v2 或迁平台层 CR 一并做（届时允许改测试、有 CFO 协调消费方）。原"趁 v1.0 定版做"的设想与兼容门冲突，按保守方案让位——记录于 backend P5 worklog。
- **`ordering.js` 无专属测试**（P1 遗留）✅ **P5 已清偿**：新增 `queue/ordering.test.mjs` 8 用例，钉死排序键（seq→createdAt→round）、哑参数 `assignMissing`、null/空洞容忍、`maxEventSeq(null)` 保留崩溃行为、以及"投影跳过无 type 事件但 maxEventSeq 计入"的既有不对称。
- **真实持久化适配器** ⏭ **触发条件 2026-08-12 治理转正复核后修正（决策本身不变，仍未清偿）**：原"移交首个消费方落地期"的触发条件已经过时——首个消费方 `functions/copycat` 已经落地（`v1.0.1` 起消费本库），但**本条真正相关的 `session/` 端口（logStore/snapshotStore）截至目前仍是 0 个生产环境实际消费者**：copycat 自己写了一个 logStore 的 SQLite 实现（`code/backend/src/data/sqlite-log-store.js`，文件头注释自述"intentionally not wired into copycat's composition root yet"），但按其自身 Step-5 R3b 决定尚未接入生产组合根，目前只被它自己的测试文件引用（`git grep` 全 copycat `src/` 确认无第二处 import）。端口契约已在 v1.0 contract 正式化（含实现方义务清单），内存参考实现即可执行规格；**新触发条件：`session/` 端口出现生产环境实际消费者时再写真实适配器**——不再以"是否存在任意消费方"为准，那个条件已满足但不解除这条债，因为债的本质是"没人在生产环境真正跑这个端口"，不是"没人 import 过这个库"。**copycat 实际消费了本库哪些面，唯一事实源是 `contract.md`「治理与变更控制」节的消费方清单表**（该表同时是 CR 影响面评估依据）；本条只写判据、不复述消费范围，避免同一易变事实出现第二份副本。
- **`defineMachine` YAGNI 项** ✅ **P5 已评估：明确留在 v1.x 之外**：层级/并行/actor/entry-exit-actions/延迟转移/字符串 target 简写全部**不纳入 v1.0**（contract "明确非目标"节冻结此边界）；copycat Step-5 收编 session.status 只需平表 + can/transition，无一项 YAGNI 需求实据。将来需求出现 = minor/v2 扩展，走契约变更流程。
**动机**：迁 `0/` 平台层意味着对外承诺冻结、多模块可依赖——必须先有稳定契约、版本号、跨传输验证、清偿破 API 的债，才能承担平台层的复用责任。
