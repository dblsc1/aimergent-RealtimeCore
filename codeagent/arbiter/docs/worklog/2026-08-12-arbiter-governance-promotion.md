# 2026-08-12 · arbiter · governance-promotion

## 任务

CFO 指派：realtime_core 自己的 `contract.md`（§治理状态）、`rules.md`（§工作模式）、`handoff.md` 仍写着"轻量、在 `dev/` 孵化、等待转正"，但平台层转正（物理迁入 `0/`、CONTRACTS-INDEX、CI 白名单）据称已在 2026-07-20 完成，`functions/copycat` 也已把它当正式钉版依赖在用。任务要求：**先自己核实**转正三项是否真的完成，再更新三份文档为"已转正/受治理"状态，写明触发条件证据、受治理后的具体规则（契约冻结、变更走 CR）、消费方清单（须实查，不许写"待补"）；若发现转正其实没做完，据实报告不要粉饰。

## 核实过程与证据（独立验证，不直接采信既有《技术债台账复审报告》的结论，只把它当线索）

1. **物理位置**：`ls /srv/aimergent/0/realtime_core` 确认仓在位（`.git` 存在，`origin` = `github.com/dblsc1/aimergent-RealtimeCore.git`）；`find /srv/aimergent/dev -maxdepth 2 -iname "*realtime*"` 零命中，确认 `dev/realtime_core/` 已不存在。
2. **CONTRACTS-INDEX**：`command grep -n -i realtime /srv/aimergent/0/deploy/CONTRACTS-INDEX.md` 命中模块矩阵第 13 行 + 反查表第 33 行，两处均已登记（provides/consumes/契约来源四列齐全，反查表已列 `copycat` 为消费方）。
3. **CI 白名单**：`command grep -n -i realtime` 分别命中 `0/ci/install-ci.sh:26,62`、`0/ci/merge-to-main.sh:18`、`0/ci/repo-status.sh:136`，均已把 `0/realtime_core` 放入路径 case 白名单（L1-platform 分层）。
4. **溯源 commit**：`git log --oneline -- deploy/CONTRACTS-INDEX.md ci/install-ci.sh ci/merge-to-main.sh ci/repo-status.sh AGENTS.md`（在 `0/` 仓）定位到两次治理提交：
   - `e19d903`（PR #27，"realtime_core 转正为平台层模块 L0 文档同步"，2026-07-20，trailer `cfo-arbiter@aimergent+realtime-core-promotion`）：改了 `.gitignore`/`AGENTS.md`/`README.md`/`ci/repo-status.sh`/`deploy/CONTRACTS-INDEX.md`/`deploy/runbooks/git-governance.md`/`docs/1 structure/README.md`/`docs/manual/README.md` 共 8 个文件。
   - `86d3057`（PR #28，"realtime_core CI 注册 + Step-5 留痕 + maze 翻牌 git化"，2026-07-20，trailer `cfo-arbiter@aimergent+rtc-machinery-gitify`）：补了 `ci/install-ci.sh`、`ci/merge-to-main.sh` 两处白名单（`e19d903` 当时未动这两个文件）。
   - `git show --stat` 逐一核对两次 commit 的改动文件列表，与我独立 grep 到的当前状态一致；`CFO_agent/consulter/docs/findings/2026-07-20-realtime-core-promotion-review.md` 是 PR#27 的独立审核报告，结论 `APPROVED`，且明确记录了"`install-ci.sh`/`merge-to-main.sh` 当时未加白名单，是记录在案的分阶段延后，非遗漏"——与 PR#28 随后补齐的事实吻合。
5. **辅助文档同步**：`0/AGENTS.md`（顶层结构树 + 铁律8 平台清单）、`0/docs/1 structure/README.md`、`0/docs/manual/README.md`、`0/deploy/runbooks/git-governance.md` 均已列出 `realtime_core`（逐一 grep 核对，非转正三项本身，但一并核实证明 e19d903 的铁律11 覆盖面确实完整）。
6. **消费方**：`command grep -n realtime /srv/aimergent/0/functions/copycat/code/backend/package.json` 命中 `"@aimergent/realtime-core": "git+https://github.com/dblsc1/aimergent-RealtimeCore.git#v1.0.1"`；对 `0/functions/`、`0/web_modules/` 全量 grep `@aimergent/realtime-core` 与 `aimergent-RealtimeCore`（排除 `.worktrees/`、`node_modules/`）确认**只有 copycat 一个消费方**，无第二家。
7. **消费范围细查**（不满足于契约文本自称，逐文件核实真实 import，这是本次核实里发现有价值细节的地方）：
   - `functions/copycat/code/backend/src/services/realtime/library.js` 逐符号转发 `transport/` 四文件（`poll-machine`/`dispatch`/`engine`/`channels`），文件头注释自述"Every symbol is forwarded from the pinned realtime_core package's public exports"。
   - `createPollRegistry` 在 `src/application/home/home-realtime-wiring.js` 被真实 import 使用（owner-key 顶替，F2 presence）。
   - `src/data/sqlite-log-store.js` 实现了 `session/` 的 logStore 端口 SQLite 适配器，但文件头注释自述"intentionally not wired into copycat's composition root yet; Step-5 R3b will decide"；我对 `src/` 全量 grep（含 `app.js`）确认除该文件自身与其测试文件外**无第二处 import**——独立验证了代码注释的说法，不是照抄注释。
   - **`defineMachine`／`machine/` 目录：全仓 grep 零命中**。这与 copycat 自己 `module_docs/contract.md:26` 的原文"owner-key 顶替/`defineMachine`（Step-5 R1 起消费）"不符——copycat 侧的契约文本声称消费了 `defineMachine`，但代码里没有任何 import。这不是我能改的（那是 copycat 模块的契约，不在本次写域），如实记录，见下方"发现但未处理"。
