// realtime_core · session/aggregate.property.test.mjs（P3b · 验收核心）
//
// 任务单 §4 四条不变量的 property 测试（PRNG 沿用仓内 mulberry32 固定种子约定：
// CI 每次跑出的用例集合相同，零新依赖）。影子模型 harness：测试侧独立按
// decide/evolve 语义维护一份"应有状态"，每步与运行时重建的真实状态深比较——
// 模型即不变量的可执行表述。
//
//   不变量1（重放确定性：崩溃后 load 重建 === 一路 evolve；含快照 present/absent/
//     behind 三形态）→ 测试 ①
//   不变量2（拒绝无痕：reject 不产事件/不改状态/不动日志）→ 测试 ①（内嵌）+ 测试 ②
//   不变量3（decide/evolve 只见升级后事件：重放路径上每个事件 v === 当前版本）
//     → 测试 ③（随机 v1 日志重放）
//   不变量4（execute 串行：并发 execute 同 stream 等价于某串行序、CAS 零冲突；
//     出现 ConflictError 即锁失效）→ 测试 ④（有锁零冲突）+ 测试 ⑤（去锁则响亮冲突）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineAggregate, reject } from './aggregate.js';
import { createMemoryLogStore } from './memory-log-store.js';
import { createMemorySnapshotStore } from './memory-snapshot-store.js';
import { createAggregateRuntime } from './aggregate-runtime.js';
import { withLock } from '../concurrency/locks.js';

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function rand () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCtx () {
  let now = 0; let n = 0;
  return { clock: () => { now += 1; return now; }, rng: () => { n += 1; return (n % 97) / 97; } };
}

// ── 影子模型：与聚合 decide/evolve 语义逐字对应的可执行不变量 ──────────────
// acc 聚合（单版本，用于不变量 1/2/4）：add/freeze/unfreeze。
function accAggregate () {
  return defineAggregate({
    name: 'acc',
    initial: () => ({ total: 0, ops: 0, frozen: false }),
    decide: {
      add: (s, cmd) => (s.frozen ? reject('frozen') : [{ type: 'added', payload: { n: cmd.n } }]),
      freeze: (s) => (s.frozen ? reject('already-frozen') : [{ type: 'frozen-evt', payload: {} }]),
      unfreeze: (s) => (s.frozen ? [{ type: 'unfrozen-evt', payload: {} }] : reject('not-frozen')),
    },
    evolve: {
      added: (s, ev) => ({ ...s, total: s.total + ev.payload.n, ops: s.ops + 1 }),
      'frozen-evt': (s) => ({ ...s, frozen: true }),
      'unfrozen-evt': (s) => ({ ...s, frozen: false }),
    },
  });
}

// 影子：给定当前 model 与命令，返回 { rejected } 或 { next }（新 model）。
function shadowStep (model, cmd) {
  if (cmd.type === 'add') {
    if (model.frozen) return { rejected: 'frozen' };
    return { next: { ...model, total: model.total + cmd.n, ops: model.ops + 1 } };
  }
  if (cmd.type === 'freeze') {
    if (model.frozen) return { rejected: 'already-frozen' };
    return { next: { ...model, frozen: true } };
  }
  if (cmd.type === 'unfreeze') {
    if (!model.frozen) return { rejected: 'not-frozen' };
    return { next: { ...model, frozen: false } };
  }
  throw new Error('unreachable');
}

function randomCommand (rand) {
  const r = rand();
  if (r < 0.6) return { type: 'add', n: 1 + Math.floor(rand() * 5) };
  if (r < 0.8) return { type: 'freeze' };
  return { type: 'unfreeze' };
}

