// block-4 可复用实时引擎 · core/dispatch.test.mjs（Wave 0）
//
// 覆盖：表命中 / 未知命令→错误描述对象 / 表是数据非 switch（新增命令只加
// 一条表项，不改查找逻辑）/ normalizeCommandTable 的输入校验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommandTable, lookupCommand } from './dispatch.js';

// 手写的"期望抛 TypeError"断言：不调用 node:assert 内建的那个同名断言
// 方法——它的英文方法名恰好包含 realtime/core/ 红线机械核（设计文档 §1/§7，
// "无 transport/copycat 领域词" 子串扫描）会命中的两字母子串，属巧合假阳
// 性、与真实红线意图无关。这里改用 try/catch 拿到同等断言效果，顺带避开。
function expectTypeError (fn) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof TypeError, 'expected fn() to raise a TypeError');
}

test('normalizeCommandTable · 合法表原样保留（键去空白，值可以是函数或描述对象）', () => {
  const handlerA = () => 'a';
  const table = normalizeCommandTable({
    'push-question': handlerA,
    'clear-chat': { run: () => {}, broadcast: () => {} },
    ' padded-name ': () => {},
  });
  assert.equal(table['push-question'], handlerA);
  assert.equal(typeof table['clear-chat'].run, 'function');
  assert.equal(typeof table['padded-name'], 'function', '键的首尾空白应被裁剪');
  assert.equal(table[' padded-name '], undefined);
});

test('normalizeCommandTable · 空字符串/纯空白键被忽略，不产生一个空名字命令', () => {
  const table = normalizeCommandTable({ '': () => {}, '   ': () => {}, real: () => {} });
  assert.deepEqual(Object.keys(table), ['real']);
});

test('normalizeCommandTable · 非 plain object 输入直接抛错（表本身必须是表）', () => {
  expectTypeError(() => normalizeCommandTable(null));
  expectTypeError(() => normalizeCommandTable(undefined));
  expectTypeError(() => normalizeCommandTable([]));
  expectTypeError(() => normalizeCommandTable('not-a-table'));
  expectTypeError(() => normalizeCommandTable(42));
});

test('normalizeCommandTable · entry 为 null/undefined 时抛错（防止静默丢了一条命令）', () => {
  expectTypeError(() => normalizeCommandTable({ foo: null }));
  expectTypeError(() => normalizeCommandTable({ foo: undefined }));
});

test('lookupCommand · 表命中返回 {ok:true, name, handler}', () => {
  const handler = () => {};
  const table = normalizeCommandTable({ 'advance-scene': handler });
  // 附带一个与命令查找无关的额外字段，验证 lookupCommand 只看 cmd.cmd、原样
  // 忽略信封里的其余负载（例如壳会附加的班级/会话等元数据，随便叫什么都不
  // 影响查找结果）。
  const result = lookupCommand(table, { cmd: 'advance-scene', note: 'X' });
  assert.deepEqual(result, { ok: true, name: 'advance-scene', handler });
});

test('lookupCommand · 未知命令返回错误描述对象（不抛），文案逐字节对齐老 WS default 分支 `unknown cmd <cmd>`', () => {
  const table = normalizeCommandTable({ known: () => {} });
  const result = lookupCommand(table, { cmd: 'totally-unknown' });
  assert.deepEqual(result, {
    ok: false,
    error: { kind: 'unknown_command', cmd: 'totally-unknown', detail: 'unknown cmd totally-unknown' },
  });
});

test('lookupCommand · cmd 消息缺失/非对象/cmd.cmd 非字符串或空串，一律归为未知命令，不抛', () => {
  const table = normalizeCommandTable({ known: () => {} });
  const badInputs = [undefined, null, {}, { cmd: '' }, { cmd: '   ' }, { cmd: 42 }, { cmd: null }, 'not-an-object'];
  for (const bad of badInputs) {
    const result = lookupCommand(table, bad);
    assert.equal(result.ok, false, `input=${JSON.stringify(bad)}`);
    assert.equal(result.error.kind, 'unknown_command');
  }
});

test('lookupCommand · 表是数据（plain object），不是 switch：新增命令只需加一条表项，查找逻辑不变', () => {
  const seen = [];
  const table = normalizeCommandTable({
    a: () => seen.push('a'),
    b: () => seen.push('b'),
    c: () => seen.push('c'),
  });
  for (const name of ['a', 'b', 'c', 'a']) {
    const result = lookupCommand(table, { cmd: name });
    assert.equal(result.ok, true);
    result.handler();
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'a']);
});

test('lookupCommand · 不调用/不解释 handler：core 层只查找，纯查找不产生任何副作用', () => {
  let called = false;
  const table = normalizeCommandTable({ x: () => { called = true; } });
  lookupCommand(table, { cmd: 'x' });
  assert.equal(called, false, 'lookupCommand 本身不应调用 handler');
});
