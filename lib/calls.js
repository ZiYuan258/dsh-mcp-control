// 调用记录：谁真的被调用了、花了多久、成没成。
//
// 这一块是从参考实现（dsh-overall-mcp 的 lib/calls.js）学来的思路，但实现方向相反：
// 它把 running 行也写进 jsonl，读取时再按 id 合并；我们**只在结算时写一行**。
// 理由：append-only 文件的好处是「读」不需要状态机，而写两次就要在读侧做去重，
// 一旦进程在两次写之间被杀，文件里会留下一条永远 running 的孤儿行——那正是
// 面板上「有个调用转了一星期」的成因。结算才写，最坏情况是丢一条进行中的记录，
// 而不是留一条假的。
//
// 另一条约束：**不碰 token 统计**。调用记录回答「谁被用了」，token 成本回答
// 「占了多少上下文」，两者独立；混在一起会让「停用某个 server 省了多少」这个
// 核心问题变得不可答。

/** 记录保留 7 天。再长也没人看，而且面板只需要「最近」。 */
export const CALL_KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** 文件行的硬上限，防止一个话痨的 agent 把磁盘写满。 */
export const CALL_LIMIT_LINES = 20000
/** 内存里保留的条数上限：面板一次最多翻这么多，多了没意义。 */
export const CALL_MEMORY_LIMIT = 2000
/** 单条参数/结果的截断长度。够看清「调了什么」，不够还原敏感内容。 */
export const CALL_TEXT_LIMIT = 400
/** 每写这么多条就裁一次文件。 */
export const CALL_PRUNE_EVERY = 200

/**
 * 判断一次工具调用属于哪个空间。
 *
 * 只认两种：`mcp__<server>__<tool>` 形式的 MCP 工具，和名为 `skill` 的工具调用。
 * 其它（read/bash/write…）一律返回 null —— 这个面板管的是 MCP 与 skill，
 * 如果把每个原生工具都记下来，真正的信号会被噪音埋掉。
 *
 * 注意 `parts.length < 3` 的判断：`mcp__foo` 这种（没有工具名）说明名字形状不对，
 * 记下来只会污染统计。
 */
export function classifyCall(name, args) {
  if (typeof name !== 'string' || name === '') return null

  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    if (parts.length < 3 || parts[1] === '') return null
    return { space: 'mcp', server: parts[1], tool: parts.slice(2).join('__') }
  }

  if (name === 'skill') {
    const target = args && typeof args === 'object' ? args.name : undefined
    return { space: 'skill', skill: typeof target === 'string' && target !== '' ? target : null, tool: name }
  }

  return null
}

/** 参数压成一行短文本。对象走高信息量的 JSON，其它走 String。 */
export function textOf(value, limit = CALL_TEXT_LIMIT) {
  if (value === undefined || value === null) return ''
  let text
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  text = String(text).replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 会话 id 只留尾 6 位：面板上够区分，也不至于把完整 id 写进文件。 */
export function shortSession(sessionId) {
  const text = typeof sessionId === 'string' ? sessionId : ''
  if (text === '') return '?'
  return text.length <= 6 ? text : text.slice(-6)
}

/**
 * 从一条 `tool/call` 事件造一条进行中的记录。返回 null 表示这次调用不在统计范围内。
 *
 * `at` 传的是**插件自己的时钟**，不是事件里的时间戳：两处时间口径必须一致，
 * 否则耗时会出现负数或几小时的漂移。
 */
export function startRow(sessionId, event, at = Date.now()) {
  const data = event?.data
  if (!data) return null
  const kind = classifyCall(data.name, data.arguments)
  if (!kind) return null

  const callId = typeof data.callId === 'string' && data.callId !== '' ? data.callId : null
  return {
    id: `${sessionId ?? 'unknown'}#${callId ?? `${data.name}@${at}`}`,
    callId,
    space: kind.space,
    name: data.name,
    tool: kind.tool,
    server: kind.server ?? null,
    skill: kind.skill ?? null,
    status: 'running',
    startedAt: new Date(at).toISOString(),
    ms: null,
    session: shortSession(sessionId),
    req: textOf(data.arguments),
    res: null,
    note: null,
  }
}

/**
 * 用一条 `tool/result` 事件结算记录。
 *
 * result 事件**可能不带 callId**（上游用 `sourceEventSeqs` 回连）。所以两条路：
 * 有 callId 就按 callId 找，没有就退回「同会话里最早那条还 running 的」——这不完美，
 * 但比把结果算到错的调用上强，而且并发同一工具调用在真实会话里极少同时发生。
 */
export function findPending(rows, sessionId, callId) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row.status !== 'running' || row.session !== shortSession(sessionId)) continue
    if (callId) {
      if (row.callId === callId) return row
      continue
    }
    return row
  }
  return null
}

