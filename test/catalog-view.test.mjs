// 目录视图的行为测试。
//
// 用户实测提的一个问题：「目录页面搜索没问题，但是不搜索的话什么都没有，不能像
// 商店一样逛」。这条测试把「进来就有东西」和「翻页接着看」钉住——两者都不是后端
// 能力问题（空关键词在官方 registry 上返回第一页全部条目），是客户端什么时候发请求、
// 翻页怎么合并的问题。没有测试的话，下次改 UI 很容易又退回「必须先搜」。

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { makeReact, buttonText, flush } from './helpers/react-stub.mjs'

const CLIENT = new URL('../client.js', import.meta.url)

/** 一页目录条目（形状按官方 registry 实测字段）。 */
function entry(name, version) {
  return {
    name,
    title: name,
    description: `${name} description`,
    version,
    packages: 1,
    remotes: 0,
    install: { transport: 'stdio', registryType: 'npm', identifier: name, command: 'npx', args: ['-y', name], env: {} },
    reason: null,
    suggested: {
      id: name.replace(/[^A-Za-z0-9]+/g, '-'),
      serverName: 'srv',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', name],
      env: {},
    },
  }
}

const PAGE_ONE = {
  ok: true,
  view: 'catalog',
  entries: [entry('io.example/alpha', '1.0.0'), entry('io.example/beta', '2.0.0')],
  nextCursor: 'cursor-1',
}

// 第二页刻意重复 alpha：跨页边界上同一条目仍可能出现，客户端必须去重。
const PAGE_TWO = {
  ok: true,
  view: 'catalog',
  entries: [entry('io.example/gamma', '3.0.0'), entry('io.example/alpha', '1.5.0')],
  nextCursor: null,
}

/** 服务器视图要的那份快照：本测试只关心目录页，给个空壳让它别报错。 */
const EMPTY_SNAPSHOT = {
  ok: true,
  servers: [],
  orphaned: [],
  totals: { servers: 0, enabled: 0, disabled: 0, mcpToolCount: 0, mcpSchemaBytes: 0, mcpEstTokens: 0, activeEstTokens: 0, bytesPerToken: 4, calls: 0, callsToday: 0, okRate: null },
  patchPath: 'C:\\\\home\\\\cordis.patch.yml',
  callsPath: 'C:\\\\home\\\\calls.jsonl',
  layersReadable: true,
  panelEntry: 'settings',
  panelEntryFile: 'C:\\\\home\\\\state.json',
}

/**
 * 启动客户端，返回能反复渲染目录视图的句柄。
 *
 * `pages` 按顺序供 GET 使用：第一次是第一页，第二次是第二页，用完之后重复最后一页。
 */
async function boot({ pages = [PAGE_ONE, PAGE_TWO] } = {}) {
  const source = await readFile(CLIENT, 'utf8')
  const react = makeReact()
  const gets = []
  let definition = null
  let served = 0

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    navigator: { language: 'zh-CN' },
    URLSearchParams,
    URL,
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
      setTimeout,
      confirm: () => true,
    },
    document: { createElement: () => ({ setAttribute() {}, parentNode: null }), head: { appendChild() {} } },
    fetch: async (url) => {
      gets.push(String(url))
      // 按 URL 分派，不能按调用次序发牌：切到目录 tab 之前，服务器视图已经 GET 过几次了。
      const payload = String(url).includes('view=catalog')
        ? pages[Math.min(served, pages.length - 1)]
        : EMPTY_SNAPSHOT
      if (String(url).includes('view=catalog')) served += 1
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'mcp-control/client.js' })
  assert.ok(definition, 'client.js must hand its definition to window.__ModuleLoader__')

  const client = definition.factory((name) => {
    if (name === 'react') return react.api
    throw new Error(`client.js must not require "${name}"`)
  })

  const rows = []
  const slots = {
    register(registration, component) {
      const row = Object.assign({}, registration, { component })
      rows.push(row)
      return () => {
        const at = rows.indexOf(row)
        if (at >= 0) rows.splice(at, 1)
      }
    },
    inject(_name, callback) {
      const off = callback()
      return typeof off === 'function' ? off : () => {}
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return { getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} }
      return undefined
    },
    effect: (fn) => fn(),
    inject: (_deps, callback) =>
      callback({ layout: { selectPanel() {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } } }),
  }

  client.apply(ctx)
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done))

  const section = rows.find((row) => row.name === 'settings.section')
  assert.ok(section, 'the settings seat must be registered')

  const render = () => react.settle(section.component, { ctx: undefined })

  /** 切到目录 tab 并等它稳定下来。 */
  async function openCatalog() {
    const tree = await render()
    const tab = react.findAll(tree, (node) => node.tag === 'button' && buttonText(node) === '目录')[0]
    assert.ok(tab, 'the catalog tab must exist')
    tab.props.onClick()
    return render()
  }

  return { react, gets, render, openCatalog }
}

