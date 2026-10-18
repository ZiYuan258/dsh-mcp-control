// 双语是这个仓库的约定（中文为默认语言），而约定靠自觉守不住。
//
// 检查三组文档对：
//   1. README.md            ↔ README.en.md
//   2. SECURITY.zh.md       ↔ SECURITY.md
//   3. docs/release-notes-v*.md（单文件内双语，中文在前）
//
// 只比较读者用来导航的**结构**与必须逐字一致的**事实**，不比较行文——
// 两种语言本来就该读起来不同。
//
// 还有一项：文件编码。这一条是被咬出来的，不是想出来的。本仓库的姊妹项目
// （dsh-skill-router）有过两次真实事故：
//   · 一次「用 PowerShell 就地改一行」把 README.en.md 写成了 **UTF-8 BOM + CRLF**，
//     第一行变成 `\uFEFF# …`，标题匹配不到，双语标题数变成 36 vs 35。诡异之处在于
//     **文本内容是对的**，只是前缀变了——diff 看起来正常，只有断言会说话。
//   · 一次 BOM 造出一个名为 `name` 的幽灵条目。
// 所以 BOM 与 CRLF 各自值得一条守卫，而且守卫要**自动覆盖新文档**，不靠谁记得登记。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const hasCjk = (text) => /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text)

