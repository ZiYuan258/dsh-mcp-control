// 安装/卸载一个 MCP 服务器：往 HOME 补丁里加一块自己的 `- insert:`，或者把加过的
// 那一块拿掉。
//
// 为什么不是复用 `upsertDisabled`？因为那是另一种行形状。`upsertDisabled` 只碰
// 「`- id: x` + `disabled: <bool>`」这种**覆盖行**，绝不动 `insert:` 里的行（AGENTS.md
// 规则 1）。新增一个 server 需要 `serverName`/`transport`/`command` 这些 config 字段，
// 那是一条完整的**插入行**。
//
// 两者共享的唯一原则，也是这个文件存在的理由：**逐行、追加、从不重写整个文件**。
// 所以安装走「在文件末尾追加一整块新的 `- insert:`」——已有的块一个字节都不碰，
// 连行号都不变。补丁是按顺序应用的，多一块和少一块语义完全相同（本机 home 补丁
// 本来就是两块）。这样做还有个副作用是好的：卸载时只需要删掉我们自己加的那块，
// 能精确地删干净。
//
// 反过来说，把新行塞进宿主写过的那块里，会让「谁写的这一行」再也分不清，卸载时就
// 只能靠猜——这正是参考实现（dsh-overall-mcp）绕开补丁文件的原因，也是我们不走
// 它那条路的原因。

/** 与 index.js 里的常量同值：MCP 行的插件名就是身份，位置不算。 */
export const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/**
 * `dsh-mcp-client` 自己的 `SERVER_NAME_PATTERN`。抄在这里是有代价的（上游改了要跟），
 * 但代价比放行一个到运行时才炸的名字小得多：serverName 同时是工具前缀
 * （`mcp__<server>__<tool>`）和命名空间保留键，撞了会在 apply 阶段直接抛
 * `serverName "x" is already in use`，整个条目起不来。
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

// 裸标量的安全集：**必须**以字母数字或下划线开头。以 `-` 开头会写出 `- -m` 这种
// 看着像嵌套序列的行；以 `?`/`:`/`#`/`@`/`` ` `` 开头在 YAML 里都有特殊含义。
const BARE_SCALAR = /^[A-Za-z0-9_][A-Za-z0-9_./@-]*$/
const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'])
const NUMERIC = /^[-+]?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?$/

/**
 * Quote one YAML scalar so that reading it back yields exactly this string.
 *
 * 为什么不用 `JSON.stringify`：Windows 路径写进双引号里，`\U`、`\A` 这些在 YAML 双引号
 * 标量里是非法的转义，`yaml.load` 会直接抛。单引号标量里反斜杠是字面量，这才是
 * `D:\Anaconda\python.exe` 这种值的正确写法。
 */
