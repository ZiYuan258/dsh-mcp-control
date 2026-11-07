/**
 * 调用记录的测试。
 *
 * 这一组里最容易写错的是**口径**：`today` 用本地时区、`okRate`/`avgMs` 只算已结算的、
 * `okRate` 返回的是百分数（`95.5`）而不是比例（`0.955`）。所以断言都写死具体数字，
 * 不写成"大于零"——口径错了才是最可能的错法。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CALL_KEEP_MS,
  CALL_LIMIT_LINES,
  CALL_TEXT_LIMIT,
  classifyCall,
  findPending,
  parseCallLines,
  pruneRows,
  settleRow,
  shortSession,
  startRow,
  summarizeCalls,
  textOf,
  toCallLine,
} from '../lib/calls.js'

test('classifyCall 只认 MCP 工具与 skill 调用', () => {
  assert.deepEqual(classifyCall('mcp__rea__search', {}), { space: 'mcp', server: 'rea', tool: 'search' })
  // 工具名里带 __ 时全部归给工具，不丢后半截
  assert.deepEqual(classifyCall('mcp__rea__a__b', {}), { space: 'mcp', server: 'rea', tool: 'a__b' })
  assert.deepEqual(classifyCall('skill', { name: 'office-docx' }), { space: 'skill', skill: 'office-docx', tool: 'skill' })
  assert.deepEqual(classifyCall('skill', {}), { space: 'skill', skill: null, tool: 'skill' })
  // 参数是 JSON 文本而不是对象：会话日志里 tool/call 的 data.arguments 就是这个形状。
  // 只认对象会让每一次 skill 调用都记成 skill: null，「哪个 skill 用得最多」永远空白。
  assert.deepEqual(
    classifyCall('skill', '{"name": "dsh-plugin-failures"}'),
    { space: 'skill', skill: 'dsh-plugin-failures', tool: 'skill' },
  )
  assert.deepEqual(classifyCall('skill', '{not json'), { space: 'skill', skill: null, tool: 'skill' })
  assert.deepEqual(classifyCall('skill', undefined), { space: 'skill', skill: null, tool: 'skill' })

  // 形状不对的一律不记，否则会污染统计
  assert.equal(classifyCall('mcp__rea', {}), null)
  assert.equal(classifyCall('mcp____tool', {}), null)
  assert.equal(classifyCall('read', {}), null)
  assert.equal(classifyCall('', {}), null)
  assert.equal(classifyCall(null, {}), null)
})

test('textOf 压成一行并截断', () => {
  assert.equal(textOf(undefined), '')
  assert.equal(textOf(null), '')
  assert.equal(textOf('  a\n b  '), 'a b')
  assert.equal(textOf({ a: 1 }), '{"a":1}')
  const long = 'x'.repeat(CALL_TEXT_LIMIT + 50)
  assert.equal(textOf(long).length, CALL_TEXT_LIMIT + 1) // 加一个省略号
  assert.ok(textOf(long).endsWith('…'))
})

test('shortSession 只留尾 6 位', () => {
  assert.equal(shortSession('abc'), 'abc')
  assert.equal(shortSession('0123456789'), '456789')
  assert.equal(shortSession(''), '?')
  assert.equal(shortSession(undefined), '?')
})

test('startRow 从 tool/call 事件造一条进行中的记录', () => {
  const at = Date.parse('2026-11-07T10:00:00.000Z')
  const row = startRow('session-abcdef123', { data: { name: 'mcp__rea__search', arguments: { q: 'x' }, callId: 'c1' } }, at)

  assert.equal(row.id, 'session-abcdef123#c1')
  assert.equal(row.callId, 'c1')
  assert.equal(row.space, 'mcp')
  assert.equal(row.server, 'rea')
  assert.equal(row.tool, 'search')
  assert.equal(row.skill, null)
  assert.equal(row.status, 'running')
  assert.equal(row.startedAt, '2026-11-07T10:00:00.000Z')
  assert.equal(row.ms, null)
  assert.equal(row.session, 'def123') // 尾 6 位
  assert.equal(row.req, '{"q":"x"}')
  assert.equal(row.res, null)
})

test('startRow 对不在范围内的调用返回 null', () => {
  assert.equal(startRow('s', { data: { name: 'read' } }, 0), null)
  assert.equal(startRow('s', {}, 0), null)
  assert.equal(startRow('s', null, 0), null)
})

test('startRow 在没有 callId 时用一个可读的合成 id', () => {
  const at = Date.parse('2026-11-07T10:00:00.000Z')
  const row = startRow('s1', { data: { name: 'skill', arguments: { name: 'x' } } }, at)
  assert.equal(row.callId, null)
  assert.equal(row.id, `s1#skill@${at}`)
})

test('findPending 优先按 callId 找，没有 callId 时退回会话里最新那条', () => {
  const at = Date.parse('2026-11-07T10:00:00.000Z')
  const a = startRow('sess-aa', { data: { name: 'mcp__x__t', callId: 'c1' } }, at)
  const b = startRow('sess-aa', { data: { name: 'mcp__x__t', callId: 'c2' } }, at + 1000)
  const rows = [a, b]

  assert.equal(findPending(rows, 'sess-aa', 'c1'), a)
  assert.equal(findPending(rows, 'sess-aa', 'c2'), b)
  // 没有 callId：从后往前找，拿到最新那条
  assert.equal(findPending(rows, 'sess-aa', null), b)
  // 别的会话不串
  assert.equal(findPending(rows, 'sess-bb', null), null)
  // 未知 callId 不误配
  assert.equal(findPending(rows, 'sess-aa', 'nope'), null)
})

test('settleRow 结算耗时与成败', () => {
  const at = Date.parse('2026-11-07T10:00:00.000Z')
  const row = startRow('s', { data: { name: 'mcp__x__t', callId: 'c1' } }, at)

  const ok = settleRow(row, { message: { isError: false, content: [{ type: 'text', text: 'fine' }] } }, at + 250)
  assert.equal(ok.settled, true)
  assert.equal(ok.row.status, 'ok')
  assert.equal(ok.row.ms, 250)
  assert.match(ok.row.res, /fine/)

  const bad = settleRow(
    startRow('s', { data: { name: 'mcp__x__t', callId: 'c2' } }, at),
    { message: { isError: true, content: 'boom' }, error: { code: 'ECONNRESET' } },
    at + 40,
  )
  assert.equal(bad.row.status, 'failed')
  assert.equal(bad.row.note, 'ECONNRESET')

  // 时钟倒退不会算出负耗时
  const back = settleRow(startRow('s', { data: { name: 'mcp__x__t' } }, at), { message: {} }, at - 5000)
  assert.equal(back.row.ms, 0)

  assert.deepEqual(settleRow(null, {}, 0), { row: null, settled: false })
})

test('summarizeCalls 的三个口径分得清', () => {
  const tz = 0 // 用 UTC 做基准，断言才稳定
  const now = Date.parse('2026-11-07T12:00:00.000Z')
  const rows = [
    // 今天，成功，100ms
    { status: 'ok', startedAt: '2026-11-07T01:00:00.000Z', ms: 100, space: 'mcp', server: 'rea', tool: 'a' },
    // 今天，失败，300ms
    { status: 'failed', startedAt: '2026-11-07T02:00:00.000Z', ms: 300, space: 'mcp', server: 'rea', tool: 'b' },
    // 昨天，成功，200ms
    { status: 'ok', startedAt: '2026-11-06T05:00:00.000Z', ms: 200, space: 'mcp', server: 'atta', tool: 'c' },
    // 还在跑：算进 total，不算进 settled / 成功率 / 平均
    { status: 'running', startedAt: '2026-11-07T03:00:00.000Z', ms: null, space: 'skill', skill: 'office-docx' },
  ]

  const stats = summarizeCalls(rows, now, tz)

  assert.equal(stats.total, 4)
  assert.equal(stats.today, 3) // 三条今天，昨天那条不算
  assert.equal(stats.settled, 3)
  assert.equal(stats.failed, 1)
  // 成功率是**百分数**：2/3 → 66.7，不是 0.667
  assert.equal(stats.okRate, 66.7)
  // 平均只算已结算的三条：(100+300+200)/3
  assert.equal(stats.avgMs, 200)

  assert.deepEqual(stats.servers, [
    { server: 'rea', calls: 2, failed: 1, avgMs: 200 },
    { server: 'atta', calls: 1, failed: 0, avgMs: 200 },
  ])
  assert.deepEqual(stats.skills, [{ skill: 'office-docx', calls: 1, failed: 0 }])
})

test('summarizeCalls 空集合不发散', () => {
  const stats = summarizeCalls([], Date.parse('2026-11-07T12:00:00.000Z'), 0)
  assert.equal(stats.total, 0)
  assert.equal(stats.today, 0)
  assert.equal(stats.settled, 0)
  assert.equal(stats.okRate, null) // 没有样本就说没有样本，不写 0
  assert.equal(stats.avgMs, null)
  assert.deepEqual(stats.servers, [])
  assert.deepEqual(stats.skills, [])
})

test('pruneRows 先按 7 天裁，再按行数上限裁', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z')
  const fresh = { status: 'ok', startedAt: new Date(now - 1000).toISOString(), ms: 1 }
  const stale = { status: 'ok', startedAt: new Date(now - CALL_KEEP_MS - 1000).toISOString(), ms: 1 }
  const broken = { status: 'ok', startedAt: 'not a date', ms: 1 }

  assert.deepEqual(pruneRows([fresh, stale, broken], now), [fresh])

  // 数组按时间正序（旧在前），裁掉最旧的、保留最新的 CALL_LIMIT_LINES 条
  const many = Array.from({ length: CALL_LIMIT_LINES + 5 }, (_, i) => ({
    status: 'ok',
    startedAt: new Date(now - (CALL_LIMIT_LINES + 4 - i) * 1000).toISOString(),
    ms: 1,
  }))
  const kept = pruneRows(many, now)
  assert.equal(kept.length, CALL_LIMIT_LINES)
  assert.equal(kept[0], many[5])
  assert.equal(kept[kept.length - 1], many[many.length - 1])
})

test('parseCallLines 跳过坏行而不是整体失败', () => {
  const good = { name: 'mcp__x__t', status: 'ok' }
  const text = [JSON.stringify(good), '{ not json', '', JSON.stringify({ hello: 1 }), JSON.stringify(good)].join('\n')
  const rows = parseCallLines(text)
  // 第二个 good 与「没有 name 的对象」被跳过，坏 JSON 被跳过
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'mcp__x__t')
})

test('toCallLine 字段顺序固定，读回来等价', () => {
  const row = {
    id: 's#c1',
    callId: 'c1',
    space: 'mcp',
    name: 'mcp__x__t',
    server: 'x',
    skill: null,
    tool: 't',
    status: 'ok',
    startedAt: '2026-11-07T10:00:00.000Z',
    ms: 12,
    session: 'abcdef',
    req: 'q',
    res: 'r',
    note: null,
  }
  const line = toCallLine(row)
  assert.equal(
    line,
    '{"id":"s#c1","space":"mcp","name":"mcp__x__t","server":"x","skill":null,"tool":"t","status":"ok",' +
      '"startedAt":"2026-11-07T10:00:00.000Z","ms":12,"session":"abcdef","req":"q","res":"r","note":null}',
  )
  // callId 不落盘：它是会话内的一次性的 id，重放时没有意义
  assert.doesNotMatch(line, /callId/)
  assert.equal(parseCallLines(line).length, 1)
})
