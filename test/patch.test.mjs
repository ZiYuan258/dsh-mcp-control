/**
 * 安装/卸载行的纯函数测试。
 *
 * 这一组是本插件里"写别人文件"的那部分，所以断言的重点不是"能跑"，而是
 * **写出来的字节读回来还是同一个值**、**不该动的一个字节都不动**。
 * YAML 标量那一节尤其重要：Windows 路径写进双引号标量会让 `yaml.load` 直接抛，
 * 而这种错误只有在别人的机器上才会出现。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MCP_CLIENT_PLUGIN,
  appendServerBlock,
  buildInsertBlock,
  listServerRows,
  removeServerRows,
  suggestServerName,
  validateServerSpec,
  yamlQuote,
} from '../lib/patch.js'

/**
 * 宿主自己写的一块：一个 insert 行 + 一条独立的覆盖行。
 *
 * 末尾那个 `''` 是**结尾换行**，不是空行（`splitLines`/`joinLines` 就靠它区分
 * "有换行"和"没有换行"）。真实补丁文件都以换行结尾，所以基线必须带上它，
 * 否则"装一次再卸一次回到同一串字节"这条断言测的就不是真实形状。
 */
const HOST_FILE = [
  '- insert:',
  '    - id: rea-mcp',
  '      name: "@deepseek-ai/dsh-mcp-client"',
  '      config:',
  '        serverName: rea',
  '        transport: stdio',
  '        command: C:\\Users\\me\\node.exe',
  '- id: rea-mcp',
  '  disabled: true',
  '',
]

test('yamlQuote 只在安全时才裸写，其余一律单引号', () => {
  // 裸写：普通标识符
  assert.equal(yamlQuote('npx'), 'npx')
  assert.equal(yamlQuote('rea'), 'rea')
  assert.equal(yamlQuote('server.mjs'), 'server.mjs')
  // `@` 在 YAML 里是保留指示符，出现在开头必须引起来
  assert.equal(yamlQuote('@acme/srv'), "'@acme/srv'")

  // 以 '-' 开头会写成 `- -y`，看着像嵌套序列，必须引起来
  assert.equal(yamlQuote('-y'), "'-y'")
  assert.equal(yamlQuote('-m'), "'-m'")

  // 空串与保留字
  assert.equal(yamlQuote(''), "''")
  assert.equal(yamlQuote(null), "''")
  assert.equal(yamlQuote('true'), "'true'")
  assert.equal(yamlQuote('FALSE'), "'FALSE'")
  assert.equal(yamlQuote('null'), "'null'")
  assert.equal(yamlQuote('off'), "'off'")

  // 数字看着像标量，读回来却是 number
  assert.equal(yamlQuote('42'), "'42'")
  assert.equal(yamlQuote('1.5'), "'1.5'")
  assert.equal(yamlQuote('1e3'), "'1e3'")

  // 单引号标量里反斜杠是字面量 —— 这正是 Windows 路径需要的
  assert.equal(yamlQuote('D:\\Anaconda\\python.exe'), "'D:\\Anaconda\\python.exe'")
  assert.equal(yamlQuote('https://x.dev/sse'), "'https://x.dev/sse'")
  assert.equal(yamlQuote('a b'), "'a b'")

  // 内部单引号双写
  assert.equal(yamlQuote("it's"), "'it''s'")
})

