# 审核报告 · realtime_core P3b 会话内核（下）：decide/evolve 聚合 + 事件版本化 + 崩溃重放

- **任务**：`feat/p3b-decide-evolve`（P3b — defineAggregate/reject 纯聚合 / upcastEvent 事件版本化 / createMemorySnapshotStore / createAggregateRuntime execute 锁串行+CAS+滚动快照·load 快照+尾部重放 / append 路径唯一复用 delivery / 四不变量 property 测 / 三层全链路参考示例）
- **审核对象（exact target）**：仓 `dev/realtime_core`，分支 `feat/p3b-decide-evolve`，base `9d8c03e`（main）..head `3c7bc91`，`diff_mode=exact`
- **审核人**：reviewagent（独立审核，Opus）
- **日期**：2026-07-19
- **verdict**：**approved**（分支未合 main，交合并门）

被审业务代码一行未改；7 处变异注入全部完全还原（`git status --porcelain` 空、全量 153/153 复绿、纯度门 56/56 复绿）。

---

## 结论一句话

九项全 PASS。核心裁断——**影子模型（`shadowStep`）是独立于被测实现的手写 reducer，不调用 foldEvents/applyEvent/evolve，三条重建路径各自锚定到该独立影子**，故不变量 1 有真实判别力、非"由构造成立"的自证空转（M1 变异 foldEvents 使三路同时偏离影子而变红，铁证）。版本化 9 测经 3 处变异（缺函数静默跳过 / 不强制盖 v / 事件来自未来）精确变红；execute 串行经去锁变异证明锁真在串行化（property④ 变红出 ConflictError，property⑤ 反证独立成立）；拒绝无痕经泄漏变异变红；纯度门 5 项经 Date.now/领域词变异变红。兼容门 110 既有零改、153/153 串行全绿；铁律与文档四件同步一致无越域；backend report embedded-self-v2 机械核验全过。**approved。**

---

## 九项审核结果

### 1. 兼容门 —— PASS

- `git diff --no-renames 9d8c03e..3c7bc91` = **15 文件**：session/ 4 生产（aggregate/aggregate-runtime/upcaster/memory-snapshot-store）+ 4 测试（aggregate/aggregate-runtime/aggregate-versioning/aggregate.property）、reference/classroom-aggregate.ref.{mjs,test.mjs}、module_docs/{contract,rules,handoff}.md、codeagent/backend/docs/{worklog,report.json}。
- **既有源/测试零改动**：name-status 中仅 4 项为 `M`（全是 docs/report：contract/rules/handoff/report.json），**其余 11 项全为 `A`（新增）**。P1/P2/P3a 全部既有 `.test.mjs`、`transport/`、`concurrency/`、`queue/`、`package.json`、`check-kernel-purity.mjs` **均不在 diff**（零触碰）。
- **串行全量重跑**：`node --test --test-concurrency=1` → **153 pass / 0 fail / 0 skip**（既有 110 + 新增 43）。✅

### 2. 重放确定性实质审（核心）—— PASS，影子有真实判别力

**影子独立性裁断（任务单点名）**：`aggregate.property.test.mjs` 的影子 `shadowStep(model, cmd)`（第 59–73 行）是**独立手写的 reducer**——它以 `{total, ops, frozen}` 自维护"应有状态"，用自己的算术（`total + cmd.n`、`ops+1`、frozen 分支）推进，**不调用** `foldEvents`/`applyEvent`/`evolve`/`decideCommand` 任何被测实现代码。三条重建路径——`rtSnap.load`（快照，snapshotEvery=3 覆盖 present+behind）、全新 `rtNoSnap.load`（无快照全量=absent）、全新 `rtCrash.load`（新实例+幸存快照=崩溃）——**各自** `deepEqual` 到这个独立影子（第 107/109/111 行），而非彼此比较。

