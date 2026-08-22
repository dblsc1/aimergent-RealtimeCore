# governance-promotion · 打回复审（第 2 轮）

verdict: **rejected**

- Exact target：`9061648118fb3f94b27226970b2c119d434a059d..a6994bd612c2160e2eb7b9bfeac853b66f170203`（分支 `chore/governance-promotion`，`diff_mode=exact`）
- 复审增量：`a23b7f3..a6994bd`（首轮审核 commit 之上的唯一新 commit）
- 检测脚本：`review/reviewcode/module_docs/check-consumer-scope.sh`（本轮新增，含负控）
- 工作位置：worktree `.worktrees/gov-review2`，未触碰主检出与任何其它仓（copycat 只读）

---

## 一、首轮 issue 的闭环核实（必核 1 / 必核 4）

首轮唯一 issue（P2，`module_docs/rules.md:67`「真实持久化适配器…随首个消费方落地…无消费方时写适配器就是无处跑的死代码」）**已消除**。worker 声称矛盾共 4 处，自行 grep 核实结论如下（`command grep -rno`，file:line 级，排除 `.git`）：

| # | 位置 | 旧表述 | a6994bd 后 | 判定 |
|---|---|---|---|---|
| 1 | `module_docs/rules.md:67` | 「移交首个消费方落地期…无消费方时写适配器就是无处跑的死代码」 | 完整推理（唯一权威） | 已改 |
| 2 | `module_docs/rules.md:52` | 「真实持久化适配器（照端口契约）仍留随消费方落地」 | 指针 → P5 节 | 已改 |
| 3 | `module_docs/contract.md:249` | 「真实适配器…随首个消费方落地」 | 新触发条件 + 指针 | 已改 |
| 4 | `module_docs/handoff.md:35` | 「**真实持久化适配器**（随首个消费方）」 | 新触发条件 + 指针 | 已改 |

**是否有第 5 处漏网**：对 `持久化适配器`/`首个消费方`/`死代码`/`无消费方`/`随消费方`/`落地期` 六个关键词全仓扫描，`module_docs/` 内除上述 4 处 + 新增变更记录行（`contract.md:286`）外无其它命中。`contract.md:250`（copycat `classroom.js` L2 糖层「无生产消费方，抽了就是死代码」）经核**不构成矛盾**——它说的是"糖层这个具体面没有生产消费方"，恰好与本次新口径（按面判定）同构，属真话。

其余命中全部落在**历史留痕**（`codeagent/backend/docs/report.json:69`、`codeagent/backend/docs/worklog/2026-07-19-*.md`、旧 reviewreport），保留旧措辞是正确的——`无人改历史`（项目 AGENTS.md 文档体系），**不作为 issue**。

## 二、新口径本身是否站得住（必核 2）

新口径：触发条件 = 「`session/` 端口（logStore/snapshotStore）是否出现**生产环境实际消费者**」。

去 `/srv/aimergent/0/functions/copycat`（main，`5ffe4016ff84cc05f42735aa2bfcaacce0a67aea`）**只读实查**，不采信 worker 描述：

- ✅ **`sqlite-log-store.js` 确未接生产组合根**：`command grep -rn "sqlite-log-store" code/`（排除 node_modules）唯一命中 `code/backend/src/data/sqlite-log-store.property.test.mjs:24`。文件头注释自述 `intentionally not wired into copycat's composition root yet`。
- ✅ **`session/` 端口 0 个生产消费者**：全仓 `realtime-core/session` 的非测试命中只有 `sqlite-log-store.js` 自身（`session/errors`、`session/envelope`），而它未被任何生产文件引用。
- ⇒ **口径的核心结论成立**：以「`session/` 端口有无生产消费者」而非「有无任意消费方」作触发条件，是正确且更精确的判据；「不提供真实适配器」的决策维持不变，站得住。

**但是**——支撑这个口径的那句事实陈述是错的，见下节。

## 三、issues

### P2-1（contract / arbiter）「copycat 目前只消费 `transport/`」是事实错误，且与本文档集另一处硬冲突

**证据**（`review/reviewcode/module_docs/check-consumer-scope.sh` 机械产出，只统计非测试生产文件的真 import）：

```
== A. 消费方生产代码实际 import 的 realtime_core scope ==
  - concurrency/   (生产文件命中 7 处，例：code/backend/src/routes/teacher-rest.js)
  - queue/         (生产文件命中 3 处，例：code/backend/src/services/session-state/core/library.js)
  - session/       (生产文件命中 2 处，例：code/backend/src/data/sqlite-log-store.js  ← 未接组合根)
  - transport/     (生产文件命中 4 处，例：code/backend/src/services/realtime/library.js)
```

逐条生产命中（非测试）：
- `concurrency/locks`：`code/backend/src/app.js:67`、`routes/teacher-rest.js:28`、`routes/teacher-session-commands.js:21`、`routes/teacher-skill-commands.js:13`、`services/session-state/service.js:33`、`application/persona/operation-port.js:1`、`domains/basic/skill-routes.js:11`
- `queue/`：`services/session-state/core/library.js:4`（`queue/ordering`）、`:5`（`queue/ids`）、`services/session-state/operations/push.js:14`（`genTurnId`）

