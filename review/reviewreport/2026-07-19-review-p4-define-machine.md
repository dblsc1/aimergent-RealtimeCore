# 审核报告 · realtime_core P4 defineMachine 声明式转移表工具

- **任务**：`feat/p4-define-machine`（P4 — 百行级零依赖声明式**平表**有限状态机 `defineMachine`：状态全集 + 合法转移表 + 纯谓词守卫 + 定义期全面校验响亮 throw；transition/can/assertState/states/finalStates；参考示例手写 phase 守卫改表驱动等价证明；纯度门扩展 machine scope）
- **审核对象（exact target）**：仓 `dev/realtime_core`，分支 `feat/p4-define-machine`，base `c6b1a97`（main）..head `8094e50`，`diff_mode=exact`
- **审核人**：reviewagent（独立审核，Opus）
- **日期**：2026-07-19
- **verdict**：**approved**（分支未合 main，交合并门）

被审业务代码一行未改；4 处变异注入全部完全还原（`git status --porcelain` 空、全量 187/187 复绿、纯度门 61/61 复绿）。base `c6b1a97` == 当前 main HEAD，且为 head 祖先。

---

## 结论一句话

七项全 PASS。核心裁断——**兼容门/等价证明成立**：no-renames diff 下 `code/` 内唯一被改的既有文件是任务单显式授权的 `reference/classroom-aggregate.ref.mjs`；等价证明的效力载体 `classroom-aggregate.ref.test.mjs` **git diff 为空（一字未改）**，其 4 用例（含专测降级守卫的 #2）零修改全绿，"表驱动=手写"等价机械成立。定义期 19 类校验逐条读测且经 2 处变异（放行不存在 target / 抹掉位置字段）精确变红；未知键严格拒绝亲测能拦住拼错的 `gaurd`（定义期 throw 带位置）。不可变/纯度经 Object.freeze 与纯度门 61/61 核实、machine scope 经注入 Date.now 变红证非空转。property 终态吸收性经"final 复活"变异变红。参考改造三处手写 phase 守卫确实全下沉 `machine.can`、machine 只守卫不产事件不折叠态。铁律与文档四件同步一致；留痕 embedded-self-v2 机械核验全过。**approved。**

---

## 七项审核结果

### 1. 兼容门与等价证明（核心）—— PASS

- **no-renames diff（`git diff --no-renames c6b1a97..8094e50 --name-status`）= 10 文件**：新增（A）`src/machine/define-machine.js` + 两测试；修改（M）`reference/classroom-aggregate.ref.mjs`、`review/reviewcode/check-kernel-purity.mjs`、`module_docs/{contract,rules,handoff}.md`、`codeagent/backend/docs/{report.json,worklog}`。
- **`code/` 下唯一被改的既有文件 = `reference/classroom-aggregate.ref.mjs`**（任务单 §3 显式授权）；3 个 machine 文件全为 `A`（新增）。无第二个既有 `code/` 文件被动。✅
- **等价证明的全部效力所在——`classroom-aggregate.ref.test.mjs` 一字未改**：`git diff --no-renames c6b1a97..8094e50 -- '**/classroom-aggregate.ref.test.mjs'` **输出为空**。测试未被动过，"表驱动与手写等价"的证明有效。
  - 独立重跑该 4 用例：`node --test reference/classroom-aggregate.ref.test.mjs` → **4 pass / 0 fail**。其中 **#2「decide 守卫拒绝：closed 后 push-question / 无题时 submit-answer 被拒且无痕」直接压在被降级的三处守卫上**——绿即证降级后拒绝行为逐字不变。
- **串行全量重跑**：`node --test --test-concurrency=1` → **187 pass / 0 fail / 0 skip**（既有 153 零改 + 新增 34）。✅

### 2. 定义期校验实质审 —— PASS

逐条读 `define-machine.test.mjs` 定义期 19 用例，与 worklog 覆盖表、`define-machine.js` 校验逻辑三方吻合：spec 非对象 / id 非非空串 / spec 顶层未知键 / states 非对象或空 / 状态名空串 / initial 非非空串 / initial 不在 states / 状态定义非对象 / 状态未知键 / type 非 final / final 声明 on / on 非对象 / 转移定义非对象 / 转移未知键 / target 非非空串 / target 指向不存在 / guard 非串 / guard 引用未定义 / guards 非对象或非函数——每条断言抛 `MachineDefinitionError` 且信息带 id 与位置（`err.where` 或 message）。