export function yamlQuote(value) {
  const text = String(value ?? '')
  if (text === '') return "''"
  if (BARE_SCALAR.test(text) && !RESERVED.has(text.toLowerCase()) && !NUMERIC.test(text)) return text
  return `'${text.replace(/'/g, "''")}'`
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validArgs(args) {
  return Array.isArray(args) && args.every((arg) => typeof arg === 'string')
}

function validEnv(env) {
  if (env === undefined || env === null) return true
  if (typeof env !== 'object' || Array.isArray(env)) return false
  return Object.entries(env).every(([key, value]) => nonEmpty(key) && typeof value === 'string')
}

/**
 * 校验一个待安装的条目。返回 `{ ok, error? }`。
 *
 * 拒绝而不是纠正：这里每一个字段都会变成别人机器上的一条配置，猜错的表现是
 * 「装上了但不启动」，比装不上更难查。
 */
export function validateServerSpec(spec) {
  if (spec === null || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' }
  if (!nonEmpty(spec.id)) return { ok: false, error: 'id is required' }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(spec.id)) {
    return { ok: false, error: 'id must be 1-64 characters of letters, digits, dot, dash or underscore' }
  }
  if (!nonEmpty(spec.serverName)) return { ok: false, error: 'serverName is required' }
  if (!SERVER_NAME_PATTERN.test(spec.serverName)) {
    return { ok: false, error: 'serverName must be 1-32 characters of letters, digits, dash or underscore' }
  }
  const transport = spec.transport ?? 'stdio'
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    return { ok: false, error: 'transport must be stdio or streamable-http' }
  }
  if (transport === 'stdio') {
    if (!nonEmpty(spec.command)) return { ok: false, error: 'command is required for stdio' }
    if (spec.args !== undefined && !validArgs(spec.args)) return { ok: false, error: 'args must be an array of strings' }
    if (!validEnv(spec.env)) return { ok: false, error: 'env must be an object of strings' }
    if (spec.cwd !== undefined && typeof spec.cwd !== 'string') return { ok: false, error: 'cwd must be a string' }
  } else {
    if (!nonEmpty(spec.url)) return { ok: false, error: 'url is required for streamable-http' }
    if (!/^https?:\/\//i.test(spec.url)) return { ok: false, error: 'url must start with http:// or https://' }
    if (!validEnv(spec.headers)) return { ok: false, error: 'headers must be an object of strings' }
  }
  if (spec.toolCallTimeoutMs !== undefined) {
    if (!Number.isFinite(spec.toolCallTimeoutMs) || spec.toolCallTimeoutMs <= 0) {
      return { ok: false, error: 'toolCallTimeoutMs must be a positive number' }
    }
  }
  return { ok: true }
}

/**
 * Render a whole `- insert:` block (one server) as lines.
 *
 * 与宿主自己写的块布局逐字符对齐：`- insert:` 顶格，`- id:` 缩进四格，`config` 的子键
 * 缩进八格。对齐不是审美——`findIdRow` 靠「缩进为 0 = 顶层覆盖行，缩进非 0 = 嵌套
 * 插入行」区分两者，块内缩进一旦错乱，覆盖行就会被当成插入行，toggle 会改错地方。
 */
export function buildInsertBlock(spec) {
  const transport = spec.transport ?? 'stdio'
  const lines = ['- insert:']
  const row = (text) => lines.push(`    ${text}`)
  const key = (text) => lines.push(`      ${text}`)
  const sub = (text) => lines.push(`        ${text}`)

  row(`- id: ${yamlQuote(spec.id)}`)
  key(`name: "${MCP_CLIENT_PLUGIN}"`)
  key('config:')
  sub(`serverName: ${yamlQuote(spec.serverName)}`)
  sub(`transport: ${transport}`)

  if (transport === 'stdio') {
    sub(`command: ${yamlQuote(spec.command)}`)
    if (Array.isArray(spec.args) && spec.args.length > 0) {
      sub('args:')
      for (const arg of spec.args) lines.push(`          - ${yamlQuote(arg)}`)
    }
    if (nonEmpty(spec.cwd)) sub(`cwd: ${yamlQuote(spec.cwd)}`)
    if (spec.env && Object.keys(spec.env).length > 0) {
      sub('env:')
      for (const [name, value] of Object.entries(spec.env)) {
        lines.push(`          ${yamlQuote(name)}: ${yamlQuote(value)}`)
      }
    }
  } else {
    sub(`url: ${yamlQuote(spec.url)}`)
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      sub('headers:')
      for (const [name, value] of Object.entries(spec.headers)) {
        lines.push(`          ${yamlQuote(name)}: ${yamlQuote(value)}`)
      }
    }
  }

  if (spec.toolCallTimeoutMs !== undefined) sub(`toolCallTimeoutMs: ${Math.round(spec.toolCallTimeoutMs)}`)
  return lines
}

/** Every `- id: x` in the file, with the indentation that decides its role. */
export function locateRows(lines) {
  const rows = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)- id: (.+)$/.exec(lines[i])
    if (!match) continue
    rows.push({ index: i, indent: match[1].length, rawId: unquote(match[2]) })
  }
  return rows
}

function unquote(text) {
  const value = String(text ?? '').trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

/** The line range a row occupies: the `- id:` line plus every more-indented line. */
function rowExtent(lines, index) {
  const indent = /^(\s*)/.exec(lines[index])[1].length
  let end = index + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === '') {
      // 空行只有在后面还跟着本行的子行时才算本行内部；否则它就是分隔符。
      let probe = end + 1
      while (probe < lines.length && lines[probe].trim() === '') probe++
      if (probe < lines.length && /^(\s*)/.exec(lines[probe])[1].length > indent) {
        end = probe
        continue
      }
      break
    }
    if (/^(\s*)/.exec(line)[1].length <= indent) break
    end++
  }
  return end
}

function rowBody(lines, index) {
  return lines.slice(index, rowExtent(lines, index)).join('\n')
}

/** 一行里是否写着本插件认识的 MCP 客户端名（单双引号都算）。 */
function namesMcpClient(text) {
  return text.includes(MCP_CLIENT_PLUGIN)
}

/**
 * Append a new `- insert:` block for one server.
 *
 * 返回 `{ lines, changed, mode }`：`mode` 为 `appended` / `duplicate` / `invalid`。
 * 重复的 id **不覆盖**——覆盖会静默改掉一条已经在跑的服务器；调用方拿到
 * `duplicate` 后应该让用户改个名字，或者先卸载再装。
 */
