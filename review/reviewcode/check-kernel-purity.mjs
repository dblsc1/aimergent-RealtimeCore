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

console.log(`\n=== kernel-purity: ${passes} PASS / ${failures} FAIL ===`);
process.exit(failures === 0 ? 0 : 1);