**两处变异自检（任务单点名）**：

| # | 注入 | 语义破坏 | 结果 | 还原 |
|---|---|---|---|---|
| A | `define-machine.js:192` target-existence 检查改 `if (false)`（放行 target 指向不存在的状态） | 非法 target 不再定义期拒绝 | 「定义期·target 指向不存在」**not ok（1 fail/0 pass）** | checkout，porcelain 空 |
| B2 | `define-machine.js:36` `this.where = undefined`（错误信息丢掉位置字段） | 位置诊断信息丢失 | 三条断言位置的用例（initial 不在 states / target 指向不存在 / guard 引用未定义）**全 not ok（3 fail/0 pass）** | checkout，porcelain 空 |

> 说明：初次仅抹掉 message 的括号位置后缀（保留 `err.where` 字段）**未变红**——因位置断言压在 `err.where` 字段而非 message 后缀上；改抹 `where` 字段（B2）后三用例精确变红，证明位置诊断被测试真钉死、非空过。

**未知键严格拒绝亲验**（自构造 `gaurd` 拼错定义）：
```
defineMachine({ id:'x', initial:'a', states:{ a:{ on:{ GO:{ target:'a', gaurd:'boom' } } } }, guards:{ boom:()=>true } })
→ THREW MachineDefinitionError: 未知键「gaurd」（只允许 target/guard）（位置：states.a.on.GO）
```
拼错键在**定义期**响亮 throw 带位置，"未知键严格拒绝"确能拦住拼错键。✅

### 3. 不可变与纯度 —— PASS

