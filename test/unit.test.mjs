import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  estimateTokens,
  fiberPhaseLabel,
  findIdRow,
  hasIdRow,
  isLocked,
  joinLines,
  resolveHomePatchPath,
  serverNameOf,
  splitLines,
  summarizeSchemas,
  toolPrefixFor,
  unquoteYaml,
  upsertDisabled,
  yamlScalar,
} from '../index.js'

test('fiberPhaseLabel maps loader states and hides unknown ones', () => {
  assert.equal(fiberPhaseLabel(0), 'pending')
  assert.equal(fiberPhaseLabel(1), 'loading')
  assert.equal(fiberPhaseLabel(2), 'active')
  assert.equal(fiberPhaseLabel(3), 'failed')
  assert.equal(fiberPhaseLabel(4), null)
  assert.equal(fiberPhaseLabel(5), 'unloading')
  assert.equal(fiberPhaseLabel(999), null)
  assert.equal(fiberPhaseLabel(null), null)
  assert.equal(fiberPhaseLabel(undefined), null)
})

test('isLocked refuses the patch root, this plugin, and empty ids', () => {
  assert.equal(isLocked('include', 'anything'), true)
  assert.equal(isLocked('my-mcp', 'cordis:include'), true)
  assert.equal(isLocked('my-mcp', 'dsh-mcp-control'), true)
  assert.equal(isLocked('my-mcp', 'dsh-mcp-toggle'), true)
  assert.equal(isLocked('my-mcp', 'some-server'), false)
  assert.equal(isLocked('', 'some-server'), true)
  assert.equal(isLocked(undefined, 'some-server'), true)
})

test('serverNameOf prefers the configured serverName', () => {
  assert.equal(serverNameOf({ options: { config: { serverName: 'rea' }, name: 'pkg' }, id: 'x' }), 'rea')
  assert.equal(serverNameOf({ options: { config: {}, name: 'pkg' }, id: 'x' }), 'pkg')
  assert.equal(serverNameOf({ options: { config: { serverName: '' }, name: '' }, id: 'x' }), 'x')
})

test('estimateTokens uses the stated bytes-per-token ratio', () => {
  assert.equal(estimateTokens(0), 0)
  assert.equal(estimateTokens(4), 1)
  assert.equal(estimateTokens(4000), 1000)
  assert.equal(estimateTokens(-10), 0)
  assert.equal(estimateTokens(NaN), 0)
  assert.equal(estimateTokens(100, 2), 50)
  assert.equal(estimateTokens(100, 0), 25)
})

test('toolPrefixFor builds the official public tool prefix', () => {
  assert.equal(toolPrefixFor('rea'), 'mcp__rea__')
  assert.equal(toolPrefixFor('my-server'), 'mcp__my-server__')
})

test('summarizeSchemas only bills MCP-prefixed tools and groups them by server', () => {
  const schemas = [
    { name: 'mcp__rea__binary_session', description: 'x'.repeat(40), parameters: { a: 1 } },
    { name: 'mcp__rea__inspect_artifact', description: '', parameters: {} },
    { name: 'mcp__other__do_thing', description: 'y'.repeat(10), parameters: {} },
    { name: 'bash', description: 'built-in, must not be billed to MCP', parameters: {} },
    { name: 'mcp__malformed', description: 'no separator', parameters: {} },
  ]
  const result = summarizeSchemas(schemas)

  assert.equal(result.totalToolCount, 3)
  assert.deepEqual([...result.byServer.keys()].sort(), ['other', 'rea'])

  const rea = result.byServer.get('rea')
  assert.equal(rea.toolCount, 2)
  assert.equal(rea.nameBytes, 'mcp__rea__binary_session'.length + 'mcp__rea__inspect_artifact'.length)
  assert.equal(rea.descriptionBytes, 40)
  assert.equal(rea.parameterBytes, JSON.stringify({ a: 1 }).length + JSON.stringify({}).length)
  assert.equal(rea.estTokens, estimateTokens(rea.schemaBytes))

  assert.equal(result.totalBytes, rea.schemaBytes + result.byServer.get('other').schemaBytes)
})

test('summarizeSchemas tolerates empty and malformed input', () => {
  assert.equal(summarizeSchemas(undefined).totalToolCount, 0)
  assert.equal(summarizeSchemas([]).totalEstTokens, 0)
  assert.equal(summarizeSchemas([{ name: 'mcp__x__y' }]).totalToolCount, 1)
  assert.equal(summarizeSchemas([{ name: 'mcp____y' }]).totalToolCount, 0)
  assert.equal(summarizeSchemas([{ name: 42 }]).totalToolCount, 0)
})

test('unquoteYaml and yamlScalar round-trip ids', () => {
  assert.equal(unquoteYaml("'rea-mcp'"), 'rea-mcp')
  assert.equal(unquoteYaml('"rea-mcp"'), 'rea-mcp')
  assert.equal(unquoteYaml('rea-mcp'), 'rea-mcp')
  assert.equal(unquoteYaml("'it''s'"), "it's")
  assert.equal(yamlScalar('rea-mcp'), 'rea-mcp')
  assert.equal(yamlScalar('my server'), '"my server"')
})

