// 从别的 MCP 客户端里把服务器配置读出来，让用户能一键搬进 DSH。
//
// 参考实现（dsh-overall-mcp 的 lib/scanner.js）用的是**白名单制**：只认几个已知路径，
// 绝不递归扫 home。这条必须抄——「扫描整个用户目录找 json」在别人的机器上就是一次
// 隐私事故，而且会慢到像卡死。
//
// 抄的部分到此为止。它把扫描结果直接当成可安装条目；我们只把它当**建议**：每一个
// 扫到的 server 都要先过 `validateServerSpec`，不合法的一律标成不可导入并说清原因。
// 原因很实在——别的客户端的配置格式比 DSH 宽松（允许 `mcpServers` 里塞 `disabled`、
// 允许没有 serverName、允许 `type: "sse"`），照搬会得到一条「装上了但起不来」的行。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** 单文件上限。配置文件不该有这么大，超了说明扫到了别的东西。 */
export const SCAN_FILE_LIMIT = 512 * 1024

/**
 * 白名单。每一项是 `{ app, file }`，file 里可以出现 `%APPDATA%` 之类的环境变量。
 *
 * 顺序固定，因为面板按这个顺序分组显示：先列同族 IDE（用户最可能在用的），
 * 再列终端 agent 的 dotfiles。
 */