- backend 自声明的"由构造成立"隐患，只作用于"execute 返回态 === load 态"这一狭窄关系（二者确共用 `foldEvents`）。但**本测试不依赖该自比较**：每条路径都锚定到独立影子。若 `foldEvents`（execute 与 load 共享）有 bug，两侧会同样地偏离影子，`assert.deepEqual(result.state, model)` 与 `assert.deepEqual(rtSnap.load, model)` **双双变红**——bug 无处藏身。
- **M1 变异铁证**：把 `aggregate-runtime.js` 的 `foldEvents` 改成丢首个事件（`aggregate-runtime.js:66`），property① 及其依赖 **FAIL（4 fail / 1 pass）**。共享折叠路径被破坏后三路同时偏离独立影子，证明影子确有判别力、**非空转、非自证循环**。
- 快照 present/absent/behind 三形态：snapshotEvery=3 使 250 种子×24 步区间内快照反复"当前/落后"；rtNoSnap=absent 全量；rtCrash=崩溃后新实例仅凭 logStore+幸存快照重建。三形态均逐步比对影子。✅

**裁断结论**：影子独立于被测实现，不变量 1 保有真实判别力，非"由构造成立"的空转。

### 3. 版本化演进实质审 —— PASS

逐条读 `aggregate-versioning.test.mjs` 9 测：①v1 日志→升 v2 重放（upcaster 补 weight=1）；②同流混合 v1/v2；③v1→v2→v3 级联；④evolve 只见当前版本（spy）；⑤缺 upcaster 响亮 throw；⑥事件来自未来响亮 throw；⑦upcaster 返回非对象 TypeError；⑧库强制盖 v 防死循环；⑨快照 schema 不匹配丢弃全量重建（污染脏快照仍正确）。语义与 `upcaster.js`/`aggregate.js`/`aggregate-runtime.js` 逐一吻合。

**两处变异自检（任务单点名）**：

| # | 注入 | 语义破坏 | 结果 | 还原 |
|---|---|---|---|---|
| M2 | `upcaster.js:43` 缺 upcaster 分支改 `break`（静默跳过）替代 throw | 缺升级函数静默放行旧 schema | 版本化⑤ FAIL（**1 fail** / 8 pass） | checkout，porcelain 空 |
| M3 | `upcaster.js:54` 去掉 `{v: from+1}` 强制盖章、直接 `current = upgraded`（信任 upcaster 自设 v） | 版本号不被库强制递增 | 版本化③④⑧ FAIL（**3 fail** / 6 pass） | checkout，porcelain 空 |

- M2 精确命中"缺 upcaster 必响亮"（⑤变红），证明该守卫非空过。
- M3 命中版本盖章：⑧（忘 bump 也不死循环——实为库强制盖章的直接断言）、③（级联到 v3 的 v 断言）、④（spy 见当前版本）三测同红，证明"库拥有版本号"是 load-bearing、被测试钉死。✅

### 4. append 路径唯一 —— PASS

- 全库 `grep -rn '\.append(' src reference`（排除 `.test.`）：**唯一实现**在 `memory-log-store.js:55`（端口），**唯一调用点**在 `delivery.js:61/66/70`（publish 的三条 CAS 分支）。
- `aggregate-runtime.js` 的 execute **不自写日志**——`createDelivery({logStore, wakeup})` 后调 `delivery.publish(streamId, toAppend, {expectedLastSeq})`（严格 CAS 分支，冲突原样上抛）。写日志只此一条语义路径。
- runtime 与 P3a delivery 的组合：reference `createClassroom` 另持一个 delivery 实例，但**仅用于读侧**（pull/ack/subscribe），**从不 publish**——写入唯一源头是 `runtime.execute`。故无第二套 append 语义、无漂移路径。✅

### 5. execute 串行等价 —— PASS

- 读 property④（120 种子，真锁 `locks:{withLock}`）：同发 k 个 add 不逐个 await，断言全成功产 1 事件、seq 连续无空洞、累计和守恒（加法可交换⇒任意串行序同值）。property⑤（去锁反证）：无 locks 并发写触发响亮 `ConflictError`，断言 `reason.name==='ConflictError'`（不静默吞）。
- **M4 变异自检（去 withLock）**：把 execute 的 `if (locks !== undefined)` 短路成 `if (false)`（`aggregate-runtime.js:137`），强制裸跑：
  - property④ **FAIL** 且报 `name: 'ConflictError'`——证明真锁正是串行化那道，去掉即撞 CAS。
  - property⑤ **仍 PASS**（它本就是无锁反证，独立成立、非依赖 M4）。
  - `aggregate-runtime.test.mjs`「锁串行」单测同步 **FAIL**。
