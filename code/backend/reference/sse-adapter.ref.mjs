// realtime_core · reference/sse-adapter.ref.mjs（P5 · scope 外参考示例）
//
// 最小 SSE（Server-Sent Events）形状的推送适配器：用 conn 抽象（`send/isOpen`，
// 与 channels.js 同一 port 形状）+ 注入的 delivery.subscribe（内部是 P2 longPoll）
// 组装。不起真 HTTP——测试注入"模拟 res.write 的假响应对象"即可。
//
// **本文件要证明的两件事（P5 任务单 §2）**：
//   ① 传输层三形态共用同一内核零改动：WS（channels.broadcast，P1 既有）、
//      long-poll（delivery.subscribe 单次即终，P3a 既有）、SSE（本文件）都只是
//      对同一 reducer/engine/delivery 词汇的**不同组装**，src/ 一行未动。
//   ② 两种生命周期的覆盖方式：
//      - 长轮询"回完即终" = **一次** poll 生命周期（RESPOND 是契约级"至多一次"）。
//      - SSE"RESPOND 后连接仍活着继续推" = **顺序复合**多个 poll 生命周期：
//        每推送一批 = 一个完整生命周期（等待→settled RESPOND→清理），随即在
//        同一条连接上开启下一个生命周期继续等。"连接存活"不属于状态机词汇——
//        它活在 conn port 里（这正是 conn 抽象的设计意图）；reducer/engine 无需
//        任何"多次 RESPOND"扩展。跨生命周期边界不丢事件：新生命周期的 initial
//        attempt 立即 pull（游标之后的积压立刻可见），不依赖唤醒信号补课。
//
// SSE wire 形状（最小忠实）：每批事件一个 frame `id: <lastSeq>\ndata: <json>\n\n`
// （id 行 = 游标语义的 SSE 原生对应物：Last-Event-ID 重连即"从游标续读"）；
// 空转超时写注释行 `: keep-alive\n\n`（SSE 心跳惯例，客户端忽略注释帧）。
//
// 消费语义：推送成功即 ack（游标前移到批尾）。at-least-once 仍成立——若进程
// 在 send 与 ack 之间崩溃，重启后该批会重推（SSE 客户端按 id 去重，与
// Last-Event-ID 惯例一致）。

/** 把一批信封编码成一个 SSE frame（id 行 = 批尾 seq，即游标语义）。 */
export function formatSseFrame (batch) {
  const lastSeq = batch[batch.length - 1].seq;
  return `id: ${lastSeq}\ndata: ${JSON.stringify(batch)}\n\n`;
}

/** SSE 注释帧（心跳用，客户端协议层忽略）。 */
export function formatSseComment (text) {
  return `: ${text}\n\n`;
}

/**
 * 在一条已建立的 SSE 连接上持续推送某 (stream, group) 的事件，直到客户端断连
 * 或连接不再可写。返回统计（cycles/pushes/heartbeats/lastError），便于测试断言。
 *
 * @param {{
 *   delivery: {subscribe: Function, ack: Function},  // createDelivery(...) 实例（须携 longPoll 注入）
 *   streamId: string,
 *   group: string,
 *   conn: {send: (frame: string) => void, isOpen: () => boolean}, // channels.js 同款 conn port
 *   timers: {set: Function, clear: Function},        // longPoll 同款一次性定时器 port
 *   timeoutMs: number,                               // 单个等待周期的空转上限（心跳间隔）
 *   onClientClose: (cb: () => void) => (() => void), // 客户端断连信号（res 'close' 的抽象）
 *   limit?: number,
 * }} opts
 * @returns {Promise<{cycles: number, pushes: number, heartbeats: number, lastError: any}>}
 */
export async function serveSse ({ delivery, streamId, group, conn, timers, timeoutMs, onClientClose, limit }) {
  const stats = { cycles: 0, pushes: 0, heartbeats: 0, lastError: null };
  let closed = false;
  // 一条 SSE 连接 = 一个外层 close 信号；每个内层 poll 生命周期各自注册/注销
  // 监听（engine CLEANUP 会调 off——"各自幂等"语义原样复用）。
  const cycleCloseListeners = new Set();
  const offOuter = onClientClose(() => {
    closed = true;
    for (const fn of [...cycleCloseListeners]) fn();
  });

  try {
    while (!closed && conn.isOpen()) {
      stats.cycles += 1;
      let stop = false;
      // 一个完整 poll 生命周期：有积压立即 settled，否则等 publish 唤醒/超时/断连。
      await delivery.subscribe(streamId, group, {
        timers,
        timeoutMs,
        limit,
        respond: {
          settled (batch) {
            // RESPOND{settled} 在 SSE 里解释为"写一帧、游标前移、连接不关"。
            conn.send(formatSseFrame(batch));
            delivery.ack(streamId, group, batch[batch.length - 1].seq);
            stats.pushes += 1;
          },
          timeout () {
            // RESPOND{timeout} 解释为心跳帧：连接不关，进入下一生命周期继续等。
            conn.send(formatSseComment('keep-alive'));
            stats.heartbeats += 1;
          },
          error (err) {
            // attempt 失败：SSE 无法向客户端表达 500——记录并终止推流（服务端断开）。
            stats.lastError = err;
            stop = true;
          },
        },
        onClientClose (fn) {
          cycleCloseListeners.add(fn);
          return () => cycleCloseListeners.delete(fn);
        },
      });
      if (stop) break;
      // CLIENT_CLOSE 生命周期是静默终态（无 RESPOND）——closed 标志在外层守卫退出。
    }
  } finally {
    offOuter();
  }
  return stats;
}
