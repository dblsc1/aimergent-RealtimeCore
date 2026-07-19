// block-4 可复用实时引擎 · core/dispatch.js（Wave 0）
//
// 命令表规范化 + 查找：表→handler，未知命令返回**错误描述对象**（不抛、不
// io），供壳（engine.js，Wave 1a）解释成 socket.send/日志等副作用。纯——不
// 调用 handler、不 try/catch（调用 + 异常捕获属副作用，留给壳的
// `createDispatcher(table, { onUnknown, onError })`，设计文档 §1/§2）。
//
// 老参照：`routes/teacher.js` WS 消息处理的 switch/case 分派（`unknown cmd`
// 走 L335-338 附近的 default 分支：`socket.send(JSON.stringify({ type: 'error',
// detail: \`unknown cmd ${cmd?.cmd}\` }))`）。本文件把"表查找"这一半形式化成
// 纯函数、语义逐字节对齐（相同的 `unknown cmd <name>` 文案），"发 socket 帧"
// 那一半留给壳。
//
// 表是数据、不是 switch（铁律17 审核代码化优先的落地形态之一）：新增命令只
// 需要在调用方的 commandTable 里加一条键值对，不改这两个函数的逻辑。

/**
 * 校验并规范化命令表：必须是 plain object（`{ [name]: handler }`），键去除
 * 首尾空白后作为命令名（空字符串键忽略），值不得是 null/undefined（防止表
 * 里静默丢了一个命令而没人发现）。`handler` 的具体形状本文件不关心——可以
 * 是函数，也可以是上层（L2 `defineClassroom`）用的 `{run, broadcast}` 描述
 * 对象；core 层只管"名字对不对得上"，不管"对上之后怎么用"。
 * @param {Record<string, unknown>} table
 * @returns {Record<string, unknown>} 规范化后的新表（不修改入参）
 */
export function normalizeCommandTable (table) {
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    throw new TypeError('dispatch: command table must be a plain object of { [name]: handler }');
  }
  const normalized = Object.create(null);
  for (const key of Object.keys(table)) {
    const name = String(key || '').trim();
    if (!name) continue;
    const handler = table[key];
    if (handler === null || handler === undefined) {
      throw new TypeError(`dispatch: command table entry "${key}" must not be null/undefined`);
    }
    normalized[name] = handler;
  }
  return normalized;
}

/**
 * 在已规范化的命令表里查找一条命令。命中返回 `{ok:true, name, handler}`；
 * 未命中（`cmd` 缺失/非对象/`cmd.cmd` 非非空字符串/表里没有这个键）一律返回
 * `{ok:false, error:{kind:'unknown_command', cmd, detail}}`，`detail` 文案与
 * 老 WS default 分支逐字节一致：`unknown cmd <cmd.cmd>`。
 * @param {Record<string, unknown>} table 已经过 `normalizeCommandTable` 的表
 * @param {{cmd?: unknown, [key: string]: unknown}} cmd 收到的命令消息
 * @returns {{ok: true, name: string, handler: unknown} |
 *           {ok: false, error: {kind: 'unknown_command', cmd: unknown, detail: string}}}
 */
export function lookupCommand (table, cmd) {
  const rawName = cmd && typeof cmd === 'object' ? cmd.cmd : undefined;
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return unknownCommandResult(rawName);
  }
  if (!Object.prototype.hasOwnProperty.call(table, rawName)) {
    return unknownCommandResult(rawName);
  }
  return { ok: true, name: rawName, handler: table[rawName] };
}

function unknownCommandResult (cmdName) {
  return {
    ok: false,
    error: { kind: 'unknown_command', cmd: cmdName, detail: `unknown cmd ${cmdName}` },
  };
}
