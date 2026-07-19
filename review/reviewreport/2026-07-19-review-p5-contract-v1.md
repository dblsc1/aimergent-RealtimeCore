# 审核报告 · realtime_core P5 契约正式化 + v1.0.0 + SSE 参考适配器 + 收债

- **审核对象（exact target）**：仓 `dev/realtime_core`，分支 `feat/p5-contract-v1`，base `f497ac2`（main）..head `3777e36`（5 commits），`diff_mode=exact`（no-renames）。
- **审核人**：reviewagent@dev/realtime_core（独立审核，Opus）。
- **裁决**：**APPROVED**（8 项全 PASS，0 阻断）。
- **方法**：契约期审核以文档-代码一致性为主战场；所有可机械核验事实一律自写脚本独立跑（不复用 backend 脚本结论），肉眼只审判断题。变异自检完全还原、porcelain 空、全量复绿。

被审业务代码一行未改。

---

## 1. 兼容门 — PASS

- no-renames diff（`f497ac2..3777e36`）下**零个既有 `*.test.mjs` 被改**：仅两个新增测试文件（`queue/ordering.test.mjs`、`reference/sse-adapter.ref.test.mjs`），生产 `src/` 唯一改动是收债的 `session/envelope.js`（12 行）。
- 全量测试**串行独立重跑 201/201 全绿**（`node --test`，本机 node v22）= 既有 187 零修改 + P5 新增 14（ordering 8 + SSE 6）。
- 结论：兼容门成立，既有行为快照未被扰动。

## 2. 契约完备性（核心）— PASS

- **独立 35/35 机械比对**（自写脚本，非 backend 脚本）：
  - `grep -rhoE '^export (function|const|class) <name>'` 抽 `src/` 全部生产导出 → **35 个**。
  - `grep '^| \`<sym>'` 抽 contract.md 表格首列符号 → **35 个**。
  - `diff` 两侧 = **空（PERFECT MATCH 35/35）**，零遗漏、零多余、零漂移。
  - 分 scope 复核文件/符号计数自洽：transport 4 文件·13 符号 + concurrency 1·4 + queue 2·4 + session 8·11 + machine 1·3 = **16 文件·35 符号**，与契约头逐字一致。
- **5 符号深读**（≥1 亲手跑 `node -e`）：
  - `initPoll`/`reduce`/`isTerminalPhase`（**live `node -e`**）：wakeup 默认 mode=wakeup·immediateFirstAttempt=true、interval 默认 false、非法 mode→TypeError、isTerminalPhase(resolved/init)=true/false、reduce 未知事件→TypeError、终态吸收→仅 DISCARD——**全部与契约逐字一致**。
  - `sealEnvelopes`（源）：四键白名单 `{type,v,id,payload}` + 三保留键 `{streamId,seq,at}` 拒绝、空/非对象/非法 v/非法 id→TypeError、seq 从 lastSeq+1 连续、Object.freeze——与契约一致。
  - `upcastEvent`（源）：逐级 v→v+1、库强制盖 `v=from+1`、来自未来/缺升级函数/返回非对象→响亮 throw——与契约一致。
- **15 不变量承诺表**：8 个测试锚点文件**全部存在**；深读 4 条锚点确认测的确实是该条不变量：
  - I2（CLEANUP 恰好一次）：`poll-machine.property.test.mjs` L90-101 逐相断言 cleanupCount≤1、终态==1、非终态==0。
  - I6/I8（确认序列=连续前缀 / 游标单调）：`log-cursors.property.test.mjs` property①④⑤，回退/越界/越高水位恒 RangeError 且零副作用。
  - I13（execute 串行等价 + 去锁反证）：`aggregate.property.test.mjs` property④真锁零 CAS 冲突、property⑤去锁响亮 ConflictError。
  - I14/I15（machine 状态封闭 + 终态吸收）：`define-machine.property.test.mjs` property① 转移结果恒 ∈ states 且 can⟺transition、property② final 后恒 throw。

## 3. SSE 参考适配器实质审 — PASS

