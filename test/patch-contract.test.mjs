/**
 * Contract tests for the patch-dialect invariants this plugin depends on.
 *
 * These are not testing our own code in isolation: they pin the SHAPE the DSH patch
 * applier requires, so a future edit to the upsert cannot silently break persistence.
 *
 * Source of the invariants (read from the shipped harness):
 *   @deepseek-ai/cordis-plugin-include/lib/index.js  applyEntryPatches()
 *     :48-50  "Inserted entries are indexed as they are added, so a later patch in the
 *              same list can target a row an earlier patch inserted."
 *     :90-94  an id-targeted patch whose id is absent warns and is SKIPPED
 *     :99-102 overrides assign target[key] = value (insert/name destructured out),
 *             so a `disabled:`-only row cannot disturb the row's `config`
 *     :95-98  a `name` that mismatches the target's name skips the patch
 *   @deepseek-ai/cordis-plugin-loader/lib/index.js  Entry#update()
 *     :365    "Merge new options, restart as needed"
 *     :368-369 isNullable deletes, otherwise assign -> merge, never wholesale replace
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hasIdRow, joinLines, splitLines, upsertDisabled } from '../index.js'

/** The home patch currently on disk, in miniature. */
const REAL_HOME_PATCH = `- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        transport: stdio
        command: D:\\nodejs\\node.exe
`

/** Parse our own emitted patch list the way the applier does, then walk it. */
function applyEntryPatches(data, patches) {
  const warn = []
  const entryMap = new Map()
  const buildMap = (entries) => {
    for (const entry of entries) {
      if (entry.id) entryMap.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) buildMap(entry.config)
    }
  }
  buildMap(data)
  const out = structuredClone(data)
  const outMap = new Map()
  const rebuild = (entries) => {
    for (const entry of entries) {
      if (entry.id) outMap.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) rebuild(entry.config)
    }
  }
  rebuild(out)

  for (const patch of patches) {
    const { id, insert, name, ...overrides } = patch
    if (insert) {
      if (id) {
        const target = outMap.get(id)
        if (!target) {
          warn.push(`insert: ${id} not found`)
          continue
        }
        if (!Array.isArray(target.config)) target.config = []
        target.config.push(...insert)
      } else {
        out.push(...insert)
      }
      rebuild(insert)
      continue
    }
    if (!id) {
      warn.push('id required')
      continue
    }
    const target = outMap.get(id)
    if (!target) {
      warn.push(`patch: entry ${id} not found`)
      continue
    }
    if (name && name !== target.name) {
      warn.push(`name mismatch ${id}`)
      continue
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'id') continue
      target[key] = value
    }
  }
  return { data: out, warn }
}

test('appended override lands AFTER the insert, so the applier can reach the row', () => {
  const { lines, crlf } = splitLines(REAL_HOME_PATCH)
  const result = upsertDisabled(lines, 'rea-mcp', true)
  const text = joinLines(result.lines, crlf)

  // The insert must still be the first patch entry: appending the override after it
  // is exactly what makes the id resolvable (buildMap(insert) runs first).
  const insertIndex = text.indexOf('- insert:')
  const overrideIndex = text.indexOf('- id: rea-mcp\n  disabled: true')
  assert.ok(insertIndex !== -1, 'insert block survives')
  assert.ok(overrideIndex !== -1, 'top-level override row emitted')
  assert.ok(overrideIndex > insertIndex, 'override must come after the insert')
})

test('the insert list itself is never modified', () => {
  const { lines } = splitLines(REAL_HOME_PATCH)
  const result = upsertDisabled(lines, 'rea-mcp', true)
  // Every original line is preserved verbatim and in order.
  const originalLines = REAL_HOME_PATCH.split('\n').filter((line) => line !== '')
  let cursor = 0
  for (const line of originalLines) {
    while (cursor < result.lines.length && result.lines[cursor] !== line) cursor++
    assert.ok(cursor < result.lines.length, `original line preserved: ${line}`)
    cursor++
  }
})

test('a disabled-only override does not clobber the row config', () => {
  // Simulate the tree after the home insert has been applied, then apply our override.
  const base = []
  const insertPatch = { insert: [{ id: 'rea-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'rea', transport: 'stdio' } }] }
  const first = applyEntryPatches(base, [insertPatch])
  assert.equal(first.warn.length, 0)

  const override = { id: 'rea-mcp', disabled: true }
  const second = applyEntryPatches(first.data, [override])
  assert.equal(second.warn.length, 0, 'override must resolve against the inserted row')

  const row = second.data.find((entry) => entry.id === 'rea-mcp')
  assert.equal(row.disabled, true)
  assert.deepEqual(row.config, { serverName: 'rea', transport: 'stdio' }, 'config must be untouched')
  assert.equal(row.name, '@deepseek-ai/dsh-mcp-client')
})

test('an override row carrying no name passes the name assertion', () => {
  const base = [{ id: 'x', name: '@deepseek-ai/dsh-mcp-client', config: {} }]
  const { warn } = applyEntryPatches(base, [{ id: 'x', disabled: true }])
  assert.equal(warn.length, 0)
})

test('an override whose target row is absent is skipped, not fatal', () => {
  // This is the documented behaviour when the row lives in a lower layer that this
  // particular tree did not compose; the Loader warns and keeps booting.
  const { warn, data } = applyEntryPatches([], [{ id: 'nowhere', disabled: true }])
  assert.equal(warn.length, 1)
  assert.match(warn[0], /not found/)
  assert.deepEqual(data, [])
})

test('re-enabling round-trips and keeps exactly one override row', () => {
  const { lines, crlf } = splitLines(REAL_HOME_PATCH)
  const off = upsertDisabled(lines, 'rea-mcp', true)
  const on = upsertDisabled(off.lines, 'rea-mcp', false)
  const text = joinLines(on.lines, crlf)

  const overrideRows = text.split('\n').filter((line) => line === '- id: rea-mcp')
  assert.equal(overrideRows.length, 1, 'exactly one top-level override row')
  assert.match(text, /^- id: rea-mcp\n  disabled: false$/m)

  const applied = applyEntryPatches(
    [],
    [
      { insert: [{ id: 'rea-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'rea' } }] },
      { id: 'rea-mcp', disabled: false },
    ],
  )
  assert.equal(applied.data.find((entry) => entry.id === 'rea-mcp').disabled, false)
})

test('hasIdRow sees the appended row so a second call upserts instead of appending again', () => {
  const { lines } = splitLines(REAL_HOME_PATCH)
  assert.equal(hasIdRow(lines, 'rea-mcp'), true, 'nested insert row already counts')

  const once = upsertDisabled(lines, 'rea-mcp', true)
  assert.equal(once.lines.filter((line) => line === '- id: rea-mcp').length, 1)

  // Repeating the SAME state is a no-op: the file must be left byte-identical.
  const twice = upsertDisabled(once.lines, 'rea-mcp', true)
  assert.equal(twice.mode, 'unchanged')
  assert.equal(twice.changed, false)

  // Flipping the state does rewrite in place, still with exactly one row.
  const flipped = upsertDisabled(once.lines, 'rea-mcp', false)
  assert.equal(flipped.mode, 'replaced')
  assert.equal(flipped.lines.filter((line) => line === '- id: rea-mcp').length, 1)
})