受影响行（本轮新写入的文字）：`module_docs/contract.md:249`、`module_docs/rules.md:67`、`module_docs/handoff.md:35`、`module_docs/contract.md:286`（变更记录复述）。

**这不是措辞瑕疵，而是与首轮同一类的铁律 11 全文一致性缺陷**：`module_docs/rules.md:65` 明写 `sessionLockKey`/`skillLockKey`/`orderedSessionEvents`/`maxEventSeq`/`genTurnId` 是「**copycat 换装期的硬依赖遗产面**」——这些符号正住在 `concurrency/locks` 与 `queue/ids`·`queue/ordering`。同一份 rules.md 里，L65 说 copycat 硬依赖这些面，L67 说 copycat「只消费 `transport/`」。修矛盾的 commit 又引入一处新矛盾。

**修法建议**：把三处指针里的消费范围事实**整句删掉**，只留「触发条件见 rules.md P5 节」；rules.md:67 的表述改为「`session/` 端口尚无生产消费者」（这才是本条债真正相关、且已核实为真的事实），不要去断言 copycat 消费了什么。

### P2-2（contract / arbiter）消费方清单漏登 `concurrency/` 与 `queue/`，直接削弱 CR 影响面评估

`module_docs/contract.md:269` 消费方清单行只登记 `transport/`、`session/`、`machine/` 三个面（脚本 B1 段：`concurrency/` FAIL、`queue/` FAIL）。该表在 L263 被明确声明为「**供 CR 评审时评估影响面**」——照现表，一个改 `concurrency/locks` 或 `queue/ids` 的 CR 会被评为「不影响 copycat」，而实际上 copycat 生产代码有 10 处 import（含 `app.js`）会被打断。

该缺陷源自首轮 candidate `d438e7a`，首轮审核漏检（首轮报告写「copycat … forwards only `transport/`」，同一错误）。本轮 candidate 未修，且把该错误从表格扩散到 contract 正文/handoff，**故本轮必须一并修**。

### P3-1（观察，不单独构成打回）四处改法的结构未真正消除漂移（必核 3）

「rules.md:67 放完整推理 + 三处短指针」的方向是对的，但**没有做到位**：三处"指针"里各自又嵌了一份**易变事实**（copycat 的消费范围），于是同一事实仍有 4 份独立措辞副本 —— 漂移向量原样保留，本次 P2-1 就是它当场发作的实证。

更深一层：本文档集现有**两个互相竞争的"消费范围事实源"**——`contract.md:269` 消费方清单表（被声明为清单权威）与 `rules.md:67`（被声明为触发条件权威），二者**当前已经互相矛盾**（表列 3 个面，正文说 1 个面）。结论：**只要事实副本 >1，指针结构就防不住漂移**。建议单一事实源 = `contract.md:269` 清单表；rules.md:67 只写判据（「`session/` 端口有无生产消费者，现状见 contract.md 消费方清单」），handoff/contract 非目标节只留纯指针、零事实。

## 四、脚本与防空转

新增 `review/reviewcode/module_docs/check-consumer-scope.sh`（只读，不改任何文件）：
- A 段：从消费方仓生产代码机械提取实际消费的 realtime_core scope 集合（排除 `*.test.mjs`/`*test-helpers*`/注释行，支持多行 import 续行 `} from '…'`）。
- B1 段：逐 scope 核 `contract.md` 消费方清单是否登记。
- B2 段：扫 `module_docs/` 全部「只消费 …」排他断言，与 A 集合比对。

**负控（防空转）**：把 module_docs 三文件复制到临时树、按建议修法改正（删排他断言 + 补两个 scope 行）后重跑，脚本 **exit 0 / RESULT: PASS**；对当前 candidate 则 exit 1 并精确点名 `concurrency/`、`queue/`。证明其具判别力、非恒红。

## 五、肉眼审项及其「为何不能代码化」

- **「新口径本身是否站得住」**（必核 2）：这是设计判断题——判据该选"任意消费方"还是"该端口的生产消费者"，属规范性取舍，无机械真值可算。可代码化的部分（copycat 是否真的没接组合根、`session/` 是否真的 0 生产消费者）**已经代码化并跑过**（见二节与脚本 A 段）。
- **「指针结构能否防未来漂移」**（必核 3）：对未来的反事实推断，不可机械判定；但其**当下征兆**（事实副本数 >1、两个权威源已互相矛盾）已由 B1/B2 段机械抓到。

## 六、门禁

`bash ci/gates/run-gates.sh` → 见 worklog 记录的实跑输出（exit 0）。

## 七、结论

**rejected（第 2 次打回，已达铁律「上限 2 次」）**。首轮点名的矛盾确已消除，新口径的核心判据成立且经独立实查，但修复文本自身引入/扩散了同一类别（铁律 11 全文一致性）的事实错误，并且暴露出消费方清单漏登两个面这一**影响 CR 影响面评估**的实质缺陷。修法很小（删三处事实副本 + 补两行清单），但必须修完再合。

按角色纪律，下一轮若仍不通过须升级 CFO 裁决；`escalation` 字段已如实标注打回上限已达。
