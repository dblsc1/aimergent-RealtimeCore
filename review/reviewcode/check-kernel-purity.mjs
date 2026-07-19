#!/usr/bin/env node
// check-kernel-purity.mjs — realtime_core 实时引擎 core 机械纯度门（铁律17）。
//
// 端口来源（逐字继承逻辑，仅适配路径/命名）：copycat
// `review/reviewcode/backend/services/check-realtime-engine-purity.mjs`。
// 抽取后 realtime 引擎壳落在 `code/backend/src/transport/`（对应老仓 realtime/），
// 本门核对该目录，检查范围与老门一致——只核实时引擎壳，不核 concurrency/、queue/
// （后者含领域相邻词 rounds/skillId，本就不在纯度门覆盖内，与老门 scope 一致）。
//
// 对 `code/backend/src/transport/` 下的**生产** .js（递归，排除 `*.test.mjs`）机械核四项，
// 任一 FAIL → 非零退出：
//   ① 无 transport/domain 耦合 import：**只对 `import ... from '<spec>'` 语句做行级匹配**（非整文件子串
//      扫描），禁止 import specifier 引用 session-state / operations / repositories / db / connection /
//      fastify / @fastify / ws / http / net / socket.io 等 transport/存储/领域层；允许 node: 内建 +
//      transport/ 内 `./` 兄弟模块（引擎壳 engine.js 解释副作用需要 node 定时器/事件是合法的）。
//   ② 生产**代码**无 copycat 领域词：先剥掉行注释 `//…` 与块注释 `/* … */`（注释里为对照老源而提及
//      领域概念不算耦合——门核的是代码耦合，不是注释词汇），再对剩余代码匹配 copycat 领域标识符
//      （scenarioId/classCode/studentPhase/studentName/mountedSkillIds/voiceId/skillId/`\brounds\b`）。
//   ③ `db.transaction(` 计数 = 0（引擎 core 不碰 DB 事务）。
//   ④ 单文件 ≤500 行。
//
// ⚠️ **为何行级 import 匹配 + 剥注释 + 排除测试**：原始红线是整文件子串扫 `import.*session-state|
//    fastify|ws|scenarioId|rounds|classCode`——会误伤 `assert.throws`（方法名含 `ws` 子串）、测试
//    fixture 里的 `classCode:'X'`、以及注释里为对照老源提到的领域词。本脚本把粗糙子串门升级成"只看
//    生产文件的 import 语句 + 剥注释后的代码"，消除这三类假阳性。
//
// ── P3a 扩展 scope：code/backend/src/session/ ────────────────────────────
// 会话内核（日志+游标投递层）生产 .js 额外机械核五项（任务单 §5 红线）：
//   ⑤ import 只许 node: 内建 + session/ 内 ./ 兄弟（零 transport import——对
//      transport 的依赖只许以 wakeup/longPoll port 形状注入，不许 import）；
//   ⑥ 剥注释后零 copycat 领域词（扩展词表 scenario/question/skill/scene/round，
//      含复数与 Id 后缀、camelCase 内嵌大写形式；lowercase 词中缀不匹配，避免
//      误伤 background/surround 这类无辜词）；
//   ⑦ 零全局非确定性：Date.now( / Math.random( 计数 = 0（clock/rng 一律注入）；
//   ⑧ db.transaction( 计数 = 0；
//   ⑨ 单文件 ≤500 行。
// session/ 不存在时该段优雅 SKIP（向后兼容 P2 及更早的分支）。
//
// ── P4 扩展 scope：code/backend/src/machine/ ─────────────────────────────
// 声明式状态机工具（defineMachine）是又一个纯逻辑子目录，与 session/ 要求完全
// 相同——⑤-⑨ 的 5 项检查（import 不出目录/零 transport、零扩展领域词、零
// Date.now/Math.random、无 db.transaction、≤500 行）对 machine/ 逐字复用（内部
// 抽成 checkStrictScope helper，session/ 与 machine/ 共用）。machine/ 不存在时
// 该段优雅 SKIP。states/events 是通用词，天然领域无关。
//
// 用法：node check-kernel-purity.mjs [transport-dir]
//   缺省 transport-dir = <repo>/code/backend/src/transport
//   transport/ 不存在时优雅 SKIP（exit 0）。
// 退出码：0 全 PASS；1 有 FAIL；2 用法错。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');   // review/reviewcode → repo 根
const realtimeDir = process.argv[2] || path.join(repoRoot, 'code/backend/src/transport');

