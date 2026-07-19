# realtime_core · 审核结论台账

> 一行一条，仅 reviewagent 追加。详细报告在 `review/reviewreport/`。

| 日期 | 任务 | verdict | 报告 | 备注 |
|---|---|---|---|---|
| 2026-07-19 | P1 内核逐字抽取（feat/extract-kernel, bb645c8..2a039ae） | approved | `review/reviewreport/2026-07-19-review-extract-kernel.md` | 13 文件逐字节一致；verbatim 13/13、purity 16/16、npm test 48/48 独立重跑一致；两门防空转自检均正确变红并已还原；3 处偏离核实成立 |
| 2026-07-19 | P2 内核扩展（feat/p2-kernel-extension, 7d41f8e..f909d37） | approved | `review/reviewreport/2026-07-19-review-p2-kernel-extension.md` | 兼容门：6 既有测试文件零改、72/72 串行全绿（48+24）；purity 16/16、poll-machine 零 import/timer/Promise；三新不变量经 2 处变异自检证明非空过并已还原（porcelain 空）；block-9 两 poller 逐条复现、微时序适配无可观测差异；5 处偏离成立；越域仅 handoff.md 轻微越出任务单显式指令（lightweight 模式、铁律11 正当、标出不打回）；embedded-self-v2 机械核验全过 |
| 2026-07-19 | P3a 会话内核（上）：事实日志+游标投递（feat/p3a-log-cursors, c634568..6e66246） | approved | `review/reviewreport/2026-07-19-review-p3a-log-cursors.md` | 兼容门：既有 72 零改（transport/concurrency/queue 零触碰）、110/110 串行全绿（+38）；四不变量影子模型 property 测语义正确，经 3 处变异（seq 跳号/游标回退/CAS 双胜）精确变红证明非空过并还原（porcelain 空）；崩溃重建仅留 logStore、内存态彻底重建无虚过；复用考验守零 transport import 红线（longPoll/wakeup 能力注入，集成测试注入真实 engine.js，零自制轮询）；纯度门 36/36 扩展 session scope，五项经 3 处变异（Date.now/领域词/transport import）证明非空转并还原；九处偏离逐条成立（publish 追尾+CAS 兜底无静默丢失、ack 幂等合理）；文档三件（contract/rules/handoff）任务单显式授权、同步一致无越域；embedded-self-v2 机械核验全过（SELF→6e66246、base 祖先、changed_files 16 精确相等、tracked/clean）、trailer 合法 |