8. **tag 核实**：`git tag -l` 见 `v1.0.0`（2026-07-19）、`v1.0.1`（2026-07-20）；`git show v1.0.1 --stat` 确认只改了仓根 `package.json`（加 exports map 使库可作 git 依赖安装），无 API 面变化，是合规 patch；`git merge-base --is-ancestor <tag-commit> main` 确认两枚 tag 的落点commit 均在 main 分支历史上（非孤儿 tag）。

**结论：转正三项（物理位置、CONTRACTS-INDEX、CI 白名单）全部属实、证据具体到 commit/文件/行号，无缺项。** 与既有《技术债台账复审报告》"前提已失效"第 6 条的判断方向一致，但本次是我独立复核（自己重新 grep/git log/git show，未直接照抄该报告的结论），且额外查清了此前该报告未细查的"copycat 到底怎么消费"的具体范围（`transport/` 已用、`session/` 写了未接、`machine/` 未消费）。三份 module_docs 在此之前**从未同步**这一状态，是纯文档滞后（"专门做过的治理动作没被模块自己的文档记录"），不是转正本身有缺口——因此任务性质不变，是纯文档同步，不升级为"先补完转正"。

## 改动

- `module_docs/contract.md`：
  - 治理状态段落（原第5行）改写为 governed + 逐项证据（commit/PR号/文件路径行号）。
  - 文末新增"治理与变更控制"节：契约冻结定义、变更走 CR 的具体流程、消费方清单表（含 `transport/`/`session/`/`machine/` 三个 scope 的真实消费现状，不是笼统"copycat 消费"一句话）、"未发现第二个消费方"的搜索范围说明。
  - "变更记录"表新增一行记录本次同步。
- `module_docs/rules.md`：
  - "工作模式"段落改写为 governed + 两条升级条件的证据。
  - "跨仓依赖机制"段落更新：当前消费方 + 两枚 tag 的状态（不再是"未来消费方"的预告性措辞）。
  - P5 路线图节"移交项"补 ✅ 标记（原文字面仍是"待 CFO 治理流程"，不改会与"工作模式"新写的 governed 状态在同一文件内自相矛盾）。
- `module_docs/handoff.md`：
  - "一句话"摘要移除"孵化于 `dev/`"措辞，改为 governed + 仓路径 + 唯一已核实消费方一句话。
  - "路线图"结尾段落"移交 CFO 的两件事"标记为均已完成 + 证据指路（tag 已打、L0 doc-sync 已完成）。

**未改**：`code/`、`review/`（任务单禁止，且本任务本来就不涉及代码）；`codeagent/arbiter/AGENTS.md`"本模块特有"占位符（任务单写域只列了三份 module_docs，未含此文件，留待后续任务视需要填）。

## 发现但未处理（据实报告，不擅自跨界改）

1. **copycat 自己的契约文本与代码不符**：`functions/copycat/module_docs/contract.md:26` 声称消费 `defineMachine`（"owner-key 顶替/`defineMachine`（Step-5 R1 起消费）"），但全仓 grep `defineMachine`/`realtime-core/machine` 零命中。这是 copycat 模块自己的契约维护问题，不是 realtime_core 的职权范围，本次未碰 copycat 任何文件，仅在此记录、在 report.json 里知会 CFO。
2. **`0/deploy/CONTRACTS-INDEX.md:4` 头部说明句仍未提 realtime_core**："本索引聚合已迁完的 auth、llm、market_data、stock、spy"没有把 realtime_core 加进这句列举（模块矩阵表和反查表本身都已正确收录，只是这句概括性开场白没扩写）。consulter 在 2026-07-20 审核 PR#27 时已经发现并记录为"非阻断，留 CFO 收尾时顺手做"。`CONTRACTS-INDEX.md` 属 CFO 维护范围，不在本模块 arbiter 写域内，本次未改，仅重申此待办仍未处理。

## 自检

