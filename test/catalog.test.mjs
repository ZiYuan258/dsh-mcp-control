/**
 * 目录搜索的测试。
 *
 * 网络不测（这台机器上就有代理，测网络测的是代理），测的是**把目录条目变成一条
 * 补丁行**这一段：`summarizeEntry` 怎么挑分发包、`specFromEntry` 怎么生成 spec、
 * 名字怎么转 id。这一段错了，用户会装上一个「装上了但起不来」的服务器。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CATALOG_PAGE_LIMIT,
  CATALOG_URL,
  cacheFresh,
  catalogUrl,
  collapseVersions,
  compareVersions,
  parseCatalogPage,
  specFromEntry,
  summarizeEntry,
  suggestIdFromName,
} from '../lib/catalog.js'

/** 官方 registry 的真实条目形状（截取，字段名按实测）。 */
const NPM_ENTRY = {
  server: {
    name: 'io.example/fetch',
    title: 'Fetch',
    description: 'Fetch a URL and turn it into markdown.',
    version: '1.2.3',
    repository: { url: 'https://github.com/example/fetch' },
    packages: [
      {
        registryType: 'npm',
        identifier: '@example/mcp-server-fetch',
        version: '1.2.3',
        transport: { type: 'stdio' },
        environmentVariables: [
          { name: 'API_KEY', isRequired: true },
          { name: 'OPTIONAL', isRequired: false },
        ],
      },
    ],
  },
}

const HTTP_ENTRY = {
  server: {
    name: 'ac.inference.sh/mcp',
    description: 'Hosted inference.',
    version: '0.1.0',
    remotes: [{ type: 'streamable-http', url: 'https://ac.inference.sh/mcp' }],
  },
}

const SSE_ONLY = {
  server: {
    name: 'legacy/sse',
    remotes: [{ type: 'sse', url: 'https://legacy.dev/sse' }],
  },
}

test('summarizeEntry：npm 分发包 → npx 启动，必填环境变量留空待填', () => {
  const summary = summarizeEntry(NPM_ENTRY)
  assert.equal(summary.name, 'io.example/fetch')
  assert.equal(summary.title, 'Fetch')
  assert.equal(summary.version, '1.2.3')
  assert.equal(summary.repository, 'https://github.com/example/fetch')
  assert.equal(summary.packages, 1)
  assert.equal(summary.remotes, 0)
  assert.equal(summary.reason, null)

  assert.equal(summary.install.transport, 'stdio')
  assert.equal(summary.install.registryType, 'npm')
  assert.equal(summary.install.identifier, '@example/mcp-server-fetch')
  assert.equal(summary.install.command, 'npx')
  // 版本固定进参数，避免装到明天的新版本
  assert.deepEqual(summary.install.args, ['-y', '@example/mcp-server-fetch@1.2.3'])
  // 只有 isRequired 的变量进来，值留空等用户填
  assert.deepEqual(summary.install.env, { API_KEY: '' })
})

test('summarizeEntry：pypi 走 uvx，oci 走 docker run', () => {
  const pypi = summarizeEntry({
    server: { name: 'p/py', packages: [{ registryType: 'pypi', identifier: 'mcp-server-fetch', transport: { type: 'stdio' } }] },
  })
  assert.equal(pypi.install.command, 'uvx')
  assert.deepEqual(pypi.install.args, ['mcp-server-fetch'])

  const oci = summarizeEntry({
    server: { name: 'o/oci', packages: [{ registryType: 'oci', identifier: 'ghcr.io/x/y', transport: { type: 'stdio' } }] },
  })
  assert.equal(oci.install.command, 'docker')
  assert.deepEqual(oci.install.args, ['run', '--rm', '-i', 'ghcr.io/x/y'])
})

test('summarizeEntry：streamable-http remote 直接可用', () => {
  const summary = summarizeEntry(HTTP_ENTRY)
  assert.equal(summary.install.transport, 'streamable-http')
  assert.equal(summary.install.url, 'https://ac.inference.sh/mcp')
  assert.deepEqual(summary.install.headers, {})
  assert.equal(summary.reason, null)
})

test('summarizeEntry：只支持 sse 的条目不可装，但要说清为什么', () => {
  const summary = summarizeEntry(SSE_ONLY)
  assert.equal(summary.install, null)
  assert.match(summary.reason, /unsupported remote transport: sse/)
})

test('summarizeEntry：没有分发包也没有 remote 时给出原因', () => {
  const summary = summarizeEntry({ server: { name: 'empty/one' } })
  assert.equal(summary.install, null)
  assert.match(summary.reason, /no installable package or remote endpoint/)
})

test('summarizeEntry：没有名字的条目直接跳过', () => {
  assert.equal(summarizeEntry({ server: {} }), null)
  assert.equal(summarizeEntry({}), null)
  assert.equal(summarizeEntry(null), null)
})

test('parseCatalogPage：坏条目跳过，游标按实测形状取', () => {
  const page = parseCatalogPage({
    servers: [NPM_ENTRY, { server: {} }, HTTP_ENTRY],
    metadata: { nextCursor: 'abc' },
  })
  assert.equal(page.entries.length, 2)
  assert.equal(page.nextCursor, 'abc')

  assert.deepEqual(parseCatalogPage({}), { entries: [], nextCursor: null })
  assert.deepEqual(parseCatalogPage(null), { entries: [], nextCursor: null })
})

