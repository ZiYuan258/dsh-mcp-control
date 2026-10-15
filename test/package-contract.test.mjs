// 清单契约：`package.json` 说的和代码里做的是不是同一件事。
//
// 这个仓库有三处**同一事实的副本**，而它们没有任何机制保证同步：
//
//   1. `package.json` 的 version  ←→  `client.js` 里印在面板上的 VERSION
//   2. `package.json` 的 files    ←→  运行时真正需要的文件集合
//   3. `package.json` 的 dsh.requires ←→  代码里真正调用的服务
//
// 第 1 条会漂移，因为改版本号是两处手工编辑。第 2 条会漂移得很隐蔽：DSH 安装插件时按
// `files` 白名单**投影**一份到 profile，投影里缺一个文件，插件在**别人的机器上**起不来，
// 而本机（源码目录就在手边）一切正常——这是最贵的一类漂移，因为发现它的人不是作者。
// 第 3 条漂移后，DSH 可能在缺少依赖时仍然加载本插件，然后在第一次调用时炸掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const path = (file) => new URL(file, root)
const read = (file) => readFileSync(path(file), 'utf8')
// 用 readFileSync + JSON.parse 而不是 createRequire：后者在 Windows 上要把
// `new URL(...).pathname` 的 `/C:/…` 前缀手工剥掉，那一步一旦写错，测的是路径转换
// 而不是清单——而路径转换出错时抛的是 ENOENT，看起来像"文件不存在"，误导得很。
const pkg = JSON.parse(read('package.json'))

test('版本号在 package.json 与 client.js 两处一致', () => {
  const inClient = read('client.js').match(/const VERSION\s*=\s*'([^']+)'/)
  assert.ok(inClient, 'client.js 里没有找到 `const VERSION = \'…\'`——面板上的版本号就是它')
  assert.equal(
    inClient[1],
    pkg.version,
    `client.js 写着 ${inClient[1]}，package.json 写着 ${pkg.version}。` +
      ' 两处必须一致：面板显示的是前者，安装的是后者，用户看到的版本号会因此骗人。',
  )
})

test('client.js 里的包名与 package.json 一致', () => {
  const inClient = read('client.js').match(/const PACKAGE\s*=\s*'([^']+)'/)
  assert.ok(inClient, 'client.js 里没有找到 `const PACKAGE = …`')
  assert.equal(inClient[1], pkg.name)
})

test('ModuleLoader 的 bundle id 必须等于包名', () => {
  // 这不是风格问题：客户端加载器用它做键，不等于包名就会挂载到别的槽位上（或完全不挂载）。
  const inClient = read('client.js').match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/)
  assert.ok(inClient, 'client.js 里没有找到 ModuleLoader.load({ id: … })')
  assert.equal(inClient[1], pkg.name)
})

