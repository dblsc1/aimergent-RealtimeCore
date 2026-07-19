# 2026-07-19 · backend · P5 契约正式化 + v1.0.0 + SSE 参考适配器 + 收债（feat/p5-contract-v1）

任务单：`/srv/aimergent/0/CFO_agent/arbiter/docs/taskcards/2026-07-19-realtime-core-p5-contract-v1.md`。base = f497ac2（P4 squash 后的 main）。lightweight 单 agent 模式，四个交付物各一 commit + 本收尾 commit。

## 做了什么（按 commit）

1. **收债**（ca57509）：
   - **信封 id 去重（P3a ⑤号债）**：`session/envelope.js` 缺省 id 改为 import `queue/ids.js::genEventId`（唯一事实源）。关键手法：`genEventId({ clock: () => at, rng })`——clock 传"本信封已取的 at"，保证 id 时间戳分量 === 信封 `at`、rng 只读一次，**既有行为逐字节不变**（`memory-log-store.test.mjs` 的 `/^evt-\d+-/` 断言等全部零修改通过）。
   - **纯度门配套**：session/ scope 开**受控白名单**（仅 `queue/ids.js` 一个文件），并新增"白名单闭环"段——被引入 session/ 的 ids.js 本身跑同 5 项严格检查（61→66 项）。取舍：三个候选（本地重复实现 / 提取共享新目录 / 白名单受控引用）中选白名单——不新增目录结构、格式唯一事实源回到 ids.js、且闭环检查堵住"白名单成纯度盲区"。
   - **ordering.js 补测（P1 遗留债）**：新增 `queue/ordering.test.mjs` 8 用例。补测中**发现并钉死一处既有不对称**：`orderedSessionEvents` 跳过无 `type` 事件，`maxEventSeq` 却计入它们（老源行为，原样冻结入契，不修）。
2. **SSE 参考适配器**（47e73d7）：`reference/sse-adapter.ref.mjs`（`serveSse`/`formatSseFrame`/`formatSseComment`）+ 6 测试。组装 = conn 抽象（与 channels.js 同 port 形状）+ delivery.subscribe（内部真 longPoll + 真 memory-log-store，src/ 一行未动）。
3. **contract.md 正式化**（6f1df6e）：draft 全转正 → v1.0.0 冻结基线。5 scope · 16 文件 · **35 导出符号**逐一列签名/错误/语义；**5 端口**（logStore/snapshotStore/timers/wakeup/conn）+ ctx 注入约定单独成节含实现方义务；**15 条不变量承诺表**（I1–I15）逐条带测试文件锚点（契约与测试互指）；semver 政策（枚举扩展=minor 及消费方 default 分支义务、信封字段只加不改单列、升级链 throw 语义 = 契约承诺）；明确非目标 6 项；遗产兼容面标注。**机械自查**：脚本比对 src/ 全部 `export` 符号 vs 契约文本，35/35 命中；全文一致性通读一遍（修正过一处自己写错的 session 文件/符号计数 7·10→8·11）。
4. **README + version**（cc6bc6f）：仓根 README 一页（三层一图 + defineMachine/defineAggregate+runtime/delivery/longPoll 四段最小示例 + 门命令 + 指向 contract.md）；package.json 0.1.0→**1.0.0**；handoff 全面刷新。
5. 本 commit：worklog + report.json。

## SSE 结论（任务单 §2 要求的诚实结论）

**0.6 号设计声明（"端口形状对 SSE 成立"）从理论承诺变为实测事实——成立，无内核缺口。**

- **覆盖方式**：长轮询"回完即终" = 一个 poll 生命周期（RESPOND 至多一次，I1）；SSE"RESPOND 后连接仍活着继续推" = **顺序复合**多个 poll 生命周期——每推一帧 = 一个完整生命周期（等待→settled RESPOND→CLEANUP），适配器随即在同一 conn 上开下一个。"连接存活"不是状态机词汇，**它活在 conn port 里**——这正是 conn 抽象的设计意图，reducer/engine 无需"多次 RESPOND"扩展。6 用例实测：积压立即推/同 conn 三帧三生命周期/跨周期边界零丢失（新周期 initial attempt 立即 pull 积压）/超时→心跳注释帧继续推/断连静默清理/重连从游标续读（id 行 = Last-Event-ID 语义）/conn 与 channels(WS) 同形状互换。
- **顺带发现（非 SSE 缺口，如实入契）**：写测试时撞见一处 **P1 起即有**的微任务窗口——wakeup 形态下 publish 落在 initial attempt（已 pull 空）与 SUBSCRIBE 生效之间时，唤醒丢失，事件延迟到 TIMEOUT 或下一生命周期才可见（上限 timeoutMs）。这不是 bug 修复对象（长轮询客户端超时重询天然兜底、SSE 心跳周期天然兜底），但属于消费方必须知道的语义 → 已写进 contract `longPoll` 条目（语义冻结："不得假设 publish 后必即时唤醒"）与 handoff 避坑。保守决策：**记录不修**——修（SUBSCRIBE 后补一次 attempt）会改既有动作序列，违反本单兼容门。

## 决策与偏离

- **符号中性化：未做，移交 v2/迁平台层（偏离 rules.md 原设想）**。rules.md 原文"破 API 必须趁 v1.0 定版做"与本任务单最高优先级纪律 2（既有 187 测试零修改全绿）**硬冲突**——重命名必改测试。备选"新旧双名并存"会把两套名字一起冻进 v1.0，债变更重。保守方案：契约设**遗产兼容面**小节（`queue/` 全部 + `sessionLockKey`/`skillLockKey`），冻结如现状、注明新消费方不应用于新数据建模、中性化=major 随 v2/迁平台层 CR（届时可改测试、CFO 协调消费方）。rules.md 债务条目已更新处置与理由。
- **locks 模块级单例**：契约如实写明锁链注册表是模块级单例（copycat 逐字遗产），隔离实例工厂留 v1.x（minor）——不在本单改。
- **范围切割遵守**：不打 tag（rules/handoff 写明"CFO 合并后在 main 打 v1.0.0"）；迁平台层/CR/CONTRACTS-INDEX 全部标"待 CFO 治理流程"；copycat 与 0/ 仓只读未动。
- **"P5 处理"标记项盘点**（任务单 §3）：①信封 id 去重 ✅；②ordering 补测 ✅；③中性化 ⏭ 移交（上）；④真实持久化适配器 ⏭ 随首个消费方（端口契约已正式化，参考实现即规格）；⑤defineMachine YAGNI 项 ✅ 已评估——明确留在 v1.0 之外（contract 非目标节冻结此边界，copycat Step-5 无一项实据需求）；⑥`maxEventSeq` null 兜底（P1 worklog 提出"若公开需评估"）——评估结论：保留崩溃行为并入契冻结（加兜底=改既有行为违兼容门）。无悬空项。
- 本仓无 git remote（与 P1–P4 同状态）：candidate 停在本地 commit，无 push 环节。

## 数字（自检门）

- 测试：**201/201 全绿**（串行 `--test-concurrency=1`）= 既有 **187 零修改** + P5 新增 14（ordering 8 + SSE 6）。
- 纯度门：**66 PASS / 0 FAIL**（transport 16 + session 40 + machine 5 + 白名单闭环 5）。
- 契约覆盖：35/35 导出符号（机械比对）、5 端口、15 不变量条目（各带测试锚点）。
