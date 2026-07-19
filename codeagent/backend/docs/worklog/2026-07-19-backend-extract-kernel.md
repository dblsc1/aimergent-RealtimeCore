# worklog · 2026-07-19 · backend · realtime_core 内核逐字抽取（P1）

任务单：`/srv/aimergent/0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p1-extraction.md`
角色：`realtime_core` backend 实现者（Opus）。范围：建仓 + 逐字抽取 + 测试落位 + 两个审核脚本 + 文档。**不做任何功能扩展。**

## 做了什么

1. `bash 0/ci/new_module.sh dev/realtime_core` 生成标准模块结构（git init on main），scaffold 首提交后开 `feat/extract-kernel` 分支，全部工作在该分支。
2. 从 copycat 主工作区（`0/functions/copycat/code/backend/src/services/`，**只读**）逐字节 `cp` 七个生产文件 + 六个测试文件到新仓。
3. 建 `code/backend/package.json`（ESM、零依赖、`npm test`=`node --test`）。
4. 移植纯度门 → `review/reviewcode/check-kernel-purity.mjs`；新写逐字门 `review/reviewcode/check-verbatim-extraction.mjs`。
5. 写 contract.md 骨架、rules.md 路线图（P2→P5）、本 worklog、report.json。

## 抽取映射表（最终）

**关键发现：目标目录映射使每个相对 import 原样保留，七个生产文件与六个测试文件全部 0 改动、逐字节一致。** engine.js 的 `./core/poll-machine.js`、`./core/dispatch.js` 在 `transport/engine.js` + `transport/core/*` 结构下仍正确解析；所有测试 import 的都是同目录兄弟。故**无一行 import 需要改**——逐字门 13/13 显示 0 处差异。

| 源（相对 `.../src/services/`） | 目标（相对 `code/backend/src/`） | import 改动 |
|---|---|---|
| `realtime/core/poll-machine.js` | `transport/core/poll-machine.js` | 无（零 import） |
| `realtime/core/dispatch.js` | `transport/core/dispatch.js` | 无（零 import） |
| `realtime/engine.js` | `transport/engine.js` | 无（`./core/*` 相对路径原样保留） |
| `realtime/channels.js` | `transport/channels.js` | 无（零 import） |
| `session-state/locks.js` | `concurrency/locks.js` | 无（零相对 import） |
| `session-state/core/ordering.js` | `queue/ordering.js` | 无（零 import） |
| `session-state/core/ids.js` | `queue/ids.js` | 无（零相对 import） |
| `realtime/core/poll-machine.property.test.mjs` | `transport/core/poll-machine.property.test.mjs` | 无 |
| `realtime/core/dispatch.test.mjs` | `transport/core/dispatch.test.mjs` | 无 |
| `realtime/channels.test.mjs` | `transport/channels.test.mjs` | 无 |
| `realtime/engine.integration.test.mjs` | `transport/engine.integration.test.mjs` | 无 |
| `session-state/locks.mirror.test.mjs` | `concurrency/locks.mirror.test.mjs` | 无 |
| `session-state/core/ids.test.mjs` | `queue/ids.test.mjs` | 无 |

## 测试

- `cd code/backend && npm test`（= `node --test`，串行）：**48 个 node:test 用例，全 pass，0 fail / 0 skip**。
- 每文件 test() 数：poll-machine.property 11、engine.integration 11、dispatch 9、locks.mirror 8、channels 5、ids 4 = 48。property test 内部循环跑数百次断言（任务单"≥230 断言级"指内部断言量；顶层 test 块 48 个，以实际为准）。
- 纯度门 `check-kernel-purity.mjs`：16 PASS / 0 FAIL（scope=transport/）。
- 逐字门 `check-verbatim-extraction.mjs`：13 PASS / 0 FAIL（全 0 处差异）。并做负向自检——临时篡改 ordering.js 一行非 import 代码，门正确 FAIL（exit=1），证明非空过。

## 保守决策（任务单未覆盖，取最保守并记录）

1. **ordering.js 无独立测试，不强凑**：源仓 ordering 没有独立测试文件；覆盖它的 `queue-core.mirror.test.mjs`、`queue-invariants.property.test.mjs` **同时 import 了未抽取的 `normalize.js`/`views.js`/`transitions.js`/`dedupe.js`**。硬抽会要么牵连抽出范围外文件、要么改测试 import 超出"仅 import 白名单"红线——二者都违规。**保守选择：不抽这两个纠缠测试，ordering.js 本单不带专属测试**（其纯函数行为将由未来消费方/P3 会话内核间接覆盖）。locks 与 ids 有干净的独立测试（`locks.mirror.test.mjs`、`ids.test.mjs`），已抽。
2. **纯度门 scope = transport/ only**：忠实移植 copycat 老门——老门只核 `realtime/`，从不核 `session-state/`。原因：`concurrency/locks.js` 含 `skillId` 参数名、`queue/ordering.js` 含 `rounds`，都会被领域词检查 ② 命中。这是老门有意的 scope 边界（session-state 本就领域相邻），不是遗漏。故新门默认目录 = `src/transport`，逻辑逐字保留，仅改两处路径 + 头注释 + SKIP 文案。`FORBIDDEN_IMPORT` 列表中的 `session-state` 等片段原样保留（新仓无此目录，无害）。
3. **逐字门源根硬编码 copycat 绝对路径**（可用 argv[2] 覆盖）：这是一次性跨仓抽取校验，copycat 是只读主工作区，绝对路径最直接可靠。
4. **package.json 命名 `@aimergent/realtime-core` v0.1.0、private、engines node>=20、零 deps**：零 runtime 依赖是内核卖点，devDependencies 也为空（node:test 内建）。

## P2+ 候选（发现想改但**不动手**，留待后续任务单）

红线要求"顺手改进"一律记账不动手。逐字抽取期间注意到以下候选：

- **符号命名带领域味**：`sessionLockKey`/`skillLockKey`（`locks.js`）、`orderedSessionEvents`/`maxEventSeq`（`ordering.js`）、`genEventId`/`genTurnId`（`ids.js`）——一个号称"领域无关"的库里仍有 session/skill/event/turn 词汇。P5 正式契约定稿时是中性化重命名的候选（会破 API，须评估消费方）。
- **`locks.js` 参数名 `skillId`**：`skillLockKey(skillId)` 的形参是领域词——正是 concurrency/ 无法纳入纯度门的直接原因。P2+ 可中性化为 `resourceId` 之类。
- **`ordering.js` 的 `void options;` 哑参 + 死分支注释**：源码保留了老源"两分支 push 逻辑完全相同"的死代码残留（`assignMissing` 哑参）。P2 清理候选：去掉哑参位。
- **`ordering.js` `maxEventSeq` 无 null 兜底**：对 `session=null` 会抛（源码有意保留的老行为，注释说明调用方已在更早处理 null）。若 P5 公开为对外 API，需评估是否加防御。
- **测试后缀不统一**：`locks.mirror.test.mjs`（`.mirror.` 中缀）vs 其余 `.test.mjs`。逐字保留未改；P2 可统一命名约定。

## 交付物落位

- 代码：`code/backend/src/{transport,concurrency,queue}/`、`code/backend/package.json`
- 审核脚本：`review/reviewcode/check-kernel-purity.mjs`、`review/reviewcode/check-verbatim-extraction.mjs`
- 文档：`module_docs/contract.md`（骨架）、`module_docs/rules.md`（路线图）、本 worklog、`codeagent/backend/docs/report.json`
- 分支：`feat/extract-kernel`（未合 main，合并走后续审核门）
