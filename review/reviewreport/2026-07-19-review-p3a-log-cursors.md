# 审核报告 · realtime_core P3a 会话内核（上）：事实日志 + 游标投递

- **任务**：`feat/p3a-log-cursors`（P3a — 事件信封携 v / 存储端口 + 内存实现 + CAS / delivery publish-pull-ack-subscribe 复用 P2 longPoll / 四不变量 property 测 / 纯度门扩展 session scope）
- **审核对象（exact target）**：仓 `dev/realtime_core`，分支 `feat/p3a-log-cursors`，base `c634568`（main）..head `6e66246`，`diff_mode=exact`
- **审核人**：reviewagent（独立审核，Opus）
- **日期**：2026-07-19
- **verdict**：**approved**（分支未合 main，交合并门）

被审业务代码一行未改；所有变异注入完全还原（`git status --porcelain` 空、全量复绿）。

---

## 结论一句话

四条不变量的影子模型 property 测在语义上正确且经三处针对性变异证明非空转（每处对应 property 精确变红后完全还原）；崩溃重建语义真只保留 logStore、内存态彻底重建无虚过；复用考验守住"零 transport import"红线（等待机制以 longPoll/wakeup 能力注入，集成测试注入真实 engine.js）；纯度门扩展 session scope 五项经三处变异证明非空转；兼容门 72 既有测试零改、110/110 串行全绿；九处偏离逐条核实合理无隐患；留痕 embedded-self-v2 机械核验全过。**approved。**

---

## 八项审核结果

### 1. 兼容门 —— PASS

- `git diff --no-renames c634568..6e66246` 仅触及 **16 文件**：`code/backend/src/session/` 4 生产 + 4 测试、`reference/classroom-feed.ref.{mjs,test.mjs}`、`review/reviewcode/check-kernel-purity.mjs`、`module_docs/{contract,rules,handoff}.md`、`codeagent/backend/docs/{worklog,report.json}`。
- **既有内核文件零改动**：`transport/`、`concurrency/`、`queue/`、`package.json` 及全部 P1/P2 既有测试文件**均不在 diff 集合内**（grep 确认 NONE）。`check-kernel-purity.mjs` 为既有文件、diff 仅**追加** ⑤-⑨ session scope 段（零删除行，既有 transport 门逐字保留）。
- **串行全量重跑**：`node --test --test-concurrency=1` → **110 pass / 0 fail / 0 skip**（既有 72 + 新增 38）。✅

### 2. 不变量测试实质审（核心）—— PASS

**影子模型正确性**：`log-cursors.property.test.mjs` 的 `driveInterleaving` harness 以 `shadowIds`（日志权威 id 序列）+ 每 group `{confirmed, cursor, high}` 作可执行的"标准答案"，每步之后断言真实 store/delivery 状态恒等于模型：
- 不变量1 核心断言 `assert.deepEqual(m.confirmed, shadowIds.slice(0, cursor))` —— confirmed 只在合法 ack 时按 `(cursor, seq]` 精确追加一次，与日志连续前缀逐元素比对，丢/重/乱序任一发生即不等。**答案本身正确**：confirmed 的构造独立于被测实现（由模型自维护），cursor/high 的推进规则与规约一致。
- 随机步覆盖关键交错：每步在 `crash / publish / casClash（过期快照直写）/ pull / 合法 ack / 越位 ack` 六类中按概率分派，`g` 在 g1/g2 间随机 —— append/pull/ack/casClash/crash 均被真实覆盖，且崩溃步 p=0.15（property①）/p=0.5（property⑥ 加压）。终检另核 seq 连续无空洞 + 日志与影子一致。

**三处变异自检（防空转）**——每处注入后运行 `log-cursors.property.test.mjs`，确认对应 property 变红，再 `git checkout` 完全还原并出示 `git status --porcelain` 空：

| # | 注入（memory-log-store.js） | 语义破坏 | 结果 | 还原 |
|---|---|---|---|---|
| ① | `sealEnvelopes({lastSeq: actual → actual+1})` | seq 允许跳号 | property ①②③⑤⑥ FAIL（**5 fail** / 1 pass） | checkout，porcelain 空 |
| ② | `advanceCursor` 删除回退检查（`seq<current` 不再 throw） | 游标允许回退 | property ④ FAIL（**1 fail** / 5 pass） | checkout，porcelain 空 |
| ③ | `append` CAS 检查短路（`if(false && …)`） | CAS 冲突两个都成功 | property ①③⑥ FAIL（**3 fail** / 3 pass） | checkout，porcelain 空 |