export function scanTargets(env = process.env, home = os.homedir()) {
  const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const fill = (text) => text.replace(/%APPDATA%/g, appData).replace(/^~(?=$|[\\/])/, home)
  const raw = [
    { app: 'Claude Desktop', file: '%APPDATA%/Claude/claude_desktop_config.json' },
    { app: 'Claude Code', file: '~/.claude.json' },
    { app: 'Claude Code', file: '~/.claude/settings.json' },
    { app: 'VS Code', file: '%APPDATA%/Code/User/mcp.json' },
    { app: 'VS Code Insiders', file: '%APPDATA%/Code - Insiders/User/mcp.json' },
    { app: 'Cursor', file: '~/.cursor/mcp.json' },
    { app: 'Windsurf', file: '%APPDATA%/Windsurf/User/mcp_config.json' },
    { app: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json' },
    { app: 'Gemini CLI', file: '~/.gemini/settings.json' },
    { app: 'Codex CLI', file: '~/.codex/config.toml' },
  ]
  return raw.map((entry) => ({ app: entry.app, file: fill(entry.file) }))
}

/** 三种已知 schema：`mcpServers`、`servers`、`mcp.servers`。 */
export function serversFromJson(parsed) {
  if (parsed === null || typeof parsed !== 'object') return {}
  if (parsed.mcpServers && typeof parsed.mcpServers === 'object') return parsed.mcpServers
  if (parsed.servers && typeof parsed.servers === 'object') return parsed.servers
  if (parsed.mcp && typeof parsed.mcp === 'object' && parsed.mcp.servers && typeof parsed.mcp.servers === 'object') {
    return parsed.mcp.servers
  }
  return {}
}

/**
 * 极简 TOML 提取：只认 `[mcp_servers.<name>]` 段里的 `key = "value"` 与 `key = [ ... ]`。
 *
 * 为什么不上 TOML 解析器：本插件零依赖，这是硬约束（package-contract 会红）。
 * 而 Codex 的配置文件里我们只关心这一种形状，多解析别的东西只会引入 bug。
 * 认不出来就返回 `{}`，面板上说「这个文件里没找到 MCP 配置」，比报解析错误好。
 */
export function serversFromToml(text) {
  const out = {}
  let current = null
  let collecting = null
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (line === '' || line.startsWith('#')) continue

    const section = /^\[mcp_servers\.([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (section) {
      current = section[1]
      out[current] = out[current] ?? {}
      collecting = null
      continue
    }
    if (line.startsWith('[')) {
      current = null
      collecting = null
      continue
    }
    if (current === null) continue

    // 跨行数组的续行先处理：它**没有** `=`，先走 assignment 分支就会被当成无关行丢掉。
    if (collecting !== null) {
      const piece = line.replace(/,$/, '').trim()
      if (piece === ']') {
        out[current][collecting.key] = collecting.items
        collecting = null
        continue
      }
      if (piece.endsWith(']')) {
        pushTomlString(collecting.items, piece.slice(0, -1))
        out[current][collecting.key] = collecting.items
        collecting = null
        continue
      }
      for (const part of piece.split(',')) pushTomlString(collecting.items, part)
      continue
    }

    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line)
    if (!assignment) continue
    const key = assignment[1]
    let value = assignment[2].trim()

    if (value.startsWith('[') && !value.endsWith(']')) {
      collecting = { key, items: [] }
      continue
    }

    if (value.startsWith('[')) {
      const inner = value.slice(1, value.endsWith(']') ? -1 : undefined)
      const items = []
      for (const piece of inner.split(',')) pushTomlString(items, piece)
      out[current][key] = items
      continue
    }
    out[current][key] = unquoteToml(value)
  }
  return out
}

function pushTomlString(list, piece) {
  const value = unquoteToml(piece)
  if (value !== '') list.push(value)
}

function unquoteToml(text) {
  const value = String(text ?? '').trim()
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1)
  if (value === 'true') return true
  if (value === 'false') return false
  return value.replace(/,$/, '').trim()
}

/**
 * 把一条外来配置翻译成 DSH 的 spec。
 *
 * 三件事在这里发生，每一件都有一个具体的坑：
 *   1. `type`/`transport` 归一：别的客户端用 `sse`（DSH 不支持），用 `http`（DSH 叫
 *      `streamable-http`）。不认识的传输直接不可导入，而不是猜一个。
 *   2. `serverName` 由 id 推导：外来配置里没有这个概念，而 DSH 必须要有。
 *   3. `disabled` 不算信息：我们只导入「能跑的」配置，是否启用在导入后由用户决定。
 */
export function translateServer(id, config) {
  const result = {
    id: String(id),
    serverName: id,
    importable: false,
    error: null,
    spec: null,
    summary: '',
  }

  if (config === null || typeof config !== 'object') {
    result.error = 'entry is not an object'
    return result
  }

  const source = String(config.url ?? config.command ?? '').trim()
  const kind = String(config.type ?? config.transport ?? (source !== '' && /^https?:/i.test(source) ? 'http' : 'stdio')).toLowerCase()

  if (kind === 'sse') {
    result.error = 'SSE transport is not supported by dsh-mcp-client'
    return result
  }

  if (kind === 'http' || kind === 'streamable-http' || kind === 'streamablehttp') {
    const headers = {}
    if (config.headers && typeof config.headers === 'object') {
      for (const [name, value] of Object.entries(config.headers)) {
        if (typeof value === 'string') headers[name] = value
      }
    }
    result.spec = { transport: 'streamable-http', url: String(config.url ?? ''), headers }
    result.summary = result.spec.url
    result.importable = true
    return result
  }

  if (kind === 'stdio') {
    const env = {}
    if (config.env && typeof config.env === 'object') {
      for (const [name, value] of Object.entries(config.env)) {
        if (typeof value === 'string') env[name] = value
      }
    }
    const args = Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : []
    result.spec = {
      transport: 'stdio',
      command: String(config.command ?? ''),
      args,
      cwd: typeof config.cwd === 'string' ? config.cwd : '',
      env,
    }
    result.summary = [result.spec.command, ...args].filter(Boolean).join(' ')
    result.importable = result.spec.command !== ''
    if (!result.importable) result.error = 'stdio entry has no command'
    return result
  }

  result.error = `unsupported transport: ${kind}`
  return result
}

/** 读一个文件，永不抛。返回 `{ ok, servers, error }`。 */
export async function readScanTarget(target) {
  let text
  try {
    const buffer = await readFile(target.file, 'utf8')
    if (buffer.length > SCAN_FILE_LIMIT) {
      return { ...target, ok: false, servers: [], error: `file is larger than ${SCAN_FILE_LIMIT} bytes` }
    }
    text = buffer
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ...target, ok: false, missing: true, servers: [], error: 'not found' }
    return { ...target, ok: false, servers: [], error: String(error?.message ?? error) }
  }

  if (target.file.toLowerCase().endsWith('.toml')) {
    const servers = serversFromToml(text)
    return { ...target, ok: true, servers: Object.entries(servers).map(([id, config]) => translateServer(id, config)) }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ...target, ok: false, servers: [], error: `not valid JSON: ${String(error?.message ?? error)}` }
  }
  const servers = serversFromJson(parsed)
  return { ...target, ok: true, servers: Object.entries(servers).map(([id, config]) => translateServer(id, config)) }
}

/**
 * 全扫一遍。
 *
 * `found` 只含**真的存在**的文件；不存在的目标进 `missing`，面板据此显示
 * 「这台机器上没装别的 MCP 客户端」而不是列一张全红的表。磁盘错误单独进 `failed`。
 */
export async function scanAll(env = process.env, home = os.homedir()) {
  const targets = scanTargets(env, home)
  const results = await Promise.all(targets.map((target) => readScanTarget(target)))
  return {
    found: results.filter((row) => row.ok),
    missing: results.filter((row) => row.missing).map((row) => ({ app: row.app, file: row.file })),
    failed: results.filter((row) => !row.ok && !row.missing).map((row) => ({ app: row.app, file: row.file, error: row.error })),
    scanned: results.length,
  }
}
