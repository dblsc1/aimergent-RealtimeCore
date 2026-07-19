# worklog · 2026-07-19 · backend · P4 defineMachine 声明式转移表工具

## 任务

realtime_core P4：提供百行级、零依赖的声明式**平表**有限状态机工具
`defineMachine`（状态全集 + 合法转移表 + 纯谓词守卫），词汇照抄 XState。核心价值 =
**定义期全面校验**（非法定义在 `defineMachine()` 调用时响亮 throw，带 id + 位置）。
分支 `feat/p4-define-machine`，从 main HEAD `c6b1a97` 切出，不合 main。

## 改了什么 · 为什么

### 新增 `code/backend/src/machine/define-machine.js`（270 行，零 import）

- `defineMachine(spec)` → `Object.freeze` 的不可变纯机器，方法全纯：
  - `transition(state, event, ctx?) → {state, changed} | throw IllegalTransitionError`
  - `can(state, event, ctx?) → boolean`（不抛；`can===true ⟺ transition 成功`）
  - `states` / `finalStates`（`Object.freeze` 枚举）/ `initial`
  - `assertState(value) → value | throw`（裸字符串逃逸运行时断言）
- 两个导出错误类：`MachineDefinitionError`（定义期，携 `machineId`/`where` 位置）、
  `IllegalTransitionError`（运行期，携 `machineId`/`reason`/`from`/`event`/`guard`）。
- **为什么单独 machine/ 目录**：与 session/ 同为纯逻辑内核，纳入同一严格纯度门；
  states/events 是通用词，天然领域无关。

### 新增测试

- `machine/define-machine.test.mjs`（32 用例）：运行期 transition/can/assertState
  全行为 + 定义期校验逐条（每种非法定义一个用例，断言错误信息含 id 与位置）。
- `machine/define-machine.property.test.mjs`（2 用例，mulberry32 固定种子）：
  - property①（200 种子×40 步）状态封闭性——transition 结果恒 ∈ states，且 can ⟺
    transition 成功；
  - property②（120 种子）终态吸收性——进 final 后任何事件恒 throw 且 can=false，
    机器不可复活。

### 参考示例表驱动改造 `reference/classroom-aggregate.ref.mjs`

- 取舍：**改原文件、不新增变体**——任务单允许两种，改原文件能让"既有 4 个参考
  测试零修改全绿"直接成为"表驱动与手写等价"的证明，最干净。新增变体反而要复制
  一份组装代码、留两套 decide，违 DRY。
- 手写 phase 守卫 → 表驱动：`state.phase === 'closed'`、`ANSWERING_PHASES.has(...)`
  三处 if/else 全下沉到 `CLASSROOM_MACHINE.can(state.phase, EVENT)`；`ANSWERING_PHASES`
  常量删除。machine 只做守卫，decide 仍产事件、evolve 仍推进 phase（组合边界）。
- **等价证明**：`classroom-aggregate.ref.test.mjs` 一字未改，4 用例全绿。转移表逐格
  复刻原逻辑：`PUSH_QUESTION`/`CLOSE` 存在于 idle/asking/awaiting（不在 closed→
  can=false→原 reject 码），`SUBMIT_ANSWER` 只存在于 asking/awaiting（复刻
  ANSWERING_PHASES）。

### 纯度门扩展 `review/reviewcode/check-kernel-purity.mjs`

- 把 session/ 的 5 项严格检查抽成 `checkStrictScope(dir, label, banner)` helper
  （DRY），session/ 与 machine/ 共用。新增 machine/ scope（⑩-⑭）。
- 数字：transport 16 + session 40（8 文件×5）+ machine 5（1 文件×5）= **61 PASS / 0 FAIL**
  （原 56 → 61）。

## 定义期校验覆盖表（验收项 §39/§48）

