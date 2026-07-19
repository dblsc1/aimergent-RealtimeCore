# 2026-07-19 · backend · P3a 会话内核（上）：事实日志 + 游标投递

任务单：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p3a-log-cursors.md`。分支 `feat/p3a-log-cursors`（自 main c634568 切出，不合 main）。lightweight 单 agent 模式（Opus）。

## 做了什么

`code/backend/src/session/` 新增四个生产文件（"记账本 + 书签"层，取代 copycat delivered/done 单消费者模型的通用层）：

| 文件 | 行数 | 职责 |
|---|---|---|
| `errors.js` | 28 | `ConflictError`（CAS 冲突，携带 streamId/expected/actual） |
| `envelope.js` | 79 | 信封校验+构造（seq/at/缺省 id/缺省 v 分配，Object.freeze），纯函数 |
| `memory-log-store.js` | 108 | 存储端口内存参考实现：CAS append（整批原子）/ read / getCursor / advanceCursor 只前进 |
| `delivery.js` | 127 | 投递层：publish（append+wakeup.emit）/ pull-ack 分离 / subscribe（注入复用 P2 longPoll） |

新增测试 38 个（合计 110 全绿）：`memory-log-store.test.mjs`（12）、`delivery.test.mjs`（10）、`delivery.subscribe.test.mjs`（7，真实 P2 longPoll 对接）、`log-cursors.property.test.mjs`（6，四不变量）、`reference/classroom-feed.ref.test.mjs`（3）。参考示例 `reference/classroom-feed.ref.mjs`（领域词只出现在 reference/）。

纯度门 `check-kernel-purity.mjs` 扩展 session/ scope（任务单显式授权）：36 PASS / 0 FAIL = transport 16（4 文件×4 项，逐项与 P2 完全一致）+ session 20（4 文件×5 项：import 不出目录零 transport / 零扩展领域词 / 零 Date.now·Math.random / 零 db.transaction / ≤500 行）。

## 四条不变量 → property test 映射（验收核心）

测试文件：`src/session/log-cursors.property.test.mjs`，PRNG 沿用仓内 mulberry32 固定种子约定。核心是**影子模型 harness**（`driveInterleaving`）：shadowIds（日志应有 id 序列）+ 每 group 的 confirmed/cursor/high 模型与真实 store/delivery 同步演进，**每步之后**断言真实状态 == 模型。

| 不变量（任务单 §4） | 测试 | 如何映射 |
|---|---|---|
| 1. 任意 append/pull/ack/崩溃重建交错下，每 group 经 ack 确认的序列 = 日志**连续前缀**（不丢/不重/不乱序） | property①（300 种子×30 步，crash p=0.15）+ property⑥ 加压复用 | 每步 `assert.deepEqual(model.confirmed, shadowIds.slice(0, cursor))`——confirmed 由模型在每次成功 ack 时按 (cursor, seq] 精确追加一次，与日志前缀逐元素比对，丢/重/乱序任一发生即不等 |
| 2. seq 流内连续无空洞；CAS 冲突下并发 append 恰好一个成功 | property②（150 种子，双流）+ property③（200 种子，K=2..4 路同快照）+ property① 内嵌 casClash 步 | ②终检 `seqs == [1..N]` 且多流独立；③同一快照 K 路 append 断言 winners==1、conflicts==K-1、日志恰好多一批且仍连续、落盘批属同一胜者；①每步随机拿过期快照直写，断言必 ConflictError 且日志不变 |
| 3. 游标只前进；advanceCursor/ack 到未 pull 过的 seq 之外 = throw | property④（200 种子，端口层随机攻击）+ property⑤（200 种子，投递层越位 ack）+ property① 每步 | ④合法/回退/越界/非法值混打，断言回退恒 RangeError、越日志末尾恒 RangeError、游标恒等于只前进的模型；⑤`ack(high+1 … lastSeq+2)` 逐点恒 RangeError 且游标纹丝不动，`ack(high)` 恰好放行；①非法 ack 步 + 每步 cursor==模型（模型由构造只前进） |
| 4. 随机时点丢内存、仅凭 logStore 重建 delivery，继续操作后不变量 1 仍成立 | property①（crash 步 p=0.15）+ property⑥（p=0.5 加压，100 种子×40 步） | crash 步：`delivery = createDelivery({logStore…})` 全新实例、模型 high 回退到 cursor；重建后**继续**随机 publish/pull/ack，不变量 1/3 断言每步照常执行；另抽查"重建后未 pull 就 ack 必 RangeError"。终检日志 seq 连续 + 与影子一致 |

确定性叙事版补充：`delivery.test.mjs`「崩溃重建」用例（续读不重不漏/先 pull 再 ack/尾指针懒重建）与 `classroom-feed.ref.test.mjs`「断线重连」用例。

## 复用考验（等待机制 = P2，零自制轮询）

`delivery.subscribe` 不含任何等待/轮询代码：把 attempt（=pull）、classify（有事件即终态）、wakeOn='appended'、pollKey=streamId 组装后**整体交给注入的 P2 `longPoll`**；publish 用 `wakeup.emit(streamId,'appended')` 命中 engine SUBSCRIBE 的 pollKey 过滤。`delivery.subscribe.test.mjs` 注入**真实** `transport/engine.js` 的 longPoll（非复制品）验证：等待/唤醒/立即结算/超时/断连静默/同组双订阅/跨流不误唤醒/未 ack 重投，7 用例全绿。session/ 生产代码零 transport import（纯度门机械核）。

## 任务单未覆盖的设计决策（保守取向，未停下等确认）

1. **longPoll 以能力注入而非 import**：任务单同时要求"必须复用 P2 longPoll"与"session/ 零 transport import"。取交集：`createDelivery({logStore, wakeup, longPoll})` 把 longPoll 当注入能力，subscribe 未注入即 TypeError。复用是真复用（组装真实引擎），红线一寸不破。
2. **框架分配字段严格拒绝**：调用方事件里出现 `seq`/`at`/`streamId` 或未知键 = TypeError（不静默覆盖/忽略）。`id` 允许调用方自带（跨系统去重的正当需求），缺省生成。
3. **id 生成本地实现同 ids.js 格式**（`evt-<clock>-<rand36>`）而非 import `queue/ids.js`：session/ 纯度门要求 import 不出本目录。格式一致性登记为 P5 技术债（handoff 已记）。
4. **游标错误用内建 RangeError**（回退/越日志末尾/越高水位），只有 CAS 冲突设专类 `ConflictError`：前者是调用方编程错误，后者是可重试的并发事实，语义不同。适配器识别用 `err.name`，不强依赖 instanceof。
5. **ack 同 seq 幂等 no-op、回退 throw**：重复 ack 是 at-least-once 重投的自然结果（合法）；回退才是"书签倒退"（违规）。跨连接的过期 ack（seq < cursor）同样 throw——严格版可向后兼容地放宽，反向不行。
6. **advanceCursor 越过日志末尾 = RangeError**：不能给不存在的事件立书签（不变量 3 在端口层的兜底；投递层另有"不越过本实例已 pull 高水位"更严一道）。
7. **publish 缺省"追加到尾"**：尾指针缓存 + ConflictError 兜底重读重试**一次**（内存实现同步无 await，重读后同一 tick 内不可能再冲突）；显式传 `expectedLastSeq` 则严格 CAS 原样上抛。发布方通常不关心落在哪个位置，关心时有严格通道。
8. **崩溃后高水位归游标**：pulledHigh 是 delivery 实例内存态，重建即丢——"重启后未重新 pull 就 ack"被拒（RangeError），强迫消费方先重读再确认，堵住确认幽灵事件的窗口。
9. **信封冻结、payload 黑盒不冻结**：日志不可变是事实层承诺；payload 库不解释也不拷贝（领域无关红线），调用方纪律记入 handoff 避坑。
10. **subscribe 结算走 P1 原生 `respond.settled(batch)`**（classify 不带自定义 outcome）：最小扩展面，不新造 outcome 词汇。

## 自检结果

- 兼容门：既有 72 测试**零修改**（`git diff` 对既有测试文件为空），全绿。
- 全量：110/110 全绿（串行 `--test-concurrency=1`）。
- 纯度门：36 PASS / 0 FAIL（含新 session scope 20 项）；门内正则经正/反样本抽查（skillId/nextQuestion/rounds/scene/Date.now 命中，background/surround 不误伤）。
- 单文件最大 127 行（≤500）；零新增依赖；copycat 与 0/ 仓只读未碰。