- **Object.freeze 核实**：`machine` 对象本身 `Object.freeze`（`define-machine.js:268` `return Object.freeze(machine)`）；`states`/`finalStates` 各自 `Object.freeze`（222-223）。测试 `machine 不可变`、`states/finalStates 枚举导出且冻结` 断言 `Object.isFrozen` 且改写抛 `TypeError`（`m.id='hacked'`、`m.states.push('x')` 均 grab 到 TypeError）——运行时改 machine 确失败。✅
- **transition/can 无内部状态**：`resolve(state,event,ctx)` 是纯函数——只读闭包内不可变的 `stateSet`/`table`/`guards`，无赋值给外层可变量、无累加器；`transition`/`can` 只转发 `resolve`，同输入恒同输出、重复调用无副作用（guard 抛异常按设计原样上抛，测试 `guard 抛异常=编程错误` 钉死 transition 与 can 均不吞）。
- **纯度门重跑**：`node review/reviewcode/check-kernel-purity.mjs` → **61 PASS / 0 FAIL**（transport 16 + session 40 + machine 5）。session 段 40 项行为逐字不变（重构抽 `checkStrictScope` helper，session/machine 共用同 5 项检查，非放水）。
- **machine scope 非空转（变异 D）**：向 `define-machine.js` 注入 `const _mut = Date.now();` → 门 **FAIL「machine/define-machine.js: 出现 1 处 Date.now(」（60 PASS / 1 FAIL）**，证明 machine scope 真在检查、非空转。checkout 还原、porcelain 空、门复绿 61/61。✅

### 4. property 不变量 —— PASS

- 读 `define-machine.property.test.mjs` 两条不变量：①**状态封闭性**（200 种子×40 步，含机器不认识的 `NOISE` 噪声事件搅动 event-not-handled 路径，每步断言 `transition` 结果 ∈ stateSet、`changed` 语义、`can===true ⟺ transition 成功`）；②**终态吸收性**（120 种子，随机走到终态或强制 `CLOSE` 保证覆盖，终态后逐事件断言 `can=false` 且 `transition` 必抛 `IllegalTransitionError`，机器不可复活）。
- **变异自检（final 可复活）**：把 `resolve` 的 `event-not-handled` 分支改成宽容自环 `{ ok:true, target:state, changed:false }`（`define-machine.js:214`，令终态吸收任何事件而不抛/不拒） → **property②「终态吸收性」not ok（1 fail/0 pass）**——证明不变量②有真实判别力、终态"不可复活"被真钉死。checkout 还原、porcelain 空。✅

### 5. 参考示例改造实质审 —— PASS

读 `reference/classroom-aggregate.ref.mjs` 改造 diff：

- **三处手写 phase 守卫全部下沉到 `CLASSROOM_MACHINE.can`**（含 v2 override 共 4 个 decide 分支）：
  - `push-question`：`state.phase === 'closed' ? reject('classroom-closed') : […]` → `can(phase,'PUSH_QUESTION') ? […] : reject('classroom-closed')`。表：`PUSH_QUESTION` 定义于 idle/asking/awaiting-answer，**不在** closed（final 无 on）→ closed 时 can=false→原 reject 码。逐格等价。
  - `submit-answer`（v1+v2）：`ANSWERING_PHASES.has(phase)`（{asking,awaiting-answer}）→ `can(phase,'SUBMIT_ANSWER')`。表：`SUBMIT_ANSWER` 仅定义于 asking/awaiting-answer——精确复刻 `ANSWERING_PHASES`。逐格等价。
  - `close`：`state.phase === 'closed' ? reject('already-closed') : […]` → `can(phase,'CLOSE') ? […] : reject('already-closed')`。表：`CLOSE` 定义于 idle/asking/awaiting-answer，不在 closed。逐格等价。
  - `ANSWERING_PHASES` 常量已删除，无"半保留"残余 if/else。
- **组合边界与 contract.md 一致**：machine 只调 `can(...)` 做守卫——**不产出事件、不折叠状态**；`decide` 仍产事件、`evolve` 仍推进 phase。改造未触碰 decide 的产事件职责或 evolve。✅
- 等价的机械证据 = §1 的 ref.test.mjs 零修改 4/4 全绿（#2 专压守卫）。

### 6. 铁律与文档 —— PASS（2 项 info，不阻断）

- **≤500 行**：`define-machine.js` 269 行（gate 计 270 含尾换行）；测试 286/100；reference 改造后仍单文件。全 ≤500。
- **零依赖**：`define-machine.js` 零 import（纯度门 `import 不出 machine/、零 transport 耦合（零 import）` PASS）；`package.json` 无 dependencies。
- **copycat 与 0/ 仓未动**：diff 全部落在 `dev/realtime_core` 本仓（`git diff --name-only c6b1a97..8094e50 | grep -v '^(code|codeagent|module_docs|review)/'` 无输出）。
- **contract/rules/handoff 与代码一致、不超授权**：contract.md 新增「P4 扩展导出面（draft）」（API/错误类/定义期校验/组合边界/验收锚点）与代码逐一吻合、内部一致；rules.md 勾 P4✅ 并细化 P5（正式契约/semver/CR 迁平台/SSE 适配器测试/信封 id 与 ids.js 去重债）；handoff.md 同步 machine/ 接口 + 测试数 187 + 纯度门 61。任务单 §文档与留痕**显式授权**更新此三件，无越域。
- **保守决策裁断**：任务单 §39 列"重复定义"为校验项，但 JS 对象字面量静默折叠重复键（`{a:1,a:2}→{a:2}`），运行时确实拿不到重复信息——**"重复键无法检测→改未知键严格拒绝"的保守替代成立**：已亲测（§2）能在定义期拦住拼错的 `gaurd`/`onn`/`context`，取得响亮校验的等价收益，且三处（contract/rules/worklog）如实登记限制。裁断合理。✅

> **info①（不阻断）**：backend 修改了 `review/reviewcode/check-kernel-purity.mjs`——按 0/AGENTS.md 沙盒表 `review/` 是 reviewagent 独占写区、backend 禁写。但本次由**任务单 §5「纯度门扩展 scope 把 src/machine/ 纳入」显式指派给 backend**；且我独立核验该改动是忠实的 DRY 重构（session 段 40 项行为逐字不变）+ 正确的新 scope（变异 D 证 machine 段非空转），无放水、无藏匿。属任务单授权的越界，非未受控写入——照实记录，交 arbiter 知会；不作 reject 理由。
>
> **info②（不阻断）**：backend report `contract.touched=false` 而 diff 确改了 `module_docs/contract.md`。按 `0/roles/report-schema.md` 升级面语义，`contract.touched` 是**平台契约**路由信号（碰 auth/market_data/llm → 项目级审 + 消费方契约测试）；本次为 draft 模块内部契约、无消费方、无跨模块影响，故 `touched=false` 的路由判定正确（与 P1–P3b 惯例一致）。仅标出。

### 7. 留痕 —— PASS

backend report.json（`codeagent/backend/docs/report.json`）embedded-self-v2 机械核验：
- **protocol** = embedded-self-v2；**head** = SELF → `git log -1 --format=%H -- codeagent/backend/docs/report.json` = `8094e50`（= 分支 HEAD）。
- **base** `c6b1a97fc258ddf7f496e43ab8c5f0bec63a2b33` == 当前 main HEAD，为 head 祖先（`merge-base --is-ancestor` 成立），是 P3b squash 后 main 起点、非 feature-only 中间提交，合规。
- **diff_mode** = `contains`；**changed_files 10 项**按 contains 核对——每项均在 `git diff --no-renames c6b1a97..8094e50`（10 项），实为**集合完全相等**；含本 report 与本角色 worklog。
- **tracked & clean**（porcelain 对 report.json 空）。
- **commit trailer**：`Agent-Attribution: backend@dev/realtime_core+p4-define-machine`——三段小写 slug（role=backend / module=dev/realtime_core，`/` 分层合法 / task=p4-define-machine）可解析、唯一、格式合法。
- **worklog 完整**：`2026-07-19-backend-p4-define-machine.md` 含任务、改动+为什么、**定义期校验 19 类覆盖表**、5 条保守决策、YAGNI 项、验收结果、偏离项——与代码/测试一致。✅

---

## 独立复跑证据

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试（串行） | `node --test --test-concurrency=1` | 187 pass / 0 fail / 0 skip |
| 纯度门 | `node review/reviewcode/check-kernel-purity.mjs` | 61 PASS / 0 FAIL（transport 16 + session 40 + machine 5） |
| ref.test 零修改 | `git diff --no-renames c6b1a97..8094e50 -- '**/classroom-aggregate.ref.test.mjs'` | **空（未改）** |
| ref 等价 4 用例 | `node --test reference/classroom-aggregate.ref.test.mjs` | 4 pass / 0 fail |
| code/ 唯一改的既有文件 | `git diff --no-renames c6b1a97..8094e50 --name-status -- code/` | 仅 `M reference/classroom-aggregate.ref.mjs`；machine 3 文件均 `A` |
| base == main HEAD | `git rev-parse main` | c6b1a97（= base，且 head 祖先） |
| SELF 解析 | `git log -1 --format=%H -- codeagent/backend/docs/report.json` | 8094e50 |
| changed_files 集合 | report 10 项 vs no-renames diff 10 项 | EXACT MATCH |
| 跨仓路径 | `git diff --name-only c6b1a97..8094e50 \| grep -v '^(code\|codeagent\|module_docs\|review)/'` | 无（全在本模块） |

## 变异自检明细（4 处，全还原）

| # | 项 | 注入位置 | 破坏 | 结果 | 还原 |
|---|---|---|---|---|---|
| A | 2 定义期校验 | `define-machine.js:192` target-existence 改 `if(false)` | 放行 target 指向不存在的状态 | 「target 指向不存在」1 fail/0 pass | checkout，porcelain 空 |
| B2 | 2 定义期校验 | `define-machine.js:36` `this.where=undefined` | 抹掉位置诊断字段 | 三条位置断言用例 3 fail/0 pass | checkout，porcelain 空 |
| C | 4 property | `define-machine.js:214` event-not-handled 改宽容自环 | final 状态可复活 | property② 终态吸收性 1 fail/0 pass | checkout，porcelain 空 |
| D | 3 纯度门 machine scope | `define-machine.js:61` 注入 `Date.now()` | machine/ 全局非确定性 | 门 FAIL 60/1（Date.now） | checkout，porcelain 空 |

终态：被审业务代码一行未改，`git status --porcelain` 空，全量 187/187 + 纯度门 61/61 复绿。

## verdict：approved

七项全 PASS，无 P0/P1 隐患，无架构级缺陷。核心裁断（第 1 项）：**ref.test.mjs git diff 为空 + 4 用例零改全绿（#2 专压降级守卫）**，"表驱动=手写"等价机械成立；四处变异（放行不存在 target / 抹位置字段 / final 复活 / machine 段 Date.now）精确变红证各门非空转。两项 info（backend 改纯度门=任务单授权的越界、`contract.touched=false` 路由正确）已照实记录、不阻断。分支 `feat/p4-define-machine` 未合 main，交合并门（独立 approved → 本地 gates/tests → squash）。