test('validateServerSpec 拒绝而不是纠正', () => {
  const ok = { id: 'demo', serverName: 'demo', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }
  assert.deepEqual(validateServerSpec(ok), { ok: true })

  assert.equal(validateServerSpec(null).ok, false)
  assert.match(validateServerSpec(null).error, /object/)

  assert.equal(validateServerSpec({ ...ok, id: '' }).ok, false)
  assert.match(validateServerSpec({ ...ok, id: 'a b' }).error, /letters, digits/)
  assert.equal(validateServerSpec({ ...ok, id: '-lead' }).ok, false)

  assert.equal(validateServerSpec({ ...ok, serverName: '' }).ok, false)
  assert.match(validateServerSpec({ ...ok, serverName: 'x'.repeat(33) }).error, /1-32 characters/)
  assert.equal(validateServerSpec({ ...ok, serverName: 'has space' }).ok, false)

  assert.match(validateServerSpec({ ...ok, transport: 'sse' }).error, /stdio or streamable-http/)
  assert.match(validateServerSpec({ ...ok, command: '' }).error, /command is required/)
  assert.match(validateServerSpec({ ...ok, args: ['ok', 2] }).error, /array of strings/)
  assert.match(validateServerSpec({ ...ok, env: { A: 1 } }).error, /object of strings/)
  assert.match(validateServerSpec({ ...ok, cwd: 5 }).error, /cwd must be a string/)

  const http = { id: 'web', serverName: 'web', transport: 'streamable-http', url: 'https://x.dev/mcp' }
  assert.deepEqual(validateServerSpec(http), { ok: true })
  assert.match(validateServerSpec({ ...http, url: '' }).error, /url is required/)
  assert.match(validateServerSpec({ ...http, url: 'ftp://x' }).error, /http:\/\/ or https:\/\//)

  assert.match(validateServerSpec({ ...ok, toolCallTimeoutMs: 0 }).error, /positive number/)
  assert.match(validateServerSpec({ ...ok, toolCallTimeoutMs: '900' }).error, /positive number/)
})

test('buildInsertBlock 的缩进与宿主自己写的块逐字符一致', () => {
  const lines = buildInsertBlock({
    id: 'demo',
    serverName: 'demo',
    transport: 'stdio',
    command: 'D:\\Anaconda\\python.exe',
    args: ['-m', 'demo.mcp'],
    cwd: 'D:\\work',
    env: { DEMO_ROOT: 'D:\\work', PYTHONIOENCODING: 'utf-8' },
    toolCallTimeoutMs: 3600000,
  })

  assert.equal(lines[0], '- insert:')
  assert.equal(lines[1], '    - id: demo')
  assert.equal(lines[2], `      name: "${MCP_CLIENT_PLUGIN}"`)
  assert.equal(lines[3], '      config:')
  assert.equal(lines[4], '        serverName: demo')
  assert.equal(lines[5], '        transport: stdio')
  assert.equal(lines[6], "        command: 'D:\\Anaconda\\python.exe'")
  assert.equal(lines[7], '        args:')
  assert.equal(lines[8], "          - '-m'")
  assert.equal(lines[9], '          - demo.mcp')
  assert.equal(lines[10], "        cwd: 'D:\\work'")
  assert.equal(lines[11], '        env:')
  assert.equal(lines[12], "          DEMO_ROOT: 'D:\\work'")
  assert.equal(lines[13], "          PYTHONIOENCODING: utf-8")
  assert.equal(lines[14], '        toolCallTimeoutMs: 3600000')
})

test('buildInsertBlock 的 http 分支写 url/headers 而不是 command', () => {
  const lines = buildInsertBlock({
    id: 'web',
    serverName: 'web',
    transport: 'streamable-http',
    url: 'https://x.dev/mcp',
    headers: { Authorization: 'Bearer t' },
  })
  const text = lines.join('\n')
  assert.match(text, /transport: streamable-http/)
  assert.match(text, /url: 'https:\/\/x\.dev\/mcp'/)
  assert.match(text, /headers:/)
  assert.match(text, /Authorization: 'Bearer t'/)
  assert.doesNotMatch(text, /command:/)
})

test('appendServerBlock 追加一整块，既有内容一个字节不动', () => {
  const before = HOST_FILE.slice()
  const result = appendServerBlock(before, {
    id: 'new-mcp',
    serverName: 'newmcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
  })

  assert.equal(result.changed, true)
  assert.equal(result.mode, 'appended')
  // 原文件的每一行都还在原位
  for (let i = 0; i < before.length; i++) assert.equal(result.lines[i], before[i])
  // 紧跟其后的是我们那一块（基线以换行结尾，所以不需要再插一个分隔空行）
  assert.equal(result.lines[before.length], '- insert:')
  assert.equal(result.lines[before.length + 1], '    - id: new-mcp')
  // 结尾换行跟着原文件走
  assert.equal(result.lines[result.lines.length - 1], '')
})

test('appendServerBlock 对没有结尾换行的文件也不擅自补一个', () => {
  const noTrailing = HOST_FILE.slice(0, -1)
  const result = appendServerBlock(noTrailing, {
    id: 'new-mcp',
    serverName: 'newmcp',
    transport: 'stdio',
    command: 'npx',
  })
  assert.equal(result.mode, 'appended')
  // 先补一个分隔空行，块放在最后，整体仍然不以空行结尾
  assert.equal(result.lines[noTrailing.length], '')
  assert.equal(result.lines[noTrailing.length + 1], '- insert:')
  assert.notEqual(result.lines[result.lines.length - 1], '')
})

test('appendServerBlock 遇到重复 id 拒绝覆盖', () => {
  const result = appendServerBlock(HOST_FILE.slice(), {
    id: 'rea-mcp',
    serverName: 'other',
    transport: 'stdio',
    command: 'npx',
  })
  assert.equal(result.changed, false)
  assert.equal(result.mode, 'duplicate')
  assert.deepEqual(result.lines, HOST_FILE)
})

test('appendServerBlock 拒绝不合法的 spec，文件原样返回', () => {
  const result = appendServerBlock(HOST_FILE.slice(), { id: 'x', serverName: 'x', transport: 'sse' })
  assert.equal(result.changed, false)
  assert.equal(result.mode, 'invalid')
  assert.deepEqual(result.lines, HOST_FILE)
})

test('removeServerRows 只删自己那一块，旁边的覆盖行原样留下', () => {
  const withOwn = appendServerBlock(HOST_FILE.slice(), {
    id: 'own-mcp',
    serverName: 'own',
    transport: 'stdio',
    command: 'npx',
  }).lines

  const result = removeServerRows(withOwn, 'own-mcp')
  assert.equal(result.changed, true)
  assert.equal(result.mode, 'removed')
  assert.equal(result.removed, 1)
  assert.deepEqual(result.lines, HOST_FILE)
})

test('removeServerRows 不删同名但属于别的插件的行', () => {
  const foreign = [
    '- insert:',
    '    - id: shared',
    '      name: "@someone/other-plugin"',
    '      config:',
    '        whatever: 1',
  ]
  const result = removeServerRows(foreign, 'shared')
  assert.equal(result.changed, false)
  assert.equal(result.mode, 'absent')
  assert.deepEqual(result.lines, foreign)
})

test('removeServerRows 保留同一块里宿主写的那一行', () => {
  const shared = [
    '- insert:',
    '    - id: mine',
    '      name: "@deepseek-ai/dsh-mcp-client"',
    '      config:',
    '        serverName: mine',
    '        transport: stdio',
    '        command: npx',
    '    - id: theirs',
    '      name: "@someone/other-plugin"',
  ]
  const result = removeServerRows(shared, 'mine')
  assert.equal(result.changed, true)
  const text = result.lines.join('\n')
  assert.doesNotMatch(text, /mine/)
  assert.match(text, /- insert:/) // 块非空，必须留下
  assert.match(text, /id: theirs/)
})

test('removeServerRows 删完就空掉的 insert 块整块拿走', () => {
  const only = [
    '- insert:',
    '    - id: solo',
    '      name: "@deepseek-ai/dsh-mcp-client"',
    '      config:',
    '        serverName: solo',
    '',
  ]
  const result = removeServerRows(only, 'solo')
  assert.equal(result.changed, true)
  assert.deepEqual(result.lines, [])
})

test('装一次再卸一次，回到同一串字节（结尾换行也还原）', () => {
  for (const baseline of [HOST_FILE.slice(), HOST_FILE.slice(0, -1)]) {
    const installed = appendServerBlock(baseline.slice(), {
      id: 'round-mcp',
      serverName: 'round',
      transport: 'stdio',
      command: 'npx',
    })
    assert.equal(installed.mode, 'appended')
    const removed = removeServerRows(installed.lines, 'round-mcp')
    assert.equal(removed.mode, 'removed')
    assert.deepEqual(removed.lines, baseline)
  }
})

test('removeServerRows 未知 id 是 absent 而不是错误', () => {
  const result = removeServerRows(HOST_FILE.slice(), 'nope')
  assert.equal(result.changed, false)
  assert.equal(result.mode, 'absent')
  assert.equal(result.removed, 0)
})

test('listServerRows 只报插入行，跳过顶层覆盖行', () => {
  const rows = listServerRows(HOST_FILE)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { id: 'rea-mcp', serverName: 'rea', transport: 'stdio' })
})

test('listServerRows 认得块里后来追加的 server', () => {
  const grown = appendServerBlock(HOST_FILE.slice(), {
    id: 'web',
    serverName: 'web',
    transport: 'streamable-http',
    url: 'https://x.dev/mcp',
  }).lines
  const rows = listServerRows(grown)
  assert.deepEqual(rows.map((row) => row.id).sort(), ['rea-mcp', 'web'])
  assert.equal(rows.find((row) => row.id === 'web').transport, 'streamable-http')
})

test('suggestServerName 产出 dfsh 认识的名字', () => {
  assert.equal(suggestServerName('ac.inference.sh/mcp'), 'ac-inference-sh-mcp')
  assert.equal(suggestServerName('--lead--'), 'lead')
  assert.equal(suggestServerName(''), 'server')
  assert.equal(suggestServerName('x'.repeat(60)).length, 32)
})
