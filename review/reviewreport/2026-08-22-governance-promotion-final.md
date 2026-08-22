# governance-promotion · 终审（第 3 轮）

verdict: **approved**

- Exact target：`9061648118fb3f94b27226970b2c119d434a059d..0839cbf9dc9363208d361b8de9afb06c0fc98dc5`（分支 `chore/governance-promotion`，`diff_mode=exact`）
- 本轮增量：`8452b88..0839cbf`（第 2 轮审核 commit 之上的唯一新 commit，arbiter 执行 CFO 定点裁决）
- 轮次说明：**同一任务第 3 轮**。前两轮均 rejected，铁律「同一任务打回上限 2 次」已于第 2 轮触发并升级 CFO；CFO 维持打回、下达定点修法并裁决续跑，本轮为该裁决下的终审。
- 工作位置：worktree `.worktrees/gov-review2`；主检出 `/srv/aimergent/0/realtime_core` 全程未碰，`functions/copycat` 全程只读。

---

## 零、先修脚本自身的缺陷（本轮第一件事）

第 2 轮我新增的 `review/reviewcode/module_docs/check-consumer-scope.sh` 在完整 worktree 上残留一条 FAIL：

```
FAIL  reviewlog.md:5 断言「只消费 ?」，但生产代码还消费了: concurrency queue session transport
```

**这是脚本缺陷，不是文档缺陷**。`module_docs/reviewlog.md:5` 是我自己第 2 轮的结案台账行，为记录 finding 而**引述**了那句错误断言（「…但修复文本断言 copycat『只消费 transport/』为事实错误…」）。B2 段按字面抓「只消费」，分不清**规范性断言**与**对断言的引述**，于是判了审核台账自己。

根因复盘（写进本报告以免重演）：`reviewlog.md` 与该脚本由**同一 commit `8452b88`** 引入，而我前一轮的负控跑在只含 `contract.md`/`rules.md`/`handoff.md` 三文件的临时子集树上——**子集负控看不见自己的台账绊倒自己的脚本**。教训：负控必须跑在**完整树**上。

### 修法

B2 段改为按**文件角色**区分断言与引述：扫 `module_docs/` 全部文档，**排除审核历史留痕 `reviewlog.md`**（append-only 台账，按项目 AGENTS.md「无人改历史」不得回头改写，其内容天然含被打回文本的引述）。

关键取舍——**用 denylist 而非 allowlist**：`module_docs/` 下**新增**的任何规范性文档自动纳入扫描，不会因为没写进白名单而漏检；检测力只对 `reviewlog.md` 这一个文件让步。（arbiter 在其 escalation 里给的两个选项中，(b) 三文件白名单会在新增文档时静默漏检，故未采纳。）

同时**顺带加强**（不是削弱）解析：原 B2 只认反引号包裹的 scope（`` `transport/` ``），碰上不带反引号的写法会把 claimed 解析成空、输出「只消费 ?」这种无信息量的 FAIL。改为反引号/裸写皆认（`` `transport/` `` / `` `transport` `` / `transport/`），负控③即验证了这一路径。

被跳过的行会打印 `skip` 行留痕，不静默吞掉。

### 负控（本轮硬要求：**跑在完整 worktree 上，不是临时子集树**）

