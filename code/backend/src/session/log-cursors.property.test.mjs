// realtime_core · session/log-cursors.property.test.mjs（P3a）
//
// 任务单 §4 四条不变量的 property 测试（PRNG 沿用仓内 mulberry32 固定种子
// 约定：CI 每次跑出的用例集合相同，零新依赖）。映射：
//   不变量1（已确认序列 = 日志连续前缀，不丢/不重/不乱序）→ 测试 ①（主交错
//     harness，每步核对）+ 测试 ⑥ 高频崩溃加压终检
//   不变量2（seq 连续无空洞；CAS 并发恰好一个胜者）→ 测试 ②（连续性）+
//     测试 ③（同快照 K 路并发一个胜者）+ 测试 ① 内嵌 casClash 步
//   不变量3（游标只前进；ack 越过已 pull 高水位 = throw）→ 测试 ④（随机
//     advanceCursor 攻击）+ 测试 ⑤（随机越位 ack）+ 测试 ① 每步单调核对
//   不变量4（随机时点崩溃重建后继续操作，不变量1 仍成立）→ 测试 ①（crash
//     步 p=0.15）+ 测试 ⑥（crash p=0.5 加压）
//
// harness 结构：影子模型（shadowIds = 日志应有的 id 序列；每 group 的
// confirmed/cursor/high）与真实 store/delivery 同步演进，每步之后断言真实
// 状态与模型一致——模型即不变量的可执行表述。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLogStore } from './memory-log-store.js';
import { createDelivery } from './delivery.js';

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function rand () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stubWakeup = () => ({ emit () {}, subscribe () { return () => {}; } });

function newStore (rand) {
  let now = 0;
  return createMemoryLogStore({ clock: () => { now += 1; return now; }, rng: rand });
}

// ── 主交错 harness（不变量 1+4，内嵌 2/3 抽查）──────────────────────────