| # | 非法定义 | 抛出 | 错误信息含 | 测试用例 |
|---|---|---|---|---|
| 1 | spec 非对象 | MachineDefinitionError | — | 定义期·spec 非对象 |
| 2 | id 非非空字符串（缺/空/非串） | 〃 | — | 定义期·id 非非空字符串 |
| 3 | spec 顶层未知键 | 〃 | id + `spec` + 键名 | 定义期·spec 顶层未知键 |
| 4 | states 非对象 / 为空 | 〃 | `states` | 定义期·states 非对象/为空 |
| 5 | 状态名为空字符串 | 〃 | id | 定义期·状态名为空字符串 |
| 6 | initial 非非空字符串 | 〃 | `initial` | 定义期·initial 非非空字符串 |
| 7 | initial 不在 states | 〃 | id + `initial` + 名字 | 定义期·initial 不在 states |
| 8 | 状态定义非对象 | 〃 | 状态名 | 定义期·状态定义非对象 |
| 9 | 状态未知键（如 `onn`） | 〃 | `states.<s>` + 键名 | 定义期·状态未知键 |
| 10 | type 非 'final' | 〃 | `states.<s>.type` + 值 | 定义期·type 非 final |
| 11 | final 状态声明 on | 〃 | `states.<s>.on` + final | 定义期·final 状态声明 on |
| 12 | on 非对象 | 〃 | 状态名 | 定义期·on 非对象 |
| 13 | 转移定义非对象 | 〃 | `states.<s>.on.<e>` | 定义期·转移定义非对象 |
| 14 | 转移未知键（拼错 `gaurd`） | 〃 | 键名 | 定义期·转移未知键 |
| 15 | target 非非空字符串 | 〃 | `...target` | 定义期·target 非非空字符串 |
| 16 | target 指向不存在的状态 | 〃 | id + `...target` + 名字 | 定义期·target 指向不存在 |
| 17 | guard 非字符串 | 〃 | `...guard` | 定义期·guard 非字符串 |
| 18 | guard 引用未定义 | 〃 | id + `...guard` + guard 名 | 定义期·guard 引用未定义 |
| 19 | guards 非对象 / guard 非函数 | 〃 | `guards` | 定义期·guards 非对象/guard 非函数 |

## 保守决策（未覆盖处按任务单选保守，不停等确认）

1. **重复键无法运行时检测**：任务单 §39 列"重复定义"为校验项，但 JS 对象字面量会
   静默折叠重复键（`{a:1, a:2}` → `{a:2}`），运行时拿不到重复信息。保守替代：对
   状态定义（只许 on/type）、转移定义（只许 target/guard）、spec 顶层做**未知键严格
   拒绝**——把拼错的 `gaurd`/`onn`/`context` 在定义期照亮，取得响亮校验的等价收益。
   已在 contract/rules/worklog 三处记录此限制。
2. **guard 签名 `(ctx, event)`**：照抄 XState 顺序；event 传入的是**事件名字符串**
   （与 `transition(state, event)` 的 event 一致），非 XState 的事件对象——因本工具
   是平表、事件即名字。已写入 contract guard 契约。
3. **guard 抛异常不吞**：guard 应是纯谓词；抛异常 = 编程错误，`transition` 与 `can`
   均原样上抛（不 try/catch 吞成 false）。测试 `guard 抛异常=编程错误` 钉死。
4. **字符串 target 简写不做**（XState 支持 `on: { E: 'target' }`）：YAGNI，只支持
   `{ target, guard? }` 对象形式，非对象转移定义响亮 throw。记入 rules.md YAGNI 项。
5. **assertState 复用 IllegalTransitionError**（reason='unknown-state'）而非新设类：
   语义都是"状态不合法"，少一个导出面。

## 明确不做（YAGNI，记 rules.md P4）

层级/并行状态、entry/exit actions 执行、invoke/actor、延迟(after)转移、字符串 target
简写。需要时走 CR 扩展。

## 验收结果

- 既有 153 测试零修改全绿（`git diff --name-only c6b1a97 -- code/` 仅
  `reference/classroom-aggregate.ref.mjs` 一个被改，无既有测试文件被动）。
- 新增 34 测试全绿（machine 单测 32 + property 2）。全量 187/187 串行全绿。
- 纯度门 61/61 PASS（含 machine scope）。
- 参考示例 4 用例零修改全绿（等价证明）。

## 偏离项

- 无实质偏离。lightweight 单 agent 按任务单显式授权一并更新 module_docs
  （contract/rules/handoff）+ 纯度门脚本；下游仍有独立 reviewagent 审 candidate。
- 本仓 `dev/` 孵化局部仓，无 git remote——candidate 停在本地 commit，无 push 环节
  （与 P1/P2/P3a/P3b 同状态）。
