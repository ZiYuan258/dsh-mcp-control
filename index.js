/**
 * dsh-mcp-control — host half.
 *
 * A maintained fork of dsh-mcp-toggle (MIT, © 2026 Zenjibad).
 *
 * What it does that the original does not:
 *   1. Prices every MCP server in context tokens, measured from the *model-facing*
 *      projection (ctx.tools.schemas()), so you can see that a 200-tool server costs
 *      ~180k tokens per request before you decide to turn it off.
 *   2. Reports which patch layer each row lives in (home / profile / bundle), because
 *      the home layer outranks the profile layer and that determines where a
 *      `disabled:` override must be written to actually win.
 *   3. Bulk actions (disable-all / enable-all), since the usual intent is
 *      "turn all of these off, I will re-enable one".
 *
 * Invariants inherited from the original (see AGENTS.md of dsh-mcp-toggle):
 *   - packaged plugin, client talks to this host half over its HTTP route;
 *   - list only rows whose options.name is the official client package;
 *   - live toggle must be entry-level Entry#update, never EntryTree#update
 *     (the tree wrapper calls tree.write() and flattens patches into config);
 *   - persistence is an UPSERT of one top-level `- id: <rawId>` + `disabled:` row into
 *     the HOME patch layer, which outranks the profile layer; the file is edited
 *     line-wise and never rewritten wholesale;
 *   - raw config id (entry.options.id) is what patch rows carry, not the prefixed
 *     loader id (`include:<rawId>`) that the client round-trips;
 *   - every failure returns JSON, never a non-JSON 500.
 */

import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const name = 'dsh-mcp-control'
export const inject = ['webServer']

const ROUTE = '/mcp-control/api'
const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client'
const MAX_BODY_BYTES = 1_000_000

/** Loader fiber states (cordis-plugin-loader). 4 is a terminal/unused slot. */
const FIBER_PHASE = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: null, 5: 'unloading' }

/** Entry ids/names this plugin refuses to touch (the patch root and itself). */
const LOCKED = new Set(['include'])
const LOCKED_NAMES = new Set(['cordis:include', 'dsh-mcp-control', 'dsh-mcp-toggle'])

/**
 * Bytes per token used for the cost estimate. This is a deliberate, stated
 * approximation: the real ratio depends on the tokenizer and on how much of the
 * schema is structural punctuation, and the harness bills a tokenizer we cannot
 * call from here. 4 B/token is the conventional English/JSON figure and matches
 * the order of magnitude measured on this host for the REA tool block.
 */
const BYTES_PER_TOKEN = 4

/**
 * How many pre-edit snapshots of the patch file to keep beside it
 * (`cordis.patch.yml.backup-<iso>`). Enough to undo a mistaken click, few enough
 * that a long session cannot leave hundreds of copies in `$DSH_HOME`.
 */
const BACKUP_KEEP = 10

/* -------------------------------------------------------------------------- */
/* pure helpers — no I/O, so they are unit-testable without a DSH process      */
/* -------------------------------------------------------------------------- */

export function fiberPhaseLabel(phase) {
  if (phase === null || phase === undefined) return null
  return FIBER_PHASE[phase] ?? null
}

export function isLocked(id, entryName) {
  if (typeof id !== 'string' || id.length === 0) return true
  if (LOCKED.has(id)) return true
  return typeof entryName === 'string' && LOCKED_NAMES.has(entryName)
}

/** Display label for a row: the MCP serverName, else the package name, else the id. */
export function serverNameOf(entry) {
  const configured = entry?.options?.config?.serverName
  if (typeof configured === 'string' && configured.length > 0) return configured
  const packageName = entry?.options?.name
  if (typeof packageName === 'string' && packageName.length > 0) return packageName
  return String(entry?.id ?? 'unknown')
}

export function estimateTokens(bytes, bytesPerToken = BYTES_PER_TOKEN) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  const divisor = Number.isFinite(bytesPerToken) && bytesPerToken > 0 ? bytesPerToken : BYTES_PER_TOKEN
  return Math.round(bytes / divisor)
}

/** The model-facing tool name an official MCP row contributes: mcp__<serverName>__<tool>. */
export function toolPrefixFor(serverName) {
  return `mcp__${serverName}__`
}

/**
 * Group the model-facing tool schemas by owning MCP server and price each group.
 *
 * Only tools carrying the `mcp__<server>__` prefix are attributed, so this never
 * inflates an MCP server's bill with built-in tools.
 *
 * What is measured: exactly the fields the harness sends to the model for each tool
 * (name + description + parameters). An advertised outputSchema is NOT part of the
 * model-facing projection, so it is correctly absent from this number — which is why
 * this figure is smaller than a raw tools/list payload and larger than nothing.
 */