if (!fs.existsSync(realtimeDir)) {
  console.log(`SKIP: transport dir 不存在（非引擎 PR）[${realtimeDir}]`);
  process.exit(0);
}

let failures = 0;
let passes = 0;
const pass = (m) => { passes += 1; console.log(`  PASS ${m}`); };
const fail = (m) => { failures += 1; console.log(`  FAIL ${m}`); };

console.log(`\n=== check-kernel-purity: ${path.relative(repoRoot, realtimeDir)} ===`);

// 递归收集生产 .js（排除 *.test.mjs / *.test.js）
function collect (dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.js') && !/\.test\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const prodFiles = collect(realtimeDir).sort();
if (prodFiles.length === 0) fail('transport/ 下没有找到任何生产 .js — 结构异常');

// ── ① import 行级：禁 transport/存储/领域层，允许 node: + transport 内 ./ 兄弟 ──
// forbidden import specifier 片段（对 quoted path 匹配，不扫整文件）
const FORBIDDEN_IMPORT = /(session-state|\/operations(\/|['"]|$)|repositor|\/db\.js|['"]db['"]|\/connection|fastify|@fastify|(^|\/)ws['"]|['"]ws['"]|socket\.io|(^|\/)http['"]|(^|\/)net['"])/;
const importSpecRe = /^\s*import\b[^;]*?from\s+['"]([^'"]+)['"]/gm;
const bareImportRe = /^\s*import\s+['"]([^'"]+)['"]/gm;   // side-effect import 'x'

// ── ② 领域词（剥注释后匹配代码）──
const DOMAIN_WORD = /\b(scenarioId|classCode|studentPhase|studentName|mountedSkillIds|voiceId|skillId|rounds)\b/;
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (naive; `://` in urls preserved by the [^:] guard)
}

console.log('\n[①-④] 逐文件：无 transport/domain import · 生产代码无领域词 · db.transaction(=0 · ≤500 行');
for (const full of prodFiles) {
  const rel = path.relative(realtimeDir, full);
  const src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n').length;

  // ① import 行级
  const specs = [];
  let m;
  importSpecRe.lastIndex = 0; while ((m = importSpecRe.exec(src)) !== null) specs.push(m[1]);
  bareImportRe.lastIndex = 0; while ((m = bareImportRe.exec(src)) !== null) specs.push(m[1]);
  let importOk = true;
  for (const spec of specs) {
    if (FORBIDDEN_IMPORT.test(spec)) { fail(`${rel}: 禁止的 transport/存储/领域层 import「${spec}」`); importOk = false; continue; }
    const isNode = spec.startsWith('node:');
    const isSibling = spec.startsWith('./') || spec.startsWith('../');
    if (!isNode && !isSibling) { fail(`${rel}: 非 node: 内建、非 ./ 兄弟的裸包 import「${spec}」（引擎 core 不应依赖第三方包）`); importOk = false; continue; }
    // ../ 逃出 transport/ 也算耦合
    if (isSibling) {
      const resolved = path.resolve(path.dirname(full), spec);
      if (!resolved.startsWith(realtimeDir + path.sep) && resolved !== realtimeDir) {
        fail(`${rel}: import「${spec}」逃出 transport/ 目录（跨层耦合）`); importOk = false;
      }
    }
  }
  if (importOk) pass(`${rel}: import 无 transport/存储/领域耦合（${specs.length ? specs.join(',') : '零 import'}）`);

  // ② 领域词（剥注释后的代码）
  const code = stripComments(src);
  const dm = code.match(DOMAIN_WORD);
  if (dm) fail(`${rel}: 生产代码出现 copycat 领域词「${dm[1]}」（引擎须领域无关）`);
  else pass(`${rel}: 剥注释后代码无 copycat 领域词`);

  // ③ db.transaction(
  const txn = (src.match(/db\.transaction\(/g) || []).length;
  if (txn === 0) pass(`${rel}: db.transaction(=0`);
  else fail(`${rel}: db.transaction(=${txn}`);

  // ④ ≤500
  if (lines <= 500) pass(`${rel}: ${lines} 行 ≤500`);
  else fail(`${rel}: ${lines} 行 >500`);
}

// ── ⑤-⑨ / ⑩-⑭ 严格 scope（session/ 与 machine/ 共用同一 5 项检查）──────────
// 两个纯逻辑子目录（P3a session/、P4 machine/）要求相同：import 不出本目录（零
// transport import——对 longPoll/wakeup 的依赖只许以 port 形状注入）、零扩展领域词、
// 零 Date.now/Math.random、无 db.transaction、≤500 行。抽成一个 helper 以 DRY。
const SESSION_WORD_LOWER = /\b(scenario|question|skill|scene|round)(s|id|ids)?\b/i;
const SESSION_WORD_CAMEL = /(Scenario|Question|Skill|Scene|Round)/;
const GLOBAL_NONDET = /\b(?:Date\s*\.\s*now|Math\s*\.\s*random)\s*\(/g;

/**
 * 对一个纯逻辑子目录跑 5 项严格纯度检查。
 * @param {string} dir 目录绝对路径 @param {string} label 报告用短名（session/machine）
 * @param {string} banner 段落标题
 * @param {string[]} [allowedOutside] 受控白名单：允许 import 解析到的**具体文件**
 *   绝对路径（P5 收债：session/envelope.js 复用 queue/ids.js 的 id 生成器——去重
 *   优先于目录自闭；白名单文件本身必须在别处纳入同 5 项严格检查，见 [⑮] 段）。
 */
function checkStrictScope (dir, label, banner, allowedOutside = [], onlyFiles = null) {
  if (!fs.existsSync(dir)) {
    console.log(`\n${banner.replace(/：.*/, '')} SKIP: ${label}/ 不存在（该扩展之前的分支）`);
    return;
  }
  const files = (onlyFiles ?? collect(dir)).sort();
  if (files.length === 0) fail(`${label}/ 存在但没有任何生产 .js — 结构异常`);

  console.log(`\n${banner}`);
  for (const full of files) {
    const rel = `${label}/${path.relative(dir, full)}`;
    const src = fs.readFileSync(full, 'utf8');
    const lines = src.split('\n').length;

    // import：只许 node: + 解析后仍在本目录内的 ./ 兄弟；零 transport。
    const specs = [];
    let m;
    importSpecRe.lastIndex = 0; while ((m = importSpecRe.exec(src)) !== null) specs.push(m[1]);
    bareImportRe.lastIndex = 0; while ((m = bareImportRe.exec(src)) !== null) specs.push(m[1]);
    let importOk = true;
    for (const spec of specs) {
      if (/transport/.test(spec)) { fail(`${rel}: 禁止 import transport「${spec}」（等待机制只许以 longPoll/wakeup port 形状注入）`); importOk = false; continue; }
      if (FORBIDDEN_IMPORT.test(spec)) { fail(`${rel}: 禁止的 transport/存储/领域层 import「${spec}」`); importOk = false; continue; }
      const isNode = spec.startsWith('node:');
      const isSibling = spec.startsWith('./') || spec.startsWith('../');
      if (!isNode && !isSibling) { fail(`${rel}: 非 node: 内建、非 ./ 兄弟的裸包 import「${spec}」（纯逻辑内核不应依赖第三方包）`); importOk = false; continue; }
      if (isSibling) {
        const resolved = path.resolve(path.dirname(full), spec);
        const inDir = resolved.startsWith(dir + path.sep) || resolved === dir;
        const whitelisted = allowedOutside.includes(resolved);
        if (!inDir && !whitelisted) {
          fail(`${rel}: import「${spec}」逃出 ${label}/ 目录（跨层耦合）`); importOk = false;
        }
      }
    }
    if (importOk) pass(`${rel}: import 不出 ${label}/（白名单外零逃逸）、零 transport 耦合（${specs.length ? specs.join(',') : '零 import'}）`);

    // 扩展领域词（剥注释后的代码）。
    const code = stripComments(src);
    const lower = code.match(SESSION_WORD_LOWER);
    const camel = code.match(SESSION_WORD_CAMEL);
    if (lower) fail(`${rel}: 生产代码出现 copycat 领域词「${lower[0]}」（${label}/ 须领域无关）`);
    else if (camel) fail(`${rel}: 生产代码标识符内嵌领域词「${camel[1]}」（${label}/ 须领域无关）`);
    else pass(`${rel}: 剥注释后代码零领域词（扩展词表 scenario/question/skill/scene/round）`);

    // 零全局非确定性。
    const nondet = (code.match(GLOBAL_NONDET) || []).length;
    if (nondet === 0) pass(`${rel}: Date.now(/Math.random(=0（非确定性全走注入）`);
    else fail(`${rel}: 出现 ${nondet} 处 Date.now(/Math.random(（必须走 clock/rng 注入）`);

    // db.transaction(
    const txn = (src.match(/db\.transaction\(/g) || []).length;
    if (txn === 0) pass(`${rel}: db.transaction(=0`);
    else fail(`${rel}: db.transaction(=${txn}`);

    // ≤500
    if (lines <= 500) pass(`${rel}: ${lines} 行 ≤500`);
    else fail(`${rel}: ${lines} 行 >500`);
  }
}

// ⑤-⑨ P3a session/ 扩展 scope。P5 收债起：受控白名单允许且仅允许 import
// queue/ids.js（envelope 缺省 id 生成去重到唯一事实源；该文件本身在 [⑮] 段
// 纳入同 5 项严格检查，保证被引入 session/ 的代码不弱于 session/ 自身标准）。
const QUEUE_IDS = path.join(repoRoot, 'code/backend/src/queue/ids.js');
checkStrictScope(
  path.join(repoRoot, 'code/backend/src/session'),
  'session',
  '[⑤-⑨] session/ 逐文件：import 不出目录（白名单：queue/ids.js）· 零 transport · 零领域词(扩展词表) · 零 Date.now/Math.random · db.transaction(=0 · ≤500 行',
  [QUEUE_IDS],
);

// ⑩-⑭ P4 machine/ 扩展 scope（声明式状态机工具；同 session 的 5 项严格检查）。
checkStrictScope(
  path.join(repoRoot, 'code/backend/src/machine'),
  'machine',
  '[⑩-⑭] machine/ 逐文件：import 不出目录（零 transport）· 零领域词(扩展词表) · 零 Date.now/Math.random · db.transaction(=0 · ≤500 行',
);

// ⑮ P5 白名单闭环：session/ 获准引用的 queue/ids.js 本身必须过同 5 项严格检查
// （import 自闭/零 transport、零扩展领域词、零 Date.now/Math.random、无
// db.transaction、≤500 行）——白名单不成为纯度盲区。注意：queue/ 其余文件
// （ordering.js 含领域相邻词 rounds）仍不在纯度门覆盖内，scope 不变。
if (fs.existsSync(QUEUE_IDS)) {
  checkStrictScope(
    path.join(repoRoot, 'code/backend/src/queue'),
    'queue',
    '[⑮] 白名单文件 queue/ids.js：同 session/machine 的 5 项严格检查（白名单闭环）',
    [],
    [QUEUE_IDS],
  );
} else {
  fail('queue/ids.js 不存在但被 session/ 白名单引用——结构异常');
}

console.log(`\n=== kernel-purity: ${passes} PASS / ${failures} FAIL ===`);
process.exit(failures === 0 ? 0 : 1);
