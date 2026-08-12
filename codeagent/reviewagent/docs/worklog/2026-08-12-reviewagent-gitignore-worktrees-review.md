# 2026-08-12 · reviewagent · gitignore-worktrees-review（realtime_core）

## 任务
CFO 派发的第二波批量任务：14 个模块仓（copycat 已有、L0 由 consulter 单独处理）的 `chore/gitignore-worktrees` 分支，给根 `.gitignore` 追加 `.worktrees/` 忽略规则（铁律15①一分支一活跃写者用的仓根 git worktree 不被 gitignore 会污染主检出、挡 merge-to-main.sh 的工作区干净检查）。本仓（`realtime_core`）candidate head `cf7cdc052516064faf4f7ba60c567e34a9ddae82`，base(origin/main) `e0faf0210482472e32f3b0cb4bc1d9e93e732227`。

## 做了什么 / 为什么

1. 复用第一波的批量核验思路（铁律17），写 `gitignore-review-verify.sh`，14 仓统一跑 6 类机械核验：diff 范围恰好 1 文件、+3/-0 且内容与 `functions/copycat/.gitignore` 现有规则块逐字节相同、`.gitignore` 语义生效、无已跟踪文件误伤、本地门禁、commit 归属。
2. **踩了一个自己的工具坑**：第一版核验脚本用 `git diff -U0 ... | grep -E '^\+' | grep -v '^\+\+\+' | sed 's/^\+//'` 提取新增行，本机交互 shell 的 `grep` 是包了 ugrep 的函数（`type grep` 可见），遇到 `'^\+\+\+'` 这种连续多个 `\+` 的基本正则报 `ugrep: error: ... invalid syntax`，管道静默产出空结果——不是报错中断，是**悄悄给出错误的空结果**，导致 14 仓全部被误判『追加内容与参照块不同』。定位后改用纯 bash `while read` + `case` 前缀匹配重写这段逻辑，完全绕开 shell 的 grep/sed 正则方言差异，重跑后 14 仓真实全绿。记录这个坑是为了以后不再对这台机器的 `grep` 传复杂 BRE。
3. **采纳 CFO 对验法 3 的更正**：任务书原定 `git status --porcelain` 无输出即判定生效，CFO 自己踩了两次坑（① status 会被同期任何未 add 的其它未跟踪文件污染；② 想用 `grep worktrees` 过滤 status 输出定位探针行，结果 grep 命中的是文件名本身带 `worktrees` 的 worklog，不是被忽略的探针路径）后改法为 `git check-ignore -v <probe-path>`——这是 git 自己的权威判定，且直接指出命中哪条规则、哪个文件。改用后不再需要保证探针测试时点周围没有其它未跟踪文件这个隐藏前提，本仓验证：`git check-ignore -v ".worktrees/probe/x"` 输出源文件=`.gitignore`、pattern=`.worktrees/`、exit=0，三者同时成立，证明命中的正是这条新规则本身（非其它预置规则碰巧覆盖）。
4. 产出：`codeagent/reviewagent/docs/report.json`（embedded-self-v2，review_target exact 对齐 base/head/changed_files）、`review/reviewreport/2026-08-12-gitignore-worktrees-review.md`、`module_docs/reviewlog.md` 追加一行、本 worklog。commit 但不 push（钩子限制），SHA 交给 CFO 代推。

## 结论

approved。chore/gitignore-worktrees 给 realtime_core 的根 .gitignore 追加 3 行（空行+注释+`.worktrees/`），与 functions/copycat 已生效多时的同一条规则逐字节一致（连注释文字都相同）。diff 恰好 1 个文件、+3/-0；`git check-ignore -v` 权威判定确认新探针路径确实被本仓 .gitignore 里这条新规则命中（非碰巧被其它规则覆盖）；`git ls-files | grep worktrees` 为空，未误伤任何已跟踪文件；本地 run-gates.sh 全绿；commit 归属合法。approved。