test('files 白名单覆盖运行时真正需要的一切', () => {
  const required = [
    'index.js', // 宿主半入口（main / exports["."]）
    'client.js', // 浏览器半入口（exports["./client"]）
    'cordis.patch.yml', // dsh.bundle.patch——缺它插件根本不会被插入
    'package.json', // 永远随包，不用列
  ]
  for (const file of required) {
    assert.ok(existsSync(path(file)), `${file} 不存在于仓库里`)
    if (file !== 'package.json') {
      assert.ok(pkg.files.includes(file), `files 白名单漏了 ${file}——投影到 profile 后插件会缺文件`)
    }
  }

  // locale 与 icon 是"有则必须投影"的：清单里声明了 meta.title/meta.icon，投影缺了就会退化。
  for (const dir of ['locale']) {
    assert.ok(existsSync(path(dir)), `${dir}/ 不存在`)
    assert.ok(pkg.files.includes(dir), `files 白名单漏了 ${dir}/`)
    const files = readdirSync(path(dir))
    assert.ok(files.length > 0, `${dir}/ 是空的`)
    for (const file of files) {
      if (file.endsWith('.json')) JSON.parse(read(dir + '/' + file)) // 必须是合法 JSON
    }
    // 声明了 exports 通配就必须真的有东西匹配它。
    assert.ok(
      pkg.exports['./locale/*.json'],
      'exports 缺少 "./locale/*.json"——DSH 读取本地化文案要走它',
    )
    assert.ok(files.some((f) => f.endsWith('.json')), 'locale/*.json 通配没有任何文件匹配')
  }

  // icon 只在 package.json 里声明了路径，这里确认那个路径真的能解析（相对清单，不是相对 cwd）。
  if (pkg.icon !== undefined) {
    const iconName = pkg.icon.replace(/^\.\//, '')
    assert.ok(existsSync(path(iconName)), `package.json 声明了 icon: ${pkg.icon}，但文件不在`)
    const size = readFileSync(path(iconName)).length
    assert.ok(size <= 256 * 1024, `icon 超过 256 KiB 上限（${size} B）`)
  }
})

test('files 白名单里的每一条都真实存在（反向检查）', () => {
  // 只查正向会漏掉"白名单里写着一个不存在的文件"：DSH 投影时静默忽略，
  // 于是白名单看起来是完备的，而缺的那个文件谁都没发现。
  for (const entry of pkg.files) {
    assert.ok(existsSync(path(entry)), `files 里列了 ${entry}，但仓库里没有这个东西`)
  }
})

test('仓库里没有未列进白名单的运行时文件（避免"忘了加"）', () => {
  // 这一条守的是另一头：新增了一个 .js 却没加进 files。它按扩展名找候选，
  // 而不是按文件名列举，所以新文件自动进入检查范围。
  const problems = []
  for (const entry of readdirSync(root)) {
    if (!/\.(js|mjs|cjs)$/.test(entry)) continue
    if (entry === 'client.js' || entry === 'index.js') continue // 已在上面正向查过
    problems.push(entry)
  }
  assert.deepEqual(
    problems,
    [],
    '仓库根目录出现了预期之外的脚本文件。如果它是运行时需要的，加进 files；' +
      '如果只是开发脚本，放 test/ 或 tools/，别让它躺在会被投影的位置。',
  )
})

test('宿主半不依赖任何 @deepseek-ai/* 运行时包', () => {
  // 这是本插件"零依赖"卖点的可执行版本：宿主半只通过 ctx.get(...) 取服务。
  // 一旦有人 import 了 @deepseek-ai/*，安装就不再是"复制几个文件"，
  // 而 README 与 AGENTS.md 里"无构建、无依赖"的说法会同时变成假话。
  const text = read('index.js')
  const imports = [...text.matchAll(/^\s*import\s[\s\S]*?from\s*'([^']+)'/gm)].map((m) => m[1])
  const external = imports.filter((name) => name.startsWith('@deepseek-ai/'))
  assert.deepEqual(external, [], 'index.js 引入了 @deepseek-ai/*，破坏了零依赖承诺')

  const nodeBuiltins = imports.filter((name) => name.startsWith('node:'))
  const nonBuiltin = imports.filter((name) => name.startsWith('node:') === false && name.startsWith('.') === false)
  assert.deepEqual(nonBuiltin, [], `index.js 引入了非内置、非相对模块: ${nonBuiltin.join(', ')}`)
  assert.ok(nodeBuiltins.length > 0, 'index.js 似乎没有任何 import——检查解析是否失效了')
})

test('客户端半只用浏览器模块表里的东西', () => {
  // client.js 是手写的 CJS 闭包，不是 ESM。它靠 factory 收到的 require 取依赖，
  // 而浏览器模块表里只有 react / react-dom 那几个。require 别的名字会在运行时炸。
  const text = read('client.js')
  const required = [...text.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
  assert.ok(required.length > 0, 'client.js 里没有 require() 调用——检查解析是否失效了')
  const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis'])
  const unexpected = required.filter((name) => allowed.has(name) === false)
  assert.deepEqual(unexpected, [], `client.js require 了模块表里没有的名字: ${unexpected.join(', ')}`)
})

test('保持手写 CJS 闭包的形状（禁止被"现代化"成 ESM）', () => {
  // AGENTS.md 明令不许改这个形状。写成断言是因为"顺手改成 ESM"看起来像改进，
  // 只有一条会红的测试能把这种改进拦下来。
  const text = read('client.js')
  assert.match(text, /window\.__ModuleLoader__\.load\(\{/, 'client.js 不再是 ModuleLoader 闭包')
  assert.match(text, /var module = \{ exports: \{\} \}/, '缺少 CJS 前奏 `var module = { exports: {} }`')
  assert.match(text, /return module\.exports/, '缺少 CJS 收尾 `return module.exports`')
  assert.doesNotMatch(text, /^\s*import\s/m, 'client.js 里出现了 ESM import——它必须是 CJS 闭包')
  assert.doesNotMatch(text, /^\s*export\s/m, 'client.js 里出现了 ESM export——它必须是 CJS 闭包')
})

test('dsh.requires 里声明的服务在代码里真的被用到', () => {
  // 反过来查：声明了却不用，说明清单在说大话；用了却没声明，说明清单在漏。
  const text = read('index.js')
  for (const contract of pkg.dsh.requires) {
    if (contract === 'ctx.effect') {
      assert.match(text, /ctx\.effect\(/, 'dsh.requires 声明了 ctx.effect，但代码里没调用')
      continue
    }
    if (contract === 'ctx.get') {
      assert.match(text, /ctx\.get\(/, 'dsh.requires 声明了 ctx.get，但代码里没调用')
      continue
    }
    const service = contract.replace(/^ctx\./, '').split('.')[0]
    assert.match(
      text,
      new RegExp(`ctx\\.get\\(['"]${service}['"]\\)`),
      `dsh.requires 声明了 ${contract}，但代码里没有 ctx.get('${service}')`,
    )
  }
})

test('dsh 块的必填字段齐全（DSH 少了它们不会加载本插件）', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(path('cordis.patch.yml')), 'dsh.bundle.patch 指向的文件不存在')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject 必须是数组')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'), 'slots 不在 inject 里')
})

test('cordis.patch.yml 插入的行与包名对得上', () => {
  const patch = read('cordis.patch.yml')
  const name = patch.match(/name:\s*'([^']+)'/)
  assert.ok(name, 'cordis.patch.yml 里没有 name:', patch)
  assert.equal(name[1], pkg.name, '插入的行必须指向本包')
  const id = patch.match(/id:\s*([\w-]+)/)
  assert.ok(id, 'cordis.patch.yml 里没有 id:')
  // 面板/锁定名单里用的就是这个短 id。改短 id 等于改插件行，安装过的会成为孤儿。
  assert.equal(id[1], 'mcp-control', '插入的短 id 变了，会让已安装的 profile 留下孤儿行')
})

test('包是 private 的（防止误发到 npm）', () => {
  // 通过 `dsh plugin add <路径或 github:…>` 安装，不走 npm 发布。
  // 留 private 是防止有人把 `npm publish` 当成发布方式——那会让"装的是哪个版本"变成两套真相。
  assert.equal(pkg.private, true)
})