export function summarizeSchemas(schemas) {
  const byPrefix = new Map()
  let totalToolCount = 0
  let totalBytes = 0

  for (const schema of schemas ?? []) {
    const toolName = schema?.name
    if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) continue
    const rest = toolName.slice('mcp__'.length)
    const sep = rest.indexOf('__')
    if (sep <= 0) continue
    const serverName = rest.slice(0, sep)

    const nameBytes = toolName.length
    const descriptionBytes = typeof schema.description === 'string' ? schema.description.length : 0
    let parameterBytes = 0
    try {
      parameterBytes = JSON.stringify(schema.parameters ?? {}).length
    } catch {
      parameterBytes = 0
    }
    const bytes = nameBytes + descriptionBytes + parameterBytes

    const entry = byPrefix.get(serverName) ?? {
      serverName,
      toolCount: 0,
      schemaBytes: 0,
      nameBytes: 0,
      descriptionBytes: 0,
      parameterBytes: 0,
    }
    entry.toolCount += 1
    entry.schemaBytes += bytes
    entry.nameBytes += nameBytes
    entry.descriptionBytes += descriptionBytes
    entry.parameterBytes += parameterBytes
    byPrefix.set(serverName, entry)

    totalToolCount += 1
    totalBytes += bytes
  }

  for (const entry of byPrefix.values()) entry.estTokens = estimateTokens(entry.schemaBytes)

  return { byServer: byPrefix, totalToolCount, totalBytes, totalEstTokens: estimateTokens(totalBytes) }
}

/** Unquote a YAML scalar well enough to compare ids written by hand or by a tool. */
export function unquoteYaml(text) {
  const value = String(text ?? '').trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

/** Quote an id for YAML only when a bare scalar would be ambiguous. */
export function yamlScalar(value) {
  return /^[A-Za-z0-9_.@/-]+$/.test(value) ? value : JSON.stringify(value)
}

/** Split file text into lines while remembering whether CRLF endings were used. */
export function splitLines(text) {
  const crlf = text.includes('\r\n')
  const lines = text.split('\n')
  if (crlf) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].endsWith('\r')) lines[i] = lines[i].slice(0, -1)
    }
  }
  return { lines, crlf }
}

export function joinLines(lines, crlf) {
  const eol = crlf ? '\r\n' : '\n'
  return lines.join(eol)
}

/**
 * Find every place a raw id appears in a patch file, whichever form it takes:
 * a top-level `- id: x` row, or a row nested inside an `insert:` list.
 * Returns { topLevel: index|-1, nested: index|-1 }.
 */
export function findIdRow(lines, rawId) {
  let result = { topLevel: -1, nested: -1 }
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)- id: (.+)$/.exec(lines[i])
    if (!match) continue
    if (unquoteYaml(match[2]) !== rawId) continue
    if (match[1].length === 0) result.topLevel = i
    else result.nested = i
  }
  return result
}

export function hasIdRow(lines, rawId) {
  const found = findIdRow(lines, rawId)
  return found.topLevel !== -1 || found.nested !== -1
}

/**
 * Upsert a top-level `- id: <rawId>` row carrying `disabled: <bool>`.
 *
 * Behaviour is line-wise and additive, never a rewrite:
 *   - an existing top-level row for the id gets its `disabled:` line replaced
 *     in place (last one wins, so exactly one such line remains);
 *   - a top-level row without any `disabled:` line gains one, indented to match
 *     the row's own children;
 *   - otherwise a fresh two-line row is appended.
 *
 * A row nested inside an `insert:` list is deliberately NOT edited in place: the
 * appended top-level override is the documented "override/disable a composed entry"
 * form, it also wins over the profile layer, and it keeps the original insert list
 * byte-identical.
 */
