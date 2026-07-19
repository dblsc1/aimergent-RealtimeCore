# 审核报告 · realtime_core P2 内核扩展（interval 形态 + 顶替 + block-9 参考验收）

- **仓**：`/srv/aimergent/dev/realtime_core`
- **分支**：`feat/p2-kernel-extension`
- **base**：`7d41f8e5e39af47552a5450723497a34eca1c162`（feat(realtime_core): P1 verbatim kernel extraction + reviewagent approved (squash) — main 上 P1 任务起点）
- **head**：`f909d377a778019e78ed5983688707e10179d4af`（feat(realtime_core): P2 kernel extension）
- **diff_mode**：exact（`git diff --no-renames 7d41f8e..f909d37`）
- **任务单**：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p2-kernel-extension.md`
- **审核性质**：新逻辑审核（非逐字核对）
- **verdict：approved**

---

## 1. 兼容门（最高优先）—— PASS

P1 移植的 6 个既有测试文件：
`locks.mirror.test.mjs`、`queue/ids.test.mjs`、`transport/channels.test.mjs`、`transport/core/dispatch.test.mjs`、`transport/core/poll-machine.property.test.mjs`、`transport/engine.integration.test.mjs`。

- `git diff --no-renames 7d41f8e..f909d37 --name-only` 的 15 个改动文件中**不含上述任何一个**——6 个既有测试文件零改动。**PASS**
- 全量串行重跑 `cd code/backend && node --test --test-concurrency=1`：**72 pass / 0 fail / 0 skip**（duration ~978ms），既有 48 + 新增 24。既有 48 全绿。**PASS**

无任何对既有测试的"顺手调整"。

## 2. 新不变量测试是否真的在测 —— PASS（含变异自检）

逐条读 `poll-machine.extended.property.test.mjs` 三条新不变量：均为「显式钉死 + 随机序列（mulberry32 固定种子，wakeup/interval 双形态各 200–400 种子）统计交叉核」双保险，断言口径正确（respondCount≤1、supersededRespondCount、attemptAfterTerminalCount、cleanupCount/disarmIntervalCount 恰好一次）。

**变异自检（2 条，均已完全还原、`git status --porcelain` 空）**：

| # | 注入违规 | 位置 | 预期拦截 | 实测 |
|---|---|---|---|---|
| 变异1 | teardown 丢弃 `DISARM_INTERVAL`（interval 终态只 `[CLEANUP]`） | `poll-machine.js` `teardown()` | 不变量③ | 测试 #5（不变量③随机序列）**FAIL**，另 #1（不变量① interval teardown 断言）**FAIL**；共 2 fail。还原后 `git checkout` → porcelain 空 |
| 变异2 | SUPERSEDE 后停在非终态 `WAITING`（允许后续 settled 二次 RESPOND） | `poll-machine.js` `reduceSupersede()` | 不变量① | 测试 #1、#2（不变量① 显式 + 随机 respondCount≤1）**FAIL**；共 3 fail。还原后 `git checkout` → porcelain 空、`git diff HEAD` 空 |

两条不变量均非空过：注入违规即精确变红，还原后仓库逐字节回归干净，还原后全量 72/72 复绿。被审业务代码一行未改。**PASS**

## 3. block-9 行为对照（实质审）—— PASS

亲读 copycat 源（只读）`domains/child-ab/next-question-poller.js`、`domains/parent/options-waiter.js`，逐条核对参考实现：

**next-question（child-ab）**：1000ms interval（ARM_INTERVAL）✓、attempt 同步返回 `{kind}` 经 `Promise.resolve` + classify 读 kind ✓、`not_found`/`delivered` 终止 ✓、其余继续等 ✓、延迟首发 `immediateFirstAttempt:false` ✓、60s 超时 ✓、`raw.on('close')` 静默（CLIENT_CLOSE→仅 CLEANUP）✓、cleanup 拆 interval+timer+off（DISARM_INTERVAL+CLEANUP）✓、active 计数 ✓。特征测断言与源逐条对齐。

**options-waiter（parent）**：800ms ✓、`!round`→notFound / `round.status==='ready'`→ready ✓、keyed supersede 恰好一次 ✓、按身份 `registry.delete`（不误删后来者）✓、异 key 互不影响 ✓、`activeCount==registry.size` ✓。顶替顺序 `prev(); registry.set(key,…)` 照抄 block-9 `previous(); active.set(key,…)`；引擎 CLEANUP 的 `registry.get(key)===superseder` 身份守卫在「旧 prev() 同步 cleanup 摘除 → 新 set」序内成立，无误删。

**微时序适配裁定**：block-9 attempt 在 interval 回调内**同步**结算并同步 cleanup；参考经 `attempt→Promise→ATTEMPT_RESULT` 事件，结算落 tick 后一个微任务。真实 HTTP 场景**无可观测差异**，理由：①同步 attempt（DB 读）仍在 ATTEMPT 动作运行的同一同步点执行，只有"结算分支/respond"被推迟一个微任务；②所有竞争事件（`close` I/O、`timeout`、下一 tick）都是宏任务，严格排在当前宏任务的微任务队列**之后**排空——微任务先于任何后续宏任务，故 close-vs-attempt-结果同 tick 竞争的结局与 block-9 逐位一致（先到的宏任务经 `done`/终态 DISCARD 守卫拦下第二次 respond）；③SUPERSEDE/TIMEOUT/CLIENT_CLOSE/POLL_TICK 派发均为同步喂入（非经 attempt promise），无推迟。结论：适配诚实且不改任何可观测结局（首发时机/超时时序/顶替结局/close 语义）。**PASS**

## 4. 纯度门与设计红线 —— PASS

- `node review/reviewcode/check-kernel-purity.mjs` 独立重跑：**16 PASS / 0 FAIL**，scope=`src/transport` 未缩小。
- `poll-machine.js` 亲自 grep `import|require|setTimeout|setInterval|clearTimeout|clearInterval|Promise|Date.|Math.random`：**仅命中注释行（5–7 行），生产代码零 import / 零 timer / 零 Promise**。副作用全部下沉到 engine.js。**PASS**
- `reference/` 置于纯度门 scope 外：成立——参考是合法引用 block-9 领域词（kind/round/options）的领域适配器，非通用内核；纯度门只核 `transport/` 生产内核，与 copycat 老门 scope 一致。
- 单文件 ≤500：poll-machine.js 339、engine.js 205、locks.js 47——均远低于上限。**PASS**

## 5. 偏离项复核 —— 五处均更保守/合理，无隐患

1. **config 放 initPoll 而非 START**：任务单允许其一；initPoll 已是 engine 调用点，最小改动面，既有测试无一对 initPoll() 整体 deepEqual，加字段安全。**合理**。
2. **DISARM_INTERVAL 与 CLEANUP 分离**：满足"CLEANUP 恰好一次且必含 DISARM_INTERVAL"，同时 wakeup teardown 保持 `[CLEANUP]` 与 P1 逐字节一致——兼容门零风险；engine.cleanup() 再对 interval null-guard 兜底一次（DISARM 已清则 no-op），防漏不泄漏。**更保守**。
3. **classify 取代布尔 isSettled**：布尔无法表达 delivered/not_found/continue 三分类；未传 classify 退回 isSettled，P1 调用方零改动。**合理**。
4. **registry 注入而非 engine 内建全局**：保持 engine 零全局状态、可测；不传 key/registry 完全绕过。**更保守**。
5. **reference 置于 scope 外**：见 §4，理由成立。**合理**。

（另 SUPERSEDE 允许任意非终态而非仅 waiting：语义无害、更稳健，终态由顶部 DISCARD 守卫拦下。）

## 6. 越域裁量 —— 一处轻微越出任务单显式指令，标出不打回

本模块当前为 `lightweight` 单 agent 模式（rules.md §工作模式，CFO 已知情），单 agent 统一承担多角色。核对 backend 在本模式下的两类越角色写入：

- **`module_docs/rules.md`（路线图勾掉 P2）**：任务单 §留痕与验收显式指令（"rules.md 路线图勾掉 P2"）。**在范围内**。
- **`module_docs/contract.md`（导出面同步、仍标 draft）**：任务单显式指令（"contract.md：导出面变更同步"）。**在范围内**。
- **`review/reviewcode/check-verbatim-extraction.mjs`（`git rm` 退役）**：任务单 §4 显式指令（"退役：删除该脚本，并在 worklog 说明"）。已删除、reviewcode 目录仅剩 check-kernel-purity.mjs + .gitkeep、worklog 已说明兼容门接任。**在范围内**。
- **`module_docs/handoff.md`（更新）**：任务单**未显式列为交付物**（§留痕与验收只点名 contract.md + rules.md + 逐字门退役）。此项**轻微越出任务单显式指令**——但内容合理（接口变更后按铁律 11「改动即改文档 + 关联文档全同步」同步 handoff 属正当），且严格限于本仓本模块、无跨模块/跨仓触碰。lightweight 单 agent 模式下 CFO 已知情，**不作为 reject 理由，仅标出供 CFO/未来模块 arbiter 知悉**。

无任何跨模块、跨仓、copycat 源、`0/` 或 staging 的越界写入（copycat 源仅只读对照）。

## 7. 留痕 —— PASS

- **report.json（backend，`codeagent/backend/docs/report.json`）embedded-self-v2 机械核验**：
  - tracked/clean：`git status --porcelain` 空（已跟踪且干净）。**PASS**
  - `protocol:embedded-self-v2`、`head:"SELF"` → `git log -1 --format=%H -- <path>` = `f909d377…`（resolved_head）。
  - `base:7d41f8e…` = PR 目标 main 的任务起点；`git merge-base --is-ancestor 7d41f8e f909d37` 成立。**PASS**
  - `changed_files`（15 项）与 `git diff --no-renames 7d41f8e..f909d37` 集合**完全相等**（无缺/多/重复）。**PASS**
  - 注：backend report 用 `diff_mode:"contains"`（其自报），但集合恰好等于 exact diff，无漂移。
- **commit trailer**：`Agent-Attribution: backend@dev/realtime_core+p2-kernel-extension`——三段小写 slug 均可解析（role=backend，module=dev/realtime_core 允许 `/` 分层，task=p2-kernel-extension），唯一。**PASS**
- **worklog**（`codeagent/backend/docs/worklog/2026-07-19-backend-p2-kernel-extension.md`）：完整——改动总览、block-9 逐条对照表（两 poller）、5 处设计决策、微时序诚实记录、文件尺寸、自检结论、lightweight 沙盒说明。**PASS**

## 结论

七项检查全部通过。核心结论：①兼容门无损（6 既有测试文件零改、72/72 串行全绿）；②三条新不变量经变异自检证明非空过、精确可拦违规实现；③参考实现逐条忠实复现 block-9 两 poller，微时序适配诚实且无可观测差异；④纯度红线保持（poll-machine 零 import/timer/Promise，16/16 PASS）；⑤五处偏离均更保守或合理、无隐患；⑥越域仅 handoff.md 一处轻微越出任务单显式指令，lightweight 模式下标出不打回；⑦留痕 embedded-self-v2 机械核验全过。

**verdict = approved。** 分支未合 main，交合并门（`merge-to-main.sh`）。