test('collapseVersions：同一条目的多个版本合成一行，留最新的', () => {
  // registry 是「一条目一版本一行」：实测搜 filesystem 会拿到同一条的
  // 0.1.2 / 0.1.3 / 0.1.5 三行。不去重的话一屏三条一样的卡片，逛起来像刷屏。
  const rows = [
    { name: 'com.pulsemcp/remote-filesystem', version: '0.1.2' },
    { name: 'com.pulsemcp/remote-filesystem', version: '0.1.5' },
    { name: 'com.pulsemcp/remote-filesystem', version: '0.1.3' },
    { name: 'io.example/fetch', version: '1.0.0' },
  ]
  const collapsed = collapseVersions(rows)
  assert.equal(collapsed.length, 2)
  assert.equal(collapsed[0].name, 'com.pulsemcp/remote-filesystem')
  assert.equal(collapsed[0].version, '0.1.5')
  assert.equal(collapsed[1].version, '1.0.0')
  // 顺序保持首次出现的顺序，不因为版本比较而重排整页
  assert.deepEqual(collapsed.map((row) => row.name), ['com.pulsemcp/remote-filesystem', 'io.example/fetch'])
  assert.deepEqual(collapseVersions([]), [])
})

test('compareVersions：按数字段比，不是按字符串比', () => {
  // 字符串比较会让 0.1.10 排在 0.1.9 前面，于是「留最新」会留下旧的
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersions('0.1.9', '0.1.10'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  // 缺段算 0：1.2 与 1.2.0 是同一个版本
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
  assert.equal(compareVersions('1.2.1', '1.2'), 1)
  // 预发布比正式版旧：1.0.0-rc.1 在 1.0.0 之前（多出的段让它更旧）。
  // 这一条保证「留最新」不会把 rc 留下来、把正式版扔掉。
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('', ''), 0)
  assert.equal(compareVersions(null, '1.0.0'), -1)
})

test('catalogUrl：关键词与游标都进查询串，limit 被夹住', () => {
  assert.equal(catalogUrl(''), CATALOG_URL + `?limit=${CATALOG_PAGE_LIMIT}`)
  assert.match(catalogUrl('fetch'), /search=fetch/)
  assert.match(catalogUrl('  spaced  '), /search=spaced/)
  assert.match(catalogUrl('x', 'cur'), /cursor=cur/)
  // 超出上限被夹回服务端接受的值
  assert.match(catalogUrl('x', null, 999), /limit=50/)
  assert.match(catalogUrl('x', null, 0), /limit=1/)
})

test('cacheFresh：十分钟内算新鲜', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z')
  assert.equal(cacheFresh({ fetchedAt: '2026-11-07T11:55:00.000Z' }, now), true)
  assert.equal(cacheFresh({ fetchedAt: '2026-11-07T11:40:00.000Z' }, now), false)
  assert.equal(cacheFresh(null, now), false)
  assert.equal(cacheFresh({}, now), false)
  assert.equal(cacheFresh({ fetchedAt: 'nonsense' }, now), false)
  // 未来的时间戳不算新鲜（时钟被改过）
  assert.equal(cacheFresh({ fetchedAt: '2026-11-07T13:00:00.000Z' }, now), false)
})

test('specFromEntry：stdio 条目生成可直接安装的 spec', () => {
  const summary = summarizeEntry(NPM_ENTRY)
  const spec = specFromEntry(summary)
  assert.equal(spec.id, 'io-example-fetch')
  assert.equal(spec.serverName, 'io-example-fetch')
  assert.equal(spec.transport, 'stdio')
  assert.equal(spec.command, 'npx')
  assert.deepEqual(spec.args, ['-y', '@example/mcp-server-fetch@1.2.3'])
  assert.deepEqual(spec.env, { API_KEY: '' })
  // 目录条目里没有 cwd，就不要凭空造一个
  assert.equal('cwd' in spec, false)
})

test('specFromEntry：http 条目生成 url/headers，没有 command', () => {
  const spec = specFromEntry(summarizeEntry(HTTP_ENTRY))
  assert.equal(spec.transport, 'streamable-http')
  assert.equal(spec.url, 'https://ac.inference.sh/mcp')
  assert.deepEqual(spec.headers, {})
  assert.equal('command' in spec, false)
})

test('specFromEntry：不可装的条目返回 null', () => {
  assert.equal(specFromEntry(summarizeEntry(SSE_ONLY)), null)
  assert.equal(specFromEntry({ install: null }), null)
  assert.equal(specFromEntry(null), null)
})

test('specFromEntry：overrides 能改 id/serverName/env', () => {
  const spec = specFromEntry(summarizeEntry(NPM_ENTRY), { id: 'mine', serverName: 'mysrv', env: { API_KEY: 'k' } })
  assert.equal(spec.id, 'mine')
  assert.equal(spec.serverName, 'mysrv')
  assert.deepEqual(spec.env, { API_KEY: 'k' })
})

test('suggestIdFromName 产出补丁里能用的 id', () => {
  assert.equal(suggestIdFromName('ac.inference.sh/mcp'), 'ac-inference-sh-mcp')
  assert.equal(suggestIdFromName('@scope/pkg'), 'scope-pkg')
  assert.equal(suggestIdFromName('---'), 'mcp-server')
  assert.equal(suggestIdFromName(''), 'mcp-server')
  assert.equal(suggestIdFromName(null), 'mcp-server')
  assert.equal(suggestIdFromName('x'.repeat(80)).length, 48)
  // 结果必须能过 validateServerSpec 的 id 规则（首字符是字母数字）
  assert.match(suggestIdFromName('1.server'), /^[A-Za-z0-9]/)
})
