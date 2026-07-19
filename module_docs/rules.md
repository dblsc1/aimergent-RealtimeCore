# realtime_core · 模块专属规则

> 框架根为 `/srv/aimergent/0`；项目级铁律见 `/srv/aimergent/0/AGENTS.md`。完整治理时此处只能加严，并由 arbiter 执笔维护；独立实验可按《新模块与新项目开设指南》选择轻量模式。

## 工作模式

- 模式：`lightweight`（孵化于 `dev/`，尚无外部消费方；P5 迁 `0/` 平台层时升级为 `governed`）。
- 升级条件：出现第一个外部消费方，或经 CR 迁入 `0/` 平台层——届时切 `governed`，契约冻结、变更走 CR。

## 技术与目录

1. **纯 ESM、零 runtime 依赖**是本库的卖点：`package.json` `"type":"module"`，`npm test` = `node --test`，不引第三方 runtime 包（devDependencies 也尽量为零）。新增代码不得破坏"内核零依赖"。
2. 代码分区（`code/backend/src/`）：`transport/`（实时引擎壳 + long-poll reducer + 命令分发 + 频道）、`concurrency/`（keyed 锁）、`queue/`（事件排序 + id 生成）。测试 `.test.mjs`/`.property.test.mjs` 旁置于被测模块同目录。
3. **纯度门**：`transport/` 生产 .js 受 `review/reviewcode/check-kernel-purity.mjs` 约束——无 transport/存储/领域层 import、无 copycat 领域词、无 `db.transaction(`、单文件 ≤500 行。`concurrency/`、`queue/` **不在纯度门覆盖内**（含领域相邻词 `rounds`/`skillId`，与 copycat 老门 scope 一致）。
4. **逐字抽取纪律（v0.1 遗产）**：`code/backend/src/` 现有七文件是 copycat 内核的逐字节抽取，受 `review/reviewcode/check-verbatim-extraction.mjs` 守护（相对 copycat 源逐行一致，仅允许 import/路径白名单差异）。P2+ 功能扩展在此之上叠加，不得回改这七文件的既有导出行为（要改先记 worklog + 评估消费方）。

## 跨仓依赖机制

- 未来消费方引用 realtime_core：**用 git tag 固定版本**（本单决策 3）。P1 无消费方，机制暂不落地，仅此记录。P5 定稿时随 semver v1.0 tag 正式启用。

## 启动与自检

- 安装：无（零 runtime 依赖；`code/backend/` 无需 `npm install`）。
- 启动：不适用（库，无服务进程）。
- lint / typecheck：暂无（v0.1 纯抽取，未引入 lint 工具链）。
- test：`cd code/backend && npm test`（= `node --test`，串行；v0.1 = 48 个 node:test 用例全绿）。
- 审核脚本：`node review/reviewcode/check-kernel-purity.mjs` 与 `node review/reviewcode/check-verbatim-extraction.mjs`，均须全 PASS。

## 演进路线图（P2→P5）

> 本单（P1）只做建仓 + 逐字抽取 + 测试落位，**不做任何功能扩展**。以下为已拍板的后续路线，每项含动机，供后续任务单展开。

### P2 · reducer 扩展 + engine keyed registry
在逐字继承的 `poll-machine.js` reducer 之上扩展新事件/动作/终态：`POLL_TICK`、`ARM_INTERVAL`、`SUPERSEDED` 终态、"首发开关"（首次投递即触发的语义），并给 `engine.js` 加 keyed poller registry（按 key 管理多个并发 long-poll 的注册/唤醒/回收）。
**动机 + 验收**：以库内参考实现复现 copycat block-9 两个 poller 的行为作为验收基准——证明扩展后的通用内核能无损承载真实业务的实时形态，而非空想 API。

### P3 · 会话内核（游标投递模型）
引入会话状态内核，**采用"游标投递模型"**（日志 + 每消费组游标）**替代** copycat 现有的 delivered/done 标记模型：事件写入 append-only 日志，每个消费组维护自己的读游标，投递进度 = 游标位置。**事件版本化为 P3 必含设计**（每事件带 schema version，消费方可前向兼容）。定义 `decide`/`evolve` 聚合语义（命令 → decide → 事件 → evolve → 新状态）。
**动机**：delivered/done 模型在多消费组、重放、审计场景下会互相打架；游标模型让"谁读到哪"独立可查，且事件版本化是长寿命内核不返工的前提。

### P4 · defineMachine 转移表工具
提供声明式状态机构造工具 `defineMachine`（转移表：states / events / guards / actions）。**词汇照抄 XState**（states/events/guards/actions/context），降低学习成本、便于未来对接生态，但实现保持零依赖、纯函数内核。
**动机**：P2 手写 reducer 能跑但难维护；转移表把状态机结构显式化、可静态校验、可可视化，是内核从"能用"到"好用"的关键。

### P5 · 正式契约 + semver v1.0 + 迁平台层
定稿 `module_docs/contract.md` 正式契约、打 semver **v1.0** tag、**经 CR 迁入 `0/` 平台层**（触及 `0/AGENTS.md` 顶层结构，需用户逐字确认）、补 **SSE 参考适配器测试**（证明内核能驱动 SSE 传输，不止 long-poll）。
**动机**：迁 `0/` 平台层意味着对外承诺冻结、多模块可依赖——必须先有稳定契约、版本号、跨传输验证，才能承担平台层的复用责任。
