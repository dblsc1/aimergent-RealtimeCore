# 2026-08-12 · reviewagent · sync-ci-gates-review（realtime_core）

## 任务
CFO 派发的批量任务：15 个模块仓的 `chore/sync-ci-gates` 分支同步 CI 门禁（5→7 道 + check-report-schema.sh 的 status 按角色分档新枚举）。本仓（`realtime_core`，batch=R）candidate head `809cb3bba02276046d5a564096d13495f99cb3ab`，base(origin/main) `e6d1808e9d833b8f07cff9e29c3693019b3b676b`。任务书：`/home/xia/.claude/jobs/4fc91805/tmp/gate-review-task.md`；CFO 中途把范围从 11 仓扩到 15 仓（补 ai_cad/copycat/auth_services/market_data 这批"已有7道门但status枚举是旧版"的仓）。

## 做了什么 / 为什么

1. 先读 `0/AGENTS.md`、`0/roles/reviewagent.md`、`0/roles/report-schema.md`，确认沙盒范围（review/、module_docs/reviewlog.md、codeagent/reviewagent/docs/；对 code/ 只读；不碰主检出）。
2. 铁律17 是本任务重点：15 仓 diff 高度同构，写了一个批量核验脚本 `gate-review-verify.sh`（`/home/xia/.claude/jobs/4fc91805/tmp/gate-review-verify.sh`），单次跑完全部 15 仓的 7 类机械核验（diff 范围/exact-set、整文件逐字节比对母本、豁免清单未污染、self_checked+bash -n 语法、run-gates.sh+run-tests.sh 本地全绿、commit 归属 trailer），未逐仓肉眼看 diff。RUNNER_TEMP/PIP_CACHE_DIR 按任务书提示指向 `/srv/aimergent/.sys/{tmp,pipcache}` 绕开 2.7G tmpfs。15 仓机械核验**全部通过，零 FAIL、零 WARN**（脚本 exit 0）。
3. 逐字节比对**整文件**而非只看新增 hunk（上一轮 ai_cad 审核的教训）：对全部 5 个门禁机制文件（含不在本仓 diff 里的），无条件与 `/srv/aimergent/0/ci/...` 母本 `diff`，确认零漂移。
4. 新门禁有效性抽验（任务书要求抽 2~3 仓，不必 15 仓都做）：写 `gate-effectiveness-test.sh`，用 `git hash-object`/`read-tree`/`commit-tree` 纯 plumbing 在内存中合成一次性 commit（不落分支 ref、不碰工作区/索引），构造"status 与 base 不同的非法值"，跑 `AIMERGENT_REPORT_BASE=<base> AIMERGENT_REPORT_HEAD=<合成commit> bash ci/gates/check-report-schema.sh`确认非 0 退出——特别注意任务书提醒的坑：测试值必须与 base 不同，否则文件不在 diff 内、门禁会跳过报"全部合规"（这是铁律12 的既定设计边界，不是门禁缺陷）。抽样：ai_aircombat（batch A，reviewagent 写 self_checked）、ai_cad（batch B，同测试，验证单文件替换本身即生效）、realtime_core（首次安装，worker 写完全非法字符串）——三仓覆盖本次改动的三种形态，全部正确拒绝（exit 非 0）。额外加了 2 个正控（verdict 角色换合法值、worker 角色写 self_checked 应放行）确认门禁不是无差别拒绝，两个正控均正确放行（exit 0）。
5. realtime_core 的豁免清单判断题：`git ls-files`/`ls` 核实豁免清单里引用的 L0/其它模块专属路径（`docs/0_problems_before_move/`、`deploy/nginx/portal/turbowarp-{editor,app}/`、`CFO_agent/`、`docs/1 structure/README.md`、`deploy/handoff-staging-testfixes.md`、`deploy/runbooks/prod-data-migration.md`、`code/backend/characterization/package.json`）在本仓**全部不存在**；结合豁免清单与 L0 母本逐字节相同（非本仓自造弱化），判断：接受，不阻断本次门禁同步；登记轻量文档债务建议供 arbiter 后续裁剪（reviewagent 无 module_docs/rules.md 写权限，不越界代写）。详细推理见 `review/reviewreport/`。
6. 产出：`codeagent/reviewagent/docs/report.json`（embedded-self-v2，review_target exact 对齐 base/head/changed_files）、`review/reviewreport/2026-08-12-sync-ci-gates-review.md`、`module_docs/reviewlog.md` 追加一行、本 worklog。 commit 但不 push（钩子限制 reviewagent 无 push 权限，按任务书要求把 SHA 交给 CFO 代推）。

## 结论

approved。chore/sync-ci-gates 是 realtime_core 首次安装 CI 门禁：.github/workflows/ci.yml + 全部 6 个 ci/gates 文件 + ci/hooks/commit-msg 从无到有，与 L0 母本逐字节相同，已含 7 道门 + status 新枚举（self_checked）。豁免清单（legacy-path-exempt.txt/remote-test-exempt.txt/.gitleaks.toml）沿用 L0 默认版，其中若干条目引用的 L0/其它模块专属路径在本仓不存在——判断为不构成实际安全削弱（路径不存在，匹配恒假），予以接受，登记轻量文档债务供后续收紧（详见报告判断题一节）。diff 无越界，本地 run-gates.sh/run-tests.sh 全绿（含 201/201 单元测试），commit 归属合法。approved。