- `reference/sse-adapter.ref.mjs`：`serveSse` 用 `while(!closed && conn.isOpen())` **循环顺序复合多个 poll 生命周期**，每个 `delivery.subscribe` 生命周期 settled→`conn.send(frame)`+`ack`（游标前移）+pushes++，真正用 conn port（`send/isOpen`）多帧推送——**非单帧糊弄**。
- 6 测试实测：核心用例同一 conn **连收 3 帧 = 3 个完整生命周期**（游标 2→3→5、id 行 = 批尾 seq），另含跨周期零丢失 / 超时→心跳注释帧续推 / 断连静默零帧 / 重连从游标续读 / conn 与 channels(WS) 同形状互换。
- **"src/ 一行未动" diff 核实**：SSE commit `47e73d7` 仅触 `reference/`（2 文件）+ rules.md 1 行，`src/` 零触碰。

## 4. 微任务窗口裁断 — PASS（延迟非丢失，非阻断）

独立读 `engine.js`（longPoll）+ `poll-machine.js`（reduce）后裁断：

- **① 是否 P1 起既有（非 P5 引入）：是。** `engine.js` 与 `poll-machine.js` 在 `f497ac2..3777e36` **零触碰**（per-commit diff 核实），P5 只把窗口写进契约。窗口机理 = 异步 ATTEMPT + 非缓存 wakeup（emit 不重放，端口义务）+ SUBSCRIBE 排在 initial attempt 之后（L248 进入 WAITING 才 SUBSCRIBE）——皆 P1 内核既有；`SUBSCRIBE`/`WAKEUP` 不在 P2 新增符号清单内，属 v0.1 抽取面。**"P1 起即有"成立。**
- **② timeoutMs 兜底上限说法准确：准确。** 进入 WAITING 恒发 `[SUBSCRIBE, ARM_TIMER]`（poll-machine L248），ARM_TIMER 以 timeoutMs 装一次性定时器（engine L127-128）→ 最坏等待被 timeoutMs 封顶。
- **③ "记录不修"对 v1.0 可接受：可接受（是延迟不是丢失）。** 错过唤醒的事件仍留在日志；下一生命周期 initial attempt 立即 `pull`（游标之后积压立刻可见）或长轮询客户端超时重询补课——SSE 测试 #2 已实测"跨周期靠 initial attempt 补课零丢失"。属**有界延迟（≤timeoutMs）非数据丢失**，不升级为阻断项；保守"记录不修"（修 = SUBSCRIBE 后补 attempt = 改既有动作序列 = 违兼容门）成立。

## 5. 收债实质审 — PASS

- **信封 id 去重（clock 传已取 at）**：`envelope.js` 缺省 id 改 `genEventId({clock:()=>at, rng})`；`ids.js::genEventId` = `evt-${clock()}-${rng().toString(36).slice(2,8)}`，注入 `clock:()=>at` 后与旧内联 `evt-${at}-${rng().toString(36).slice(2,8)}` **逐字节等价**（rng 单次读取、时间戳分量===信封 at）。既有测试全绿佐证 + README ex2 实跑生成 `evt-1784450532508-ccqzdx` 印证。行为逐字保住。
- **纯度门闭环 · 变异自检（真闭环非放水口）**：
  - 白名单是**具体文件路径**（仅 `queue/ids.js`），且 ⑮ 段把 `ids.js` 本身跑同 5 项严格检查——白名单不成盲区，**真闭环**。
  - **变异自检**：向白名单外的 `session/upcaster.js` 注入跨 scope import `import { orderedSessionEvents } from '../queue/ordering.js';`（ordering.js 不在白名单）→ 门从 **66 PASS/0 FAIL 变红为 65 PASS/1 FAIL**，精确报 `session/upcaster.js: import「../queue/ordering.js」逃出 session/ 目录（跨层耦合）`。证明门有判别力、非空转。
  - **完全还原**：`git checkout` 后 `git status --porcelain` **空**、纯度门复绿 **66/0**、全量测试复绿 **201/201**。
- **ordering 补测 8 用例**：钉死排序键 seq→createdAt→round、哑参数 assignMissing（true/false/缺省逐字一致）、null/空洞容忍、`maxEventSeq(null)` 保留崩溃 throw、以及"投影跳过无 type 事件但 maxEventSeq 计入"的既有不对称——真钉死既有行为。
- **六项债逐条对账（worklog↔rules.md↔report debt_ledger 三处一致，无悬空）**：①信封 id 去重 ✅清偿；②ordering 补测 ✅清偿；③符号中性化 ⏭移交 v2/迁平台层（与"187 零修改"兼容门硬冲突，契约标遗产兼容面冻结）；④真实持久化适配器 ⏭移交首个消费方；⑤defineMachine YAGNI ✅评估留 v1.0 外；⑥maxEventSeq null 兜底 ✅评估保留崩溃行为入契冻结。

