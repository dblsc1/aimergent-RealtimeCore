# arbiter · governance-promotion 第 3 轮（CFO 定点修正）

- 日期：2026-08-22
- 分支：`chore/governance-promotion`（worktree `.worktrees/gov-review2`）
- base：`9061648118fb3f94b27226970b2c119d434a059d`（main）／接手 head：`8452b8867e1af140b6cb510df6e4c6733078e2c8`
- tier：`normal`
- 背景：本分支已被 reviewagent 连续 rejected 2 次，触发铁律「打回上限 2 次」，升级 CFO。CFO 维持打回并独立复核了 reviewer 的两条事实，指定精确修法。本轮是**定点执行 CFO 裁决**，不重新论证、不扩大范围。

## 为什么改（问题的本质）

第 2 轮 candidate `a6994bd` 修好了首轮的矛盾，但在修复文本里写下了新的事实错误：「首个消费方 `functions/copycat` 已落地但目前只消费 `transport/`」。

这句话为假。我按 CFO 要求自己去 copycat 主检出（main `5ffe4016ff84cc05f42735aa2bfcaacce0a67aea`，只读）复核，逐条命中与 CFO 给的完全一致：

- `concurrency/locks` **7 处生产 import**：`src/app.js:67`（组合根）、`routes/teacher-rest.js:28`、`routes/teacher-session-commands.js:21`、`routes/teacher-skill-commands.js:13`、`application/persona/operation-port.js:1`、`domains/basic/skill-routes.js:11`、`services/session-state/service.js:33`。（`routes/teacher-ws-test-helpers.mjs:34` 是测试辅助，不计入生产。）
- `queue/` **3 处生产 import**：`services/session-state/core/library.js:4`（`queue/ordering`，动态 import）、同文件 `:5`（`queue/ids`）、`services/session-state/operations/push.js:14`（`genTurnId`）。
- `session/`：只有 `data/sqlite-log-store.js`（`session/errors`、`session/envelope`），而它的唯一引用者是自己的 `sqlite-log-store.property.test.mjs:24`，未接生产组合根。
- `machine/`：零命中。

所以**触发条件的判据本身是对的**（`session/` 端口确实 0 个生产环境实际消费者），错的只是拿来支撑它的那句排他断言。而且这句假话与本仓 `rules.md` P5「符号中性化」条自述的「`sessionLockKey`/`skillLockKey`/`orderedSessionEvents`/`maxEventSeq`/`genTurnId` 是 copycat 换装期的硬依赖遗产面」直接冲突——那些符号正住在 `concurrency/locks` 与 `queue/ids`·`queue/ordering`。修矛盾的 commit 自己引入了一处新矛盾。

更深的病根（reviewer 的 P3-1，我认同并按 CFO 第 4 条根治）：同一个**易变事实**（copycat 消费范围）在文档集里有 4 份独立措辞副本，而且存在**两个互相竞争的权威源**——`contract.md` 消费方清单表（自称清单权威）与 `rules.md` P5（自称触发条件权威）。副本数 >1 时，"指针结构"防不住漂移；本轮 P2-1 就是它当场发作的实证。**只删这一次的错话不解决问题，必须把事实副本降到 1。**

## 改了什么