const headings = (text) => [...text.matchAll(/^(#{1,3}) (.+)$/gm)].map((m) => m[1].length)
const fences = (text) => (text.match(/^```/gm) ?? []).length
const tableRows = (text) => (text.match(/^\|/gm) ?? []).length

/** 编码守卫：不许有 BOM，不许有 CRLF。两者都能让"内容正确"的文件以诡异方式失败。 */
function encodingProblems(file) {
  const buffer = readFileSync(new URL(file, root))
  const found = []
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    found.push(`${file}: 带 UTF-8 BOM（会让第 1 行的匹配整体偏移，并曾造出幽灵条目）`)
  }
  if (buffer.includes(Buffer.from('\r\n'))) found.push(`${file}: 用了 CRLF 换行`)
  return found
}

/**
 * 两份文件：相同的标题骨架、代码块数、表格行数，以及一组逐字相同的事实。
 *
 * 事实清单里放的是**数字与标识符**，不放句子：句子该随语言不同，数字不该。
 * 766,054 与 191514 在两个文件里必须是同一串字符，否则两个读者会得到两个成本观。
 */
function checkPair(label, defaultFile, alternateFile, facts) {
  const a = read(defaultFile)
  const b = read(alternateFile)

  const ha = headings(a)
  const hb = headings(b)
  assert.equal(ha.length, hb.length, `${label}: 标题数量不同（${ha.length} vs ${hb.length}）`)
  assert.equal(
    ha.join(),
    hb.join(),
    `${label}: 标题层级序列不同（[${ha}] vs [${hb}]）——两份文档的导航结构必须一一对应`,
  )
  assert.equal(fences(a), fences(b), `${label}: 围栏代码块数量不同（${fences(a)} vs ${fences(b)}）`)
  assert.equal(tableRows(a), tableRows(b), `${label}: 表格行数不同（${tableRows(a)} vs ${tableRows(b)}）`)

  // 重复的二级标题，两个文件各查一遍。
  //
  // 这一条来自一次真实的损坏：姊妹项目的 README.en.md 被一次坏替换**整段复制**了一遍
  // （第 10 行到末尾），而上面那三条计数**一条都没红**——因为两个文件的内容和结构本来
  // 就不一样，重复之后数量仍然"看起来正常"。是读者会发现"读着读着又回到了开头"，不是测试。
  // 计不了数的东西要单独查：一个 L2 标题出现两次，几乎总是拼接事故。
  for (const [name, text] of [[defaultFile, a], [alternateFile, b]]) {
    const seen = new Map()
    for (const line of text.split('\n')) {
      if (/^##\s/.test(line) === false) continue
      const key = line.trim()
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    const dupes = [...seen].filter(([, n]) => n > 1)
    assert.deepEqual(
      dupes.map(([k, n]) => `${k.slice(0, 40)} ×${n}`),
      [],
      `${label}: ${name} 里有重复的二级标题`,
    )
  }

  const missing = []
  for (const fact of facts) {
    if (a.includes(fact) === false) missing.push(`${defaultFile} 缺 ${JSON.stringify(fact)}`)
    if (b.includes(fact) === false) missing.push(`${alternateFile} 缺 ${JSON.stringify(fact)}`)
  }
  assert.deepEqual(missing, [], `${label}: 两份文档的共享事实不一致`)

  return { headings: ha.length, blocks: fences(a) / 2, rows: tableRows(a) }
}

test('README 中英结构对齐且共享事实一致', () => {
  const stats = checkPair('README', 'README.md', 'README.en.md', [
    // 成本实测值：两个文件必须印同一组数字。
    '766,054 B',
    '191514',
    '191K',
    '207',
    // 上下文与层序。
    '320K',
    'cordis.patch.yml',
    'applyEntryPatches',
    'upsertDisabled',
    // 机制证据。
    'ctx.tools.schemas()',
    'syncTools',
    'ctx.tools.register',
    'EntryTree.update',
    'fiberPhase',
    // 拒绝的功能。
    'outputSchema',
    'bytes / 4',
    // 安装与测试。
    'mcp-control',
    'npm test',
    'dsh plugin --profile desktop add',
    // 安全承诺。
    'backupPath',
    'persistError',
    '1 MB',
    // 入口标识。
    'github:ZiYuan258/dsh-mcp-control',
  ])
  assert.ok(stats.headings >= 12, `README 只有 ${stats.headings} 个标题，结构可能被截断了`)
})

test('README 第 3 行是语言切换行（中文为默认语言，链到对面）', () => {
  assert.equal(
    read('README.md').split('\n')[2],
    '[English](README.en.md) | 中文',
    'README.md 第 3 行必须是语言切换行，且中文在前',
  )
  const english = read('README.en.md')
  assert.ok(english.includes('[中文](README.md)'), 'README.en.md 没有链回 README.md')
  // 英文侧的第一行必须是英文标题，不是中文标题——两侧各以自己的语言开头。
  assert.equal(
    hasCjk(english.split('\n')[0]),
    false,
    'README.en.md 的标题不该是中文',
  )
  assert.equal(hasCjk(read('README.md').split('\n')[0]), true, 'README.md 的标题必须是中文')
})

test('README 开头（第一个二级标题之前）必须说清三件事', () => {
  // 守的是**位置**，不是内容。读者搜到这个仓库时只有几秒钟判断这是不是他要的东西，
  // 写在文档深处等于没写。位置会漂移，靠人眼守不住，所以让它变成一条会红的断言。
  //
  // 三件事：
  //   1. 这是 dsh-mcp-toggle 的 fork（否则用户会以为装错了）；
  //   2. 上游停更且**不留备份**这个具体缺陷（这是 fork 存在的理由）；
  //   3. 本分支补了什么。
  for (const [file, needles] of [
    [
      'README.md',
      [/dsh-mcp-toggle/, /维护分支/, /备份/, /(停更|长期停更)/],
    ],
    [
      'README.en.md',
      [/dsh-mcp-toggle/, /maintained fork/i, /backup/i, /dormant/i],
    ],
  ]) {
    const text = read(file)
    const firstHeading = text.split('\n').findIndex((line) => /^##\s/.test(line))
    const opening = firstHeading < 0 ? text : text.split('\n').slice(0, firstHeading).join('\n')
    for (const pattern of needles) {
      assert.match(opening, pattern, `${file}: 开头（前 ${opening.split('\n').length} 行）缺少 ${pattern}`)
    }
  }
})

test('SECURITY 中英结构对齐且共享事实一致', () => {
  // 中文侧是第一语言：中文标题、中文在前的切换行。
  const zh = read('SECURITY.zh.md')
  const en = read('SECURITY.md')
  assert.ok(hasCjk(zh.split('\n')[0]), 'SECURITY.zh.md 的标题必须是中文')
  assert.equal(
    zh.split('\n')[2],
    '[English](SECURITY.md) | 中文',
    'SECURITY.zh.md 第 3 行必须是切换行',
  )
  assert.ok(en.split('\n')[2].includes('SECURITY.zh.md'), 'SECURITY.md 第 3 行必须链到 SECURITY.zh.md')
  assert.equal(hasCjk(en.split('\n')[0]), false, 'SECURITY.md 的标题不该是中文')

  checkPair('SECURITY', 'SECURITY.zh.md', 'SECURITY.md', [
    'cordis.patch.yml',
    'backupPath',
    'persistError',
    'http://127.0.0.1',
    '1 MB',
    '403',
    '404',
    '405',
    '503',
  ])
})

test('发布说明：单文件双语，中文在前，恰好一个 H1', () => {
  const dir = new URL('docs/', root)
  assert.ok(existsSync(dir), 'docs/ 目录不存在')
  const notes = readdirSync(dir)
    .filter((n) => /^release-notes-v.+\.md$/.test(n))
    .sort()
  assert.ok(notes.length > 0, 'docs/ 里一份发布说明都没有')

  const failures = []
  for (const name of notes) {
    const lines = read('docs/' + name).split('\n')
    const text = lines.join('\n')
    if (hasCjk(lines[0]) === false) failures.push(`${name}: 标题必须是中文`)
    if (lines[2] !== '[English](#english) | 中文') failures.push(`${name}: 第 3 行必须是中文在前的切换行`)

    // H1 有且只有一个。理由不是审美：`tools/publish-release.mjs` 用**第一行**作
    // GitHub Release 的标题，所以多出来的 H1 不会影响发布结果——正因如此，这个偏离
    // **不会被任何东西发现**。它靠约定维持，而约定靠人记。
    let inFence = false
    const h1s = []
    lines.forEach((line, index) => {
      if (/^```/.test(line)) inFence = !inFence
      if (inFence === false && /^# /.test(line)) h1s.push({ line: index + 1, text: line.slice(2).trim() })
    })
    if (h1s.length !== 1) {
      failures.push(`${name}: H1 有 ${h1s.length} 个（必须恰好 1 个；英文节用 ## English，不另起大标题）`)
    }
    const version = name.replace(/^release-notes-v/, '').replace(/\.md$/, '')
    if (h1s.length === 1 && h1s[0].text.startsWith('v' + version + ' ') === false) {
      failures.push(`${name}: H1 必须以 v${version} 开头（Release 标题取自此），实际是 ${JSON.stringify(h1s[0].text.slice(0, 50))}`)
    }

    const englishAt = lines.findIndex((line) => line.trim() === '## English')
    if (englishAt < 0) failures.push(`${name}: 没有 "## English" 一节`)
    else {
      if (englishAt < lines.length / 3) failures.push(`${name}: 英文节开始得太早`)
      if (lines.slice(englishAt).join('\n').trim().length < 200) failures.push(`${name}: 英文节看起来是空的`)
      if (lines.slice(0, englishAt).join('\n').trim().length < 200) failures.push(`${name}: 中文节看起来是空的`)
      if (/[\u4e00-\u9fff]/.test(lines.slice(englishAt).join('\n'))) {
        failures.push(`${name}: 英文节里出现了中文`)
      }
    }
    void text
  }
  assert.deepEqual(failures, [], '发布说明格式不合格')
})