export function upsertDisabled(lines, rawId, disabled) {
  const target = yamlScalar(rawId)
  const next = lines.slice()
  let currentId = null
  let rowIndex = -1
  let disabledIndex = -1

  for (let i = 0; i < next.length; i++) {
    const idMatch = /^(\s*)- id: (.+)$/.exec(next[i])
    if (idMatch) {
      currentId = idMatch[1].length === 0 ? unquoteYaml(idMatch[2]) : null
      if (currentId === rawId) rowIndex = i
      continue
    }
    if (currentId === rawId && /^\s+disabled:/.test(next[i])) disabledIndex = i
  }

  if (disabledIndex !== -1) {
    const indent = /^(\s*)/.exec(next[disabledIndex])[1]
    const updated = `${indent}disabled: ${disabled ? 'true' : 'false'}`
    // A toggle to the state it already holds must not touch the file: rewriting it
    // would churn mtime, drop a pointless backup, and wake the patch HMR watcher.
    if (next[disabledIndex] === updated) {
      return { lines, changed: false, mode: 'unchanged' }
    }
    next[disabledIndex] = updated
    return { lines: next, changed: true, mode: 'replaced' }
  }

  if (rowIndex !== -1) {
    const indent = `${/^(\s*)/.exec(next[rowIndex])[1]}  `
    next.splice(rowIndex + 1, 0, `${indent}disabled: ${disabled ? 'true' : 'false'}`)
    return { lines: next, changed: true, mode: 'inserted' }
  }

  const endsWithBlank = next.length > 0 && next[next.length - 1].trim() === ''
  const appended = []
  if (!endsWithBlank && next.length > 0) appended.push('')
  appended.push(`- id: ${target}`, `  disabled: ${disabled ? 'true' : 'false'}`, '')
  return { lines: next.concat(appended), changed: true, mode: 'appended' }
}

/** Resolve the home patch layer: $DSH_HOME/cordis.patch.yml (default ~/.dsh). */
export function resolveHomePatchPath(env = process.env, home = os.homedir()) {
  const dshHome = env.DSH_HOME && String(env.DSH_HOME).trim() ? String(env.DSH_HOME).trim() : path.join(home, '.dsh')
  return path.join(dshHome, 'cordis.patch.yml')
}

export function resolveDshHome(env = process.env, home = os.homedir()) {
  return env.DSH_HOME && String(env.DSH_HOME).trim() ? String(env.DSH_HOME).trim() : path.join(home, '.dsh')
}

/* -------------------------------------------------------------------------- */
/* patch layer inspection                                                     */
/* -------------------------------------------------------------------------- */

async function readPatchLines(file) {
  try {
    const text = await readFile(file, 'utf8')
    return { ok: true, ...splitLines(text) }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, lines: [], crlf: false, missing: true }
    return { ok: false, lines: [], crlf: false, error: String(error?.message ?? error) }
  }
}

/**
 * Every layer a raw id could live in. Read-only: this never writes.
 * Layers are reported so the UI can explain WHERE a row comes from, and so a
 * "disabled: true" that is silently shadowed by a higher layer is visible.
 */
async function inspectLayers(rawId, ctx) {
  const homePath = resolveHomePatchPath()
  const layers = []

  const home = await readPatchLines(homePath)
  if (home.ok) {
    layers.push({ layer: 'home', file: homePath, present: hasIdRow(home.lines, rawId), readable: true })
  } else {
    layers.push({ layer: 'home', file: homePath, present: false, readable: false, error: home.error })
  }

  const profilesDir = path.join(resolveDshHome(), 'profiles')
  let profileNames = []
  try {
    const entries = await readdir(profilesDir, { withFileTypes: true })
    profileNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    profileNames = []
  }

  for (const profileName of profileNames) {
    const file = path.join(profilesDir, profileName, 'cordis.patch.yml')
    const parsed = await readPatchLines(file)
    if (!parsed.ok) {
      layers.push({ layer: `profile:${profileName}`, file, present: false, readable: false, error: parsed.error })
      continue
    }
    if (parsed.missing) continue
    layers.push({ layer: `profile:${profileName}`, file, present: hasIdRow(parsed.lines, rawId), readable: true })
  }

  const present = layers.filter((entry) => entry.present)
  const label = present.length === 0 ? 'bundle' : present.map((entry) => entry.layer).join('+')
  return { layers, label }
}

/* -------------------------------------------------------------------------- */
/* host plugin                                                                */
/* -------------------------------------------------------------------------- */

function listMcpEntries(loader) {
  const rows = []
  for (const entry of loader.entries()) {
    if (entry?.options?.group) continue
    if (entry?.options?.name !== MCP_CLIENT_PLUGIN) continue
    const rawId = typeof entry.options.id === 'string' ? entry.options.id : entry.id
    if (isLocked(rawId, entry.options.name)) continue
    rows.push({
      entryId: entry.id,
      rawId,
      serverName: serverNameOf(entry),
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : fiberPhaseLabel(entry.fiber.state),
    })
  }
  rows.sort((a, b) => a.serverName.localeCompare(b.serverName))
  return rows
}

