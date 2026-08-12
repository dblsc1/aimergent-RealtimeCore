# 2026-08-12 · sync-ci-gates-review · reviewagent 正式审核报告（realtime_core）

- 审核对象（exact target）：`chore/sync-ci-gates` 分支 candidate
  - base：`e6d1808e9d833b8f07cff9e29c3693019b3b676b`（origin/main）
  - head：`809cb3bba02276046d5a564096d13495f99cb3ab`
  - changed_files（9）：`.github/workflows/ci.yml`、`ci/gates/.gitleaks.toml`、`ci/gates/agent-attribution-activation`、`ci/gates/check-report-schema.sh`、`ci/gates/legacy-path-exempt.txt`、`ci/gates/remote-test-exempt.txt`、`ci/gates/run-gates.sh`、`ci/gates/run-tests.sh`、`ci/hooks/commit-msg`
- verdict：**approved**
- tests_verified：true（run-gates.sh + run-tests.sh 均 reviewagent 亲跑）
- contract_conformance：true（本任务零 contract.md 改动）

## 任务背景

母代码 L0 从 5 道门禁补到 7 道（新增 commit 归属校验 + canonical report schema 校验），并在 `0994f57`（PR #50）把 `check-report-schema.sh` 的 status 枚举改为按角色分档——worker（backend/frontend）新增可写 `self_checked`（诚实的自检态，不是自我批准），verdict 角色（reviewagent/arbiter/consulter）不放开这个值，因为下判断正是这些角色的职责。本任务是把这套机制同步进 15 个模块仓的 `chore/sync-ci-gates` 分支。原定 11 仓此前只有旧的 5 道门（本仓不属于此批）；后补的 4 仓（ai_cad/copycat/auth_services/market_data）已有 7 道门但 status 枚举仍是旧版（本仓不属于此批）；realtime_core 是首次安装 CI（本仓正是该情形）。**本次改动只动门禁机制文件，零业务代码——因此 11+4 仓的 diff 高度同构，本审核用一个批量核验脚本机械跑完全部 15 仓，未逐仓肉眼看 diff。**

## 一、批量核验脚本结果（铁律17：机械项全部脚本化）

核验脚本：`gate-review-verify.sh`（15 仓共用，per-repo 参数化 base/head/batch），对每仓机械核验 7 类事实：① diff 范围落在允许集合内 + batch 专属 exact-set 断言；② `ci/gates/{check-report-schema.sh,run-gates.sh,run-tests.sh,agent-attribution-activation}` + `ci/hooks/commit-msg` **整文件**（非仅新增 hunk）与 `/srv/aimergent/0/ci/...` 母本 `diff` 逐字节比对；③ 豁免清单（legacy-path-exempt.txt/remote-test-exempt.txt/.gitleaks.toml）是否出现在 diff、若出现是否混入 L0 专属路径；④ `check-report-schema.sh` 含 `self_checked` 且 `bash -n` 语法通过（连带其余 3 个 shell 文件语法一并检查）；⑤ `bash ci/gates/run-gates.sh` 与 `bash ci/gates/run-tests.sh`（`RUNNER_TEMP=/srv/aimergent/.sys/tmp PIP_CACHE_DIR=/srv/aimergent/.sys/pipcache` 绕开 2.7G tmpfs）退出码；⑥ 用本仓自己的 `ci/hooks/commit-msg` 钩子校验 HEAD commit message 的 `Agent-Attribution` trailer。本仓（`realtime_core`）的机械核验原始片段：

```
### repo=realtime_core batch=R
################################################################
head=809cb3bba02276046d5a564096d13495f99cb3ab
base(origin/main)=e6d1808e9d833b8f07cff9e29c3693019b3b676b
--- diff --name-only --no-renames base..head ---
.github/workflows/ci.yml
ci/gates/.gitleaks.toml
ci/gates/agent-attribution-activation
ci/gates/check-report-schema.sh
ci/gates/legacy-path-exempt.txt
ci/gates/remote-test-exempt.txt
ci/gates/run-gates.sh
ci/gates/run-tests.sh
ci/hooks/commit-msg
PASS check1(scope): diff 全部落在允许集合（门禁机制文件 ∪ 豁免清单）
INFO check1b: realtime_core 首次安装，不做 exact-set 断言（另见专项判断）
NOTE: 豁免清单出现在 diff 中: ci/gates/.gitleaks.toml ci/gates/legacy-path-exempt.txt ci/gates/remote-test-exempt.txt
--- check2: 逐字节比对母本（整文件） ---
PASS check2: ci/gates/check-report-schema.sh 与母本逐字节相同
PASS check2: ci/gates/run-gates.sh 与母本逐字节相同
PASS check2: ci/gates/run-tests.sh 与母本逐字节相同
PASS check2: ci/gates/agent-attribution-activation 与母本逐字节相同
PASS check2: ci/hooks/commit-msg 与母本逐字节相同
PASS check2(补充,非任务硬性列项): .github/workflows/ci.yml 与 L1 模板母本(ci/workflows/ci.yml)逐字节相同
--- check4: status 新枚举 + bash -n 语法 ---
PASS check4a: check-report-schema.sh 含 self_checked
PASS check4b: bash -n ci/gates/check-report-schema.sh
PASS check4b: bash -n ci/gates/run-gates.sh
PASS check4b: bash -n ci/gates/run-tests.sh
PASS check4b: bash -n ci/hooks/commit-msg
--- check6: commit 归属 trailer（用本仓 commit-msg hook 校验 HEAD 消息） ---
PASS check6: commit-msg hook 校验通过
--- check5a: bash ci/gates/run-gates.sh ---
PASS check5a: run-gates.sh exit 0
--- check5b: bash ci/gates/run-tests.sh (RUNNER_TEMP=/srv/aimergent/.sys/tmp) ---
PASS check5b: run-tests.sh exit 0
=== repo=realtime_core verdict=PASS notes=none ===
```