function driveInterleaving (seed, { steps, crashProb }) {
  const rand = mulberry32(seed);
  const store = newStore(rand);
  let delivery = createDelivery({ logStore: store, wakeup: stubWakeup() });
  const shadowIds = []; // 日志权威 id 序列（每次成功 append 后从 store 增量补录）
  const groups = ['g1', 'g2'];
  const model = new Map(groups.map((g) => [g, { confirmed: [], cursor: 0, high: 0 }]));

  const absorbAppended = () => {
    const fresh = store.read('s1', shadowIds.length);
    for (const e of fresh) shadowIds.push(e.id);
  };

  const checkInvariant1And3 = (label) => {
    for (const g of groups) {
      const m = model.get(g);
      const cursor = store.getCursor('s1', g);
      assert.equal(cursor, m.cursor, `seed=${seed} ${label}: group ${g} 游标应与模型一致（模型只前进 ⇒ 真实游标只前进）`);
      assert.deepEqual(m.confirmed, shadowIds.slice(0, cursor),
        `seed=${seed} ${label}: group ${g} 已确认序列必须恒等于日志连续前缀（不丢/不重/不乱序）`);
    }
  };

  for (let step = 0; step < steps; step += 1) {
    const g = groups[Math.floor(rand() * groups.length)];
    const m = model.get(g);
    const r = rand();

    if (r < crashProb) {
      // 崩溃：丢掉 delivery 全部内存态，仅 logStore 幸存（不变量 4）。
      delivery = createDelivery({ logStore: store, wakeup: stubWakeup() });
      for (const each of model.values()) each.high = each.cursor; // 高水位随内存丢失
      if (shadowIds.length > m.cursor && rand() < 0.5) {
        // 重启后未重新 pull 就越过游标 ack ⇒ 必须 RangeError（不变量 3）。
        assert.throws(() => delivery.ack('s1', g, m.cursor + 1), RangeError,
          `seed=${seed} step=${step}: 崩溃重建后未 pull 的 ack 应被拒`);
      }
    } else if (r < crashProb + 0.28) {
      // publish 1..3 个事件。
      const n = 1 + Math.floor(rand() * 3);
      const events = Array.from({ length: n }, (_, i) => ({ type: 'noted', payload: { step, i } }));
      const before = shadowIds.length;
      const appended = delivery.publish('s1', events);
      assert.equal(appended.lastSeq, before + n, `seed=${seed} step=${step}: publish 后 lastSeq 应精确推进 n`);
      absorbAppended();
    } else if (r < crashProb + 0.38) {
      // CAS 冲突步（不变量 2）：拿一个随机（多半过期的）快照直写 store。
      const lastSeq = shadowIds.length;
      const snapshot = Math.floor(rand() * (lastSeq + 1));
      if (snapshot === lastSeq) {
        store.append('s1', snapshot, [{ type: 'noted', payload: { step, oob: true } }]);
        absorbAppended(); // 外部写入者成功——顺带让 delivery 尾指针缓存过期，后续 publish 走 CAS 兜底重试路径
      } else {
        assert.throws(() => store.append('s1', snapshot, [{ type: 'noted' }]),
          (err) => err.name === 'ConflictError',
          `seed=${seed} step=${step}: 过期快照 append 必须 ConflictError`);
        assert.equal(store.read('s1', 0).length, lastSeq, `seed=${seed} step=${step}: 失败的 append 不得改动日志`);
      }
    } else if (r < crashProb + 0.62) {
      // pull：只读不动游标，收到的必是游标后连续一段。
      const limit = rand() < 0.5 ? 1 + Math.floor(rand() * 3) : undefined;
      const batch = delivery.pull('s1', g, { limit });
      const expected = shadowIds.slice(m.cursor, limit === undefined ? undefined : m.cursor + limit);
      assert.deepEqual(batch.map((e) => e.id), expected,
        `seed=${seed} step=${step}: pull 内容应为游标后连续一段`);
      batch.forEach((e, i) => assert.equal(e.seq, m.cursor + i + 1,
        `seed=${seed} step=${step}: pull 批内 seq 应连续衔接游标`));
      if (batch.length > 0) m.high = Math.max(m.high, batch[batch.length - 1].seq);
    } else if (r < crashProb + 0.80) {
      // 合法 ack：(cursor, high] 内任取——前缀确认语义。
      if (m.high > m.cursor) {
        const seq = m.cursor + 1 + Math.floor(rand() * (m.high - m.cursor));
        delivery.ack('s1', g, seq);
        m.confirmed.push(...shadowIds.slice(m.cursor, seq));
        m.cursor = seq;
      }
    } else {
      // 非法 ack：越过已 pull 高水位 ⇒ RangeError 且游标不动（不变量 3）。
      const seq = Math.max(m.high, m.cursor) + 1 + Math.floor(rand() * 3);
      assert.throws(() => delivery.ack('s1', g, seq), RangeError,
        `seed=${seed} step=${step}: ack(${seq}) 越过高水位 ${m.high} 应被拒`);
      assert.equal(store.getCursor('s1', g), m.cursor, `seed=${seed} step=${step}: 被拒的 ack 不得动游标`);
    }

    checkInvariant1And3(`step=${step}`);
  }

  // 终检（不变量 2 连续性 + 影子一致）：日志 seq 恒为 1..N 无空洞，id 序列与影子一致。
  const log = store.read('s1', 0);
  assert.deepEqual(log.map((e) => e.seq), log.map((_, i) => i + 1), `seed=${seed}: 终检 seq 必须连续无空洞`);
  assert.deepEqual(log.map((e) => e.id), shadowIds, `seed=${seed}: 终检日志与影子模型一致`);
}

test('property① · 不变量1+4：publish/pull/ack/CAS 冲突/崩溃重建随机交错（300 种子×30 步）——每 group 已确认序列恒等于日志连续前缀，游标恒不回退', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    driveInterleaving(seed, { steps: 30, crashProb: 0.15 });
  }
});

test('property② · 不变量2-连续性：随机批量 append 下 seq 流内连续无空洞、从 1 起、多流独立（150 种子）', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const rand = mulberry32(seed * 7 + 1);
    const store = newStore(rand);
    const counts = { sA: 0, sB: 0 };
    const batches = 1 + Math.floor(rand() * 12);
    for (let b = 0; b < batches; b += 1) {
      const streamId = rand() < 0.5 ? 'sA' : 'sB';
      const n = 1 + Math.floor(rand() * 4);
      const r = store.append(streamId, counts[streamId], Array.from({ length: n }, () => ({ type: 'noted' })));
      counts[streamId] += n;
      assert.equal(r.lastSeq, counts[streamId], `seed=${seed}: lastSeq 应精确等于累计条数`);
    }
    for (const streamId of ['sA', 'sB']) {
      const seqs = store.read(streamId, 0).map((e) => e.seq);
      assert.deepEqual(seqs, Array.from({ length: counts[streamId] }, (_, i) => i + 1),
        `seed=${seed}: ${streamId} 的 seq 必须为 1..${counts[streamId]} 连续序列`);
    }
  }
});

