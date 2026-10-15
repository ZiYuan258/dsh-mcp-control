// 发版一致性的**离线**检查：文档里写的版本、脚本链、测试表三者必须对上。
//
// 为什么需要它：`git push origin vX.Y.Z` 只推送 tag，而 GitHub 的 Release 是另一个独立对象，
// 必须在 /releases 上单独创建。两者在本地看起来毫无区别，所以"只推 tag 没建 Release"会静默
// 存在——姊妹项目 dsh-skill-router 就这样连续 14 个版本 tag 页有、Release 页没有，直到有人
// 翻发行版页面才发现。这里查的是**本地可判定**的部分，联网那半由
// `node tools/publish-release.mjs --check` 负责。
//
// 有意**不**检查"当前版本必须有发布说明"：那条会变成"仓库每次有改动就得发一版"的强制来源。
// 版本号只在插件行为变化时才动（见 RELEASING.md 的版本策略），工具、文档、测试的改动直接进
// main。检查只盯真正的目标——**已经存在的版本必须有发布说明，且测试表必须与脚本链一致**。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (file) => readFileSync(new URL(file, root), 'utf8')
const pkg = JSON.parse(read('package.json'))

/** 从 package.json 的 test 脚本里解析出被运行的测试文件名。 */
function chainOf(script) {
  return [...script.matchAll(/test[/\\]([\w.-]+\.mjs)/g)].map((m) => m[1])
}

test('脚本链解析先自检（否则检查自己就是下一个错误来源）', () => {
  // 姊妹项目在这里翻过车：它量"英文里写的脚本数"，词表只有 one–ten，
  // 于是 "Twenty-eight" 被解析成 8，检查报了一个**假问题**。
  // 测试自己写错判定，和文档写错数字是同一类缺陷。所以先验工具，再用它。
  assert.deepEqual(chainOf('node --test test/a.test.mjs test/b.test.mjs'), ['a.test.mjs', 'b.test.mjs'])
  assert.deepEqual(chainOf('node test/x.mjs && node test/y.mjs'), ['x.mjs', 'y.mjs'])
  assert.deepEqual(chainOf('echo nothing here'), [])
})

test('测试链里的每个文件都真实存在（否则 npm test 直接 ENOENT）', () => {
  const chain = chainOf(pkg.scripts.test)
  assert.ok(chain.length > 0, 'test 脚本里没解析出任何测试文件——检查解析或脚本本身')
  const missing = chain.filter((name) => existsSync(new URL('test/' + name, root)) === false)
  assert.deepEqual(missing, [], 'test 脚本引用了不存在的文件')
})

test('test/ 里的每个测试文件都在脚本链里（否则它从不运行）', () => {
  // 反向检查。这一条守的是**最阴的一类失效**：写了测试、测试是红的，但没人跑它，
  // 于是仓库看起来有覆盖，实际没有。`node --test test/` 的目录形式在 Node 24 上会失败，
  // 所以脚本链必须是显式列表——显式列表就会漏。
  const chain = chainOf(pkg.scripts.test)
  const onDisk = readdirSync(new URL('test/', root)).filter((n) => n.endsWith('.test.mjs'))
  const orphans = onDisk.filter((name) => chain.includes(name) === false)
  assert.deepEqual(orphans, [], 'test/ 里有测试文件没被 npm test 运行')
})

test('测试链里没有重复', () => {
  const chain = chainOf(pkg.scripts.test)
  const duplicated = chain.filter((name, index) => chain.indexOf(name) !== index)
  assert.deepEqual(duplicated, [], '测试链里出现了重复的文件')
})

test('README 的测试表与实际脚本链一致，且不列出链外的文件', () => {
  // 这一条来自一次真实的漏掉：姊妹项目 v1.11.0 新增了 4 个测试脚本，脚本链改了、
  // **README 的测试表没改**，计数也还停在旧数字。文档因此对读者说了两件不实的事：
  // 数量不对，而且有 4 个测试根本不在清单里。
  //
  // 这正是这类仓库最该避免的失败类型——"文档自己制造错误事实"——而且它特别隐蔽：
  // 两个文件仍然互相一致，所以纯双语对比一条都不会红。要抓住它，必须拿**第三方真相**
  // （脚本链本身）去比对文档，而不是两个文档互比。
  const chain = chainOf(pkg.scripts.test)
  const failures = []
  for (const file of ['README.md', 'README.en.md']) {
    const text = read(file)
    const table = [...text.matchAll(/^test\/([\w.-]+\.mjs)/gm)].map((m) => m[1])
    assert.ok(table.length > 0, `${file}: 没有找到测试表（每行以 test/… 开头）`)
    const undocumented = chain.filter((name) => table.includes(name) === false)
    const dangling = table.filter((name) => chain.includes(name) === false)
    if (undocumented.length > 0) failures.push(`${file} 漏了: ${undocumented.join(', ')}`)
    if (dangling.length > 0) failures.push(`${file} 多列了: ${dangling.join(', ')}`)
  }
  assert.deepEqual(failures, [], 'README 的测试表与脚本链不一致')
})

test('每个已存在的版本都有发布说明，且文件名规范', () => {
  const dir = new URL('docs/', root)
  assert.ok(existsSync(dir), 'docs/ 目录不存在')
  const notes = readdirSync(dir).filter((n) => /^release-notes-v.+\.md$/.test(n))
  const badNames = notes.filter((n) => /^release-notes-v\d+\.\d+\.\d+\.md$/.test(n) === false)
  assert.deepEqual(badNames, [], '发布说明的文件名必须是 release-notes-vX.Y.Z.md')

  const versions = notes.map((n) => n.replace(/^release-notes-v/, '').replace(/\.md$/, ''))
  assert.ok(versions.length > 0, 'docs/ 里一份发布说明都没有')
  assert.ok(
    versions.includes(pkg.version),
    `当前版本 ${pkg.version} 没有发布说明（docs/release-notes-v${pkg.version}.md）——` +
      '发布说明是 Release 的正文，没有它就只能发一个空标题',
  )
})

test('发版流程文档与脚本都必须存在', () => {
  assert.ok(existsSync(new URL('RELEASING.md', root)), 'RELEASING.md 不存在（记录 tag 与 Release 是两步、以及版本策略）')
  assert.ok(
    existsSync(new URL('tools/publish-release.mjs', root)),
    'tools/publish-release.mjs 不存在（把最后一步做成一条命令）',
  )
})

test('当前版本必须有一份 DECISION 或 PROJECT_STATUS 说明它为什么是这个号', () => {
  // 松散的检查，但它拦住一类真实的漂移：fork 出来的仓库常常带着上游的版本号，
  // 于是"1.0.1"既像是上游的延续、又像是本仓库的起点，谁都说不清。
  // 本仓库是 1.0.0 起版，因为行为与上游不兼容（多了备份、批量、成本统计）。
  assert.ok(existsSync(new URL('DECISION.md', root)), 'DECISION.md 不存在')
  assert.ok(existsSync(new URL('PROJECT_STATUS.md', root)), 'PROJECT_STATUS.md 不存在')
  const status = read('PROJECT_STATUS.md')
  assert.ok(status.includes(pkg.version), `PROJECT_STATUS.md 里没有提到当前版本 ${pkg.version}`)
})