| # | 场景 | 期望 | 实际 |
|---|---|---|---|
| ① | 当前 `0839cbf` 原样状态 | exit 0 | **exit 0**，`RESULT: PASS`；B1 4/4 PASS；B2 `skip reviewlog.md:5` + `PASS 规范性文档中无「只消费 …」排他断言` |
| ② | 就地在 `module_docs/rules.md` 塞回「copycat 只消费 \`transport/\` 层」（带反引号） | exit 1 且点名文件 | **exit 1**，`FAIL rules.md:65 断言「只消费 transport」，但生产代码还消费了: concurrency queue session` |
| ③ | 就地在 `module_docs/contract.md` 塞回「copycat 只消费 transport/ 一个面」（**不带反引号**，测强化后的解析） | exit 1 且点名文件 | **exit 1**，`FAIL contract.md:251 断言「只消费 transport」，但生产代码还消费了: concurrency queue session` |

②③ 均为**就地注入完整 worktree**、跑完立即 `git checkout --` 还原；还原后 `git status --porcelain module_docs/` 无输出、脚本重跑 exit 0。注入文本**未进任何 commit**（本轮 commit 的 diff 只含 `check-consumer-scope.sh` 与我自己的四份产物，可核）。

结论：脚本具判别力、非恒绿也非恒红，且对新增规范性文档 fail-closed。

---

## 一、复审 `0839cbf`：CFO 点名的 4 处

| # | 位置 | 判定 | 证据 |
|---|---|---|---|
| 1 | `contract.md:249`「明确非目标」 | ✅ 排他断言整句删除，只留触发条件 + 指向 rules.md P5 + 声明消费范围唯一事实源为消费方清单表 | 见 diff |
| 2 | `rules.md:67` P5 技术债 | ✅ 判据改述为「本条真正相关的 `session/` 端口（logStore/snapshotStore）截至目前仍是 0 个生产环境实际消费者」——**判据不变，不再靠假话支撑**；末尾加「消费范围唯一事实源是 contract.md 清单表，本条只写判据不复述」 | 见 diff |
| 3 | `handoff.md:35` 技术债条 | ✅ 改为纯指针（「详见 rules.md P5 节；copycat 实际消费范围见 contract.md 消费方清单表」） | 见 diff |
| 4 | `contract.md:269` 消费方清单表 | ✅ 补登 `concurrency/`（`locks`，7 处生产 import 逐条列 file:line 含组合根 `app.js:67`）与 `queue/`（`ordering`/`ids`，3 处）；另在 L271 补**核实基准**（copycat main `5ffe401` + 统计口径「非测试文件真 import」+ 检测脚本路径），使复核可复现 | 脚本 B1 段 4/4 PASS |
| 5 | `contract.md:286`（旧变更记录复述行） | ✅ 该行内的「但只消费 `transport/`」删除 | 见 diff |

**关于修改一条历史变更记录行（第 5 项）**：`contract.md` 的变更记录表是**契约文档自身的一部分**（arbiter 写域），不是 worklog/reviewreport 那类不可回改的审核留痕。留着它等于在契约里留第 N 份假事实副本；且本轮新增了 2026-08-22 一行完整记录本次订正的来龙去脉，历史可追。**判定：正确，非改写留痕。**

B1 段机械核验：`concurrency/`、`queue/`、`session/`、`transport/` 四个面全部已登记（本轮前两个为 FAIL）。

## 二、arbiter 自报的 3 处**额外**改动 —— 该不该改、改得对不对

这 3 处不在 CFO 清单里（不含「只消费」字样，B2 段抓不到），由 arbiter 铁律 11 全文自查抓出。逐条核：

| 位置 | 改前 | 改后 | 判定 |
|---|---|---|---|
| `rules.md:9`（工作模式·升级条件回顾） | 「已通过 git tag…**真实消费 `transport/` 层**——`src/services/realtime/library.js` 逐符号转发，详见 contract.md 消费方清单」 | 「真实消费**本库**——`package.json` 固定依赖；**具体消费了哪些面，以 contract.md 消费方清单表为唯一事实源**」 | ✅ **该改，且改得对**。原文是同一错误断言的第 5 份副本（且同样漏 `concurrency/`+`queue/`）。改后保留了该条**真正要论证的命题**（升级条件「出现第一个外部消费方」已满足），零事实副本。 |
| `handoff.md:7`（一句话概述） | 「实际消费 `transport/` 层——`session/`/`machine/` 端口目前未被消费方接入生产，详见 contract.md…」 | 「git tag 固定 `v1.0.1`；**其实际消费了哪些面，唯一事实源是 contract.md 消费方清单表，本文件不复述**」 | ✅ **该改，且改得对**。前半句「实际消费 transport/ 层」同样为假（第 6 份副本）。后半句「`session/`/`machine/` 未接生产」虽为真，但它是判据类事实、权威在 `rules.md` P5，放在 handoff 概述里是第二份副本；削成纯指针无信息损失。 |
| `rules.md:52`（P3b 条尾） | 「…触发条件与现状见 P5 节技术债（**首个消费方已存在但尚未消费 `session/` 端口**）」 | 「…触发条件与现状见 P5 节技术债。」 | ✅ **该改，且改得对**。括号内是判据事实的第 7 份副本，权威在 P5；删括号后指针依然完整可达。 |

**是否越界？判定：否。** 三点理由：

1. **写域**：`module_docs/rules.md`、`module_docs/handoff.md` 均由 arbiter 独占维护（`0/AGENTS.md` 角色沙盒表 + 本模块 AGENTS.md 文档地图），arbiter 未碰 `code/`、未碰 `review/`、未碰 `reviewlog.md`（`git show --name-only` 可证）。
2. **纪律要求**：铁律 11 明写「**查文档结构、把所有关联文档一并改到位**……不许只改一处、留别处掉队」。前两轮被打回的正是「只修被点名的、别处掉队」。若 arbiter 只改 CFO 点名的 4 处、留下这 3 份同一易变事实的副本，**下一轮我就该以铁律 11 再打回它**。
3. **同一逻辑任务**：3 处与 CFO 点名的 4 处是同一根因（消费范围事实多副本）、同一 commit、commit message 与 report.json 逐条自报，可审计。

**我的独立结论与 CFO 的倾向一致：该改。** 未采信 arbiter 自述，三处均自行 diff 逐字核对。

## 三、单一事实源结构是否真的立住

判据：`module_docs/` 里「copycat 消费了哪些面」这个易变事实，是否**只在 `contract.md:269` 清单表一处**，其余全部零事实指针。

全 `module_docs/` 关键词扫描（`command grep -n 'transport/\|concurrency/\|queue/\|只消费\|消费范围\|实际消费\|真实消费\|消费方清单\|消费了'`，逐条人工归类）：

| 命中 | 性质 | 是否事实副本 |
|---|---|---|
| `contract.md:269` | **消费方清单表**（唯一事实源，含 file:line 与核实基准） | — 权威本体 |
| `contract.md:5` / `:249`、`rules.md:9` / `:26` / `:52` / `:67`、`handoff.md:7` / `:35` | 纯指针或只写判据 | ❌ 零事实副本 |
| `contract.md:30/46/53/61/67/80/84/91/127/227-231`、`rules.md:22/26(纯度门)/34`、`handoff.md:13/30` | 描述 **realtime_core 自身**的目录/符号/纯度门 scope，与「消费方消费了什么」无关 | ❌ 不同事实域 |
| `contract.md:250` | copycat `classroom.js` L2 糖层「无生产消费方」——说的是**本库某个面有无消费方**，第 2 轮已核为真话 | ❌ 非本事实 |
| `reviewlog.md:5` | 审核台账**引述** | ❌ 历史留痕，不得改 |

**判定：立住了。** 事实副本数从 7 降到 1，第 2 轮 P3-1 指出的「两个互相竞争的事实源」（清单表 vs rules.md:67）已消解为「表 = 事实，P5 = 判据」的正交分工。B1 段脚本已把这唯一事实源钉在机械核验上——表漏登任何一个面即 FAIL。

**未发现第 8 处漏网。**

## 四、其余必核项

| 必核项 | 判定 | 证据 |
|---|---|---|
| `rules.md:65`（符号中性化条，第 2 轮认定为正确、不该动） | ✅ **未被改** | 与 base `9061648` 上同一行（彼时 L58）逐字符比对 `IDENTICAL-TEXT` |
| 代码零改动 | ✅ | `git diff --name-only --no-renames 9061648..0839cbf` 全部 14 项无一落在 `code/`；arbiter commit 仅 6 文件（3 份 module_docs + 自己的 report/worklog/diary） |
| 历史留痕未被回头改写 | ✅ | `0839cbf` 未触及 `codeagent/backend/docs/report.json`、任何旧 worklog、任何旧 reviewreport（`git show --name-only` 可证；这三类也不在其 6 文件内） |
| `review/` 未被 arbiter 触碰 | ✅ | 同上，`review/` 零命中 |
| 消费范围事实本身 | ✅ 独立复核 | 去 `functions/copycat` main `5ffe4016ff84cc05f42735aa2bfcaacce0a67aea` 只读实查（脚本 A 段机械提取）：`concurrency/` 7 处、`queue/` 3 处、`session/` 2 处（仅 `sqlite-log-store.js`，未接组合根）、`transport/` 4 处、`machine/` 零命中——与表中登记逐条一致 |
| 门禁 | ✅ | `bash ci/gates/run-gates.sh` → **exit 0**，7 道门全绿（commit 归属 / canonical report schema / 禁默认值 / 老仓路径 / 单文件行数 / gitleaks / 模块 reviewcode） |
| 模块检测脚本 | ✅ | `bash review/reviewcode/module_docs/check-consumer-scope.sh` → **exit 0**（脚本修正后；负控三向已验判别力） |
| commit 归属（铁律 14） | ✅ | `0839cbf` trailer `Agent-Attribution: arbiter@realtime_core+governance-promotion`，唯一且合法（gate 已机械核） |

## 五、遗留（不构成打回，交 CFO 处置）

1. **arbiter 的 canonical `report.json` 仍是 `status: "blocked"`**，其 `escalation` 内容为「硬验收 `check-consumer-scope.sh exit 0` 在 arbiter 权限内不可达」。该阻塞**已被本轮脚本修正解除**（脚本现 exit 0，且**无需再改任何 `module_docs`**）。文档面本身我判 approved；arbiter 报告的 `blocked` 是否需要在合并前刷成终态，属 CFO 的交接判断，我不越权替它改（`codeagent/arbiter/docs/` 非我写域）。
2. **`module_docs/reviewlog.md` 表格结构修复**：第 2 轮的两行台账被追加在表头**之上**（L4-L5，孤行，markdown 渲染不成表）。本轮我把这两行**逐字不改地**移入表体正确位置并按日期续写本轮行。内容零改动、只修渲染结构；属我的写域。因此 arbiter/CFO 报告里引用的「`reviewlog.md:5`」在本轮后行号变化，原文可在 `8452b88` 复原。
3. **跨模块（沿用第 2 轮，仍未处理，非本模块可修）**：`functions/copycat` 自己的 `module_docs/contract.md:26` 声称消费 `defineMachine`，但 copycat 全仓 grep 零命中——copycat 侧契约文本存疑，建议 CFO 知会 copycat arbiter 核实。
4. **（arbiter findings_not_in_scope 转述，已复核属实）** `0/deploy/CONTRACTS-INDEX.md:4` 概括句仍未列举 realtime_core（矩阵表与反查表本身已正确收录），属 CFO 维护范围。

## 六、肉眼审项及其「为何不能代码化」

- **「arbiter 那 3 处额外改动算不算越界」**（第二节）：越界与否是**权限与纪律的判断题**——同一改动落在写域内、由铁律 11 要求、还是顺手扩大范围，三者的区别是规范性判断，无机械真值可算。可代码化的部分（改了哪些文件、有没有碰 `code/`/`review/`/历史留痕）**已经代码化并跑过**（`git show --name-only`、`git diff --name-only`、gates 的归属门）。
- **「单一事实源结构是否真的立住」**（第三节）：需要逐条判定每处命中「是事实副本还是指针/不同事实域」，这是语义分类，无法纯字面判定。但其**最要命的那一面已代码化**——B1 段把唯一事实源（清单表）与 copycat 生产代码的实际集合钉死，B2 段把规范性文档里的排他断言钉死，任一漂移即红。

## 七、结论

**approved。**

前两轮点名的全部 P2 已闭环：事实错误已删、判据已改述为真命题、消费方清单已补登两个面并给出可复现核实基准、第 2 轮 P3-1 观察项（多副本 + 竞争事实源）也被一并根除。arbiter 那 3 处额外改动经独立核对属铁律 11 要求范围内、未越界、改得对。本轮唯一的新问题是**我自己脚本的假阳性**，已在我的写域内修好，并按硬要求在**完整 worktree** 上跑通三向负控。

放行范围：`9061648..0839cbf` 文档面 + 本轮我的审核产物。合并前请 CFO 处置第五节第 1 项（arbiter 报告 `blocked` 终态）。
