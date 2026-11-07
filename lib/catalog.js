// 官方 MCP 目录搜索：让用户不必先知道 server 的 GitHub 地址，就能按关键词找到它。
//
// 数据源只有官方 registry（`registry.modelcontextprotocol.io`）。参考实现还接了
// Smithery 和 awesome-mcp-servers，这里**故意只留一个**：
//   - Smithery 实测会返回 500，接进来只会多一个「搜索失败」的告警源；
//   - awesome-mcp-servers 只是一个 README，条目是链接不是可安装配置，混进搜索结果
//     会让「点安装」这个动作有一半是不可用的。
// 一个能装的源，好过三个半能用的源。

/** 官方目录。 */
export const CATALOG_URL = 'https://registry.modelcontextprotocol.io/v0/servers'
/** 官方 registry 冷读很慢，给足时间；这是实测值。 */
export const CATALOG_TIMEOUT_MS = 30000
/** 单页上限（服务端限制）。 */
export const CATALOG_PAGE_LIMIT = 50
/** 搜索结果的本地缓存时长。目录不会一分钟变一次。 */
export const CATALOG_CACHE_MS = 10 * 60 * 1000

// 不带 user-agent 会被 Cloudflare 拦成 403；带上就能过。这是实测出来的，
// 不是礼节问题，所以写死在这里而不是让调用方传。
const USER_AGENT = 'dsh-mcp-control (DeepSeek Harness plugin)'

/**
 * 把目录条目压成面板能渲染的形状。
 *
 * `install` 为 null 表示「这个条目在这里装不了」——比如只声明了 sse 远程端点，
 * 或者包里既没有 npm 也没有 pypi 分发。面板必须能显示这种条目（用户要搜索的是
 * 「有没有这个东西」，不是「有什么能一键装」），但要标清楚为什么不能装。
 */
export function summarizeEntry(item) {
  const server = item?.server ?? {}
  const name = String(server.name ?? '')
  if (name === '') return null

  const packages = Array.isArray(server.packages) ? server.packages : []
  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  const stdioPackage = packages.find((pkg) => (pkg?.transport?.type ?? pkg?.transportType ?? 'stdio') === 'stdio') ?? packages[0]
  const remote = remotes.find((row) => (row?.type ?? 'streamable-http') === 'streamable-http') ?? remotes[0]

  const summary = {
    name,
    title: String(server.title ?? server.description ?? name).slice(0, 160),
    description: String(server.description ?? '').slice(0, 600),
    version: String(server.version ?? ''),
    repository: typeof server.repository?.url === 'string' ? server.repository.url : null,
    homepage: typeof server.homepage === 'string' ? server.homepage : null,
    packages: packages.length,
    remotes: remotes.length,
    install: null,
    reason: null,
  }

  if (stdioPackage) {
    const registryType = String(stdioPackage.registryType ?? 'npm')
    const identifier = String(stdioPackage.identifier ?? '')
    if (identifier !== '') {
      summary.install = {
        transport: 'stdio',
        registryType,
        identifier,
        // 让用户知道「这一装会下载并运行什么」。协议里 `command` 是可选的，
        // 缺省时按分发类型猜一个标准启动器。
        command: commandFor(registryType, identifier),
        args: argTemplateFor(registryType, identifier, stdioPackage),
        env: requiredEnvNames(stdioPackage),
      }
      summary.reason = null
      return summary
    }
  }

  if (remote && (remote.type ?? 'streamable-http') === 'streamable-http' && typeof remote.url === 'string') {
    summary.install = {
      transport: 'streamable-http',
      url: remote.url,
      headers: Array.isArray(remote.headers)
        ? Object.fromEntries(remote.headers.filter((row) => row?.name).map((row) => [row.name, '']))
        : {},
    }
    return summary
  }

  summary.reason = remote ? `unsupported remote transport: ${remote.type}` : 'no installable package or remote endpoint'
  return summary
}

function commandFor(registryType, identifier) {
  const kind = String(registryType).toLowerCase()
  if (kind === 'npm') return 'npx'
  if (kind === 'pypi') return 'uvx'
  if (kind === 'oci') return 'docker'
  return identifier
}