三处变异均使**对应不变量的 property 精确变红**（跳号→连续性/前缀/CAS 唯一性；回退→游标单调；CAS 失效→唯一胜者/前缀），证明这些 property 不是空过。还原后全量 110/110 复绿。✅

### 3. 崩溃重建语义 —— PASS

- harness 崩溃步：`delivery = createDelivery({ logStore: store, wakeup: stubWakeup() })` 建**全新** delivery 实例，旧实例整体丢弃；仅 `store`（logStore）幸存——正是唯一持久化承诺。模型侧同步 `each.high = each.cursor`（高水位随内存丢失回退到游标），订阅/wakeup 由新 stub 重建。
- 未携带旧内存态：新 delivery 的 `lastSeqCache`/`pulledHigh` 为空 Map；`knownLastSeq` 懒重建从 `logStore.read` 全量数一遍，`pulledHigh` 从零起。故不变量1 非虚过——重建后继续随机 publish/pull/ack，每步照常断言 confirmed==前缀。
- 另有确定性抽查："重建后未重新 pull 就 ack(cursor+1)" 恒 RangeError（harness crash 步 + `delivery.test.mjs`「崩溃重建」用例 + `classroom-feed.ref.test.mjs`「断线重连」），强迫先重读再确认，堵住确认幽灵事件窗口。✅

### 4. 复用考验核实 —— PASS

- `grep -nE 'setInterval|setTimeout|while\(|for(;;)|sleep'` session/ + reference 生产代码 = **NONE**：零自制轮询/等待。
- **import 图核实**：session/ 生产文件 import 仅 `./errors.js`、`./envelope.js`（同目录兄弟）——**零 transport import**。`delivery.subscribe` 把 `longPoll` 当能力注入（`createDelivery({logStore, wakeup, longPoll})`），未注入即 TypeError；subscribe 只做组装（attempt=pull / classify=有事件即终 / wakeOn='appended' / pollKey=streamId），等待/唤醒/超时/断连/顶替全部交注入的 longPoll。
- **真实注入验证**：`delivery.subscribe.test.mjs` 与 `classroom-feed.ref.test.mjs` 均 `import { longPoll } from '../transport/engine.js'`（真实 P2 引擎，非复制品），覆盖等待/立即结算/超时/断连静默/同组双订阅/跨流不误唤醒/未 ack 重投，7+3 用例全绿。
- **红线裁断**："能力注入"方案守住任务单"零 transport import"红线——复用是真复用（组装真实引擎），红线一寸不破，纯度门 ⑤ 机械核。✅

### 5. API 语义与偏离项（九条）—— 全部核实合理

1. **longPoll 能力注入而非 import**：任务单"必须复用 P2 longPoll"与"session/ 零 transport import"两约束的交集解，成立（见项 4）。
2. **框架分配字段严格拒绝**（seq/at/streamId 或未知键 = TypeError）：保守正确，不静默覆盖；id 允许自带（跨系统去重正当需求），缺省生成。
3. **id 本地实现 `evt-<clock>-<rand36>`**（同 ids.js 格式，非跨目录 import）：纯度门禁出目录所致，格式一致性由测试 `/^evt-\d+-/` 钉住，登记 P5 技术债。合理。
4. **游标违规用内建 RangeError，仅 CAS 设专类 ConflictError**：RangeError 是不可重试的调用方编程错误、ConflictError 是可重试并发事实，语义分层正确；适配器用 `err.name` 识别不强依赖 instanceof（跨 realm 稳）。RangeError vs 专类：因属编程 bug 用内建标准错误可接受，无隐患。
5. **ack 同 seq 幂等 no-op、回退 throw**：同 seq 重 ack 是 at-least-once 重投的自然结果（合法幂等）；回退是书签倒退（违规）。**合理**——幂等版可向后兼容放宽，反向不行。
6. **advanceCursor 越日志末尾 = RangeError**：不给不存在事件立书签，端口层兜底（投递层另有"不越本实例已 pull 高水位"更严一道）。成立。
7. **publish 缺省追尾 + CAS 兜底重试一次**：**无静默丢失风险**——冲突时删缓存、重读真实 lastSeq、把**同一批** events 重 append 到新尾部（seq 后移但不丢）；内存实现同步无 await，重读后同 tick 不可能再冲突，故一次足够；第二次失败**原样上抛**（响亮，非静默）。要严格乐观并发有显式 `expectedLastSeq` 通道。合理。
8. **崩溃后高水位归游标**：pulledHigh 重建即丢，强迫先重 pull 再 ack。成立（见项 3）。
9. **信封冻结、payload 黑盒不冻结**：日志不可变是事实层承诺；payload 库不解释不拷贝（领域无关红线），调用方勿改已发布 payload 记入 handoff。合理。

