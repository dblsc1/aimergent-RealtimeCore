# 审核报告 · realtime_core P1 内核逐字抽取

- **仓**：`/srv/aimergent/dev/realtime_core`
- **分支**：`feat/extract-kernel`
- **base**：`bb645c82c4f9559c554e1eea6d20365ecb15f654`（chore(realtime_core): scaffold module from template）
- **head**：`2a039ae0892b0f7eb75064bbd566efeda921b2bf`（feat(realtime_core): verbatim extract copycat realtime kernel (P1)）
- **任务单**：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p1-extraction.md`
- **verdict：approved**

## 1. 范围核对

`git diff --name-only --no-renames bb645c8..2a039ae` 与 backend report.json 的 `git.changed_files`（20 项）逐项比对，**集合完全相等**（无缺项/多项/重复）。diff 未越出本仓（无 `0/`、`copycat`、其他模块路径出现）。**PASS**

## 2. 三道门独立重跑（数字）

| 门 | 命令 | 结果 |
|---|---|---|
| 逐字抽取门 | `node review/reviewcode/check-verbatim-extraction.mjs` | **13 PASS / 0 FAIL**，exit 0 |
| 纯度门 | `node review/reviewcode/check-kernel-purity.mjs` | **16 PASS / 0 FAIL**（scope=`code/backend/src/transport`），exit 0 |
| 单元测试 | `cd code/backend && npm test`（node --test，串行） | **48 pass / 0 fail / 0 skip**（duration 268ms），exit 0 |

与 backend 自报数字完全一致。**PASS**

## 3. 门防空转自检（两道门各一次，均已还原、仓库回归干净）

- **逐字门**：临时在 `code/backend/src/queue/ordering.js` 第 20 行非 import 代码尾部追加 `/*TAMPER*/`。重跑门 → `queue/ordering.js: 1 处非白名单差异` FAIL，退出码 1（其余 12 文件仍 PASS）。还原后 `git status --short`/`git diff --stat` 均为空。
- **纯度门**：临时在 `code/backend/src/transport/engine.js` 头部插入 `import fastifyThing from 'fastify';`。重跑门 → `engine.js: 禁止的 transport/存储/领域层 import「fastify」` FAIL，退出码 1（其余 3 文件仍 PASS）。还原后 `git status --short`/`git diff --stat` 均为空。
- 审核全程 `git status` 最终为 `nothing to commit, working tree clean`。**两门均非空过，仓库审前审后逐字节一致。PASS**

## 4. 逐字抽查（人工，不信脚本）

随机抽 4 个文件（覆盖生产核心 reducer、领域相邻 concurrency、纯测试文件、引擎壳），直接 `diff` 新仓文件与 copycat 源（`0/functions/copycat/code/backend/src/services/...`，只读）：

| 文件 | 结果 |
|---|---|
| `transport/core/poll-machine.js` ↔ `realtime/core/poll-machine.js` | IDENTICAL |
| `concurrency/locks.js` ↔ `session-state/locks.js` | IDENTICAL |
| `transport/channels.test.mjs` ↔ `realtime/channels.test.mjs` | IDENTICAL |
| `transport/engine.js` ↔ `realtime/engine.js`（额外抽查，因其含相对 import 是最可能被误改的文件） | IDENTICAL |

**PASS**（超额完成 3 个的要求，第 4 个用于验证声称的"目标目录映射使相对 import 原样保留"这一关键结论）。

## 5. 留痕合规

- worklog `codeagent/backend/docs/worklog/2026-07-19-backend-extract-kernel.md`：存在，含映射表（13 文件，源/目标/import 改动）、P2+ 候选清单（5 条，含符号命名领域味、locks 形参、ordering 哑参/null 兜底、测试后缀不统一）、测试数字。**PASS**
- report.json（`codeagent/backend/docs/report.json`）：`schema_version:2`、`protocol:embedded-self-v2`、canonical path 正确；`git status --short` 无输出（已跟踪且干净）；`resolved_head`（`git log -1 --format=%H -- <path>`）= `2a039ae...`，`base`=`bb645c8...`，`merge-base --is-ancestor` 成立；`changed_files` 与 diff 集合完全相等。**PASS**
- 两个 commit 的 `Agent-Attribution` trailer：`backend@dev/realtime_core+extract-kernel`——三段小写 slug 均可解析（role=backend，module=dev/realtime_core 允许 `/` 分层，task=extract-kernel），bb645c8（scaffold）与 2a039ae（extract）均带该 trailer 且各自唯一。**PASS**
- 轻微观察（不构成打回）：backend report.json 自报 `tier:"normal"`，按项目文档体系 normal tier 应配 diary；本仓当前无 diary 目录/事件流。因本任务无独立模块 arbiter 定级（CFO 直派），任务单本身（§8 留痕要求）未列 diary 为交付物，故不计入本次 verdict，登记为观察项供 CFO/未来 arbiter 参考。

## 6. 任务单偏离项复核

worklog 声明 3 处偏离，逐条核实：

1. **ordering.js 无专属测试**：核实 copycat 源 `session-state/core/` 下确无 `ordering.test.mjs` 独立文件；覆盖 ordering 的 `queue-core.mirror.test.mjs`、`queue-invariants.property.test.mjs` 分别 import `./normalize.js`/`./views.js` 与 `./dedupe.js`/`./normalize.js`/`./transitions.js`——均为任务单映射表外的文件。若抽取这两个测试，要么牵连额外文件超出七文件范围，要么改测试 import 违反"只许改 import 路径"红线。**理由成立，判断正确**。
2. **纯度门 scope 限 transport**：核实 copycat 原门 `check-realtime-engine-purity.mjs` 第 32 行 `realtimeDir` 缺省即为 `code/backend/src/services/realtime`，从未覆盖 `session-state/`。新门缺省 scope 与老门行为一致，不是新引入的收窄。**理由成立，判断正确**。
3. **逐字门源根硬编码 copycat 绝对路径**：核实脚本第 24 行 `SRC_ROOT = process.argv[2] || '/srv/.../copycat/.../services'`，可用 `argv[2]` 覆盖，非死绑定。一次性跨仓抽取校验场景下合理。**理由成立，判断正确**。

三处偏离均如实且理由站得住。**PASS**

## 7. 铁律扫描

- **单文件 ≤500 行**：`find code/backend/src -type f \( -name '*.js' -o -name '*.mjs' \) -exec wc -l {} \; | awk '$1>500'` 无输出，最大文件 `engine.integration.test.mjs` 276 行。**PASS**
- **无密钥**：对 `code/backend/src` 与 `review/` grep 常见密钥模式无命中；`.env.staging.example` 仅占位注释，无真值。**PASS**
- **codeagent/ 无代码**：`find codeagent -type f ! -name '*.md' ! -name '.gitkeep'` 只命中 `codeagent/backend/docs/report.json`（数据文件，非业务代码，报告协议明文要求落在此路径）。**PASS**
- **copycat 源仓未改**：`git -C 0/functions/copycat status` → `working tree clean`；`git rev-parse HEAD` = `46c2c94b16f93e03b5635219621e1f2e6fb68f06`，与任务单声明一致。**PASS**

## 结论

七项检查全部通过，verdict = **approved**。核心结论：13 个抽取文件（7 生产 + 6 测试）逐字节 100% 一致（0 处哪怕 import 改动，因目标目录结构使相对路径原样解析），两道机械门经防空转自检证明非摆设，三处任务单外偏离均如实记录且理由经源码核实站得住，留痕（worklog/report.json/commit trailer）合规。P1 建仓+抽取任务达标，可交付。