function argTemplateFor(registryType, identifier, pkg) {
  const kind = String(registryType).toLowerCase()
  const pinned = String(pkg?.version ?? '')
  const target = pinned !== '' && pinned !== 'latest' ? `${identifier}@${pinned}` : identifier
  if (kind === 'npm') return ['-y', target]
  if (kind === 'pypi') return [target]
  if (kind === 'oci') return ['run', '--rm', '-i', target]
  return []
}

function requiredEnvNames(pkg) {
  const vars = Array.isArray(pkg?.environmentVariables) ? pkg.environmentVariables : []
  const out = {}
  for (const variable of vars) {
    if (variable?.isRequired === true && typeof variable.name === 'string') out[variable.name] = ''
  }
  return out
}

/** 目录页面 → `{ entries, nextCursor }`。坏条目跳过，不让一条脏数据毁掉整页。 */
export function parseCatalogPage(payload) {
  const rows = Array.isArray(payload?.servers) ? payload.servers : []
  const entries = []
  for (const row of rows) {
    const summary = summarizeEntry(row)
    if (summary) entries.push(summary)
  }
  const nextCursor = typeof payload?.metadata?.nextCursor === 'string' ? payload.metadata.nextCursor : null
  return { entries, nextCursor }
}

/** 纯函数：给定关键词与游标拼 URL。测这个比测网络可靠。 */
export function catalogUrl(query, cursor = null, limit = CATALOG_PAGE_LIMIT) {
  const url = new URL(CATALOG_URL)
  if (typeof query === 'string' && query.trim() !== '') url.searchParams.set('search', query.trim())
  url.searchParams.set('limit', String(Math.max(1, Math.min(CATALOG_PAGE_LIMIT, limit))))
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.toString()
}

/**
 * 拉一页目录。永不抛：网络问题是常态（这台机器上就有代理），
 * 面板要能显示「搜不了，因为……」，而不是一个空列表。
 */
export async function fetchCatalog(query, options = {}) {
  const { cursor = null, limit = CATALOG_PAGE_LIMIT, timeoutMs = CATALOG_TIMEOUT_MS, fetchImpl = globalThis.fetch } = options
  if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch is unavailable in this runtime' }

  const url = catalogUrl(query, cursor, limit)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (!response.ok) return { ok: false, status: response.status, error: `catalog returned HTTP ${response.status}` }
    const payload = await response.json()
    const { entries, nextCursor } = parseCatalogPage(payload)
    return { ok: true, url, query: String(query ?? ''), entries, nextCursor, fetchedAt: new Date().toISOString() }
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    return { ok: false, url, error: aborted ? `catalog request timed out after ${timeoutMs} ms` : String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

/** 缓存是否还有效。 */
export function cacheFresh(cache, now = Date.now()) {
  if (!cache || typeof cache.fetchedAt !== 'string') return false
  const at = Date.parse(cache.fetchedAt)
  if (!Number.isFinite(at)) return false
  return now - at >= 0 && now - at < CATALOG_CACHE_MS
}

/**
 * 从目录条目生成一条待安装 spec。
 *
 * `id` 由名字推导：目录里的名字是 `ac.inference.sh/mcp` 这种带斜杠的反向域名，
 * 直接当 id 会得到一个 YAML 里能写、但 patch 行匹配起来很别扭的东西。转成
 * `ac-inference-sh-mcp` 这类形状，既保留可读性又不触发 quoting。
 */
export function specFromEntry(entry, overrides = {}) {
  const install = entry?.install
  if (!install) return null
  const id = overrides.id ?? suggestIdFromName(entry.name)
  const spec = {
    id,
    serverName: overrides.serverName ?? (id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'server'),
    transport: install.transport,
  }
  if (install.transport === 'stdio') {
    spec.command = overrides.command ?? install.command
    spec.args = overrides.args ?? install.args ?? []
    spec.env = { ...(install.env ?? {}), ...(overrides.env ?? {}) }
    if (overrides.cwd) spec.cwd = overrides.cwd
  } else {
    spec.url = overrides.url ?? install.url
    spec.headers = { ...(install.headers ?? {}), ...(overrides.headers ?? {}) }
  }
  return spec
}

/** `ac.inference.sh/mcp` → `ac-inference-sh-mcp`；保证首字符是字母数字。 */
export function suggestIdFromName(name) {
  const cleaned = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned === '' ? 'mcp-server' : cleaned
}
