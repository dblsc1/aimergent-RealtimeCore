# 2026-08-12 · gitignore-worktrees-review · reviewagent 正式审核报告（realtime_core）

- 审核对象（exact target）：`chore/gitignore-worktrees` 分支 candidate
  - base：`e0faf0210482472e32f3b0cb4bc1d9e93e732227`（origin/main）
  - head：`cf7cdc052516064faf4f7ba60c567e34a9ddae82`
  - changed_files（1）：`.gitignore`
- verdict：**approved**
- tests_verified：true（run-gates.sh 亲跑；check-ignore 语义探针亲跑）
- contract_conformance：true（本任务零 contract.md 改动）

## 任务背景

第一波（sync-ci-gates）15 仓已合并进 main。第二波改动更小：给 14 个仓（copycat 不在本波，它 2026-07-18 `13f64ac` 已有同一条规则；L0 自己那份由 CFO 走 consulter 报告单独处理，不占 reviewagent 的活）的根 `.gitignore` 追加 3 行（空行 + 注释 + `.worktrees/`），使铁律15①「一分支一活跃写者」用的仓根 git worktree（建在 `<仓根>/.worktrees/` 下）不再以未跟踪目录形态污染主检出、挡住 `merge-to-main.sh` 的工作区干净检查——CFO 在 ai_cad 上实测复现过这个代价（建审核 worktree 后 merge 被『工作区不干净』挡下，撤掉 worktree 才合成）。

## 一、批量核验脚本结果

核验脚本：`gitignore-review-verify.sh`（14 仓共用），对每仓机械核验 6 类事实：① diff 范围恰好`.gitignore` 一个文件；② `git diff --numstat` 恰好 +3/-0，且用**纯 bash 逐行前缀判断**（不用 grep/sed 正则）提取新增的 3 行内容，与 `functions/copycat/.gitignore` 现有同一条规则的参照块逐字节比对；③ **`git check-ignore -v`** 权威判定（非 `git status --porcelain`——CFO 已指出该法会被同期任何未跟踪文件污染，且用 `grep worktrees` 过滤本身会被文件名恰好带 `worktrees` 的 worklog/报告文件误命中，两次踩坑）：`mkdir -p .worktrees/probe && touch .worktrees/probe/x` 后 `git check-ignore -v .worktrees/probe/x`，确认输出的源文件精确为 `.gitignore`、命中的 pattern 精确为 `.worktrees/`、退出码 0——证明是**这条新规则**在生效，不是碰巧被别的规则覆盖；④ `git ls-files | grep worktrees` 为空，确认无已跟踪文件被连带命中；⑤ `bash ci/gates/run-gates.sh` 退出码；⑥ 用本仓自己的 `ci/hooks/commit-msg` 钩子校验 HEAD commit message 的 `Agent-Attribution` trailer。**14 仓机械核验全部通过，零 FAIL、零 WARN**（脚本 exit 0）。

（第一版核验脚本的 check2b 用了 `grep -E '^\+' | grep -v '^\+\+\+'` 做前缀剥离，本机交互 shell 的 `grep` 被包成 ugrep 函数，遇到 `'^\+\+\+'` 这种连续 `\+` 的 BRE 报 `invalid syntax` 静默吞掉、产出空结果，导致 14 仓全部误判 content-mismatch——纯工具 bug，非候选缺陷；发现后改用纯 bash 逐行 `case` 前缀判断重跑，14 仓全部转为真实 PASS，证据见下方本仓片段。）

本仓（`realtime_core`）的机械核验原始片段：

```
### repo=realtime_core
################################################################
head=cf7cdc052516064faf4f7ba60c567e34a9ddae82
base(origin/main)=e0faf0210482472e32f3b0cb4bc1d9e93e732227
--- diff --name-only base..head ---
.gitignore
PASS check1: diff 恰好是 .gitignore 一个文件
numstat: 3	0	.gitignore
PASS check2a: +3/-0
PASS check2b: 追加内容与 copycat 参照块逐字节相同
check-ignore -v .worktrees/probe/x => rc=0  out=[.gitignore:18:.worktrees/	.worktrees/probe/x]
PASS check3: git check-ignore -v 确认命中本仓 .gitignore 的 .worktrees/ 规则（非碰巧被其它规则覆盖）
PASS check4: git ls-files | grep worktrees 为空，无已跟踪文件受影响
--- check5: bash ci/gates/run-gates.sh ---
PASS check5: run-gates.sh exit 0
--- check6: commit 归属 trailer ---
PASS check6: commit-msg hook 校验通过
=== repo=realtime_core verdict=PASS notes=none ===
```

## 二、追加内容与 copycat 逐字节比对

参照基线：`functions/copycat/.gitignore` 现有的 `.worktrees/` 规则块（该模块 2026-07-18 `13f64ac` 引入，commit message 标注『PROC-042 永久闭』）。本仓 `git diff -U0 base..head -- .gitignore` 显示的 3 行新增内容——空行、`# worker 并行构建隔离用仓根 git worktree（PROC-042 永久闭）：未 gitignore 会污染主 checkout 挡 merge`、`.worktrees/`——与 copycat 参照块用 `diff` 逐字节比对无输出（见上节 `PASS check2b`）。附带证据：本仓与 copycat 变更前状态的 git blob index 完全一致（`index 0939a00..4b6aa48`，与 copycat 原始 commit 13f64ac 的 index 行相同），独立佐证两边改动的是同一份原始模板文件、落地同一个目标 blob。

## 三、`.gitignore` 语义正确性（git check-ignore -v 权威判定）

构造探针 `mkdir -p .worktrees/probe && touch .worktrees/probe/x`，跑 `git check-ignore -v ".worktrees/probe/x"`：

```
check-ignore -v .worktrees/probe/x => rc=0  out=[.gitignore:18:.worktrees/	.worktrees/probe/x]
```

输出的源文件字段精确等于 `.gitignore`（本仓根 .gitignore，非其它路径的同名文件）、命中的 pattern 字段精确等于 `.worktrees/`（就是本次新增的这条规则，不是预置的其它 pattern 碰巧覆盖）、退出码 0（= 判定为已忽略）——三者同时成立，证明这条新规则**确实在生效**且**确实是它在生效**。测试后已清理探针文件/目录。

## 四、未误伤已跟踪文件

`git ls-files | grep worktrees`（在本仓 `chore/gitignore-worktrees` HEAD 下）输出为空——无任何已跟踪文件路径包含 `worktrees` 字样，说明新规则的引入没有伴随任何文件被从版本控制中移除或改变追踪状态（gitignore 本身也从不影响已跟踪文件的可见性，只影响未跟踪路径，这条检查是双重确认没有巧合命名冲突）。

## 五、肉眼判断项（为何不能代码化）

本仓无肉眼判断项——diff 范围、+3/-0、内容逐字节比对、check-ignore 语义判定、已跟踪文件零误伤、本地门禁、commit 归属，全部是脚本机械核验的客观结果。

## 六、结论

chore/gitignore-worktrees 给 realtime_core 的根 .gitignore 追加 3 行（空行+注释+`.worktrees/`），与 functions/copycat 已生效多时的同一条规则逐字节一致（连注释文字都相同）。diff 恰好 1 个文件、+3/-0；`git check-ignore -v` 权威判定确认新探针路径确实被本仓 .gitignore 里这条新规则命中（非碰巧被其它规则覆盖）；`git ls-files | grep worktrees` 为空，未误伤任何已跟踪文件；本地 run-gates.sh 全绿；commit 归属合法。approved。

**verdict：approved**。canonical report 见 `codeagent/reviewagent/docs/report.json`。
