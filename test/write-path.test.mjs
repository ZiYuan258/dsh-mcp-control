/**
 * Backup + write-path tests.
 *
 * These drive the REAL `persistDisabled` against a throwaway `DSH_HOME`, so they cover
 * the actual file write (which the pure-helper suite cannot reach) without touching the
 * machine's own patch file. `resolveHomePatchPath()` reads `process.env` at call time,
 * which is the seam that makes this possible.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { persistDisabled, pruneBackups, resolveHomePatchPath, upsertDisabled } from '../index.js'

const SAMPLE = [
  '- insert:',
  '    - id: rea-mcp',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '      config:',
  '        serverName: rea',
  '        transport: stdio',
  '',
].join('\n')

/** Run `fn` with DSH_HOME pointed at a fresh temp dir holding `contents`. */
async function withHome(contents, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcp-control-test-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const file = resolveHomePatchPath()
    if (contents !== null) await writeFile(file, contents, 'utf8')
    return await fn({ dir, file })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

test('persistDisabled writes the override and snapshots the previous bytes', async () => {
  await withHome(SAMPLE, async ({ file }) => {
    const result = await persistDisabled('rea-mcp', true)
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'appended')
    assert.ok(result.backup, 'a backup path must be reported')
    // The backup holds the PRE-edit text, byte for byte.
    assert.equal(await readFile(result.backup, 'utf8'), SAMPLE)
    // The live file gained exactly one override row.
    const after = await readFile(file, 'utf8')
    assert.ok(after.includes('- id: rea-mcp\n  disabled: true'))
  })
})

test('the original insert block survives the write byte-identically', async () => {
  await withHome(SAMPLE, async ({ file }) => {
    await persistDisabled('rea-mcp', true)
    const after = await readFile(file, 'utf8')
    assert.ok(after.startsWith(SAMPLE), 'the original bytes must be an untouched prefix')
  })
})

test('a second toggle rewrites in place and adds no second row', async () => {
  await withHome(SAMPLE, async ({ file }) => {
    await persistDisabled('rea-mcp', true)
    const result = await persistDisabled('rea-mcp', false)
    assert.equal(result.mode, 'replaced')
    const after = await readFile(file, 'utf8')
    const rows = after.split('\n').filter((line) => /^- id: rea-mcp$/.test(line))
    assert.equal(rows.length, 1, 'exactly one top-level row per id, ever')
    assert.ok(after.includes('  disabled: false'))
    assert.ok(!after.includes('  disabled: true'))
  })
})

test('repeating a toggle is a no-op that still reports success', async () => {
  await withHome(SAMPLE, async ({ file }) => {
    await persistDisabled('rea-mcp', true)
    const before = await readFile(file, 'utf8')
    const again = await persistDisabled('rea-mcp', true)
    assert.equal(again.ok, true)
    assert.equal(again.mode, 'unchanged')
    assert.equal(await readFile(file, 'utf8'), before)
  })
})

test('persistDisabled creates the patch file when none exists', async () => {
  await withHome(null, async ({ file }) => {
    const result = await persistDisabled('rea-mcp', true)
    assert.equal(result.ok, true)
    const text = await readFile(file, 'utf8')
    assert.equal(text, '- id: rea-mcp\n  disabled: true\n')
  })
})

test('CRLF line endings are preserved across a write', async () => {
  const crlf = SAMPLE.replace(/\n/g, '\r\n')
  await withHome(crlf, async ({ file }) => {
    await persistDisabled('rea-mcp', true)
    const after = await readFile(file, 'utf8')
    assert.ok(after.includes('\r\n'), 'the file must stay CRLF')
    assert.ok(!/[^\r]\n/.test(after), 'no bare LF may be introduced')
  })
})

test('pruneBackups keeps the newest BACKUP_KEEP copies', async () => {
  await withHome(SAMPLE, async ({ dir, file }) => {
    // 12 toggles => 12 backups, pruned to the 10 newest.
    for (let i = 0; i < 12; i++) await persistDisabled('rea-mcp', i % 2 === 0)
    const backups = (await readdir(dir)).filter((entry) => entry.startsWith('cordis.patch.yml.backup-'))
    assert.equal(backups.length, 10)
  })
})

test('pruneBackups is best-effort on a missing directory', async () => {
  await assert.doesNotReject(pruneBackups(path.join(tmpdir(), 'mcp-control-does-not-exist', 'cordis.patch.yml')))
})

test('the emitted patch satisfies the applier contract end to end', async () => {
  await withHome(SAMPLE, async ({ file }) => {
    await persistDisabled('rea-mcp', true)
    const after = await readFile(file, 'utf8')
    const lines = after.split('\n')
    // The override must come AFTER the insert, since inserted rows are indexed as
    // they are added — a patch before the insert would target nothing.
    const insertAt = lines.findIndex((line) => line.startsWith('- insert:'))
    const overrideAt = lines.findIndex((line) => /^- id: rea-mcp$/.test(line))
    assert.ok(insertAt !== -1 && overrideAt !== -1)
    assert.ok(overrideAt > insertAt, 'override must follow the insert')
    // And upsertDisabled is idempotent on its own output: re-applying the state a row
    // already holds is a no-op, so the file is left alone.
    const again = upsertDisabled(lines, 'rea-mcp', true)
    assert.equal(again.mode, 'unchanged')
    assert.equal(again.changed, false)
    assert.deepEqual(again.lines, lines)
  })
})
