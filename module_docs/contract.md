# realtime_core · 对外接口契约

> 本文件是 realtime_core 对外行为的**唯一事实**。当前为**孵化期骨架**：realtime_core 位于 `dev/`（试验区），尚无外部消费方。v0.1 的公共 API = **逐字继承 copycat 已验证实时内核**；**正式契约 P5 定稿**（semver v1.0、经 CR 迁入 `0/` 平台层时冻结）。在正式定稿前，下列导出符号清单描述"当前抽取了什么"，不构成对外冻结承诺。

## 契约索引声明（provides / consumes）

```yaml
provides:
  - id: realtime-core-kernel@v0.1
    summary: 领域无关的实时/状态机内核——long-poll 生命周期 reducer + 命令分发 + 频道广播 + keyed 锁；零 runtime 依赖。P5 前无对外冻结承诺。
consumes: []   # 零依赖是卖点：内核不依赖任何平台契约或第三方包
```

## 版本与定稿状态

- **v0.1（当前）**：copycat 实时内核逐字抽取，孵化于 `dev/realtime_core/`。API 表面 = 下列七文件的导出符号，**未冻结**。
- **P5（正式契约）**：semver v1.0、经 CR 迁 `0/` 平台层、补 SSE 参考适配器测试后，本契约定稿并启用冻结项标注。路线图见 `module_docs/rules.md`。

## v0.1 公共 API（逐字继承 copycat 实时内核）

七个抽取文件及其导出符号（源见 worklog 映射表；导出签名逐字节继承 copycat，未加改动）：

| 目标文件 | 导出符号 | 性质 |
|---|---|---|
| `code/backend/src/transport/core/poll-machine.js` | `PollPhase`、`PollEventType`、`PollActionType`（冻结枚举）、`initPoll()`、`isTerminalPhase(phase)`、`reduce(state, event)` | 纯 reducer，无 io/时钟/随机 |
| `code/backend/src/transport/core/dispatch.js` | `normalizeCommandTable(table)`、`lookupCommand(table, cmd)` | 纯命令表规整/查找 |
| `code/backend/src/transport/engine.js` | `longPoll({...})`、`createDispatcher(commandTable, {onUnknown, onError})` | 引擎壳：解释 reducer 动作为副作用（注入 timers/wakeup/respond） |
| `code/backend/src/transport/channels.js` | `createChannels()` | 频道广播注册表（订阅/发布） |
| `code/backend/src/concurrency/locks.js` | `withLock(key, fn)`、`sessionLockKey(sessionId)`、`skillLockKey(skillId)` | keyed 串行锁 + 键构造 |
| `code/backend/src/queue/ordering.js` | `orderedSessionEvents(session, options)`、`maxEventSeq(session)` | 纯事件排序/统计投影 |
| `code/backend/src/queue/ids.js` | `genEventId(ctx)`、`genTurnId(ctx)` | 注入式 id 生成（`ctx.clock`/`ctx.rng`，零全局） |

> `services/realtime/classroom.js`（copycat L2 糖层）**未抽取**：无生产消费方，v1 排除（本单决策 2）。

## 入口与路由

- 无 HTTP/nginx 表面：realtime_core 是**库**（ESM 模块集），由消费方 `import`，不自带服务进程或路由。
- 内部服务名 / 端口：不适用（无进程）。

## 依赖的外部契约

| 依赖 | 契约位置 | 用途 |
|---|---|---|
| 无 | — | 内核零依赖（含零第三方 runtime 依赖），不消费任何平台契约 |

## 数据与存储

- realtime_core 不拥有持久化数据：reducer/ordering 为纯函数，锁/频道为进程内内存态。无 data root、无备份/清理需求。

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