1. **删排他断言**（CFO 第 1 条）：`contract.md` 非目标节、`rules.md` P5、`handoff.md` 技术债条、`contract.md` 变更记录复述行——四处「已落地但目前只消费 `transport/`」整句删除，只留触发条件 + 指针。
2. **判据改述**（CFO 第 2 条）：`rules.md` P5 改为「本条真正相关的 `session/` 端口（logStore/snapshotStore）截至目前仍是 0 个生产环境实际消费者」。**判据不变，只是不再靠那句假话支撑。**
3. **补登两个面**（CFO 第 3 条）：`contract.md` 消费方清单表补 `concurrency/`、`queue/` 两个面，逐条列出 file:line。该表在其上方被声明为「供 CR 评审时评估影响面」——漏登会使未来改这两面的 CR 被误评为「不影响 copycat」，而实际上会打断 10 处生产 import（含组合根 `app.js`）。同时补记核实基准（copycat main `5ffe401` + 统计口径 + 检测脚本路径），让下次复核可复现。
4. **单一事实源**（CFO 第 4 条）：消费范围此后只允许存在于 `contract.md` 消费方清单表一处。除上述三处外，**自查全文一致性时又抓到两处 CFO 清单未点名、但同属该事实副本的残留**（检测脚本因它们不用「只消费」字样而抓不到）：
   - `rules.md` 工作模式节「已通过 git tag 真实消费 `transport/` 层」→ 改为「真实消费本库……具体哪些面以清单表为唯一事实源」。
   - `handoff.md` 概述节「实际消费 `transport/` 层——`session/`/`machine/` 端口目前未被消费方接入生产」→ 改为纯指针。
   还把 `rules.md` P3b 条尾巴上的「（首个消费方已存在但尚未消费 `session/` 端口）」这份判据事实副本也削成纯指针。**留着它们就等于本轮只修了脚本能看见的那几处、别处照样掉队——这正是前两轮被打回的同一个坑。**
5. `contract.md` 变更记录补本轮一行（铁律 11）。

## 没改什么（守边界）

- 任何代码：零改动。
- `rules.md` P5「符号中性化」条（CFO 点名它是对的）。
- 历史留痕：旧 worklog、`review/reviewreport/`、`codeagent/backend/docs/report.json` 一律保留原措辞——不回头改写历史（项目 AGENTS.md 文档体系「无人改历史」）。
- `review/reviewcode/check-consumer-scope.sh`：reviewagent 属主，我只读、未动一字。
- `0/deploy/CONTRACTS-INDEX.md`：已核，其 realtime_core 两行不列 scope 粒度，本轮改动不产生反查表漂移，无需 CR。

## 验证

- `bash review/reviewcode/module_docs/check-consumer-scope.sh`：B1 段 **4/4 PASS**（`concurrency/`/`queue/` 由 FAIL 转 PASS）；B2 段 `contract.md`/`rules.md`/`handoff.md` 全部 FAIL 消除。**残留一条 FAIL：`reviewlog.md:5`，见下节，已停下报 CFO。**
- `bash ci/gates/run-gates.sh`：exit 0，全绿。

## 阻塞项：检测脚本对 `reviewlog.md` 的假阳性（已报 CFO，未自行处置）

脚本 B2 段扫描 `module_docs/` **全部**文件里的「只消费」字样。`module_docs/reviewlog.md:5` 是 reviewagent 本轮的台账条目，它**引用**这句错话是为了记录 finding 本身：「……但修复文本断言 copycat「只消费 transport/」为事实错误（另有 concurrency/ 7 处含 app.js:67、queue/ 3 处）」。这是**对错误的转述，不是文档在做断言**，脚本无法区分二者。

两点事实：

1. 该行与脚本**在同一个 commit `8452b88` 里被一起引入**（`git show --stat` 确认）。reviewer 的负控是在只含三份文件的临时树上跑的，因此从未看见自己的台账行会踩自己的脚本。
2. `module_docs/reviewlog.md` 是 **reviewagent 专属写属主**，项目级沙盒表明写「arbiter 禁写 `module_docs/reviewlog.md`」；且它是审核结论历史留痕，CFO 本轮明令保留原措辞。

因此我**既不能改脚本**（reviewagent 属主，CFO 明令「认为脚本有 bug 就停下报 CFO，不要自己动」）**也不能改那一行**（越权 + 改历史）。按 CFO 指令停下上报。建议的最小修法二选一，均须由 reviewagent 执行：
- (a) B2 段扫描范围排除 `reviewlog.md`（台账是历史留痕，天然会转述错话，不属规范性断言面）；或
- (b) 只扫 `contract.md`/`rules.md`/`handoff.md` 三份规范性文档白名单。

在此之前 `check-consumer-scope.sh` 无法达到 exit 0，且**任何人都无法在不越权的前提下让它 exit 0**——这不是本轮修法未做到位。
