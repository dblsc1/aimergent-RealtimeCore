# 2026-08-22 · reviewagent · governance-promotion 打回复审（第 2 轮）

**结论：rejected**（详报 `review/reviewreport/2026-08-22-governance-promotion-rereview.md`）

## 审的什么

- exact target `9061648118fb3f94b27226970b2c119d434a059d..a6994bd612c2160e2eb7b9bfeac853b66f170203`（分支 `chore/governance-promotion`）
- 复审增量 = `a23b7f3..a6994bd`（首轮审核 commit 之上唯一新 commit，纯文档）
- 全程在 worktree `.worktrees/gov-review2`；主检出与其它仓未触碰，copycat 仅只读 grep

## 怎么审的 / 为什么这么审

首轮我只点名了 `rules.md:67` 一处。这轮 worker 说是"三份文档共 4 处"。**不采信描述，自己重扫**：拿 6 个关键词（`持久化适配器`/`首个消费方`/`死代码`/`无消费方`/`随消费方`/`落地期`）全仓 `command grep -rno` 出 file:line 表，再逐条读原文分类为「权威文档 / 历史留痕 / 假阳性」。结论：4 处属实、都改了、`module_docs/` 内无第 5 处；历史 worklog/report 里的旧措辞**故意不改是对的**（无人改历史）。

第二件事是核**新口径本身**能不能立住，而不是只核"改没改"。去 copycat 主检出只读实查两件事：`sqlite-log-store.js` 有没有接生产组合根（没有，唯一引用者是它自己的 property test，文件头注释也自述未接线）、`session/` 端口有无生产消费者（0 个）。**核心判据成立**。

第三件事顺手把"copycat 到底消费了哪些面"也机械化了——**这一步抓到了本轮的打回理由**：copycat 生产代码除 `transport/` 外还 import 了 `concurrency/locks`（7 处，含 `app.js:67`）和 `queue/ids`·`queue/ordering`（3 处）。而本轮新写入的三处文字都断言「只消费 `transport/`」，`contract.md:269` 消费方清单也只登了 3 个面。更硬的证据是**同文件内冲突**：`rules.md:65` 早就写着 lock keys / `genTurnId` / `ordering` 是「copycat 换装期的硬依赖遗产面」——L65 与 L67 直接打架。修矛盾的 commit 又造了一处同类矛盾。

**这条为什么必须打回而不是登记债务**：`contract.md:263` 白纸黑字说消费方清单是「供 CR 评审时评估影响面」。清单漏两个面 = 未来动 `concurrency/`/`queue/` 的 CR 会被评成"不影响 copycat"，而实际会打断 copycat 生产代码 10 处 import。这是治理机制被实质削弱，不是措辞问题。

## 新增检测脚本（铁律 17）

`review/reviewcode/module_docs/check-consumer-scope.sh` —— 消费方实际消费范围 vs module_docs 声明的一致性检查（只读）。A 段机械提取消费方生产代码（排测试/注释、支持多行 import 续行）实际消费的 scope；B1 逐 scope 核 contract 消费方清单；B2 扫全 `module_docs` 的「只消费 …」排他断言。

**踩坑记录**：
1. 初版把 `case "$body" in *import*` 当作"是不是真 import"的判据，结果漏掉多行 import 的续行 `} from '@aimergent/realtime-core/transport/engine';` —— `transport/` 整个 scope 在 A 段消失了。**教训：JS 的 import 不一定在同一行带 `import` 字样**，判据补 `*"from '"*`。
2. B2 段取"只消费"之后 60 字符做窗口，会把下一句里的 scope 也算进"被断言的集合"，导致误判。收窄到 25 字符。
3. `grep` 在本机被包成 ugrep shell 函数（`-c` 出两行、`-v` 多 `-e` 行为异常），全程用 `command grep`。

**负控（防空转）**：把三份 module_docs 复制到 scratchpad 临时树，按建议修法改正（删排他断言 + 清单补 `concurrency/`/`queue/`）后重跑脚本 → `exit 0 / RESULT: PASS`；对当前 candidate → `exit 1` 并精确点名两个漏登 scope。证明脚本有判别力、不是恒红。

## 肉眼审项的"为何不能代码化"

- 新口径的**规范性取舍**（该按"任意消费方"还是"该端口的生产消费者"判）无机械真值；其中可算的部分（未接组合根 / 0 生产消费者）已全部代码化跑过。
- "指针结构能否防未来漂移"是对未来的反事实推断；但其当下征兆（事实副本 >1、两个权威源已互相矛盾）已由 B1/B2 机械抓到，故报告里这条给的是证据而非感觉。

## 门禁

`bash ci/gates/run-gates.sh` → 🟢 全部门禁通过（exit 0），commit 后复跑同样绿。

## 交接提示

这是**第 2 次打回，已达铁律「同一任务上限 2 次」**。report.json 的 `escalation` 已如实标注；若第 3 轮仍不过，须升级 CFO 裁决而非由我继续打回。修法本身很小：三处指针删掉消费范围事实句、`contract.md:269` 清单补两行。