## 二、逐字节比对母本（整文件，非仅新增 hunk）

首次安装场景：`.github/workflows/ci.yml` 与 `ci/workflows/ci.yml`（L1 模板母本）、以及全部 6 个 `ci/gates/*` 文件 + `ci/hooks/commit-msg` 均与 `/srv/aimergent/0/` 下同名文件 `diff` 无输出（见上节 `PASS check2`），包括三份豁免清单——即豁免清单虽是新增文件，内容与母本默认版逐字节相同，非本仓自行改写。

## 三、豁免清单未受污染

**这是本仓的判断题（为何不能代码化）**：`legacy-path-exempt.txt`/`remote-test-exempt.txt`/`.gitleaks.toml` 三份豁免清单作为**新文件**出现在 diff 里（首次安装，此前不存在，非"被改动"）。脚本能机械核实的事实是：① 与 L0 母本逐字节相同（非本仓自行改写，见上节 check2）；② 这些清单里引用的 L0/其它模块专属路径——`docs/0_problems_before_move/`、`deploy/nginx/portal/turbowarp-{editor,app}/`、`CFO_agent/`、`docs/1 structure/README.md`、`deploy/handoff-staging-testfixes.md`、`deploy/runbooks/prod-data-migration.md`、`code/backend/characterization/package.json`——用 `git ls-files`/`ls` 核实**在 realtime_core 全部不存在**（见 worklog 附证据）。但"路径不存在=不构成实际削弱"到"是否可以直接接受"之间还有一步权衡（最小豁免集原则 vs 首次安装省事），机器只能给出事实，给不出这个权衡的结论，所以这条肉眼判：**接受**。理由：(a) 门禁的豁免匹配是精确路径匹配（`grep -qxF`/`grep -qF` 等），对不存在的路径恒假，等价于零豁免；(b) 与母本逐字节相同意味着不是本仓自造的弱化，未来 L0 清理这些条目时 realtime_core 会自动同步；(c) 4 条真正对本仓通用的条目（`.*/rules\.md`、`.*/AGENTS\.md`、`.*/docs/worklog/.*`、`.*/reviewreport/.*`、`ci/gates/run-gates\.sh` 自引用）本来就是每个模块都需要的，不是 L0 专属。**建议**（非阻断）：登记一条轻量文档债务，供 realtime_core 的 arbiter 后续在 `module_docs/rules.md` 择机裁剪成本仓最小豁免集——reviewagent 沙盒不含该文件写权限，故只提建议。

## 四、新门禁有效性抽验

本仓是 3 个抽样仓之一。用 `git hash-object`/`git read-tree`/`git commit-tree` 在内存中合成一次性 commit（不落任何分支 ref，不 touch 工作区/索引，跑完即为孤儿对象，无需清理，也不影响 push/pull），构造"status 值与 base 不同（避免铁律12 diff-skip 边界）且非法"的报告，验证门禁正确拒绝；并做正控确认门禁不是无差别拒绝一切。原始输出：

```
==============================================================
### 抽验: repo=realtime_core target=codeagent/backend/docs/report.json new_status=not_a_real_status_xyz (全新安装副本上的基础枚举校验)
==============================================================
原 status=approved -> 测试 status=not_a_real_status_xyz（确认与 base 不同才会落入 diff）
合成的一次性 commit（不落任何 ref，纯 loose object）: 0aa6ef12170ced39b8639bd353d1720dd1098bf7
--- 运行 check-report-schema.sh（AIMERGENT_REPORT_BASE=e6d1808e9d833b8f07cff9e29c3693019b3b676b AIMERGENT_REPORT_HEAD=0aa6ef12170ced39b8639bd353d1720dd1098bf7）---
❌ report schema: 缺少 embedded-self-v2 必填字段或 path/role 不匹配: codeagent/backend/docs/report.json
>>> RESULT: 门禁正确拒绝（exit=1）—— 新枚举生效
```

## 五、肉眼判断项（为何不能代码化）

仅第三节"豁免清单未受污染"一项是肉眼判断——由脚本先确认客观事实（字节相同、路径不存在），但"是否接受首次安装继承 L0 默认豁免清单"是政策/风险权衡，不是单纯的事实判定，机器给不出"可接受"这个结论本身，故肉眼判并记录理由（见上节）。其余各节（diff 范围、字节比对、语法、本地门禁、commit 归属、新门禁有效性）全部是脚本机械核验的客观结果，无需肉眼加判断。

## 六、结论

chore/sync-ci-gates 是 realtime_core 首次安装 CI 门禁：.github/workflows/ci.yml + 全部 6 个 ci/gates 文件 + ci/hooks/commit-msg 从无到有，与 L0 母本逐字节相同，已含 7 道门 + status 新枚举（self_checked）。豁免清单（legacy-path-exempt.txt/remote-test-exempt.txt/.gitleaks.toml）沿用 L0 默认版，其中若干条目引用的 L0/其它模块专属路径在本仓不存在——判断为不构成实际安全削弱（路径不存在，匹配恒假），予以接受，登记轻量文档债务供后续收紧（详见报告判断题一节）。diff 无越界，本地 run-gates.sh/run-tests.sh 全绿（含 201/201 单元测试），commit 归属合法。approved。

**verdict：approved**。canonical report 见 `codeagent/reviewagent/docs/report.json`。