- 裁断：property⑤ 真在跑真实并发（`Promise.allSettled` 两个并发 execute 共高水位，CAS 让第二个响亮失败），**非摆设**；property④ 的零冲突是锁的实证。✅

### 6. 拒绝无痕 —— PASS

- 读 property②（200 种子，随机合法前缀后发必被拒命令，断言日志长度/重建态纹丝不动）+ property① 内嵌每步（被拒步断言 rejected.code 匹配影子且日志长度不变）+ 单测 `aggregate-runtime.test.mjs`「拒绝无痕」。runtime execute 的 reject 分支（`aggregate-runtime.js:111-114`）在 append 之前 `return {rejected}`，不触日志。
- **M5 变异自检（reject 泄漏事件）**：在 reject 分支 return 前插入一条 `delivery.publish(...)`（`aggregate-runtime.js:113`），property① 与 property② 双双 **FAIL（2 fail / 3 pass）**——证明"拒绝不动日志/不改状态"被 property 真钉死、非空过。checkout 还原、porcelain 空。✅

### 7. 纯度门 —— PASS

- 独立重跑 `check-kernel-purity.mjs` → **56 PASS / 0 FAIL**（transport 16 + session 40 = 8 文件×5 项）。新四生产文件（aggregate/aggregate-runtime/upcaster/memory-snapshot-store）经 session scope 自动纳入（脚本未改）。
- **两处变异自检（session 新文件，任务单点名）**：