（第 10 条"subscribe 结算走 P1 原生 respond.settled，不新造 outcome"——最小扩展面，成立。）无架构级缺陷。✅

### 6. 纯度门扩展 —— PASS

- 独立重跑 `check-kernel-purity.mjs` → **36 PASS / 0 FAIL**（transport 16 逐项与 P2 一致 + session 20：4 文件×5 项）。
- session scope 五项经**三处变异**证明非空转（注入后确认门红 35/1，再还原）：

| 检查项 | 注入 | 文件 | 门结果 |
|---|---|---|---|
| ⑦ 零 Date.now/Math.random | `const m = Date.now()` | delivery.js | FAIL「出现 1 处 Date.now(」 |
| ⑥ 零扩展领域词 | `const scenario = 1` | delivery.js | FAIL「出现 copycat 领域词 scenario」 |
| ⑤ 零 transport import | `import ../transport/engine.js` | envelope.js | FAIL「禁止 import transport」 |

（⑧ db.transaction / ⑨ ≤500 行由全体文件实测通过结构性覆盖；最大 delivery.js 127 行。）三处均还原、porcelain 空、门复绿 36/36。✅

### 7. 铁律 —— PASS

- **≤500 行**：session/ 生产最大 `delivery.js` 127 行；全 diff 文件均 ≤500。
- **零依赖**：无新增 import 第三方包；session import 图仅 node 无（纯 JS）+ 同目录兄弟。
- **copycat 与 0/ 仓未动**：diff 全部落在 `dev/realtime_core` 内，未触碰任何其他仓。
- **文档四件同步（铁律11）**：contract.md（P3a 导出面 + 信封/端口/投递语义 + 变更记录一行）、rules.md（代码分区加 session/、纯度门双 scope、路线图 P3a✅/P3b 拆分、test 数 110）、handoff.md（session/ 接口 + 消费方避坑 + 技术债）三者内容与代码一致；**handoff 不超范围**（本单任务单 §文档与留痕**显式授权**更新 contract/rules/handoff 三者，无越域）。contract 内部一致（信封字段、端口签名、投递方法与代码逐一吻合）。✅

### 8. 留痕 —— PASS

backend report.json（`codeagent/backend/docs/report.json`）embedded-self-v2 机械核验：
- **protocol** = embedded-self-v2，**head** = SELF → 解析为 `6e66246`（`git log -1 -- report.json`）。
- **base** `c634568` 为 head 祖先（`merge-base --is-ancestor` 成立）。
- **changed_files 16 与 `git diff --no-renames c634568..6e66246` 集合完全相等**（`diff` 零差异）。
- **tracked & clean**（porcelain 对 report.json 空）。
- **commit trailer**：`Agent-Attribution: backend@dev/realtime_core+p3a-log-cursors` —— 三段小写 slug 可解析、唯一、格式合法。
- worklog 完整（改动总览 + 四不变量→property 映射表 + 复用考验 + 10 决策 + 自检结论）。

> 备注（info，不阻断）：backend report `status` 字段填 `approved`，属 worker 自评措辞偏差（应为待审）；summary 前缀已明确"[backend 自检通过的 candidate，待 reviewagent 正式审核]"，无实质误导。`diff_mode` 为 `contains`（worker 合法），changed_files 实为精确相等，更紧于要求。✅

---

## 独立复跑证据

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试（串行） | `node --test --test-concurrency=1` | 110 pass / 0 fail / 0 skip |
| 纯度门 | `node review/reviewcode/check-kernel-purity.mjs` | 36 PASS / 0 FAIL |
| 既有内核零改 | `git diff --no-renames c634568..6e66246 -- transport/ concurrency/ queue/` | NONE |
| base 祖先 | `git merge-base --is-ancestor c634568 6e66246` | YES |
| changed_files 集合相等 | `diff <(diff name-only) <(report changed_files)` | EXACT MATCH（16） |

变异自检共 **6 处**（4 不变量向×3 + 纯度门×3）全部注入→变红→`git checkout` 还原→porcelain 空→全量/门复绿；被审业务代码终态一行未改。

## verdict：approved

八项全 PASS，无 P0/P1 隐患，无架构级缺陷，无越域。分支 `feat/p3a-log-cursors` 未合 main，交合并门（独立 approved → 本地 gates/tests → squash）。
