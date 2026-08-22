# 2026-08-22 · reviewagent · governance-promotion 终审（第 3 轮）

## 一句话

修好我自己第 2 轮那个脚本的假阳性（B2 段把审核台账的**引述**当成文档**断言**），在**完整 worktree** 上跑通三向负控，复审 arbiter `0839cbf` 后判 **approved**。

## 背景与轮次

- 第 1 轮 rejected（`d438e7a`）：rules.md P5 持久化路线图与现状矛盾（铁律 11）。
- 第 2 轮 rejected（`a6994bd`）：修复文本自身断言 copycat「只消费 `transport/`」为事实错误；`contract.md` 消费方清单漏登 `concurrency/`+`queue/`；并观察到「4 份事实副本 + 两个竞争事实源」的漂移向量。**打回上限 2 次触发**，升级 CFO。
- CFO 维持打回、独立验证事实、下达 5 处定点修法并**裁决续跑第 3 轮**。arbiter 在 `0839cbf` 执行。
- 本轮 = 该裁决下的终审。

## 我改了什么（写域内）

### 1. `review/reviewcode/module_docs/check-consumer-scope.sh` —— B2 段

**问题**：B2 扫全 `module_docs/` 的「只消费」字样，`module_docs/reviewlog.md:5` 是我自己第 2 轮的台账行、为记录 finding 而**引述**了那句错话，于是脚本判了自己的台账。`reviewlog.md` 与该脚本由**同一 commit `8452b88`** 引入 —— 我上一轮的负控跑在只含三份 module_docs 的**临时子集树**上，所以从没见过这个自噬。

**为什么是脚本的错而不是文档的错**：台账是 append-only 的审核历史留痕（`0/AGENTS.md` 文档体系：无人改历史），它**必须**能引述被打回的原文；「文档对外做出规范性断言」和「台账转述一条历史 finding」是两种语义，字面 grep 区分不了。

**修法**：按**文件角色**区分——扫 `module_docs/` 全部文档，denylist 排除 `reviewlog.md`；被跳过的行打印 `skip` 留痕，不静默吞。

**为什么选 denylist 而不是 arbiter 建议的三文件 allowlist**：allowlist 在 `module_docs/` 新增任何规范性文档时会**静默漏检**（fail-open）；denylist 让新文档自动纳入（fail-closed），检测力只对 `reviewlog.md` 一个文件让步。这条取舍本身就是本轮的教训——**别为了让脚本变绿而削弱它**。

**顺带加强（非削弱）**：原解析只认反引号包裹的 scope，碰上裸写会把 claimed 解析成空、吐出「只消费 ?」这种无信息 FAIL。改为 `` `x/` `` / `` `x` `` / `x/` 三种写法皆认。负控③专门打这条路径。

### 2. `module_docs/reviewlog.md`

- 修表格结构：第 2 轮的两行台账被追加在**表头之上**（孤行，markdown 渲染不成表）。逐字不改地移入表体正确位置。**内容零改动，只修渲染**。副作用：arbiter/CFO 报告里引用的「reviewlog.md:5」行号变化，原文可在 `8452b88` 复原——已写进终审报告第五节。
- 追加本轮 approved 一行。

## 负控：这次跑在完整 worktree 上（本轮硬要求）

| # | 场景 | 结果 |
|---|---|---|
| ① | 当前 `0839cbf` 原样 | **exit 0** `RESULT: PASS`；B1 4/4 PASS；B2 `skip reviewlog.md:5` + `PASS 无排他断言` |
| ② | 就地在 `rules.md` 注入「copycat 只消费 \`transport/\` 层」 | **exit 1** `FAIL rules.md:65 …还消费了: concurrency queue session` |
| ③ | 就地在 `contract.md` 注入「只消费 transport/ 一个面」（**无反引号**） | **exit 1** `FAIL contract.md:251 …还消费了: concurrency queue session` |

②③ 就地注入→跑→`git checkout --` 还原；还原后 `git status --porcelain module_docs/` 无输出、脚本重跑 exit 0；注入文本未进任何 commit。

**教训固化**：负控必须跑在**完整树**上。子集负控的盲区正好是「脚本与自己的产物互相干涉」这一类——上一轮我就栽在这。

## 复审结论要点（详见 review/reviewreport/2026-08-22-governance-promotion-final.md）

- CFO 点名 5 处全部修到位；B1 段 `concurrency/`/`queue/` 由 FAIL 转 PASS。
- **arbiter 自报的 3 处额外改动（`rules.md:9`、`handoff.md:7`、`rules.md:52`）：判定该改、改得对、未越界。** 三处都是同一易变事实的第 5/6/7 份副本；均落在 arbiter 独占写域；铁律 11 明写「关联文档一并改到位、不许只改一处留别处掉队」，不改反而是前两轮被打回的同一个坑。我未采信其自述，逐字 diff 核对。
- 单一事实源立住了：`module_docs/` 全文关键词扫描逐条归类后，消费范围事实副本 **7 → 1**（只剩 `contract.md:269` 清单表），其余全是零事实指针或不同事实域；**无第 8 处漏网**。第 2 轮 P3-1 的「两个竞争事实源」消解为「表=事实 / P5=判据」的正交分工。
- `rules.md:65` 符号中性化条与 base `9061648`（彼时 L58）**逐字符相同**——未被误改。
- 代码零改动；`0839cbf` 未触及 `review/`、旧 worklog、旧 reviewreport、`codeagent/backend/docs/report.json`。
- `bash ci/gates/run-gates.sh` → exit 0（7 门全绿）；`bash review/reviewcode/module_docs/check-consumer-scope.sh` → exit 0。

## 交 CFO 的遗留

1. arbiter canonical `report.json` 仍 `status: "blocked"`，其 escalation（硬验收 exit 0 不可达）**已被本轮脚本修正解除**，且**无需再改任何 module_docs**。是否在合并前刷成终态属 CFO 判断——`codeagent/arbiter/docs/` 非我写域，不越权代改。
2. 跨模块（沿用第 2 轮）：copycat 自己的 `module_docs/contract.md:26` 声称消费 `defineMachine`，全仓 grep 零命中。
3. `0/deploy/CONTRACTS-INDEX.md:4` 概括句未列举 realtime_core（矩阵表/反查表已收录），属 CFO 维护范围。

## 环境坑（给后来者）

- 本环境 `grep` 被包装成 ugrep 的 shell 函数（`grep -c` 吐两行、多 `-e` 的 `-v` 行为异常）——脚本内一律 `command grep`。
- 全程在 worktree `.worktrees/gov-review2`；主检出 `/srv/aimergent/0/realtime_core` 未碰，`functions/copycat` 只读。
- 无 push 权限，commit 后把 SHA 交 CFO 代推。
