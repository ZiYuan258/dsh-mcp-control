/**
 * 扫描导入的测试。
 *
 * 这一组守的是**隐私边界**：扫描只许读白名单里的十个文件，绝不递归。所以有一条
 * 用例专门断言「白名单之外的文件不会被碰」——它不是形式主义，是这条功能唯一的
 * 安全承诺，而且很容易在某次"顺手支持一下 X"里被悄悄破坏。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  SCAN_FILE_LIMIT,
  readScanTarget,
  scanAll,
  scanTargets,
  serversFromJson,
  serversFromToml,
  translateServer,
} from '../lib/scan.js'

const HOME = 'C:\\Users\\demo'
const ENV = { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' }

test('scanTargets 是白名单，十项，顺序固定', () => {
  const targets = scanTargets(ENV, HOME)
  assert.equal(targets.length, 10)
  assert.deepEqual(
    targets.map((row) => row.app),
    ['Claude Desktop', 'Claude Code', 'Claude Code', 'VS Code', 'VS Code Insiders', 'Cursor', 'Windsurf', 'Windsurf', 'Gemini CLI', 'Codex CLI'],
  )
  // %APPDATA% 与 ~ 都被展开
  assert.equal(targets[0].file, 'C:\\Users\\demo\\AppData\\Roaming/Claude/claude_desktop_config.json')
  assert.equal(targets[1].file, 'C:\\Users\\demo/.claude.json')
  // 每一项都是绝对路径，没有通配、没有目录
  for (const row of targets) {
    assert.ok(path.isAbsolute(row.file) || /^[A-Za-z]:/.test(row.file), row.file)
    assert.doesNotMatch(row.file, /\*/)
  }
})

test('serversFromJson 认三种 schema', () => {
  assert.deepEqual(serversFromJson({ mcpServers: { a: {} } }), { a: {} })
  assert.deepEqual(serversFromJson({ servers: { b: {} } }), { b: {} })
  assert.deepEqual(serversFromJson({ mcp: { servers: { c: {} } } }), { c: {} })
  // mcpServers 优先
  assert.deepEqual(serversFromJson({ mcpServers: { a: {} }, servers: { b: {} } }), { a: {} })
  assert.deepEqual(serversFromJson({}), {})
  assert.deepEqual(serversFromJson(null), {})
  assert.deepEqual(serversFromJson([]), {})
})

test('serversFromToml 只读 [mcp_servers.*]，支持跨行数组', () => {
  const text = [
    '# 顶层注释',
    'model = "gpt-5"',
    '',
    '[mcp_servers.fetch]',
    'command = "uvx"',
    'args = [',
    '  "mcp-server-fetch",',
    '  "--verbose",',
    ']',
    'disabled = false',
    '',
    '[mcp_servers.gh]',
    'command = "npx"',
    'args = ["-y", "gh-mcp"]',
    '',
    '[other]',
    'command = "should-not-appear"',
  ].join('\n')

  const servers = serversFromToml(text)
  assert.deepEqual(Object.keys(servers).sort(), ['fetch', 'gh'])
  assert.equal(servers.fetch.command, 'uvx')
  assert.deepEqual(servers.fetch.args, ['mcp-server-fetch', '--verbose'])
  assert.equal(servers.fetch.disabled, false)
  assert.deepEqual(servers.gh.args, ['-y', 'gh-mcp'])
  // 非 mcp_servers 段一律不认
  assert.equal(servers.other, undefined)
})

test('serversFromToml 遇到认不出的东西返回空对象而不是抛', () => {
  assert.deepEqual(serversFromToml(''), {})
  assert.deepEqual(serversFromToml('[[array_of_tables]]\nname = "x"'), {})
  assert.deepEqual(serversFromToml(null), {})
})

test('translateServer：stdio 可导入，缺 command 不可导入', () => {
  const good = translateServer('fetch', { command: 'uvx', args: ['mcp-server-fetch'] })
  assert.equal(good.importable, true)
  assert.equal(good.error, null)
  assert.equal(good.spec.transport, 'stdio')
  assert.equal(good.spec.command, 'uvx')
  assert.deepEqual(good.spec.args, ['mcp-server-fetch'])
  assert.equal(good.summary, 'uvx mcp-server-fetch')

  const empty = translateServer('nothing', {})
  assert.equal(empty.importable, false)
  assert.equal(empty.error, 'stdio entry has no command')
})