test('splitLines and joinLines preserve CRLF', () => {
  const lf = splitLines('a\nb\n')
  assert.deepEqual(lf.lines, ['a', 'b', ''])
  assert.equal(lf.crlf, false)
  assert.equal(joinLines(lf.lines, lf.crlf), 'a\nb\n')

  const crlf = splitLines('a\r\nb\r\n')
  assert.deepEqual(crlf.lines, ['a', 'b', ''])
  assert.equal(crlf.crlf, true)
  assert.equal(joinLines(crlf.lines, crlf.crlf), 'a\r\nb\r\n')
})

test('findIdRow distinguishes top-level rows from insert-nested rows', () => {
  const lines = [
    '- insert:',
    '    - id: rea-mcp',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '- id: rea-mcp',
    '  disabled: true',
  ]
  const found = findIdRow(lines, 'rea-mcp')
  assert.equal(found.nested, 1)
  assert.equal(found.topLevel, 3)
  assert.equal(hasIdRow(lines, 'rea-mcp'), true)
  assert.equal(hasIdRow(lines, 'nope'), false)
})

test('upsertDisabled appends a fresh override row when the id is only nested', () => {
  const lines = [
    '- insert:',
    '    - id: rea-mcp',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '',
  ]
  const result = upsertDisabled(lines, 'rea-mcp', true)
  assert.equal(result.changed, true)
  assert.equal(result.mode, 'appended')

  const text = joinLines(result.lines, false)
  assert.match(text, /^- id: rea-mcp$/m)
  assert.match(text, /^  disabled: true$/m)

  // The original insert list must stay byte-identical.
  assert.equal(result.lines[1], '    - id: rea-mcp')
  assert.equal(hasIdRow(result.lines, 'rea-mcp'), true)
})

test('upsertDisabled replaces an existing disabled line in place (one row per id)', () => {
  const lines = ['- id: rea-mcp', '  disabled: false', '']
  const off = upsertDisabled(lines, 'rea-mcp', true)
  assert.equal(off.mode, 'replaced')
  assert.deepEqual(off.lines, ['- id: rea-mcp', '  disabled: true', ''])

  const on = upsertDisabled(off.lines, 'rea-mcp', false)
  assert.equal(on.mode, 'replaced')
  assert.deepEqual(on.lines, ['- id: rea-mcp', '  disabled: false', ''])

  // Repeated toggles never duplicate the row.
  const again = upsertDisabled(on.lines, 'rea-mcp', false)
  assert.equal(again.lines.filter((line) => /^- id: rea-mcp$/.test(line)).length, 1)
})

test('upsertDisabled rewrites the LAST disabled line (the one YAML honours)', () => {
  // A duplicate key in one YAML mapping resolves to the last occurrence, so the
  // last `disabled:` line is the effective value and must be the one rewritten.
  // Rewriting an earlier line would silently leave the old value in force.
  const lines = ['- id: rea-mcp', '  disabled: true', '  disabled: true', '']
  const result = upsertDisabled(lines, 'rea-mcp', false)
  assert.equal(result.lines[1], '  disabled: true')
  assert.equal(result.lines[2], '  disabled: false')

  const effective = (rows) =>
    rows.filter((line) => /^\s+disabled:\s*(\S+)/.test(line)).pop().match(/disabled:\s*(\S+)/)[1]
  assert.equal(effective(result.lines), 'false')
})

test('upsertDisabled inserts a disabled line for a row that has none', () => {
  const lines = ['- id: rea-mcp', "  name: '@deepseek-ai/dsh-mcp-client'", '']
  const result = upsertDisabled(lines, 'rea-mcp', true)
  assert.equal(result.mode, 'inserted')
  assert.deepEqual(result.lines, [
    '- id: rea-mcp',
    '  disabled: true',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '',
  ])
})

test('upsertDisabled appends without a leading blank line for a non-empty file', () => {
  const result = upsertDisabled(['- insert:', '    - id: other', ''], 'rea-mcp', true)
  assert.equal(result.lines[0], '- insert:')
  assert.equal(result.lines[1], '    - id: other')
  assert.equal(result.lines[2], '')
  assert.equal(result.lines[3], '- id: rea-mcp')
  assert.equal(result.lines[4], '  disabled: true')
})

test('upsertDisabled handles an empty file and a quoted id', () => {
  const empty = upsertDisabled([], 'rea-mcp', true)
  assert.deepEqual(empty.lines, ['- id: rea-mcp', '  disabled: true', ''])

  const quoted = upsertDisabled([], 'my server', true)
  assert.deepEqual(quoted.lines, ['- id: "my server"', '  disabled: true', ''])
})

test('upsertDisabled preserves CRLF endings', () => {
  const { lines, crlf } = splitLines('- id: rea-mcp\r\n  disabled: false\r\n')
  const result = upsertDisabled(lines, 'rea-mcp', true)
  assert.equal(joinLines(result.lines, crlf), '- id: rea-mcp\r\n  disabled: true\r\n')
})

test('resolveHomePatchPath honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(
    resolveHomePatchPath({ DSH_HOME: 'C:\\custom' }, 'C:\\Users\\x'),
    'C:\\custom\\cordis.patch.yml',
  )
  assert.equal(
    resolveHomePatchPath({ DSH_HOME: '   ' }, 'C:\\Users\\x'),
    'C:\\Users\\x\\.dsh\\cordis.patch.yml',
  )
})