/** 结算：返回 { row, settled }。settled 为 false 表示结果来得比记录早（或记录已被裁掉）。 */
export function settleRow(row, resultData, at = Date.now()) {
  if (!row) return { row: null, settled: false }
  const message = resultData?.message
  row.ms = Math.max(0, at - Date.parse(row.startedAt))
  row.status = message?.isError === true ? 'failed' : 'ok'
  row.res = textOf(message?.content)
  const info = resultData?.error
  if (info && typeof info === 'object') row.note = textOf(info.code ?? info.message ?? info, 120)
  return { row, settled: true }
}

/**
 * 统计。`rows` 是内存里保留下来的记录（已含本次会话的）。
 *
 * 三个数字分开口径很重要：
 *   - `total` 是「保留期内」的全部，
 *   - `today` 只数今天（本地时区，因为用户看的日历就是本地的），
 *   - `failed` / `avgMs` 只对**已结算**的记录算 —— 把 running 算进成功率会让
 *     一条卡住的调用把平均值拉成 0。
 */
export function summarizeCalls(rows, now = Date.now(), tzOffsetMinutes = new Date(now).getTimezoneOffset()) {
  const startOfToday = (() => {
    const local = new Date(now - tzOffsetMinutes * 60 * 1000)
    local.setUTCHours(0, 0, 0, 0)
    return local.getTime() + tzOffsetMinutes * 60 * 1000
  })()

  const byServer = new Map()
  const bySkill = new Map()
  let today = 0
  let settled = 0
  let failed = 0
  let msSum = 0

  for (const row of rows) {
    const at = Date.parse(row.startedAt)
    if (Number.isFinite(at) && at >= startOfToday) today++

    if (row.status === 'ok' || row.status === 'failed') {
      settled++
      if (row.status === 'failed') failed++
      if (typeof row.ms === 'number' && Number.isFinite(row.ms)) msSum += row.ms
    }

    if (row.space === 'mcp' && row.server) {
      const bucket = byServer.get(row.server) ?? { server: row.server, calls: 0, failed: 0, msSum: 0 }
      bucket.calls++
      if (row.status === 'failed') bucket.failed++
      if (typeof row.ms === 'number') bucket.msSum += row.ms
      byServer.set(row.server, bucket)
    } else if (row.space === 'skill' && row.skill) {
      const bucket = bySkill.get(row.skill) ?? { skill: row.skill, calls: 0, failed: 0 }
      bucket.calls++
      if (row.status === 'failed') bucket.failed++
      bySkill.set(row.skill, bucket)
    }
  }

  const shape = (bucket) => ({
    calls: bucket.calls,
    failed: bucket.failed,
    avgMs: bucket.calls > 0 ? Math.round((bucket.msSum ?? 0) / Math.max(1, bucket.calls)) : 0,
  })

  return {
    total: rows.length,
    today,
    settled,
    failed,
    okRate: settled > 0 ? Math.round(((settled - failed) / settled) * 1000) / 10 : null,
    avgMs: settled > 0 ? Math.round(msSum / settled) : null,
    servers: [...byServer.values()].map((bucket) => ({ server: bucket.server, ...shape(bucket) })).sort((a, b) => b.calls - a.calls),
    skills: [...bySkill.values()].map((bucket) => ({ skill: bucket.skill, calls: bucket.calls, failed: bucket.failed })).sort((a, b) => b.calls - a.calls),
  }
}

/** 删掉过期与超额的行（原地返回新数组，便于测试）。 */
export function pruneRows(rows, now = Date.now()) {
  const fresh = rows.filter((row) => {
    const at = Date.parse(row.startedAt)
    if (!Number.isFinite(at)) return false
    return now - at <= CALL_KEEP_MS
  })
  return fresh.length > CALL_LIMIT_LINES ? fresh.slice(fresh.length - CALL_LIMIT_LINES) : fresh
}

/**
 * 解析 jsonl。坏行跳过而不是整体失败：这个文件是过程数据，
 * 一行写坏不该让整个面板白屏。
 */
export function parseCallLines(text) {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const row = JSON.parse(trimmed)
      if (row && typeof row === 'object' && typeof row.name === 'string') out.push(row)
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

/** 落盘用：一行一条完整记录，字段顺序固定，diff 好读。 */
export function toCallLine(row) {
  return JSON.stringify({
    id: row.id,
    space: row.space,
    name: row.name,
    server: row.server ?? null,
    skill: row.skill ?? null,
    tool: row.tool,
    status: row.status,
    startedAt: row.startedAt,
    ms: row.ms,
    session: row.session,
    req: row.req,
    res: row.res,
    note: row.note,
  })
}