- 无代码改动：`code/`、`review/reviewcode/` 均未触碰，`check-kernel-purity.mjs`、`node --test`（既有 201 用例）预期不受影响，本次未重跑（无改动面）。
- `bash ci/gates/run-gates.sh`：见 `codeagent/arbiter/docs/report.json` 的 `self_check` 字段与本 worklog 底部命令输出。
- 全文一致性自查：改动后通读三份文件，确认"governed"措辞在三处一致、无处再出现"待 CFO 治理流程"/"孵化于 dev/"等旧措辞（`command grep -rn "待CFO治理流程\|孵化于.*dev\|lightweight" module_docs/contract.md module_docs/rules.md module_docs/handoff.md` 只命中历史变更记录表里"当时"的历史陈述行，不是当前状态声明，予以保留——历史行本就该保留原文）。

## 打回复核（reviewagent 首轮审核，P2，2026-08-12）

**打回理由**（reviewagent `review/reviewreport/2026-08-12-governance-promotion-review.md` + CFO 独立核实转发）：`module_docs/rules.md:67`（P5 技术债列表）仍写"真实持久化适配器⏭移交首个消费方落地期……无消费方时写适配器就是无处跑的死代码"，但同一版本的候选（本任务本轮）自己在"治理与变更控制"节把 `copycat` 登记为首个消费方并钉 `v1.0.1`——"等消费方出现"与"消费方已经在这儿了"在同一份文档集里并存，铁律11 全文一致性未过。CFO 转发时额外指出这条不是孤例：`rules.md:52`（P3b 段落末尾）、`contract.md:249`（明确非目标）、`handoff.md:35`（技术债余额）都有同一句式"随（首个）消费方落地"/"随首个消费方"，四处需要一并核对，不能只改 reviewagent 点名的那一行。

**根因（如实记录，不粉饰）**：我上面"自检"小节的全文一致性自查只 grep 了我自己新写/改写过的几个关键词（"待CFO治理流程""孵化于dev""lightweight"），没有反向检查"我新写的内容是否与文件里我没碰过的旧段落矛盾"。P3b/P5/明确非目标/技术债余额这几段是历史遗留内容，本轮任务单范围原本只要求"治理状态"同步，我判断这些技术债条目"不在本次任务范围"因而没有触碰、也没有把它们纳入一致性扫描——但铁律11 的"改一处先扫全文"不是"只扫我自己改的地方"，是扫**整份文件**，一旦我在同一份文件里新增了会与旧内容冲突的陈述，就必须把旧内容也扫一遍。这是本轮学到的具体教训，不只是"这一条债务表述过时"这么简单。

**核实与修正**：`command grep -n "持久化适配器\|随首个消费方\|随消费方\|无消费方" module_docs/contract.md module_docs/rules.md module_docs/handoff.md` 精确定位到 4 处（contract.md:249、rules.md:52、rules.md:67、handoff.md:35），逐一修正为同一套准确表述：**触发条件从"是否存在任意消费方"改为"`session/` 端口（logStore/snapshotStore）是否出现生产环境实际消费者"**——copycat 已落地但目前只消费 `transport/`；其自己写的 `code/backend/src/data/sqlite-log-store.js`（logStore 端口 SQLite 实现）按其 Step-5 R3b 决定尚未接入生产组合根，只被自己的测试文件引用（`git grep` 全 copycat `src/` 复核确认无第二处 import）；`session/` 端口截至目前仍是 0 个生产消费者。**决策本身不变**（本库仍不提供真实持久化适配器，只有端口契约+内存参考实现），只是触发条件的措辞从过时（"等任意消费方"）改为准确（"等 session/ 端口的生产消费者"）——这正是 CFO 给的方向："按端口区分而非按有无消费方"，核实后认为完全适用，未提出不同意见。四处里把完整推理放在 rules.md:67（技术债列表，最权威的位置），其余三处改成指向它的短指针，避免以后四处独立措辞又各自漂移。

**处置**：以同一 arbiter 身份、同一分支 `chore/governance-promotion` 追加 commit（不新开分支，trailer 沿用 `arbiter@realtime_core+governance-promotion`），不影响铁律14/15。

## 关于"曾直接写主检出"（llm_services 任务的流程事故，CFO 裁决记录于此，避免散落）

这是 llm_services（B 项）任务中发生的事，不是本模块（realtime_core，A 项）的事故，但 CFO 要求在处理这次打回时一并把裁决记录清楚：任务开始时误在 llm_services 主检出（`main` 分支）直接改了 4 个文件，中途 `git add -A` 暂存过一次，**从未 commit、从未 push**。发现遗漏 worktree 后自行纠正（详见 llm_services 仓 `codeagent/backend/docs/worklog/2026-08-12-backend-log-retention.md`）。CFO 独立用 git 核验后裁决：**不构成打回**——①在 CFO 介入前已自己发现并完整纠正；②git 核验 main 干净、零多余 commit、reflog 无 commit 记录；③worklog 如实披露未隐瞒。**根因**：先动文件、后建 worktree——正确做法是把"建 worktree"当作动第一个文件之前的第 0 步，而不是改完发现漏做了再回头补。这条记录本身不删除、不淡化，按 CFO 要求原样留痕。