test('translateServer：sse 直接拒绝，http 归一成 streamable-http', () => {
  const sse = translateServer('legacy', { type: 'sse', url: 'https://x.dev/sse' })
  assert.equal(sse.importable, false)
  assert.match(sse.error, /SSE transport is not supported/)

  const http = translateServer('web', { type: 'http', url: 'https://x.dev/mcp', headers: { A: 'b', N: 1 } })
  assert.equal(http.importable, true)
  assert.equal(http.spec.transport, 'streamable-http')
  assert.deepEqual(http.spec.headers, { A: 'b' }) // 非字符串的 header 被丢掉

  const modern = translateServer('web2', { transport: 'streamable-http', url: 'https://x.dev/mcp' })
  assert.equal(modern.importable, true)

  const unknown = translateServer('weird', { type: 'websocket', url: 'wss://x.dev' })
  assert.equal(unknown.importable, false)
  assert.match(unknown.error, /unsupported transport/)
})

test('translateServer：有 url 没 type 时按 http 猜', () => {
  const guessed = translateServer('guess', { url: 'https://x.dev/mcp' })
  assert.equal(guessed.importable, true)
  assert.equal(guessed.spec.transport, 'streamable-http')
})

test('readScanTarget 永不抛：缺失文件标 missing', async () => {
  const missing = await readScanTarget({ app: 'X', file: path.join(tmpdir(), 'nope-does-not-exist.json') })
  assert.equal(missing.ok, false)
  assert.equal(missing.missing, true)
  assert.equal(missing.error, 'not found')
})

test('readScanTarget：坏 JSON 与超限文件都被当成 failed 而不是崩溃', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scan-test-'))
  try {
    const bad = path.join(dir, 'mcp.json')
    await writeFile(bad, '{ not json', 'utf8')
    const broken = await readScanTarget({ app: 'X', file: bad })
    assert.equal(broken.ok, false)
    assert.equal(broken.missing, undefined)
    assert.match(broken.error, /not valid JSON/)

    const huge = path.join(dir, 'huge.json')
    await writeFile(huge, 'x'.repeat(SCAN_FILE_LIMIT + 10), 'utf8')
    const tooBig = await readScanTarget({ app: 'X', file: huge })
    assert.equal(tooBig.ok, false)
    assert.match(tooBig.error, /larger than/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readScanTarget：json 与 toml 各走一条路，server 都翻译过', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scan-ok-'))
  try {
    const json = path.join(dir, 'mcp.json')
    await writeFile(json, JSON.stringify({ mcpServers: { fetch: { command: 'uvx', args: ['mcp-server-fetch'] } } }), 'utf8')
    const fromJson = await readScanTarget({ app: 'VS Code', file: json })
    assert.equal(fromJson.ok, true)
    assert.equal(fromJson.servers.length, 1)
    assert.equal(fromJson.servers[0].id, 'fetch')
    assert.equal(fromJson.servers[0].importable, true)

    const toml = path.join(dir, 'config.toml')
    await writeFile(toml, '[mcp_servers.gh]\ncommand = "npx"\nargs = ["-y", "gh-mcp"]\n', 'utf8')
    const fromToml = await readScanTarget({ app: 'Codex CLI', file: toml })
    assert.equal(fromToml.ok, true)
    assert.equal(fromToml.servers[0].id, 'gh')
    assert.deepEqual(fromToml.servers[0].spec.args, ['-y', 'gh-mcp'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('scanAll 用假 home 跑：只碰白名单里的十个路径', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'scan-home-'))
  const env = { APPDATA: path.join(home, 'AppData', 'Roaming') }
  try {
    // 白名单里的两个：一个 JSON、一个 TOML
    await mkdir(path.join(home, '.claude'), { recursive: true })
    await writeFile(
      path.join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { fetch: { command: 'uvx' }, legacy: { type: 'sse', url: 'https://x/sse' } } }),
      'utf8',
    )
    await mkdir(path.join(home, '.codex'), { recursive: true })
    await writeFile(path.join(home, '.codex', 'config.toml'), '[mcp_servers.gh]\ncommand = "npx"\n', 'utf8')

    // 白名单之外的文件：绝不能出现在结果里
    await writeFile(path.join(home, 'secret.json'), JSON.stringify({ mcpServers: { leak: { command: 'x' } } }), 'utf8')
    await mkdir(path.join(home, 'projects'), { recursive: true })
    await writeFile(path.join(home, 'projects', 'mcp.json'), JSON.stringify({ mcpServers: { leak2: { command: 'x' } } }), 'utf8')

    const result = await scanAll(env, home)

    assert.equal(result.scanned, 10)
    assert.equal(result.found.length, 2)
    assert.equal(result.missing.length, 8)
    assert.deepEqual(result.failed, [])

    const files = result.found.map((row) => row.file)
    assert.ok(!files.some((file) => file.includes('secret.json')))
    assert.ok(!files.some((file) => file.includes('projects')))

    // 白名单文件里的 server 都翻译过：sse 那条不可导入
    const claude = result.found.find((row) => row.file.endsWith('.claude.json'))
    const legacy = claude.servers.find((server) => server.id === 'legacy')
    assert.equal(legacy.importable, false)
    assert.match(legacy.error, /SSE/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
