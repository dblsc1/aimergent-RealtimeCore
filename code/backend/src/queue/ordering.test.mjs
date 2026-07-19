// realtime_core · queue/ordering.test.mjs（P5 收债：P1 遗留"ordering.js 无专属测试"）
//
// 钉死 orderedSessionEvents / maxEventSeq 的既有行为（P1 逐字抽取面，纯函数）：
//   - 排序键：seq → createdAt → round，跨 round 摊平；
//   - 空洞容忍：null slot / 无 type 事件跳过；round 缺省 = index+1；
//   - `assignMissing` 是老源哑参数（两分支逻辑相同），输出必须与不传一致；
//   - maxEventSeq：全 session 最大 seq，空/无事件 = 0，非有限 seq 忽略；
//   - 崩溃行为保留：maxEventSeq(null) 抛（老源无 null 兜底，契约"遗产兼容面"注明）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedSessionEvents, maxEventSeq } from './ordering.js';

function sampleSession () {
  return {
    rounds: [
      { round: 1, _events: [{ type: 'b', seq: 2, createdAt: 10 }, { type: 'a', seq: 1, createdAt: 20 }] },
      null, // 空槽：跳过
      { round: 3, _events: [{ type: 'd', seq: 2, createdAt: 5 }, { type: 'no-seq' }, { seq: 9 }] },
    ],
  };
}

test('orderedSessionEvents · 跨 round 摊平并按 seq → createdAt → round 排序', () => {
  const out = orderedSessionEvents(sampleSession());
  // seq=1(a) 最先；seq=2 两条按 createdAt（5 的 d 在 10 的 b 前）；无 seq(=0) 的排最前。
  assert.deepEqual(
    out.map((x) => [x.event.type, x.round]),
    [['no-seq', 3], ['a', 1], ['d', 3], ['b', 1]],
  );
  // 无 type 的事件（{seq:9}）被跳过，不出现在结果里。
  assert.equal(out.some((x) => x.event.seq === 9), false);
});

test('orderedSessionEvents · seq 与 createdAt 都相同时按 round 决胜', () => {
  const session = {
    rounds: [
      { round: 2, _events: [{ type: 'late', seq: 1, createdAt: 7 }] },
      { round: 1, _events: [{ type: 'early', seq: 1, createdAt: 7 }] },
    ],
  };
  assert.deepEqual(orderedSessionEvents(session).map((x) => x.event.type), ['early', 'late']);
});

test('orderedSessionEvents · slot.round 缺省回退到 index+1（并透出 slot 引用）', () => {
  const slot = { _events: [{ type: 'x', seq: 1 }] };
  const out = orderedSessionEvents({ rounds: [null, slot] });
  assert.equal(out.length, 1);
  assert.equal(out[0].round, 2); // index 1 → round 2
  assert.equal(out[0].slot, slot);
});

test('orderedSessionEvents · assignMissing 是哑参数：true/false/缺省输出逐字一致', () => {
  const s = sampleSession();
  const plain = orderedSessionEvents(s);
  assert.deepEqual(orderedSessionEvents(s, { assignMissing: true }), plain);
  assert.deepEqual(orderedSessionEvents(s, { assignMissing: false }), plain);
});

test('orderedSessionEvents · null/无 rounds 的 session 返回空数组（?. 兜底）', () => {
  assert.deepEqual(orderedSessionEvents(null), []);
  assert.deepEqual(orderedSessionEvents({}), []);
  assert.deepEqual(orderedSessionEvents({ rounds: [] }), []);
});

test('maxEventSeq · 全 session 最大 seq；无事件/空 rounds = 0；与投影不对称——无 type 事件也计入', () => {
  // 注意与 orderedSessionEvents 的不对称（老源既有行为，原样钉死）：投影跳过
  // 无 type 事件，但 maxEventSeq 扫**全部**事件——sampleSession 里 {seq:9} 无
  // type，不出现在投影里，却贡献最大 seq。
  assert.equal(maxEventSeq(sampleSession()), 9);
  assert.equal(maxEventSeq({ rounds: [{ round: 1, _events: [{ type: 'z', seq: 41 }] }] }), 41);
  assert.equal(maxEventSeq({ rounds: [] }), 0);
  assert.equal(maxEventSeq({}), 0);
});

test('maxEventSeq · 非有限 seq（NaN/Infinity/非数值）忽略，不污染最大值', () => {
  const session = {
    rounds: [{ _events: [{ type: 'a', seq: 3 }, { type: 'b', seq: 'oops' }, { type: 'c', seq: Infinity }] }],
  };
  assert.equal(maxEventSeq(session), 3);
});

test('maxEventSeq · 保留老源崩溃行为：session=null 直接抛（无 null 兜底）', () => {
  assert.throws(() => maxEventSeq(null), TypeError);
});
