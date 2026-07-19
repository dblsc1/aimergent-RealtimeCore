#!/usr/bin/env node
// check-verbatim-extraction.mjs — realtime_core 逐字抽取机械门（任务单 §3 红线）。
//
// 断言：本仓每个抽取文件相对其 copycat 源文件**逐行一致**，唯一允许的差异行
// 是 import / 路径引用（白名单）。任何其余差异 = FAIL 并列出行号。
// 抽取的红线是"只许改 import 路径 / 文件头路径字符串"，本门把它变成可机械核验的事实。
//
// 判定一条差异行是否"仅 import/路径改动"：把源行、目标行里所有引号字符串
// （'...' / "..." / `...`）替换成同一占位符后若**完全相等**，且该行是
// import / export...from / require / 注释行之一 → 判为白名单允许；否则 FAIL。
// （import-only 编辑保持行数不变，故用逐行位置比对；行数不等即视为非白名单差异。）
//
// 源仓只读，绝不写。源根可用 argv[2] 覆盖，缺省指向母代码 copycat 主工作区。
// 用法：node check-verbatim-extraction.mjs [copycat-src-root]
//   缺省 copycat-src-root = /srv/aimergent/0/functions/copycat/code/backend/src/services
// 退出码：0 全 PASS；1 有 FAIL；2 源缺失/用法错。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');   // review/reviewcode → repo 根
const SRC_ROOT = process.argv[2] || '/srv/aimergent/0/functions/copycat/code/backend/src/services';
const targetRoot = path.join(repoRoot, 'code/backend/src');

// 抽取映射：[源(相对 SRC_ROOT), 目标(相对 targetRoot)]。7 生产 + 6 测试。
const MAP = [
  // ── 生产文件（任务单 §2 映射表）──
  ['realtime/core/poll-machine.js',      'transport/core/poll-machine.js'],
  ['realtime/core/dispatch.js',          'transport/core/dispatch.js'],
  ['realtime/engine.js',                 'transport/engine.js'],
  ['realtime/channels.js',               'transport/channels.js'],
  ['session-state/locks.js',             'concurrency/locks.js'],
  ['session-state/core/ordering.js',     'queue/ordering.js'],
  ['session-state/core/ids.js',          'queue/ids.js'],
  // ── 配套测试（同抽取，逐字）──
  ['realtime/core/poll-machine.property.test.mjs', 'transport/core/poll-machine.property.test.mjs'],
  ['realtime/core/dispatch.test.mjs',              'transport/core/dispatch.test.mjs'],
  ['realtime/channels.test.mjs',                   'transport/channels.test.mjs'],
  ['realtime/engine.integration.test.mjs',         'transport/engine.integration.test.mjs'],
  ['session-state/locks.mirror.test.mjs',          'concurrency/locks.mirror.test.mjs'],
  ['session-state/core/ids.test.mjs',              'queue/ids.test.mjs'],
];

let failures = 0;
let passes = 0;
const pass = (m) => { passes += 1; console.log(`  PASS ${m}`); };
const fail = (m) => { failures += 1; console.log(`  FAIL ${m}`); };

if (!fs.existsSync(SRC_ROOT)) {
  console.error(`用法错：copycat 源根不存在 [${SRC_ROOT}]`);
  process.exit(2);
}

// 白名单：一条差异行只有在 ① 剥掉所有引号字符串后源/目标残余完全相等，
// 且 ② 该行是 import / export...from / require / 注释行 时，才被允许。
const stripQuoted = (line) => line
  .replace(/`[^`]*`/g, '§')
  .replace(/'[^']*'/g, '§')
  .replace(/"[^"]*"/g, '§');
const IS_IMPORTISH = /^\s*(import\b|export\b[^;]*\bfrom\b|const\b.*\brequire\s*\(|.*\brequire\s*\(|\/\/|\*|\/\*)/;
function isWhitelisted (srcLine, dstLine) {
  if (stripQuoted(srcLine) !== stripQuoted(dstLine)) return false;
  return IS_IMPORTISH.test(srcLine) || IS_IMPORTISH.test(dstLine);
}

console.log(`\n=== check-verbatim-extraction ===`);
console.log(`源根: ${SRC_ROOT}`);
console.log(`目标: ${path.relative(repoRoot, targetRoot)}\n`);

for (const [srcRel, dstRel] of MAP) {
  const srcPath = path.join(SRC_ROOT, srcRel);
  const dstPath = path.join(targetRoot, dstRel);
  if (!fs.existsSync(srcPath)) { fail(`${dstRel}: 源文件缺失 [${srcPath}]`); continue; }
  if (!fs.existsSync(dstPath)) { fail(`${dstRel}: 目标文件缺失 [${dstPath}]`); continue; }

  const srcLines = fs.readFileSync(srcPath, 'utf8').split('\n');
  const dstLines = fs.readFileSync(dstPath, 'utf8').split('\n');

  if (srcLines.length !== dstLines.length) {
    fail(`${dstRel}: 行数不等（源 ${srcLines.length} vs 目标 ${dstLines.length}）— 非 import-only 改动`);
    continue;
  }

  const violations = [];
  let changedLines = 0;
  for (let i = 0; i < srcLines.length; i++) {
    if (srcLines[i] === dstLines[i]) continue;
    changedLines += 1;
    if (!isWhitelisted(srcLines[i], dstLines[i])) {
      violations.push(`    L${i + 1}: 源「${srcLines[i]}」→ 目标「${dstLines[i]}」`);
    }
  }

  if (violations.length > 0) {
    fail(`${dstRel}: ${violations.length} 处非白名单差异（非 import/路径）:`);
    for (const v of violations) console.log(v);
  } else {
    pass(`${dstRel}: 逐字一致（${changedLines} 处差异，全为 import/路径白名单）`);
  }
}

console.log(`\n=== verbatim-extraction: ${passes} PASS / ${failures} FAIL ===`);
process.exit(failures === 0 ? 0 : 1);