| 检查项 | 注入 | 文件 | 门结果 |
|---|---|---|---|
| ⑦ 零 Date.now/Math.random | `const __mut = Date.now()` | aggregate.js | FAIL「出现 1 处 Date.now(」（55/1） |
| ⑥ 零扩展领域词 | `const scenarioId = ...` | upcaster.js | FAIL「出现 copycat 领域词 scenarioId」（55/1） |

两处均命中新文件，证明纯度门对 P3b 新文件**非空转**；checkout 还原、porcelain 空、门复绿 56/56。（⑤零 transport import/⑧db.transaction/⑨≤500 由全体实测覆盖；最大 aggregate.js 156 行。）✅

### 8. 铁律与文档 —— PASS

- **≤500 行**：session 生产实测——aggregate.js 156、aggregate-runtime.js 148、memory-snapshot-store.js 64、upcaster.js 59；reference classroom-aggregate.ref.mjs 119。全 ≤500。
- **零依赖**：`package.json` 无 dependencies；新文件 import 图仅同目录 `./` 兄弟（aggregate→upcaster、aggregate-runtime→delivery），零第三方、零 node_modules。
- **copycat 与 0/ 仓未动**：diff 全部落在 `dev/realtime_core` 本仓。
- **文档四件同步（铁律11）**：contract.md（P3b 导出面 + 聚合/版本化/运行时语义 + 变更记录一行）、rules.md（路线图 P3b✅、纯度门 56 项、test 数 153）、handoff.md（P3b 聚合层接口 + 消费方避坑）三者与代码一致、契约内部一致（导出符号/签名/语义逐一吻合）；任务单 §文档与留痕**显式授权**更新 contract/rules/handoff，**无越域**。
- **backend report `diff_mode=contains` 合规性**：照 `0/roles/report-schema.md` §71，公共 `.git` 块 `diff_mode` **固定 `contains`**（changed_files 每项须出现在 base..resolved_head diff 中）；reviewagent 自己的 `review_target` 才固定 `exact`。故 backend 用 `contains` **符合规定**（且其 15 项 changed_files 与 no-renames diff 实为精确相等，更紧于要求）。照实记录：合规。✅

### 9. 留痕 —— PASS

backend report.json（`codeagent/backend/docs/report.json`）embedded-self-v2 机械核验：
- **protocol** = embedded-self-v2；**head** = SELF → 解析为 `3c7bc91`（`git log -1 --format=%H -- report.json`，本分支唯一 P3b 提交）。
- **base** `9d8c03e15c854b0d0427b4e5333a0cefae3922ea` 为 head 祖先（`merge-base --is-ancestor` 成立）；base = P3a squash 后 main 起点，非 feature-only 中间提交，合规。
- **diff_mode** = `contains`；**changed_files 15 项**按 contains 语义核对——每项均出现在 `git diff --no-renames 9d8c03e..3c7bc91`（15 项），实为**集合完全相等**；含本 report 路径与本角色 worklog。
- **tracked & clean**（porcelain 对 report.json 空）。
- **commit trailer**：`Agent-Attribution: backend@dev/realtime_core+p3b-decide-evolve`——三段小写 slug（role=backend / module=dev/realtime_core，`/` 分层合法 / task=p3b-decide-evolve）可解析、唯一、格式合法。
- **worklog「全链路自证」专节**（`## 全链路自证（整库首次三层串跑）`）存在，且与 `reference/classroom-aggregate.ref.{mjs,test.mjs}` 一致：命令→decide→事件→delivery.publish append→wakeup.emit→三组真实 engine.js longPoll 唤醒 respond.settled→三组独立游标，含 decide 拒绝无痕、断线重连仅凭 logStore+snapshot 重建、v1→v2 演进——4 用例全绿实测核对。✅

> 备注（info，不阻断）：worklog/report 的文件行数图有轻微偏差（worklog 表记 aggregate.js 170 行、aggregate-runtime.js 143 行，实测 156/148；report self_check「最大文件 aggregate.js 170 行」同偏）——纯计数近似陈述偏差，全部远 ≤500，不影响铁律与结论，标出即可。

---

## 独立复跑证据

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试（串行） | `node --test --test-concurrency=1` | 153 pass / 0 fail / 0 skip |
| 纯度门 | `node review/reviewcode/check-kernel-purity.mjs` | 56 PASS / 0 FAIL（transport 16 + session 40） |
| append 唯一路径 | `grep -rn '\.append(' src reference`（排除 test） | 定义 memory-log-store.js:55；调用仅 delivery.js:61/66/70 |
| 既有源/测试零改 | `git diff --no-renames 9d8c03e..3c7bc91 --name-status \| grep '^M'` | 仅 4 项 docs/report；11 项源/测试均 `A`（新增） |
| base 祖先 | `git merge-base --is-ancestor 9d8c03e 3c7bc91` | YES |
| SELF 解析 | `git log -1 --format=%H -- codeagent/backend/docs/report.json` | 3c7bc91 |
| changed_files 集合 | report 15 项 vs no-renames diff 15 项 | EXACT MATCH |

## 变异自检明细（7 处，全还原）

| # | 项 | 注入位置 | 破坏 | 结果 | 还原 |
|---|---|---|---|---|---|
| M1 | 2 重放确定性/影子独立 | aggregate-runtime.js:66 foldEvents 丢首事件 | 共享折叠路径出错 | property① 组 4 fail/1 pass | checkout，porcelain 空 |
| M2 | 3 版本化 | upcaster.js:43 缺 upcaster 改 break | 缺升级函数静默跳过 | 版本化⑤ 1 fail/8 pass | checkout，porcelain 空 |
| M3 | 3 版本化 | upcaster.js:54 去 `{v:from+1}` 盖章 | 版本号不被库强制递增 | 版本化③④⑧ 3 fail/6 pass | checkout，porcelain 空 |
| M4 | 5 execute 串行 | aggregate-runtime.js:137 强制跳 withLock | 无串行化 | property④ fail（ConflictError），⑤仍 pass；单测锁串行 fail | checkout，porcelain 空 |
| M5 | 6 拒绝无痕 | aggregate-runtime.js:113 reject 分支泄漏 append | 拒绝留痕 | property①② 2 fail/3 pass | checkout，porcelain 空 |
| M6a | 7 纯度门 | aggregate.js 注入 Date.now | 全局非确定性 | 门 FAIL 55/1（Date.now） | checkout，porcelain 空 |
| M6b | 7 纯度门 | upcaster.js 注入 scenarioId | 领域词 | 门 FAIL 55/1（领域词） | checkout，porcelain 空 |

终态：被审业务代码一行未改，`git status --porcelain` 空，全量 153/153 + 纯度门 56/56 复绿。

## verdict：approved

九项全 PASS，无 P0/P1 隐患，无架构级缺陷，无越域。第 2 项核心裁断：**影子模型独立于被测实现、不变量 1 有真实判别力、非自证空转**（M1 铁证）。分支 `feat/p3b-decide-evolve` 未合 main，交合并门（独立 approved → 本地 gates/tests → squash）。