test('property① · 不变量1+2：随机命令序列下，快照(每3事件)/无快照/崩溃重建三条重建路径的 load 恒等于影子模型；被拒命令不动日志/不改状态（250 种子×24 步）', async () => {
  for (let seed = 1; seed <= 250; seed += 1) {
    const rand = mulberry32(seed * 7 + 1);
    const store = createMemoryLogStore(newCtx());
    const snaps = createMemorySnapshotStore();
    const rtSnap = createAggregateRuntime({ aggregate: accAggregate(), logStore: store, snapshotStore: snaps, snapshotEvery: 3 });
    let model = { total: 0, ops: 0, frozen: false };

    for (let step = 0; step < 24; step += 1) {
      const cmd = randomCommand(rand);
      const logLenBefore = store.read('s1', 0).length;
      const expected = shadowStep(model, cmd);
      const result = await rtSnap.execute('s1', cmd);

      if (expected.rejected !== undefined) {
        // 不变量2：拒绝无痕。
        assert.deepEqual(result.rejected, { code: expected.rejected, detail: undefined },
          `seed=${seed} step=${step}: 拒绝码应匹配影子`);
        assert.equal(store.read('s1', 0).length, logLenBefore, `seed=${seed} step=${step}: reject 不得写日志`);
      } else {
        model = expected.next;
        assert.deepEqual(result.state, model, `seed=${seed} step=${step}: execute 返回态应等于影子`);
      }

      // 不变量1：三条重建路径都必须等于影子模型。
      assert.deepEqual(rtSnap.load('s1'), model, `seed=${seed} step=${step}: 快照路径 load 应等于影子`);
      const rtNoSnap = createAggregateRuntime({ aggregate: accAggregate(), logStore: store });
      assert.deepEqual(rtNoSnap.load('s1'), model, `seed=${seed} step=${step}: 无快照全量重放应等于影子`);
      const rtCrash = createAggregateRuntime({ aggregate: accAggregate(), logStore: store, snapshotStore: snaps, snapshotEvery: 3 });
      assert.deepEqual(rtCrash.load('s1'), model, `seed=${seed} step=${step}: 崩溃重建（新实例+幸存快照）应等于影子`);
    }
  }
});

test('property② · 不变量2 聚焦：从任意状态发一条必被拒的命令，日志长度/游标/重建态三者纹丝不动（200 种子）', async () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 13 + 5);
    const store = createMemoryLogStore(newCtx());
    const rt = createAggregateRuntime({ aggregate: accAggregate(), logStore: store });
    // 随机铺一段合法前缀。
    let frozen = false;
    const prefix = Math.floor(rand() * 6);
    for (let i = 0; i < prefix; i += 1) {
      if (!frozen && rand() < 0.3) { await rt.execute('s1', { type: 'freeze' }); frozen = true; }
      else if (frozen && rand() < 0.5) { await rt.execute('s1', { type: 'unfreeze' }); frozen = false; }
      else if (!frozen) await rt.execute('s1', { type: 'add', n: 1 + Math.floor(rand() * 4) });
    }
    const logBefore = store.read('s1', 0).length;
    const stateBefore = rt.load('s1');
    // 构造一条必被拒的命令。
    const rejectCmd = frozen ? { type: 'add', n: 3 } : { type: 'unfreeze' };
    const r = await rt.execute('s1', rejectCmd);
    assert.notEqual(r.rejected, undefined, `seed=${seed}: 命令应被拒`);
    assert.equal(store.read('s1', 0).length, logBefore, `seed=${seed}: 日志长度不变`);
    assert.deepEqual(rt.load('s1'), stateBefore, `seed=${seed}: 重建态不变`);
  }
});

