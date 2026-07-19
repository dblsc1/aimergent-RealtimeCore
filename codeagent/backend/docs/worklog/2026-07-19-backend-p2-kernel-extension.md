# worklog · 2026-07-19 · backend · P2 内核扩展

任务单：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p2-kernel-extension.md`
分支：`feat/p2-kernel-extension`（从 P1 合并后的 main `7d41f8e` 切出，不合 main）
Agent-Attribution：`backend@dev/realtime_core+p2-kernel-extension`

## 目标

让通用内核（poll-machine reducer + engine 壳）覆盖 copycat block-9 当年绕开引擎的三种形态——周期轮询、同 key 顶替、延迟首发——并用"库内参考实现逐条复现 block-9 两个 poller"作机械验收。**向后兼容是硬约束**：P1 移植的 48 个既有测试一行不改、必须全绿。

## 改动总览（只增不改既有行为）

### 1. poll-machine.js reducer 扩展（338 行，≤500，无需拆分）

- 新枚举 `PollMode = {WAKEUP, INTERVAL}`；新终态 `PollPhase.SUPERSEDED`（第四终态）。
- 新事件 `POLL_TICK`（interval 触发）、`SUPERSEDE`（被同 key 新请求顶替）。
- 新动作 `ARM_INTERVAL` / `DISARM_INTERVAL`（周期定时器装/拆，与一次性 `ARM_TIMER` 语义分开）。
- `initPoll(config?)`：`config = {mode?, immediateFirstAttempt?}`。缺省 = wakeup + immediateFirstAttempt:true（**P1 逐字**）；interval 默认 immediateFirstAttempt:false（复现 block-9 延迟首发）。非法 mode 抛 TypeError。
- interval 形态状态图：`init --START--> waiting [ARM_INTERVAL, ARM_TIMER, (ATTEMPT initial if immediate)]`；`waiting --POLL_TICK--> waiting [ATTEMPT poll]`；结算/超时/错误/断连/顶替 → 对应终态，teardown 含 `DISARM_INTERVAL`。
- `RESPOND.outcome` 泛化：`ATTEMPT_RESULT` 事件可带 `outcome`（delivered/not_found/…），reducer 原样透传给 `RESPOND`，缺省仍 `'settled'`。
- **终态 teardown helper**：wakeup → `[CLEANUP]`（与 P1 逐字），interval → `[DISARM_INTERVAL, CLEANUP]`。这是保持向后兼容的关键——wakeup 无 interval 可拆，动作序列与 P1 逐字节相同。

### 2. engine.js 扩展（204 行）

- 解释 `ARM_INTERVAL`/`DISARM_INTERVAL`（经注入的 `timers.setInterval`/`clearInterval`），每次 interval 触发喂一个 `POLL_TICK`。timers port 从 `{set,clear}` 扩到含 `{setInterval,clearInterval}`——**仅 interval 形态调用**，故 P1 只注入 `{set,clear}` 的既有测试完全不受影响。
- 可选 `classify(result) → {terminal, outcome?, payload?}` 取代布尔 `isSettled`（支持 block-9 多结局）；未传时退回 `isSettled`（P1 逐字）。
- `RESPOND` 泛化派发：settled/timeout/error 保持 P1 语义；其余 outcome 派到同名 `respond[outcome](payload)`。
- keyed registry：可选注入 `registry`（Map）+ `key`；同 key 新 longPoll 进场先向旧实例喂 SUPERSEDE 再登记自己，CLEANUP 按 superseder 身份严格摘除（不误删后来者）。顺序照抄 block-9 options-waiter 的 `previous(); … active.set(key, …)`。新增导出 `createPollRegistry()`。**不传 key/registry 完全绕过——P1 行为不变。**

### 3. locks.js 加 `awaitIdle()`（47 行）

- 纯新增导出：等所有 key 锁链排空后 resolve，永不 reject（链尾 `stored` 已自吞错）。等待期间有新工作入链则递归再等一轮。既有 `withLock`/`sessionLockKey`/`skillLockKey` 三个函数**一字节未改**。

### 4. 参考实现 + 特征验收（本期核心验收物，`code/backend/reference/`）

- `child-ab-next-question.ref.mjs`：interval 形态复现 block-9 next-question-poller（见下对照表）。
- `parent-options-waiter.ref.mjs`：interval + keyed registry 复现 options-waiter（多同 key 顶替）。
- 各配 fake-timers 特征测试，逐 tick 步进 + flush 微任务，逐条断言观测行为与 block-9 源一致。

### 5. 测试与门

- 新增 24 个 node:test：extended property 9 + child-ab 特征 6 + options-waiter 特征 6 + awaitIdle 3。既有 48 零修改。**合计 72/72 全绿**（串行 `--test-concurrency=1`）。
- 纯度门 `check-kernel-purity.mjs`：16 PASS / 0 FAIL，scope 未缩小。
- **P1 逐字门 `check-verbatim-extraction.mjs` 退役并删除**（`git rm`）：其使命是"证明抽取忠实"，抽取一旦叠加功能扩展逐字比对必然失真，继续留只会误报。接任兼容门 = "既有 48 测试零修改全绿"（rules.md §4 已同步）。

## block-9 行为逐条对照（参考实现如何复现）

### next-question-poller（child-ab）

| # | block-9 源行为 | 参考实现复现手段 | 特征测试断言 |
|---|---|---|---|
| 1 | setInterval 1000ms | `mode:'interval'` + `pollIntervalMs:1000`（ARM_INTERVAL） | 断言注册的 interval ms=1000 |
| 2 | attempt() 同步返回 `{kind}` | `attempt:()=>Promise.resolve(sync())` + `classify` 读 kind | 每 tick attempt 调一次 |
| 3 | `not_found` → finish(notFound) | classify `{terminal:true,outcome:'not_found'}` → respond.notFound | notFound 一次 + 清 interval/timeout |
| 4 | `delivered` → finish(delivered(body)) | classify `{terminal:true,outcome:'delivered',payload:body}` | delivered(body) 一次 |
| 5 | 其余 kind → 继续等 | classify `{terminal:false}` → 留 waiting | pending 不 respond、interval 不动 |
| 6 | **先等一个 interval 才首 attempt** | `immediateFirstAttempt:false` | START 后首 tick 前 attempt 未调 |
| 7 | setTimeout 60000ms → timeout | `timeoutMs:60000`（ARM_TIMER→TIMEOUT） | timeout 一次 + 清 interval |
| 8 | `raw.on('close')` 静默收尾 | onClientClose→CLIENT_CLOSE→只 CLEANUP | close 不 respond、清 interval/timeout |
| 9 | cleanup 拆 interval+timeout+off | DISARM_INTERVAL + CLEANUP（终态严格配对） | 终态后 interval/timeout/close 监听全清 |
| 10 | active 计数 | wait +1 / done -1 | activeCount 1→0 |

### options-waiter（parent）— 同构 + 顶替

| # | block-9 源行为 | 参考实现复现手段 | 特征测试断言 |
|---|---|---|---|
| 1 | setInterval **800ms** | `pollIntervalMs:800` | interval ms=800 |
| 2–7 | 同 next-question（round.status==='ready' → ready；`!round` → notFound） | classify 读 round.status | ready/notFound/timeout/close 各断言 |
| 8 | **Map<key,cancel> 同 key 顶替** | 注入 `registry`+`key`；内核 START 前 `prev()`→喂 SUPERSEDE→`set` | 同 key 新请求进 → 旧恰好一次 superseded + 旧 interval/timeout 清 + activeCount 仍 1 |
| 10 | cleanup 按身份摘除 `active.get(key)` | CLEANUP 按 superseder 身份 registry.delete | 异 key 互不影响、activeCount==registry.size |

## 设计决策（任务单未覆盖处，取保守方案）

1. **config 放 initPoll 而非 START 事件**：任务单允许两者其一。选 initPoll——START 当前不携带数据，且 engine 本就调 initPoll，最小改动面。config 存进 state（mode/immediateFirstAttempt/intervalArmed 三字段）；既有测试无一对 initPoll() 整体做 deepEqual，加字段安全（已实测 48 全绿）。
2. **DISARM_INTERVAL 与 CLEANUP 分离而非合并**：任务单要求"CLEANUP 恰好一次且必含 DISARM_INTERVAL"。做法是 interval 终态 teardown = `[DISARM_INTERVAL, CLEANUP]`，CLEANUP 保持 P1 原义（清一次性 timer/subscribe/close），interval 单独由 DISARM_INTERVAL 拆。好处：wakeup 形态 teardown 仍是 `[CLEANUP]`，与 P1 动作序列逐字节一致，兼容门零风险。engine cleanup() 再兜底清一次 interval（null-guard，DISARM 已先清则为 no-op），防漏不泄漏。
3. **多结局用 classify 而非扩 isSettled**：block-9 有 delivered/not_found/continue 三分类，布尔 isSettled 表达不了。加可选 classify，未传退回 isSettled——P1 调用方零改动。
4. **registry 注入而非 engine 内建全局**：保持 engine 零全局状态（纯函数式、可测）。registry 是注入的 Map，参考实现自持。
5. **SUPERSEDE 允许任意非终态**（不限 waiting）：block-9 顶替只发生在 waiting，但允许更早的非终态被顶替语义上无害且更稳健；终态由顶部 DISCARD 守卫拦下。
6. **参考实现放 `code/backend/reference/`（transport/ 之外）**：它们是领域适配器，合法引用 block-9 领域概念（kind/round/options），故置于纯度门 scope 之外——纯度门只核 `transport/` 生产内核。

## 微时序适配（诚实记录）

copycat block-9 的 attempt 在 interval 回调内**同步**结算并同步 cleanup；本参考经内核走 `attempt→Promise→ATTEMPT_RESULT 事件`，结算落在 tick 后一个微任务。观测层（fire tick → flush microtasks → 断言）行为一致，特征测试逐 tick 步进 + flush。这是"事件驱动内核 vs 同步回调"的固有差异，不影响任何可观测结局（首发时机/超时时序/顶替结局/close 语义）。

## 文件尺寸

poll-machine.js 338 行、engine.js 204 行、locks.js 47 行——均远低于 500 行铁律 9 上限，无需拆分。

## 自检结论

- 既有 48 测试：**零修改、48/48 全绿**（`git diff main` 对 6 个既有测试文件为空）。
- 新增 24 测试：**24/24 全绿**（合计 72/72，串行）。
- 纯度门：16 PASS / 0 FAIL。
- 逐字门：已退役删除（兼容门接任）。
- 分支不合 main，交下游审核门。

## 流程/沙盒说明

本模块为 `lightweight` 模式（rules.md §工作模式）：单 agent 从模块根接单、不限定单一角色（backend AGENTS.md），故本任务按任务单显式指令一并更新 `module_docs/`（contract/rules/handoff）与退役 `review/` 下逐字脚本——完整治理模式的角色沙盒边界在 lightweight 下由单 agent 统一承担。下游仍有独立 reviewagent 审 candidate。
