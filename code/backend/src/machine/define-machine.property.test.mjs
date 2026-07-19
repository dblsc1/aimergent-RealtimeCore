// realtime_core · machine/define-machine.property.test.mjs（P4 · 不变量）
//
// 固定种子 property（沿用仓内 mulberry32 约定：CI 每次跑出的用例集合相同，零新
// 依赖）。两条核心不变量：
//   不变量1（状态封闭性）：任意事件序列下，transition 返回的状态恒 ∈ states 全集，
//     且与 can 一致（can=true ⟺ transition 成功）。机器永远走不出声明的状态。
//   不变量2（终态吸收性）：一旦进入 final 状态，任何事件恒 throw（且 can=false），
//     机器不可复活。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineMachine, IllegalTransitionError } from './define-machine.js';

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function rand () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 被测机：4 态、含守卫、含终态。EVENTS 含机器不认识的噪声事件（NOISE）以搅动
// event-not-handled 路径。
function machine () {
  return defineMachine({
    id: 'prop-machine',
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'asking' } } },
      asking: {
        on: {
          ANSWER: { target: 'awaiting', guard: 'coin' },
          CLOSE: { target: 'closed' },
        },
      },
      awaiting: { on: { EXTRACTED: { target: 'asking' }, CLOSE: { target: 'closed' } } },
      closed: { type: 'final' },
    },
    // 纯谓词：由 ctx.token 决定（测试完全掌控，无随机/时钟）。
    guards: { coin: (ctx) => ctx?.token === true },
  });
}

const EVENTS = ['START', 'ANSWER', 'CLOSE', 'EXTRACTED', 'NOISE'];

test('property① · 状态封闭性：任意事件序列下 transition 结果恒 ∈ states，且 can ⟺ transition 成功（200 种子×40 步）', () => {
  const m = machine();
  const stateSet = new Set(m.states);
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 17 + 3);
    let state = m.initial;
    for (let step = 0; step < 40; step += 1) {
      const event = EVENTS[Math.floor(rand() * EVENTS.length)];
      const ctx = { token: rand() < 0.5 };
      const allowed = m.can(state, event, ctx);
      if (allowed) {
        const r = m.transition(state, event, ctx);
        assert.equal(stateSet.has(r.state), true, `seed=${seed} step=${step}: 转移后状态「${r.state}」必 ∈ states`);
        assert.equal(r.changed, r.state !== state, `seed=${seed} step=${step}: changed 语义`);
        state = r.state;
      } else {
        // can=false ⟺ transition 必抛（一致性）。
        assert.throws(() => m.transition(state, event, ctx), IllegalTransitionError,
          `seed=${seed} step=${step}: can=false 时 transition 必抛`);
        assert.equal(stateSet.has(state), true, `seed=${seed} step=${step}: 状态未被非法转移污染`);
      }
    }
  }
});

test('property② · 终态吸收性：进入 final 后任何事件恒 throw 且 can=false，机器不可复活（120 种子）', () => {
  const m = machine();
  for (let seed = 1; seed <= 120; seed += 1) {
    const rand = mulberry32(seed * 23 + 9);
    // 走一段随机序列，只要能到 closed 就停。
    let state = m.initial;
    let reachedFinal = false;
    for (let step = 0; step < 60 && !reachedFinal; step += 1) {
      const event = EVENTS[Math.floor(rand() * EVENTS.length)];
      const ctx = { token: rand() < 0.5 };
      if (m.can(state, event, ctx)) {
        state = m.transition(state, event, ctx).state;
        if (m.finalStates.includes(state)) reachedFinal = true;
      }
    }
    // 强制进终态（若随机没走到，直接从 asking 触发 CLOSE 保证覆盖）。
    if (!reachedFinal) {
      state = m.transition('asking', 'CLOSE').state;
    }
    assert.equal(m.finalStates.includes(state), true, `seed=${seed}: 应处于终态`);
    // 终态后：对每个事件，can 恒 false 且 transition 恒抛——不可复活。
    for (const event of EVENTS) {
      assert.equal(m.can(state, event, { token: true }), false, `seed=${seed}: 终态对「${event}」can 必 false`);
      assert.throws(() => m.transition(state, event, { token: true }), IllegalTransitionError,
        `seed=${seed}: 终态对「${event}」transition 必抛（不可复活）`);
    }
  }
});