// ── 不变量3：v1 日志重放，evolve 只见当前版本（v2）───────────────────────
test('property③ · 不变量3：随机长度 v1 日志经 upcaster 重放，evolve 收到的每个事件 v 恒 === 当前版本；加权状态与影子(weight=1)一致（200 种子）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 29 + 11);
    const store = createMemoryLogStore(newCtx());
    // 直接写 v1 'added' 事件（模拟旧代码留下的日志）。
    const count = 1 + Math.floor(rand() * 12);
    let shadowTotal = 0;
    let expectedLast = 0;
    for (let i = 0; i < count; i += 1) {
      const n = 1 + Math.floor(rand() * 6);
      store.append('s1', expectedLast, [{ type: 'added', v: 1, payload: { n } }]);
      expectedLast += 1;
      shadowTotal += n; // v1 → weight 补 1 → total += n*1
    }
    const seenVersions = [];
    const aggV2 = defineAggregate({
      name: 'acc', schemaVersion: 2,
      initial: () => ({ total: 0 }),
      decide: { add: (_s, c) => [{ type: 'added', payload: { n: c.n, weight: 1 } }] },
      evolve: { added: (s, ev) => { seenVersions.push(ev.v); return { total: s.total + ev.payload.n * ev.payload.weight }; } },
      eventVersions: { added: 2 },
      upcasters: { added: { 1: (ev) => ({ ...ev, payload: { ...ev.payload, weight: 1 } }) } },
    });
    const rt = createAggregateRuntime({ aggregate: aggV2, logStore: store });
    const state = rt.load('s1');
    assert.deepEqual(state, { total: shadowTotal }, `seed=${seed}: v1 日志按 weight=1 重放，state 应等影子`);
    assert.equal(seenVersions.length, count);
    assert.equal(seenVersions.every((v) => v === 2), true, `seed=${seed}: evolve 见到的每个事件 v 必 === 当前版本 2`);
  }
});

// ── 不变量4：execute 串行 ───────────────────────────────────────────────
test('property④ · 不变量4：并发 execute 同一 stream（真锁）结果等价于串行、seq 连续、零 CAS 冲突（120 种子）', async () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const rand = mulberry32(seed * 31 + 7);
    const store = createMemoryLogStore(newCtx());
    const rt = createAggregateRuntime({ aggregate: accAggregate(), logStore: store, locks: { withLock } });
    const k = 5 + Math.floor(rand() * 16);
    const adds = Array.from({ length: k }, () => 1 + Math.floor(rand() * 5));
    // 同时发起 k 个 add，不逐个 await——锁负责串行化。
    const results = await Promise.all(adds.map((n) => rt.execute('s1', { type: 'add', n })));
    assert.equal(results.every((r) => r.events && r.events.length === 1), true,
      `seed=${seed}: 每个 execute 都应成功产 1 事件（无 ConflictError 逃逸）`);
    const seqs = store.read('s1', 0).map((e) => e.seq);
    assert.deepEqual(seqs, Array.from({ length: k }, (_, i) => i + 1), `seed=${seed}: seq 连续无空洞（无交织写入）`);
    // 等价于某串行序：总和与 ops 计数守恒（加法可交换，故任意串行序同值）。
    const expectedTotal = adds.reduce((a, b) => a + b, 0);
    assert.equal(rt.load('s1').total, expectedTotal, `seed=${seed}: 累计和应守恒（等价于某串行序）`);
    assert.equal(rt.load('s1').ops, k);
  }
});

test('property⑤ · 不变量4 反证：去掉锁，并发 execute 同 stream 触发响亮 CAS ConflictError（证明锁正是串行化的那道，且冲突不被静默吞）', async () => {
  // 无锁运行时：两个基于同一高水位的并发 append，CAS 必让第二个响亮失败。
  const store = createMemoryLogStore(newCtx());
  const rt = createAggregateRuntime({ aggregate: accAggregate(), logStore: store }); // 无 locks
  const settled = await Promise.allSettled([
    rt.execute('s1', { type: 'add', n: 1 }),
    rt.execute('s1', { type: 'add', n: 1 }),
  ]);
  const rejected = settled.filter((s) => s.status === 'rejected');
  assert.equal(rejected.length >= 1, true, '去锁后并发写至少一个应因 CAS 响亮失败');
  assert.equal(rejected.every((s) => s.reason?.name === 'ConflictError'), true,
    '失败原因必须是 ConflictError（响亮上抛，非静默重试吞掉）');
  // 日志仍连续（胜者的那一批干净落盘）。
  const seqs = store.read('s1', 0).map((e) => e.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), '冲突之后日志仍连续无空洞');
});
