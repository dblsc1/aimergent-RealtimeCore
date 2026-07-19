# 2026-07-19 · reviewagent · P3a 会话内核（上）独立审核

任务单：`0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p3a-log-cursors.md`。
审核对象（exact target）：仓 `dev/realtime_core`，分支 `feat/p3a-log-cursors`，base `c634568`（main）..head `6e66246`，`diff_mode=exact`，16 文件。
verdict：**approved**（分支未合 main，交合并门）。

## 怎么审的（八项）

1. **兼容门**：`git diff --no-renames c634568..6e66246` = 16 文件全落在 session/reference/docs/purity；grep 确认 transport/concurrency/queue/package.json 及 P1/P2 既有测试**零触碰**；check-kernel-purity.mjs 为既有文件、diff 仅**追加** session 段（零删除，既有 transport 门逐字保留）。串行 `node --test --test-concurrency=1` = 110/110。
2. **不变量实质审（核心）**：亲读 `log-cursors.property.test.mjs` 影子模型 harness（shadowIds + 每 group confirmed/cursor/high 作可执行标准答案，每步断言真实==模型）。判定答案本身正确（confirmed 独立自维护、推进规则与规约一致）、随机步真覆盖 append/pull/ack/casClash/crash。**三处变异自检**注入 memory-log-store.js：①seq 跳号（lastSeq actual→actual+1）→ property①②③⑤⑥ 5 fail；②游标回退（删 seq<current 检查）→ property④ 1 fail；③CAS 双胜（append 检查短路）→ property①③⑥ 3 fail。每处确认对应 property 变红，`git checkout` 还原、porcelain 空。
3. **崩溃重建语义**：crash 步建全新 delivery、仅 logStore 幸存，新实例 lastSeqCache/pulledHigh 为空（懒重建 + 高水位归游标）——不携旧内存态，不变量1 非虚过；抽查"重建后未 pull 就 ack 恒 RangeError"。
4. **复用考验**：grep session/reference 生产零 setInterval/setTimeout/循环 sleep；import 图核实 session 生产仅同目录兄弟、**零 transport import**；subscribe 组装注入 longPoll；`delivery.subscribe.test.mjs`+`classroom-feed.ref.test.mjs` 注入真实 `../transport/engine.js` longPoll。裁断能力注入守住红线。
5. **API 偏离九条**：逐条核实合理——重点 ack 幂等合理、publish 追尾+CAS 兜底重试一次**无静默丢失**（冲突重读重 append 同批、二次失败原样上抛）、RangeError vs 专类可接受（编程 bug 用标准错误）。无架构缺陷。
6. **纯度门扩展**：独立重跑 36/36；session scope 五项经 3 处变异（delivery.js 加 Date.now→⑦红、加 scenario→⑥红；envelope.js import transport→⑤红）证明非空转，还原后门复绿。
7. **铁律**：≤500（最大 delivery.js 127）；零依赖；copycat/0 仓未动（diff 全在本仓）；文档三件（contract/rules/handoff）任务单**显式授权**、内容与代码一致、无越域、契约内部一致。
8. **留痕**：backend report embedded-self-v2 机械核验——SELF→6e66246、base c634568 祖先、changed_files 16 与 no-renames diff 精确相等、tracked/clean；trailer `backend@dev/realtime_core+p3a-log-cursors` 合法。

## 变异自检总账（6 处，全还原）

- 不变量向 3 处（memory-log-store.js）：seq 跳号 / 游标回退 / CAS 双胜 → 对应 property 精确变红。
- 纯度门 3 处（delivery.js×2、envelope.js×1）：Date.now / 领域词 / transport import → 门 35/1 变红。
- 每处 `git checkout` 还原 + `git status --porcelain` 空；终态全量 110/110、纯度门 36/36，被审业务代码一行未改。

## 观察（info，不阻断）

- backend report `status` 字段填 `approved`（worker 自评措辞偏差，应为待审）；summary 前缀已注明"待 reviewagent 正式审核"，无实质误导。`diff_mode=contains` 但 changed_files 实为精确相等。已在报告与 report.json 记为 info。

## 沙盒

reviewagent 只写 `review/`、`module_docs/reviewlog.md`、自己 `codeagent/reviewagent/docs/`；被审业务代码只读、变异注入全部还原。分支 `feat/p3a-log-cursors`，trailer `Agent-Attribution: reviewagent@dev/realtime_core+p3a-log-cursors-review`。
