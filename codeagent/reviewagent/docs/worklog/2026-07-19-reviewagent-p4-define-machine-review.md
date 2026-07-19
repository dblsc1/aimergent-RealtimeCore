# worklog · 2026-07-19 · reviewagent · P4 defineMachine 独立审核

## 任务

对 `feat/p4-define-machine`（base `c6b1a97`=main..head `8094e50`，`diff_mode=exact`）做独立审核。审核对象：realtime_core P4 声明式平表有限状态机 `defineMachine`（状态全集+合法转移表+纯谓词守卫+定义期全面校验）+ 参考示例表驱动改造 + 纯度门扩展 machine scope。

## verdict：approved

七项全 PASS，无 P0/P1，无架构级缺陷，无未受控写入。分支未合 main，交合并门。

## 七项结论（详见 review/reviewreport/2026-07-19-review-p4-define-machine.md）

1. **兼容门与等价证明（核心）** — PASS。no-renames diff = 10 文件；`code/` 内唯一被改的既有文件是任务单 §3 授权的 `reference/classroom-aggregate.ref.mjs`（machine 3 文件全 A 新增）。**等价证明效力载体 `classroom-aggregate.ref.test.mjs` 的 git diff 为空（一字未改）**——"表驱动=手写"证明有效；独立重跑该 4 用例 4pass（#2 专压被降级的三处守卫）。串行全量 187/187（既有 153 零改+新 34）。
2. **定义期校验实质审** — PASS。19 类逐条读测三方吻合。变异 A（`:192` target-existence 改 `if(false)`→目标测红）、B2（`:36` `this.where=undefined`→3 条位置断言用例红）。亲测未知键严格拒绝拦住拼错 `gaurd`（定义期 throw 带位置 `states.a.on.GO`）。
3. **不可变与纯度** — PASS。Object.freeze machine/states/finalStates（改写抛 TypeError）；transition/can 纯（resolve 只读闭包不可变态、guard 抛异常按设计上抛）。纯度门 61/61；变异 D（`:61` 注入 Date.now→门 60/1 FAIL）证 machine scope 非空转；session 段 40 项 checkStrictScope 重构后逐字不变（非放水）。
4. **property 不变量** — PASS。两不变量（状态封闭性含 NOISE 噪声/终态吸收性）读定；变异 C（`:214` event-not-handled 改宽容自环令 final 复活→property② 红）。
5. **参考示例改造实质审** — PASS。三处手写 phase 守卫（push-question / submit-answer 含 v2 / close）全下沉 `CLASSROOM_MACHINE.can`、删 `ANSWERING_PHASES`、无半保留 if/else；machine 只守卫不产事件不折叠态，组合边界合 contract.md；逐格等价。
6. **铁律与文档** — PASS。≤500（define-machine.js 269）/零依赖/copycat·0 未动；contract/rules/handoff 与代码一致、任务单授权、无越域；保守决策"重复键无法检测→未知键严格拒绝"裁断成立。
7. **留痕** — PASS。backend report embedded-self-v2 全过（SELF→8094e50=分支HEAD、base c6b1a97==main HEAD 且祖先、changed_files 10 精确相等、tracked/clean）、trailer 合法、worklog 含 19 类覆盖表。

## 变异自检明细（4 处，全还原 porcelain 空、187/187+61/61 复绿）

| # | 项 | 注入位置 | 破坏 | 结果 |
|---|---|---|---|---|
| A | 定义期校验 | `define-machine.js:192` target-existence 改 `if(false)` | 放行 target 指向不存在 | 「target 指向不存在」1 fail |
| B2 | 定义期校验 | `define-machine.js:36` `this.where=undefined` | 抹掉位置诊断字段 | 3 条位置断言用例 3 fail |
| C | property | `define-machine.js:214` event-not-handled 改宽容自环 | final 可复活 | property② 终态吸收性 1 fail |
| D | 纯度门 machine scope | `define-machine.js:61` 注入 `Date.now()` | machine/ 非确定性 | 门 60/1 FAIL |

> 注：B 初次仅抹 message 括号后缀（保留 `err.where`）未变红——位置断言压在 `err.where` 字段而非 message；改抹字段（B2）后精确变红。这一步反向确认"位置信息"是靠字段而非 message 断言的。

## 两项 info（不阻断，交 arbiter 知会）

- **backend 改 `review/reviewcode/check-kernel-purity.mjs`**：按沙盒表 backend 禁写 `review/`，但任务单 §5 显式指派"纯度门扩展 scope"给 backend。核验为忠实 DRY 重构（session 40 项逐字不变）+ 正确新 scope（变异 D 证非空转），无放水。属任务单授权的越界、非未受控写入。
- **backend report `contract.touched=false` 而 contract.md 被改**：按 report-schema 升级面语义，`contract.touched` 是平台契约路由信号；draft 模块内部契约、无消费方，`touched=false` 路由正确。

## 复跑证据

- `node --test --test-concurrency=1` → 187 pass/0 fail/0 skip
- `node --test reference/classroom-aggregate.ref.test.mjs` → 4 pass/0 fail
- `node review/reviewcode/check-kernel-purity.mjs` → 61 PASS/0 FAIL
- `git diff --no-renames c6b1a97..8094e50 -- '**/classroom-aggregate.ref.test.mjs'` → 空
- `git rev-parse main` = c6b1a97 = base；`merge-base --is-ancestor c6b1a97 8094e50` = YES

终态：被审业务代码一行未改，`git status --porcelain` 空（提交前），全量 187/187 + 纯度门 61/61 复绿。