async function buildSnapshot(ctx) {
  const loader = ctx.get('loader')
  if (!loader) return { ok: false, status: 503, error: 'loader service unavailable' }

  const rows = listMcpEntries(loader)

  let costs = { byServer: new Map(), totalToolCount: 0, totalBytes: 0, totalEstTokens: 0 }
  const tools = ctx.get('tools')
  if (tools && typeof tools.schemas === 'function') {
    try {
      costs = summarizeSchemas(tools.schemas())
    } catch (error) {
      ctx.logger?.warn?.(`mcp-control: could not read tool schemas: ${String(error?.message ?? error)}`)
    }
  }

  const servers = []
  for (const row of rows) {
    const cost = costs.byServer.get(row.serverName)
    const { layers, label } = await inspectLayers(row.rawId, ctx)
    servers.push({
      ...row,
      toolCount: cost?.toolCount ?? 0,
      schemaBytes: cost?.schemaBytes ?? 0,
      estTokens: cost?.estTokens ?? 0,
      breakdown: cost
        ? { nameBytes: cost.nameBytes, descriptionBytes: cost.descriptionBytes, parameterBytes: cost.parameterBytes }
        : null,
      layer: label,
      layers,
    })
  }

  const enabled = servers.filter((server) => server.enabled)
  return {
    ok: true,
    servers,
    totals: {
      servers: servers.length,
      enabled: enabled.length,
      disabled: servers.length - enabled.length,
      mcpToolCount: costs.totalToolCount,
      mcpSchemaBytes: costs.totalBytes,
      mcpEstTokens: costs.totalEstTokens,
      activeEstTokens: enabled.reduce((sum, server) => sum + server.estTokens, 0),
      bytesPerToken: BYTES_PER_TOKEN,
    },
    patchPath: resolveHomePatchPath(),
    layersReadable: servers.every((server) => server.layers.every((layer) => layer.readable)),
  }
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return { ok: false, error: 'payload too large' }
    chunks.push(chunk)
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8')
    return { ok: true, value: text.trim() ? JSON.parse(text) : {} }
  } catch {
    return { ok: false, error: 'unreadable request body' }
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Keep a rolling copy of the patch file before we touch it.
 *
 * The upstream dsh-mcp-toggle rewrites `$DSH_HOME/cordis.patch.yml` in place with no
 * backup and no approval gate; a bad edit there can break host startup for every
 * profile. The write path is small and test-covered, but "small and tested" is not
 * "recoverable", so every mutation first drops a timestamped copy.
 *
 * Never throws: a failed backup must not block a legitimate toggle, but it IS
 * reported in the result so the caller can see the write went unguarded.
 */
async function backupPatchFile(file, previousText) {
  if (previousText == null) return { ok: true, skipped: 'no previous file' }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${file}.backup-${stamp}`
    await writeFile(target, previousText, 'utf8')
    await pruneBackups(file)
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

/** Keep only the most recent BACKUP_KEEP copies, so a chatty UI cannot fill the disk. */
export async function pruneBackups(file) {
  try {
    const dir = path.dirname(file)
    const base = `${path.basename(file)}.backup-`
    const stale = (await readdir(dir))
      .filter((entry) => entry.startsWith(base))
      .sort()
      .slice(0, -BACKUP_KEEP)
    for (const entry of stale) {
      await rm(path.join(dir, entry), { force: true })
    }
  } catch {
    // Pruning is best-effort housekeeping; never surface its failure.
  }
}

/** Persist the desired state of one raw id into the HOME patch layer. */
export async function persistDisabled(rawId, disabled) {
  const file = resolveHomePatchPath()
  const existing = await readPatchLines(file)
  if (!existing.ok) return { ok: false, error: existing.error }

  const result = upsertDisabled(existing.lines, rawId, disabled)
  if (!result.changed) return { ok: true, file, mode: 'unchanged' }

  let text = joinLines(result.lines, existing.crlf)
  if (!text.endsWith('\n')) text += existing.crlf ? '\r\n' : '\n'

  // Snapshot the pre-edit bytes ("" for a file that did not exist yet).
  const backup = await backupPatchFile(file, existing.missing ? '' : joinLines(existing.lines, existing.crlf))

  try {
    await writeFile(file, text, 'utf8')
    return { ok: true, file, mode: result.mode, backup: backup.ok ? backup.path : null, backupError: backup.ok ? undefined : backup.error }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

function isMcpEntry(entry) {
  return entry?.options?.name === MCP_CLIENT_PLUGIN
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (!webServer) {
    ctx.logger?.warn?.('mcp-control: webServer service unavailable; panel route not mounted')
    return
  }

  const handler = async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()

      if (method === 'GET') {
        const snapshot = await buildSnapshot(ctx)
        return send(res, snapshot.ok ? 200 : snapshot.status, snapshot)
      }

      if (method !== 'POST') {
        return send(res, 405, { ok: false, error: 'method not allowed' })
      }

      const body = await readJsonBody(req)
      if (!body.ok) {
        if (body.error === 'payload too large') req.destroy()
        return send(res, 400, { ok: false, error: body.error })
      }

      const payload = body.value ?? {}

      // Bulk: the usual intent is "everything off, then enable the one I need".
      if (payload.action === 'disable-all' || payload.action === 'enable-all') {
        const loader = ctx.get('loader')
        if (!loader) return send(res, 503, { ok: false, error: 'loader service unavailable' })
        const disabled = payload.action === 'disable-all'
        const results = []
        for (const row of listMcpEntries(loader)) {
          if (row.enabled === !disabled) {
            results.push({ entryId: row.entryId, serverName: row.serverName, changed: false })
            continue
          }
          try {
            const entry = loader.resolve(row.entryId)
            await entry.update({ disabled })
            const persisted = await persistDisabled(row.rawId, disabled)
            results.push({
              entryId: row.entryId,
              serverName: row.serverName,
              changed: true,
              persisted: persisted.ok,
              persistError: persisted.ok ? undefined : persisted.error,
            })
          } catch (error) {
            results.push({
              entryId: row.entryId,
              serverName: row.serverName,
              changed: false,
              error: String(error?.message ?? error),
            })
          }
        }
        const snapshot = await buildSnapshot(ctx)
        return send(res, 200, {
          ok: true,
          action: payload.action,
          results,
          patchPath: resolveHomePatchPath(),
          servers: snapshot.ok ? snapshot.servers : [],
          totals: snapshot.ok ? snapshot.totals : null,
        })
      }

      const entryId = typeof payload.entryId === 'string' ? payload.entryId.trim() : ''
      if (!entryId) return send(res, 403, { ok: false, error: 'entry is not toggleable: ' })
      if (typeof payload.disabled !== 'boolean') {
        return send(res, 400, { ok: false, error: 'disabled must be a boolean' })
      }

      const loader = ctx.get('loader')
      if (!loader) return send(res, 503, { ok: false, error: 'loader service unavailable' })

      let entry
      try {
        entry = loader.resolve(entryId)
      } catch {
        return send(res, 404, { ok: false, error: `unknown entry: ${entryId}` })
      }
      if (!entry || !isMcpEntry(entry)) {
        return send(res, 400, { ok: false, error: 'entry is not an MCP client row' })
      }

      const rawId = typeof entry.options.id === 'string' ? entry.options.id : entry.id
      if (isLocked(rawId, entry.options.name)) {
        return send(res, 403, { ok: false, error: `entry is not toggleable: ${entryId}` })
      }

      // Live toggle first: entry-level update disposes/starts the mcp-client fiber,
      // which unregisters/registers its mcp__* tools immediately.
      try {
        await entry.update({ disabled: payload.disabled })
      } catch (error) {
        return send(res, 500, {
          ok: false,
          error: `failed to ${payload.disabled ? 'disable' : 'enable'}: ${String(error?.message ?? error)}`,
        })
      }

      const persisted = await persistDisabled(rawId, payload.disabled)
      if (!persisted.ok) {
        ctx.logger?.warn?.(`mcp-control: persistence failed: ${persisted.error}`)
      }

      return send(res, 200, {
        ok: true,
        entryId,
        rawId,
        serverName: serverNameOf(entry),
        disabled: payload.disabled,
        fiberPhase: entry.fiber === undefined ? null : fiberPhaseLabel(entry.fiber.state),
        persisted: persisted.ok,
        persistMode: persisted.ok ? persisted.mode : undefined,
        patchPath: resolveHomePatchPath(),
        // Where the pre-edit copy went, so an undo needs no guesswork.
        backupPath: persisted.backup ?? undefined,
        persistError: persisted.ok ? undefined : persisted.error,
      })
    } catch (error) {
      // Never throw across the API: the client always gets JSON it can render.
      ctx.logger?.warn?.(`mcp-control: request failed: ${String(error?.message ?? error)}`)
      try {
        send(res, 500, { ok: false, error: String(error?.message ?? error) })
      } catch {
        /* response already gone */
      }
    }
  }

  ctx.effect(() => webServer.register({ kind: 'exact', path: ROUTE, handler }), 'mcp-control.route')
}