export function appendServerBlock(lines, spec) {
  const checked = validateServerSpec(spec)
  if (!checked.ok) return { lines, changed: false, mode: 'invalid', error: checked.error }

  const taken = new Set(locateRows(lines).map((row) => row.rawId))
  if (taken.has(spec.id)) return { lines, changed: false, mode: 'duplicate', error: `id already exists: ${spec.id}` }

  const next = lines.slice()
  const block = buildInsertBlock(spec)
  // 结尾换行跟原文件保持一致。补丁文件本身几乎总是以换行结尾（宿主就是这么写的），
  // 但「几乎总是」不能写成「总是」：装一次再卸一次必须回到**同一串字节**，
  // 而多写或少写一个结尾换行就破坏了这个等于关系。
  const endedWithNewline = next.length > 0 && next[next.length - 1].trim() === ''
  const endsWithBlank = endedWithNewline
  const appended = []
  if (next.length > 0 && !endsWithBlank) appended.push('')
  appended.push(...block)
  if (endedWithNewline) appended.push('')
  return { lines: next.concat(appended), changed: true, mode: 'appended' }
}

/**
 * Remove every row that carries this id, plus the insert block it left behind.
 *
 * 安全闸，三层，缺一不可：
 *   1. 只删 `@deepseek-ai/dsh-mcp-client` 的行——同 id 的别的插件不归我们管；
 *   2. 只删**空掉之后**的 insert 块，非空的块原样保留（同一块里可能还有宿主写的行）；
 *   3. 调用方负责拒绝锁定 id（`include` 之类），这里只做形状检查。
 */
export function removeServerRows(lines, rawId) {
  const next = lines.slice()
  const endedWithNewline = next.length > 0 && next[next.length - 1].trim() === ''
  const targets = locateRows(next)
    .filter((row) => row.rawId === rawId)
    .filter((row) => namesMcpClient(rowBody(next, row.index)))

  if (targets.length === 0) return { lines, changed: false, mode: 'absent', removed: 0 }

  // 从后往前删，前面的下标保持有效。
  let removed = 0
  for (const row of [...targets].reverse()) {
    const end = rowExtent(next, row.index)
    next.splice(row.index, end - row.index)
    removed++
  }

  // 空块清理：`- insert:` 后面再没有子行，就整块拿走。
  for (let i = next.length - 1; i >= 0; i--) {
    if (/^\s*- insert:\s*$/.test(next[i]) === false) continue
    const indent = /^(\s*)/.exec(next[i])[1].length
    let hasChild = false
    for (let j = i + 1; j < next.length; j++) {
      if (next[j].trim() === '') continue
      if (/^(\s*)/.exec(next[j])[1].length > indent) hasChild = true
      break
    }
    if (hasChild) continue
    next.splice(i, 1)
    if (i - 1 >= 0 && next[i - 1].trim() === '') next.splice(i - 1, 1)
  }

  // 折叠连续空行：删掉一行之后很容易留下两行空白，多写几次就成了一张空页。
  const compact = []
  for (const line of next) {
    if (line.trim() === '' && compact.length > 0 && compact[compact.length - 1].trim() === '') continue
    compact.push(line)
  }

  // 末尾那个空字符串**不是空行**，是文件最后一个换行（`joinLines` 直接 join）。
  // 一起删掉的话，装一次再卸一次，文件就少了结尾换行——字节不再等于装之前，
  // 而「卸载把文件还原成装之前的样子」正是这个功能唯一的验收标准。
  // 但删空了就不要再补：空文件装之前是 `[]`，还回去也必须是 `[]`，不是 `['']`。
  while (compact.length > 0 && compact[compact.length - 1].trim() === '') compact.pop()
  if (endedWithNewline && compact.length > 0) compact.push('')

  return { lines: compact, changed: true, mode: 'removed', removed }
}

/** 补丁里现在有哪些本插件写的 MCP 行（不含覆盖行）。供 UI 说明「文件里有什么」。 */
export function listServerRows(lines) {
  const out = []
  for (const row of locateRows(lines)) {
    if (row.indent === 0) continue
    const body = rowBody(lines, row.index)
    if (!namesMcpClient(body)) continue
    const nameMatch = /(?:^|\n)\s*serverName:\s*(.+)$/m.exec(body)
    const transportMatch = /(?:^|\n)\s*transport:\s*(.+)$/m.exec(body)
    out.push({
      id: row.rawId,
      serverName: nameMatch ? unquote(nameMatch[1]) : row.rawId,
      transport: transportMatch ? unquote(transportMatch[1]) : 'stdio',
    })
  }
  return out
}

/** 把 id 变成适合直接用的 serverName（补丁里两处都用同一个名字最省心）。 */
export function suggestServerName(id) {
  const cleaned = String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return cleaned === '' ? 'server' : cleaned
}