test('没有 BOM、没有 CRLF（自动覆盖 docs/ 下的每一份文件）', () => {
  // 放在最后统一跑，这样**新加的文档自动纳入守卫**，不依赖谁记得把它列进去。
  const files = ['README.md', 'README.en.md', 'SECURITY.md', 'SECURITY.zh.md', 'package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'AGENTS.md', 'RELEASING.md']
  const notes = readdirSync(new URL('docs/', root))
    .filter((n) => n.endsWith('.md'))
    .map((n) => 'docs/' + n)
  const problems = []
  for (const file of [...files, ...notes]) {
    if (existsSync(new URL(file, root)) === false) {
      problems.push(`${file}: 不存在（docs-parity 的编码守卫列了它）`)
      continue
    }
    problems.push(...encodingProblems(file))
  }
  assert.deepEqual(problems, [], '编码守卫发现 BOM 或 CRLF')
})

test('解析器先自检（否则检查自己就是下一个"文档制造错误事实"）', () => {
  // 姊妹项目在这里翻过车：它量"英文里写的脚本数"，词表只有 one–ten，
  // 于是 "Twenty-eight" 被解析成 8，检查报了一个**假问题**。
  // 测试自己写错判定，和文档写错数字是同一类缺陷。所以先验工具，再用它。
  assert.deepEqual(headings('# a\n## b\n### c\n#### d'), [1, 2, 3], 'headings() 应只数 1–3 级')
  assert.equal(fences('```\ncode\n```'), 2, 'fences() 应数围栏标记，不是代码块数')
  assert.equal(tableRows('| a |\n|---|\n| b |'), 3, 'tableRows() 应数每一行以 | 开头的行')
  const withFence = '# title\n```\n# not a heading inside a fence\n```\n## real'
  let inFence = false
  const h1s = withFence.split('\n').filter((line) => {
    if (/^```/.test(line)) inFence = !inFence
    return inFence === false && /^# /.test(line)
  })
  assert.equal(h1s.length, 1, '围栏内的 `# ` 不该被算成标题（应只有开头的 # title 一个）')
})
