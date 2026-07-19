// block-3 session-state · core/ids.test.mjs（Wave 0）
//
// ids.js 没有老源对应函数（`genEventId` 是老 `eventId()` 换了注入形态；
// `genTurnId` 是全新的、为 Wave 2 两段式操作备用的稳定 id 生成器，本波
// 不接线）——所以不是"镜像"测试，是新代码自身的行为基线：格式、注入
// 生效、不同调用不撞车。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genEventId, genTurnId } from './ids.js';

test('genEventId · 格式为 evt-<clock>-<rand36>，且完全由注入的 clock/rng 决定（零全局读取）', () => {
  const ctx = { clock: () => 1700000000000, rng: () => 0.123456789 };
  const id = genEventId(ctx);
  assert.equal(id, `evt-1700000000000-${(0.123456789).toString(36).slice(2, 8)}`);
});

test('genTurnId · 格式为 q-<clock>-<rand36>，与 genEventId 前缀不同', () => {
  const ctx = { clock: () => 42, rng: () => 0.5 };
  const id = genTurnId(ctx);
  assert.equal(id, `q-42-${(0.5).toString(36).slice(2, 8)}`);
  assert.notEqual(id.slice(0, 2), 'ev');
});

test('genEventId/genTurnId · 相同 ctx 不同次调用互不影响（每次都重新读 ctx.clock()/ctx.rng()，不缓存）', () => {
  let n = 0;
  const values = [1000, 2000, 3000];
  const ctx = { clock: () => values[n++], rng: () => 0.1 };
  const a = genEventId(ctx);
  const b = genEventId(ctx);
  assert.notEqual(a, b, '两次调用应该各自读一次 clock()，不是同一个值');
  assert.match(a, /^evt-1000-/);
  assert.match(b, /^evt-2000-/);
});

test('genEventId · 固定 ctx 是纯函数：同一对 clock/rng 返回值，多次调用产出相同 id（可重放）', () => {
  const ctx = { clock: () => 999, rng: () => 0.42 };
  assert.equal(genEventId(ctx), genEventId(ctx));
});