test('property③ · 不变量2-CAS：同一快照 K 路"并发" append 恰好一个胜者，其余全 ConflictError，日志恰好多一批（200 种子）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 13 + 5);
    const store = newStore(rand);
    // 随机前缀。
    let lastSeq = 0;
    const prefix = Math.floor(rand() * 5);
    for (let b = 0; b < prefix; b += 1) {
      lastSeq = store.append('s1', lastSeq, [{ type: 'noted' }]).lastSeq;
    }
    // K 个写入者都基于同一快照发起 append（串行模拟并发到达顺序）。
    const k = 2 + Math.floor(rand() * 3);
    const batchSize = 1 + Math.floor(rand() * 3);
    let winners = 0;
    let conflicts = 0;
    for (let w = 0; w < k; w += 1) {
      try {
        store.append('s1', lastSeq, Array.from({ length: batchSize }, () => ({ type: 'noted', payload: { w } })));
        winners += 1;
      } catch (err) {
        assert.equal(err.name, 'ConflictError', `seed=${seed}: 输家必须收到 ConflictError，而非 ${err.name}`);
        assert.equal(err.expected, lastSeq);
        assert.equal(err.actual, lastSeq + batchSize);
        conflicts += 1;
      }
    }
    assert.equal(winners, 1, `seed=${seed}: 恰好一个胜者，实际 ${winners}`);
    assert.equal(conflicts, k - 1);
    const log = store.read('s1', 0);
    assert.equal(log.length, lastSeq + batchSize, `seed=${seed}: 日志应恰好多一批`);
    assert.deepEqual(log.map((e) => e.seq), log.map((_, i) => i + 1), `seed=${seed}: 冲突之后 seq 仍连续无空洞`);
    assert.equal(new Set(log.slice(lastSeq).map((e) => e.payload.w)).size, 1, `seed=${seed}: 落进日志的必须是同一个胜者的整批`);
  }
});

test('property④ · 不变量3-端口层：随机 advanceCursor 攻击（合法/回退/越界/非法值混合）下游标只前进、被拒调用零副作用（200 种子）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 29 + 11);
    const store = newStore(rand);
    const lastSeq = store.append('s1', 0, Array.from({ length: 3 + Math.floor(rand() * 8) }, () => ({ type: 'noted' }))).lastSeq;
    let cursor = 0;
    for (let step = 0; step < 25; step += 1) {
      const target = Math.floor(rand() * (lastSeq + 3)) - 1; // -1 .. lastSeq+1
      if (target < 1) {
        assert.throws(() => store.advanceCursor('s1', 'g1', target), TypeError, `seed=${seed}: seq=${target} 应 TypeError`);
      } else if (target < cursor) {
        assert.throws(() => store.advanceCursor('s1', 'g1', target), RangeError, `seed=${seed}: 回退 ${cursor}→${target} 应 RangeError`);
      } else if (target > lastSeq) {
        assert.throws(() => store.advanceCursor('s1', 'g1', target), RangeError, `seed=${seed}: 越过日志末尾 ${target}>${lastSeq} 应 RangeError`);
      } else {
        store.advanceCursor('s1', 'g1', target); // target === cursor 为幂等 no-op
        cursor = target;
      }
      assert.equal(store.getCursor('s1', 'g1'), cursor, `seed=${seed} step=${step}: 游标应精确等于模型（从未回退）`);
    }
  }
});

test('property⑤ · 不变量3-投递层：ack 越过已 pull 高水位恒 RangeError 且游标纹丝不动（200 种子）', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const rand = mulberry32(seed * 31 + 7);
    const store = newStore(rand);
    const delivery = createDelivery({ logStore: store, wakeup: stubWakeup() });
    const total = 2 + Math.floor(rand() * 8);
    delivery.publish('s1', Array.from({ length: total }, () => ({ type: 'noted' })));
    const pulled = delivery.pull('s1', 'g1', { limit: 1 + Math.floor(rand() * total) });
    const high = pulled[pulled.length - 1].seq;
    const cursorBefore = store.getCursor('s1', 'g1');
    for (let probe = high + 1; probe <= total + 2; probe += 1) {
      assert.throws(() => delivery.ack('s1', 'g1', probe), RangeError,
        `seed=${seed}: ack(${probe}) 越过高水位 ${high} 应被拒`);
      assert.equal(store.getCursor('s1', 'g1'), cursorBefore, `seed=${seed}: 被拒 ack 后游标不得移动`);
    }
    delivery.ack('s1', 'g1', high); // 合法上界恰好可确认
    assert.equal(store.getCursor('s1', 'g1'), high);
  }
});

test('property⑥ · 不变量4 加压：高频崩溃（p=0.5，100 种子×40 步）下继续操作，不变量1/3 每步成立、终检日志完好', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    driveInterleaving(seed * 17 + 3, { steps: 40, crashProb: 0.5 });
  }
});