/** 目录视图发出的第一次 GET。 */
function firstCatalogGet(gets) {
  return gets.find((url) => url.includes('view=catalog'))
}

test('目录页打开就加载第一页，不用先搜索', async () => {
  const { react, gets, openCatalog } = await boot()
  const tree = await openCatalog()
  const body = react.text(tree)

  const first = firstCatalogGet(gets)
  assert.ok(first, 'opening the catalog view must fetch the first page')

  assert.match(body, /io\.example\/alpha/, 'the first page must be on screen without typing anything')
  assert.match(body, /io\.example\/beta/)
})

test('翻页把新一页接在后面，不是换掉已经看到的', async () => {
  const { react, render, openCatalog } = await boot()
  let tree = await openCatalog()

  const more = react.findAll(tree, (node) => node.tag === 'button' && /下一页/.test(buttonText(node)))[0]
  assert.ok(more, 'a page with a cursor must offer the next page')

  more.props.onClick()
  await flush()
  tree = await render()
  const body = react.text(tree)

  // 第一页仍在场 —— 翻页要是把列表换掉，用户滚到哪儿都会丢
  assert.match(body, /io\.example\/alpha/, 'the first page must still be there after paging')
  assert.match(body, /io\.example\/beta/)
  // 第二页也接上了
  assert.match(body, /io\.example\/gamma/, 'the next page must be appended')
})

test('跨页重复的条目只出现一次', async () => {
  const { react, render, openCatalog } = await boot()
  let tree = await openCatalog()
  const more = react.findAll(tree, (node) => node.tag === 'button' && /下一页/.test(buttonText(node)))[0]
  more.props.onClick()
  await flush()
  tree = await render()

  const names = react.findAll(tree, (node) => node.props && node.props.className === 'mcc-mono')
  const occurrences = names.map((node) => react.text(node)).filter((text) => text === 'io.example/alpha')
  assert.equal(occurrences.length, 1, 'the same catalog entry must not be drawn twice after paging')
})

test('翻页时列表不会被打回加载态', async () => {
  const { react, render, openCatalog } = await boot()
  let tree = await openCatalog()

  const more = react.findAll(tree, (node) => node.tag === 'button' && /下一页/.test(buttonText(node)))[0]
  more.props.onClick()

  // 请求还在飞的时候先渲染一次：这一帧不能塌成「加载中」，
  // 否则页面高度塌掉、用户的滚动位置就丢了。
  const during = react.text(await render())
  assert.match(during, /io\.example\/alpha/, 'the list must stay on screen while the next page loads')
})

test('没有下一页时不画翻页按钮', async () => {
  const { react, openCatalog } = await boot({
    pages: [{ ok: true, view: 'catalog', entries: [entry('io.example/solo', '1.0.0')], nextCursor: null }],
  })
  const tree = await openCatalog()

  const more = react.findAll(tree, (node) => node.tag === 'button' && /下一页/.test(buttonText(node)))
  assert.deepEqual(more, [], 'a last page must not offer another page')
})

test('搜索是替换列表，不是追加', async () => {
  const { react, render, openCatalog } = await boot({
    pages: [PAGE_ONE, { ok: true, view: 'catalog', entries: [entry('io.example/solo', '9.9.9')], nextCursor: null }],
  })
  let tree = await openCatalog()

  const input = react.findAll(tree, (node) => node.tag === 'input')[0]
  assert.ok(input, 'the catalog view must have a search box')
  input.props.onChange({ target: { value: 'solo' } })

  const button = react.findAll(tree, (node) => node.tag === 'button' && buttonText(node) === '搜索')[0]
  assert.ok(button, 'the search box needs a search button')
  button.props.onClick()

  await flush()
  tree = await render()
  const body = react.text(tree)

  assert.match(body, /io\.example\/solo/, 'the search result must be on screen')
  assert.doesNotMatch(body, /io\.example\/alpha/, 'a search replaces the browse list instead of appending to it')
})
