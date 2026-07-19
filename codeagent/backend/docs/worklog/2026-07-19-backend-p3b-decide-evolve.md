# 2026-07-19 · backend · P3b 会话内核（下）：decide/evolve 聚合 + 事件版本化 + 崩溃重放

任务单：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p3b-decide-evolve.md`。分支 `feat/p3b-decide-evolve`（自 main 9d8c03e 切出，不合 main）。lightweight 单 agent 模式（Opus）。

## 做了什么

`code/backend/src/session/` 新增四个生产文件（"记账规则"层，与 P3a 的"记账本+书签"合成完整会话内核）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `upcaster.js` | 59 | 纯事件版本升级：逐级 v→v+1；库拥有版本号（强制盖 v=fromV+1）；缺升级函数 / 事件来自未来 = 响亮 throw |
| `aggregate.js` | 170 | `defineAggregate`（纯聚合描述）+ `reject`/`isReject`；decide→事件[]｜reject，evolve 纯折叠，applyEvent=upcast+evolve；未知命令/非法返回=throw，未知事件默认 throw（onUnknownEvent 可配 ignore） |
| `memory-snapshot-store.js` | 64 | 快照端口内存参考实现（get/put，防御性深拷贝 structuredClone） |
| `aggregate-runtime.js` | 143 | `createAggregateRuntime`：execute（锁串行→CAS append→读回折叠→滚动快照）/ load（快照+尾部重放） |

新增测试 43 个（合计 153 全绿）：`aggregate.test.mjs`（14）、`aggregate-runtime.test.mjs`（11）、`aggregate-versioning.test.mjs`（9）、`aggregate.property.test.mjs`（5，四不变量）、`reference/classroom-aggregate.ref.test.mjs`（4，三层全链路）。参考示例 `reference/classroom-aggregate.ref.mjs`（领域词只出现在 reference/）。

纯度门 `check-kernel-purity.mjs` **未改脚本**——它的 session/ scope 从 P3a 起就递归覆盖 `code/backend/src/session/*.js`，新四个生产文件自动纳入：56 PASS / 0 FAIL = transport 16 + session 40（8 文件×5 项）。

## 四条不变量 → property test 映射（验收核心）

测试文件：`src/session/aggregate.property.test.mjs`，PRNG 沿用仓内 mulberry32 固定种子约定。影子模型 harness：测试侧独立按 decide/evolve 语义维护"应有状态"，每步与运行时重建的真实状态深比较。

| 不变量（任务单 §4） | 测试 | 如何映射 |
|---|---|---|
| 1. 重放确定性：任意时点崩溃（丢内存，仅存 logStore+snapshotStore）→ load 重建 === 一路 evolve；含快照 present/absent/behind 三形态 | property①（250 种子×24 步） | 每步之后**三条重建路径**都与影子模型深比较：rtSnap.load（快照路径，snapshotEvery=3 覆盖 present+behind）、全新 rtNoSnap.load（无快照全量重放=absent）、全新 rtCrash.load（崩溃=新实例+幸存快照）。runtime 本身无状态，故"崩溃"即换新实例；execute 返回态也逐步比对影子 |
| 2. 拒绝无痕：reject 不产事件、不改状态、不动日志 | property①（内嵌每步）+ property②（200 种子聚焦） | ①被拒步断言 rejected.code 匹配影子且日志长度不变；②随机铺合法前缀后发一条必被拒命令，断言日志长度/重建态纹丝不动 |
| 3. decide/evolve 只见升级后事件：重放路径每个事件 v === 当前版本 | property③（200 种子） | 直接写随机长度 v1 'added' 日志（模拟旧代码遗留），用 v2 聚合（evolve 记录所见 v）load，断言 seenVersions 全 === 2 且加权状态等于影子（weight 补 1） |
| 4. execute 串行：并发 execute 同 stream 等价于某串行序、CAS 零冲突（出 ConflictError 即锁失效） | property④（120 种子，真锁）+ property⑤（去锁反证） | ④同时发起 k 个 add 不逐个 await，断言全成功、seq 连续无空洞、累计和守恒（加法可交换⇒任意串行序同值）；⑤去掉 locks 后并发写触发响亮 ConflictError（证明锁正是串行化那道，且 CAS 冲突不被静默吞） |

## 版本化演进测试明细（验收重点）

测试文件：`src/session/aggregate-versioning.test.mjs`（9 条）。场景 = counter 聚合 `incremented` 事件演进：v1 `{by}` → v2 `{by, weight}`（value += by*weight）→ v3 `{by, weight, sign}`。

1. **v1 日志→代码升级 v2→重放**：v1 聚合写满日志（落盘 v=1）→ 换 v2 聚合同 logStore load → 旧事件经 upcaster 补 weight=1，状态正确。
2. **同流混合 v1/v2**：先 v1 写、再 v2 追加，混合版本落盘，load 重放正确。
3. **v1→v2→v3 级联**：单事件逐级升到 v3，weight+sign 逐级补齐。
4. **evolve 只见当前版本**（不变量 3 直接断言）：spy evolve 记录，v1/v2/v3 输入全部被折叠为当前版本 3。
5. **缺 upcaster 遇旧版本 = 响亮 throw**（禁静默）。
6. **事件来自未来（v > 当前）= 响亮 throw**（回滚到旧代码读新日志）。
7. upcastEvent 单元：升级函数返回非对象 = TypeError。
8. **库强制递增版本号**：upcaster 忘 bump v 也不死循环（库盖 v=fromV+1）。
9. **快照 schema 不匹配 → 丢弃、全量重建**：污染脏快照仍重建正确。

## 全链路自证（整库首次三层串跑）

`reference/classroom-aggregate.ref.mjs` + `.ref.test.mjs`：最小课堂聚合（states idle→asking→awaiting-answer→closed；命令 push-question/submit-answer/close）第一次把**聚合层（decide/evolve）+ 投递层（P3a delivery 游标三组）+ 传输层（P2 longPoll 唤醒）**三层串起来跑。

链路：teacher/student/parent 三组各挂长轮询订阅进入等待 → 老师 `send({type:'push-question'})` → runtime.execute 走 decide 守卫→question-pushed 事件→**复用 P3a delivery.publish append**→wakeup.emit('appended')→三组 longPoll 同时唤醒各自 `respond.settled(batch)` → 三组独立游标推进（student 确认、teacher/parent 未确认仍能从各自游标补拉）。另证：decide 守卫拒绝（closed 后 push / 无题作答）无痕、断线重连（弃 runtime 内存壳仅凭 logStore+snapshot 重建聚合态逐字一致）、v1→v2 事件演进（v1 课堂日志 answer-submitted 无 via，经 upcaster 补 via='legacy'，evolve 只见 v2）。注入的是**真实** engine.js longPoll（非复制品）。

## 任务单未覆盖的设计决策（保守取向，未停下等确认）

1. **append 路径唯一 = 复用 delivery.publish**：runtime 内部 `createDelivery({logStore, wakeup: wakeup ?? noopWakeup})`，execute 调 `delivery.publish(streamId, events, {expectedLastSeq})`（严格 CAS 分支，冲突原样上抛）。全库仅一条 append 路径，聚合层与投递层写日志语义逐字一致，无第二条可能漂移的路径（任务单 §2 硬约束）。wakeup 可选：纯聚合场景（无订阅者）用 no-op。
2. **库拥有事件版本号**：升级函数只变换 payload/形状，库强制盖 `v = fromV+1`。版本单调递增有硬保证，永不因升级函数忘 bump 而死循环——比"信任 upcaster 自己设 v"更防呆。
3. **execute 内一处 `await Promise.resolve(replay(...))`**：真实 logStore 适配器可能异步；这个让点也让"无锁并发"真交错，于是不变量 4 的 CAS 兜底可被 property⑤ 反证。内存 store 同步，但 await 同步值仍产生微任务边界。
4. **evolve 单一折叠路径**：execute 追加后**读回**刚落盘信封，用与 load 完全相同的 foldEvents(upcast→evolve) 推进——保证"execute 后内存态"逐字等于"崩溃重建态"（不变量 1 由构造而非巧合成立）。
5. **未知命令 = throw（编程错误），非 reject**：decide 表缺 key 意味调用方发了聚合不认识的命令，是 bug 不是业务拒绝。reject 只表达"命令合法但此刻状态不允许"。
6. **未知事件默认 throw**（`onUnknownEvent:'throw'`）：重放遇到 evolve 没有 handler 的事件类型，默认响亮（保守）；可配 `ignore`（前向兼容场景消费方只关心部分事件）。
7. **快照 schema 版本不匹配 → 丢弃、从日志全量重建**：聚合逻辑（evolve）演进后旧快照的 state 可能陈旧，宁可全量重放也不用陈旧快照。schemaVersion 缺省 1。
8. **快照端口内存实现防御性深拷贝**（structuredClone on put+get）：快照落定即与调用方内存态隔离的不可变检查点，护住确定性不变量。代价是拷贝开销；真实持久化适配器天然序列化，无此顾虑。要求 state 为 structuredClone 可克隆纯数据。
9. **decide 可产出空事件数组 = 合法 no-op**：返回当前状态、不写日志（区别于 reject——no-op 是"确实无需记账"，reject 是"拒绝这命令"）。
10. **snapshotEvery 滚动只看 seq**（`Math.floor(new/every) > Math.floor(prior/every)` 跨边界即落）：确定性，不依赖时钟；缺省 50。

## 自检结果

- 兼容门：既有 110 测试**零修改**（`git diff --stat 9d8c03e -- code/` 对既有文件为空——全部为新增文件），全绿。
- 全量：153/153 全绿（串行 `--test-concurrency=1`）。
- 纯度门：56 PASS / 0 FAIL（脚本未改，session/ scope 自动覆盖新四文件）。
- 单文件最大 170 行（aggregate.js，≤500）；零新增依赖；copycat 与 0/ 仓只读未碰；测试串行。
