# 2026-07-19 · reviewagent · P5 契约正式化 + v1.0.0 + SSE + 收债 审核（feat/p5-contract-v1）

审核对象（exact target）：仓 `dev/realtime_core`，分支 `feat/p5-contract-v1`，base `f497ac2`(main)..head `3777e36`(5 commits)，`diff_mode=exact`(no-renames)。这是 v1.0.0 合并前最后一道门，契约期审核以**文档-代码一致性**为主战场。

## 裁决

**APPROVED**（八项全 PASS，0 阻断）。报告：`review/reviewreport/2026-07-19-review-p5-contract-v1.md`。

## 八项做了什么 / 为什么这样判

1. **兼容门**：no-renames diff 下零个既有 `*.test.mjs` 被改（仅 2 新增测试 + 生产 `src/` 唯一改动 envelope.js 收债）；串行独立重跑 201/201。
2. **契约完备性（核心）**：不复用 backend 脚本——自写 `grep -rhoE '^export (function|const|class)'` 抽 src 35 符号、`grep '^| \`'` 抽契约表格 35 符号，`diff` 空 = 独立 35/35 零漂移。5 符号深读（initPoll/reduce/isTerminalPhase 亲跑 `node -e`；sealEnvelopes/upcastEvent 读源），15 不变量锚点全在、深读 4 条确认测的确是该条。
3. **SSE 实质审**：`serveSse` while 循环顺序复合多 poll 生命周期、每 settled→`conn.send`+ack，核心用例同 conn 连推 3 帧（游标 2→3→5），6 测非单帧糊弄；commit 47e73d7 仅触 reference/ → src/ 一行未动 diff 核实。
4. **微任务窗口裁断**：①P1 起既有——engine.js/poll-machine.js 本 branch 零触碰、P5 仅入契；②timeoutMs 兜底准确——WAITING 恒 ARM_TIMER(timeoutMs)（poll-machine L248/engine L127）；③延迟非丢失——事件留日志、下一生命周期 initial pull 补课（SSE 测#2 实证），有界≤timeoutMs → **可接受非阻断**。
5. **收债实质审**：id 去重 `clock:()=>at` 逐字节等价（ids.js::genEventId 注入 + 201 绿 + README ex2 实跑印证）；纯度门真闭环（⑮ 复检白名单 ids.js）；**变异自检**注入非白名单跨 scope import→66/0 变红 65/1 精确报越域→还原；ordering 8 测钉死不对称；六项债三处文档一致无悬空。
6. **README/版本**：ex1/2/3 亲跑通、ex4 HTTP 示意 API 形状一致；version=1.0.0；`git tag -l` 空未打 tag。
7. **铁律**：≤500(最大 338)/零依赖/copycat·0 未动/四文档一致/契约无自相矛盾（通读）。
8. **留痕**：embedded-self-v2 机械核验全过（base f497ac2、SELF→3777e36、changed_files 12/12 集合相等 LC_ALL=C 复核、tracked+clean）；5 trailer 各唯一合法；worklog 完整。

## 变异自检（完全还原）

- **M1**：向白名单外 `src/session/upcaster.js` 注入 `import { orderedSessionEvents } from '../queue/ordering.js';`（ordering.js 不在白名单）→ 纯度门 **66/0 → 65/1**，精确报 `逃出 session/ 目录（跨层耦合）`。
- 还原：`git checkout` → `git status --porcelain` **空** → 纯度门 **66/0** → 全量测试 **201/201** 复绿。

## 判断题（无法完全代码化的部分，写明理由）

- 微任务窗口"延迟非丢失是否可接受 v1.0"——需结合日志持久性 + 下一生命周期 initial pull 语义 + SSE 测#2 实证综合裁断，非单脚本可判；结论有界延迟非丢失、非阻断。
- 契约"记录不修"的保守决策合理性、遗产兼容面移交的正当性——判断题，逐条核实成立。

## 偏离核实（backend 自报 6 项，逐条成立）

符号中性化让位兼容门 / locks 模块级单例入契冻结 / SSE 测先 flush 建订阅 / 不打 tag+迁平台层标待 CFO / lightweight 单 agent 更 module_docs+README+纯度门脚本(任务单授权) / dev 仓无 remote 停本地 commit。

## info（不阻断）

backend report `contract.touched=true` 填模块自身契约 realtime-core-kernel@v1.0.0（已注明未触平台契约、cross_module_impact=[]）；CFO 路由信号语义上 touched 指平台契约，本次无跨模块协调需求，真正需 CFO 的是移交项(tag+迁平台层)。仅标出。

## 交接 CFO

①合并后在 main squash commit 打 v1.0.0 tag（squash 后复验 embedded-self-v2）；②迁 0/ 平台层治理流程（CR+顶层结构+CONTRACTS-INDEX+切 governed，需用户确认）。

被审业务代码一行未改；分支未合 main、未打 tag，交合并门。