## 6. README / 版本 — PASS

- README 示例 1/2/3 **亲手跑通**（`node` 实跑）：ex1 can/transition/IllegalTransitionError、ex2 add+2→{n:2}/add-1→rejected 无痕/load→{n:2}、ex3 pull [hello]+游标前移——全部与文档标注一致。ex4（longPoll）为 HTTP handler 示意片段（依赖 req/res），API 形状与实测 `longPoll` 签名一致，属合理示意非跑不通。
- `package.json` version = **1.0.0**（描述同步更新为正式契约措辞）。
- **未打 tag**（`git tag -l` 空）；rules/handoff/report 均记"tag 由 CFO 合并后在 main 打"。

## 7. 铁律 — PASS

- **≤500 行**：`src/` 生产文件最大 `poll-machine.js` 338 行，全部 ≤500。
- **零依赖**：`package.json` 无 dependencies/devDependencies 字段。
- **copycat/0 未动**：分支 diff 全部落在本仓（dev/realtime_core），copycat 与 0/ 为独立仓、未触碰。
- **文档四件一致**：contract/rules/worklog/handoff/report.json 五处 201/187/66/35/5/15、微任务窗口、债务下落、tag 延迟交接 **相互一致无掉队**（铁律 11）。
- **契约无自相矛盾**：通读全文，scope 计数（16 文件·35 符号）逐节自洽；longPoll respond 键语义、ConflictError vs RangeError 分界、枚举扩展=minor 与 reduce 拒未知事件、信封"只加不改"与升级链 throw 语义——交叉引用一致，未见矛盾。

## 8. 留痕 — PASS

- **report.json embedded-self-v2 机械核验**：protocol=embedded-self-v2；base=`f497ac2`（P4 squash 后 main 任务起点，正确）；head=`SELF`→解析为最后改 report 的 commit `3777e36`；`changed_files`（12）与 `base..head` no-renames diff **集合完全相等（12/12，LC_ALL=C 复核）**；报告 tracked 且工作区 clean。`escalation=null`、`contract.touched=true`（仅模块自身契约，未触平台契约）、`cross_module_impact=[]`——路由面如实。
- **5 commit trailer 逐个核对**：`ca57509/47e73d7/6f1df6e/cc6bc6f/3777e36` 各**有且仅一条** `Agent-Attribution: backend@dev/realtime_core+p5-contract-v1`，三段 slug 合法（role=backend、module=dev/realtime_core、task=p5-contract-v1）。
- **worklog 完整**：`2026-07-19-backend-p5-contract-v1.md` 按 commit 叙事、SSE 诚实结论、决策与偏离、数字自检门齐备。

---

## 变异自检明细（完全还原）

| # | 变异 | 位置 | 预期 | 实测 | 还原 |
|---|---|---|---|---|---|
| M1 | 注入非白名单跨 scope import `../queue/ordering.js` | `src/session/upcaster.js` | 纯度门变红、精确报"逃出 session/ 目录" | 66/0 → **65/1**，FAIL `session/upcaster.js: import「../queue/ordering.js」逃出 session/ 目录（跨层耦合）` | `git checkout` → porcelain **空** → 纯度门 **66/0** → 测试 **201/201** |

## 偏离核实（backend 自报 6 项，逐条成立）

- 符号中性化移交（与兼容门硬冲突，保守让位，契约设遗产兼容面）— 成立。
- locks 模块级单例（copycat 逐字遗产，契约如实冻结）— 成立。
- SSE 测试改为先 flush 建立订阅（窗口作既有语义入契）— 成立。
- 不打 tag / 迁平台层标"待 CFO 治理流程"— 与任务单显式指令一致。
- lightweight 单 agent 更新 module_docs+README+纯度门脚本 — 任务单显式授权。
- dev 孵化仓无 remote，candidate 停本地 commit — 与 P1–P4 同状态。

## 交接给 CFO（backend 已列，审核确认）

1. 合并后在 main squash commit 打 `v1.0.0` tag（本分支未打）；squash 后以旧 main SHA 为 base、新 squash SHA 为 head 复验 embedded-self-v2。
2. 迁 `0/` 平台层治理流程（CR + `0/AGENTS.md` 顶层结构 + CONTRACTS-INDEX 登记 + 模式切 governed，需用户逐字确认）。

**最终裁决：APPROVED。** v1.0.0 合并前最后一道门通过；文档-代码一致性全绿，无阻断项。
