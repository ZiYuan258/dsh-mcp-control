/**
 * dsh-mcp-control — client half (browser bundle).
 *
 * Loaded by the DSH client ModuleLoader as a CJS closure; the bundle id MUST equal
 * the package name. React comes from the browser module table via require('react').
 *
 * The page is additive: it registers a FRESH settings.section id, so it sits beside
 * the shipped settings pages and never shadows one.
 */

window.__ModuleLoader__.load({
  id: 'dsh-mcp-control',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const ReactNS = require('react')
    const React =
      ReactNS && ReactNS.default && typeof ReactNS.default.createElement === 'function'
        ? ReactNS.default
        : ReactNS
    const h = React.createElement

    const API = '/mcp-control/api'
    const STYLE_ID = 'dsh-mcp-control'
    const CLASS_PREFIX = 'mcc-'

    // One id, two jobs: the sidebar row is registered under it, and it is the `main`
    // key the row dispatches to (Slots catalog: "Each list id addresses the matching
    // main panel"). They cannot drift apart if there is only one of them.
    const PANEL_KEY = 'mcp-control'
    // Just past the shipped order-20 group (context, jet-hub, task board).
    const SIDEBAR_ORDER = 21
    // Both must match index.js; the host is the one that validates and the option list
    // is rendered from this copy, so a mismatch would offer a choice the host rejects.
    const DEFAULT_PANEL_ENTRY = 'settings'
    const PANEL_ENTRY_VALUES = ['sidebar', 'settings']

    // Kept in step with package.json by tests/package-contract.test.mjs — the two must
    // never drift, because the panel prints this and the manifest is what installs.
    const PACKAGE = 'dsh-mcp-control'
    const VERSION = '1.1.0'

    const PHASE_LABEL = {
      pending: { zh: '连接中…', en: 'Connecting…' },
      loading: { zh: '加载中', en: 'Loading' },
      active: { zh: '已连接', en: 'Connected' },
      failed: { zh: '连接失败', en: 'Connection failed' },
      unloading: { zh: '停止中', en: 'Stopping' },
    }

    const TEXT = {
      pageTitle: { zh: 'MCP 控制台', en: 'MCP Control' },
      intro: {
        zh: '逐个启停 MCP 服务器。停用会真正注销它的全部工具——它占用的上下文 token 随之消失，下次请求立刻变便宜。',
        en: 'Start and stop MCP servers one by one. Disabling genuinely unregisters its tools, so the context tokens it cost disappear and the next request gets cheaper immediately.',
      },
      loading: { zh: '读取中…', en: 'Loading…' },
      refresh: { zh: '刷新', en: 'Refresh' },
      disableAll: { zh: '全部停用', en: 'Disable all' },
      enableAll: { zh: '全部启用', en: 'Enable all' },
      onlyEnabled: { zh: '只看已启用', en: 'Enabled only' },
      noServers: {
        zh: '没有发现 MCP 服务器。本页只列出挂了 @deepseek-ai/dsh-mcp-client 的行。',
        en: 'No MCP servers found. This page lists rows mounting @deepseek-ai/dsh-mcp-client only.',
      },
      noMatch: { zh: '没有符合筛选的服务器。', en: 'No server matches the filter.' },
      enabled: { zh: '已启用', en: 'Enabled' },
      disabled: { zh: '已停用', en: 'Disabled' },
      tools: { zh: '个工具', en: 'tools' },
      perRequest: { zh: '/轮', en: '/request' },
      activeLabel: { zh: '当前占用', en: 'Currently loaded' },
      serversLabel: { zh: '服务器', en: 'Servers' },
      enabledLabel: { zh: '启用中', en: 'enabled' },
      totalLabel: { zh: '合计', en: 'Total' },
      savedNote: {
        zh: '停用这些服务器后，每轮输入可省下约',
        en: 'Disabling the stopped servers would save about',
      },
      estimateNote: {
        zh: 'token 数由模型侧 schema 字节数 ÷ 4 估算（name + description + parameters）。',
        en: 'Token figures are the model-facing schema bytes ÷ 4 (name + description + parameters).',
      },
      layer: { zh: '所在层', en: 'Layer' },
      layerHome: { zh: 'home 层', en: 'home layer' },
      layerBundle: { zh: 'bundle 内置', en: 'from bundle' },
      breakdown: { zh: '构成', en: 'Breakdown' },
      breakdownName: { zh: '名称', en: 'name' },
      breakdownDesc: { zh: '描述', en: 'description' },
      breakdownParams: { zh: '参数', en: 'parameters' },
      patchPath: { zh: '持久化写入', en: 'Persisted to' },
      switchOn: { zh: '停用', en: 'Disable' },
      switchOff: { zh: '启用', en: 'Enable' },
      busy: { zh: '处理中…', en: 'Working…' },
      failed: { zh: '操作失败', en: 'Action failed' },
      loadFailed: { zh: '读取失败', en: 'Could not load' },
      sessionOnly: { zh: '（未能写入补丁文件，重启后会恢复）', en: ' (not persisted — will revert after a restart)' },
      bulkDone: { zh: '批量操作完成', en: 'Bulk action finished' },
      restartNote: {
        zh: '改动即时生效，无需重启 DSH；补丁文件也已同步，重启后保持。',
        en: 'Changes apply immediately with no DSH restart, and are written to the patch file so they survive one.',
      },
      panelEntryTitle: { zh: '面板入口', en: 'Panel entry' },
      panelEntryDesc: {
        zh: '决定 MCP 控制台出现在哪里。两个入口是同一个页面，任一时刻只保留一个。',
        en: 'Where the MCP console lives. Both entries open the same page, and only one exists at a time.',
      },
      panelEntryOptionSidebar: { zh: '仅侧栏', en: 'Sidebar only' },
      panelEntryOptionSettings: { zh: '仅设置页', en: 'Settings page only' },
      panelEntrySwitched: { zh: '面板入口已切换', en: 'Panel entry switched' },
      panelEntryReadFailed: {
        zh: '⚠️ 未能读取当前设置，下面显示的是默认值。重新选一次即可写回。',
        en: '⚠️ Could not read the current setting, so the default is shown. Pick one to write it back.',
      },
      panelEntryWriteFailed: {
        zh: '⚠️ 刚才那次没有保存成功，下面仍是原来的设置。请再选一次。',
        en: '⚠️ That did not save, so the setting is unchanged. Please pick one again.',
      },
    }

    function detectLang(ctx) {
      try {
        const locale = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale && typeof locale.getLocale === 'function') {
          const snapshot = locale.getLocale()
          const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
          if (active) return active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
        }
      } catch (error) {
        /* fall through to the browser preference */
      }
      const nav = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en'
      return String(nav).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    }

    function formatTokens(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
      if (n >= 10_000) return `${Math.round(n / 1000)}k`
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
      return String(Math.round(n))
    }

    function phaseLabel(phase, lang) {
      if (!phase) return lang === 'zh' ? '已停止' : 'Stopped'
      const entry = PHASE_LABEL[phase]
      return entry ? entry[lang] : phase
    }

    function layerLabel(layer, lang) {
      if (!layer || layer === 'bundle') return TEXT.layerBundle[lang]
      if (layer === 'home') return TEXT.layerHome[lang]
      return layer
    }

    /* ---------------------------------------------------------------------- */
    /* panel entry — which seat the console occupies                           */
    /* ---------------------------------------------------------------------- */

    // Mirrored locally because the seat is decided synchronously while the slot tree is
    // being built, and a fetch is not synchronous. `null` means "nothing loaded yet" and
    // is deliberately distinct from the default: the default is a decision, `null` is the
    // absence of information, and keeping them apart is what lets a first paint render
    // the default without pretending the user chose it.
    let panelEntryValue = null
    let panelEntryReadFailed = false
    const panelEntryListeners = new Set()

    function subscribePanelEntry(listener) {
      panelEntryListeners.add(listener)
      return () => {
        panelEntryListeners.delete(listener)
      }
    }

    function emitPanelEntry(value, readFailed) {
      panelEntryValue = value
      panelEntryReadFailed = Boolean(readFailed)
      // Snapshot the set first: a listener that unsubscribes mid-dispatch must not
      // disturb the iteration that is already running.
      for (const listener of Array.from(panelEntryListeners)) {
        try {
          listener()
        } catch (error) {
          console.error('[mcp-control] 面板入口订阅者抛错：', error)
        }
      }
    }

    function currentPanelEntry() {
      return panelEntryValue === null ? DEFAULT_PANEL_ENTRY : panelEntryValue
    }

    function panelEntryShowsSidebar() {
      return currentPanelEntry() === 'sidebar'
    }

    function panelEntryShowsSettings() {
      return currentPanelEntry() === 'settings'
    }

    async function loadPanelEntry() {
      try {
        const response = await fetch(API, { cache: 'no-store' })
        const data = await response.json()
        if (!data || data.ok !== true) {
          emitPanelEntry(DEFAULT_PANEL_ENTRY, true)
          return currentPanelEntry()
        }
        const stored = data.panelEntry
        // An unrecognised value means this copy and the host have drifted apart; falling
        // back to the default keeps the panel reachable rather than rendering nothing.
        emitPanelEntry(
          PANEL_ENTRY_VALUES.indexOf(stored) >= 0 ? stored : DEFAULT_PANEL_ENTRY,
          Boolean(data.panelEntryError),
        )
        return currentPanelEntry()
      } catch (error) {
        console.error('[mcp-control] 读取面板入口失败：', error)
        emitPanelEntry(DEFAULT_PANEL_ENTRY, true)
        return currentPanelEntry()
      }
    }

    async function setPanelEntry(next) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set-panel-entry', entry: next }),
      })
      const data = await response.json()
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) || `HTTP ${response.status}`)
      }
      emitPanelEntry(data.panelEntry, false)
      return data.panelEntry
    }

    // Every component that renders text needs the same locale subscription, so it lives
    // here once instead of being re-derived per component.
    function useLang(ctx) {
      const [lang, setLang] = React.useState(ctx ? detectLang(ctx) : 'en')
      React.useEffect(() => {
        if (!ctx || typeof ctx.get !== 'function') return undefined
        let locale
        try {
          locale = ctx.get('locale')
        } catch (error) {
          locale = undefined
        }
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        const off = locale.subscribe(() => setLang(detectLang(ctx)))
        return typeof off === 'function' ? off : undefined
      }, [ctx])
      return lang
    }

    function styles() {
      return `
.${CLASS_PREFIX}page { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 24px; }
.${CLASS_PREFIX}intro { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.${CLASS_PREFIX}bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.${CLASS_PREFIX}spacer { flex: 1 1 auto; }
.${CLASS_PREFIX}btn { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; font-family: inherit; }
.${CLASS_PREFIX}btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.${CLASS_PREFIX}btn:disabled { opacity: 0.5; cursor: default; }
.${CLASS_PREFIX}btnPrimary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.${CLASS_PREFIX}check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.${CLASS_PREFIX}totals { display: flex; flex-wrap: wrap; gap: 18px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.${CLASS_PREFIX}stat { display: flex; flex-direction: column; gap: 2px; }
.${CLASS_PREFIX}statValue { font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.${CLASS_PREFIX}statLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.${CLASS_PREFIX}hint { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.${CLASS_PREFIX}list { display: flex; flex-direction: column; gap: 8px; }
.${CLASS_PREFIX}row { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.${CLASS_PREFIX}rowMain { display: flex; align-items: center; gap: 10px; }
.${CLASS_PREFIX}name { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); word-break: break-all; }
.${CLASS_PREFIX}tag { font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.${CLASS_PREFIX}tagOn { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.${CLASS_PREFIX}tagOff { border-color: var(--dsw-alias-state-idle-primary); color: var(--dsw-alias-state-idle-primary); }
.${CLASS_PREFIX}tagFail { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.${CLASS_PREFIX}tagWarn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.${CLASS_PREFIX}cost { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.${CLASS_PREFIX}switch { width: 42px; height: 24px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); position: relative; cursor: pointer; padding: 0; flex: 0 0 auto; }
.${CLASS_PREFIX}switch:disabled { opacity: 0.5; cursor: default; }
.${CLASS_PREFIX}knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-label-secondary); transition: transform 140ms ease, background 140ms ease; }
.${CLASS_PREFIX}switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.${CLASS_PREFIX}switch[aria-checked="true"] .${CLASS_PREFIX}knob { transform: translateX(18px); background: var(--dsw-alias-bg-base); }
.${CLASS_PREFIX}details { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.${CLASS_PREFIX}toast { position: sticky; bottom: 8px; align-self: flex-start; border: 1px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-overlay); border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.${CLASS_PREFIX}empty { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 18px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.${CLASS_PREFIX}card { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; }
.${CLASS_PREFIX}cardText { display: flex; flex-direction: column; gap: 4px; flex: 1 1 260px; min-width: 0; }
.${CLASS_PREFIX}cardTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.${CLASS_PREFIX}cardDesc { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.${CLASS_PREFIX}seg { display: inline-flex; flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.${CLASS_PREFIX}segBtn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 6px 12px; font-size: 13px; font-family: inherit; cursor: pointer; }
.${CLASS_PREFIX}segBtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.${CLASS_PREFIX}segBtn:disabled { opacity: 0.5; cursor: default; }
.${CLASS_PREFIX}segOn, .${CLASS_PREFIX}segOn:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
`
    }

    function McpControlPage(props) {
      const ctx = props && props.ctx ? props.ctx : null
      const lang = useLang(ctx)
      const [state, setState] = React.useState({ status: 'loading', servers: [], totals: null, patchPath: '', error: '' })
      const [busy, setBusy] = React.useState(null)
      const [onlyEnabled, setOnlyEnabled] = React.useState(false)
      const [toast, setToast] = React.useState(null)

      const t = React.useCallback((key) => (TEXT[key] ? TEXT[key][lang] : key), [lang])

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(API, { cache: 'no-store' })
          const data = await response.json()
          if (!data || data.ok !== true) {
            setState({
              status: 'error',
              servers: [],
              totals: null,
              patchPath: '',
              error: (data && data.error) || `HTTP ${response.status}`,
            })
            return
          }
          setState({
            status: 'ready',
            servers: data.servers || [],
            totals: data.totals || null,
            patchPath: data.patchPath || '',
            error: '',
          })
        } catch (error) {
          setState({
            status: 'error',
            servers: [],
            totals: null,
            patchPath: '',
            error: String((error && error.message) || error),
          })
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const flash = React.useCallback((message) => {
        setToast(message)
        window.setTimeout(() => setToast(null), 6000)
      }, [])

      const toggle = React.useCallback(
        async (server) => {
          setBusy(server.entryId)
          try {
            const response = await fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ entryId: server.entryId, disabled: server.enabled }),
            })
            const data = await response.json()
            if (!data || data.ok !== true) {
              flash(`${t('failed')}: ${(data && data.error) || `HTTP ${response.status}`}`)
            } else if (data.persisted === false) {
              flash(`${t('failed')}: ${data.persistError || ''}${t('sessionOnly')}`)
            }
            await load()
          } catch (error) {
            flash(`${t('failed')}: ${String((error && error.message) || error)}`)
          } finally {
            setBusy(null)
          }
        },
        [flash, load, t],
      )

      const bulk = React.useCallback(
        async (action) => {
          setBusy(action)
          try {
            const response = await fetch(API, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action }),
            })
            const data = await response.json()
            if (!data || data.ok !== true) {
              flash(`${t('failed')}: ${(data && data.error) || `HTTP ${response.status}`}`)
            } else {
              const failed = (data.results || []).filter((item) => item.error || item.persisted === false)
              flash(
                failed.length === 0
                  ? t('bulkDone')
                  : `${t('bulkDone')}: ${failed.length} × ${t('failed')}`,
              )
            }
            await load()
          } catch (error) {
            flash(`${t('failed')}: ${String((error && error.message) || error)}`)
          } finally {
            setBusy(null)
          }
        },
        [flash, load, t],
      )

      const totals = state.totals
      const servers = state.servers || []
      const visible = onlyEnabled ? servers.filter((server) => server.enabled) : servers
      const stoppedTokens = totals ? Math.max(0, totals.mcpEstTokens - totals.activeEstTokens) : 0

      return h(
        'div',
        { className: `${CLASS_PREFIX}page` },
        h('div', { className: `${CLASS_PREFIX}intro` }, t('intro')),

        totals
          ? h(
              'div',
              { className: `${CLASS_PREFIX}totals` },
              h(
                'div',
                { className: `${CLASS_PREFIX}stat` },
                h('span', { className: `${CLASS_PREFIX}statValue` }, `${totals.enabled} / ${totals.servers}`),
                h('span', { className: `${CLASS_PREFIX}statLabel` }, `${t('serversLabel')} · ${t('enabledLabel')}`),
              ),
              h(
                'div',
                { className: `${CLASS_PREFIX}stat` },
                h('span', { className: `${CLASS_PREFIX}statValue` }, formatTokens(totals.activeEstTokens)),
                h('span', { className: `${CLASS_PREFIX}statLabel` }, `${t('activeLabel')} · token${t('perRequest')}`),
              ),
              h(
                'div',
                { className: `${CLASS_PREFIX}stat` },
                h('span', { className: `${CLASS_PREFIX}statValue` }, String(totals.mcpToolCount)),
                h('span', { className: `${CLASS_PREFIX}statLabel` }, `MCP ${t('tools')}`),
              ),
              stoppedTokens > 0
                ? h(
                    'div',
                    { className: `${CLASS_PREFIX}stat` },
                    h(
                      'span',
                      { className: `${CLASS_PREFIX}statValue` },
                      formatTokens(stoppedTokens),
                    ),
                    h('span', { className: `${CLASS_PREFIX}statLabel` }, t('savedNote')),
                  )
                : null,
            )
          : null,

        h(
          'div',
          { className: `${CLASS_PREFIX}bar` },
          h(
            'button',
            {
              className: `${CLASS_PREFIX}btn`,
              onClick: load,
              disabled: busy !== null || state.status === 'loading',
            },
            t('refresh'),
          ),
          h(
            'button',
            {
              className: `${CLASS_PREFIX}btn`,
              onClick: () => bulk('disable-all'),
              disabled: busy !== null || servers.length === 0,
            },
            t('disableAll'),
          ),
          h(
            'button',
            {
              className: `${CLASS_PREFIX}btn`,
              onClick: () => bulk('enable-all'),
              disabled: busy !== null || servers.length === 0,
            },
            t('enableAll'),
          ),
          h('span', { className: `${CLASS_PREFIX}spacer` }),
          h(
            'label',
            { className: `${CLASS_PREFIX}check` },
            h('input', {
              type: 'checkbox',
              checked: onlyEnabled,
              onChange: (event) => setOnlyEnabled(event.target.checked),
            }),
            t('onlyEnabled'),
          ),
        ),

        busy !== null && servers.length > 0
          ? h('div', { className: `${CLASS_PREFIX}hint` }, t('busy'))
          : null,

        state.status === 'loading'
          ? h('div', { className: `${CLASS_PREFIX}empty` }, t('loading'))
          : state.status === 'error'
            ? h('div', { className: `${CLASS_PREFIX}empty` }, `${t('loadFailed')}: ${state.error}`)
            : visible.length === 0
              ? h('div', { className: `${CLASS_PREFIX}empty` }, servers.length === 0 ? t('noServers') : t('noMatch'))
              : h(
                  'div',
                  { className: `${CLASS_PREFIX}list` },
                  visible.map((server) => {
                    const phase = phaseLabel(server.fiberPhase, lang)
                    const phaseClass =
                      server.fiberPhase === 'failed'
                        ? `${CLASS_PREFIX}tagFail`
                        : server.fiberPhase === 'active'
                          ? ''
                          : `${CLASS_PREFIX}tagWarn`
                    return h(
                      'div',
                      { className: `${CLASS_PREFIX}row`, key: server.entryId },
                      h(
                        'div',
                        { className: `${CLASS_PREFIX}rowMain` },
                        h(
                          'button',
                          {
                            className: `${CLASS_PREFIX}switch`,
                            role: 'switch',
                            'aria-checked': server.enabled ? 'true' : 'false',
                            'aria-label': `${server.enabled ? t('switchOn') : t('switchOff')} ${server.serverName}`,
                            title: server.entryId,
                            disabled: busy !== null,
                            onClick: () => toggle(server),
                          },
                          h('span', { className: `${CLASS_PREFIX}knob` }),
                        ),
                        h(
                          'span',
                          { className: `${CLASS_PREFIX}name`, title: server.entryId },
                          server.serverName,
                        ),
                        h(
                          'span',
                          {
                            className: `${CLASS_PREFIX}tag ${
                              server.enabled ? `${CLASS_PREFIX}tagOn` : `${CLASS_PREFIX}tagOff`
                            }`,
                          },
                          server.enabled ? t('enabled') : t('disabled'),
                        ),
                        h('span', { className: `${CLASS_PREFIX}tag ${phaseClass}` }, phase),
                        h('span', { className: `${CLASS_PREFIX}spacer` }),
                        h(
                          'span',
                          { className: `${CLASS_PREFIX}cost` },
                          `${server.toolCount} ${t('tools')} · ~${formatTokens(server.estTokens)} token${t('perRequest')}`,
                        ),
                      ),
                      h(
                        'div',
                        { className: `${CLASS_PREFIX}details` },
                        h(
                          'span',
                          {
                            title: (server.layers || [])
                              .filter((layer) => layer.present)
                              .map((layer) => layer.file)
                              .join('\n'),
                          },
                          `${t('layer')}: ${layerLabel(server.layer, lang)}`,
                        ),
                        server.breakdown
                          ? h(
                              'span',
                              null,
                              `${t('breakdown')}: ${t('breakdownName')} ${server.breakdown.nameBytes}B · ${t(
                                'breakdownDesc',
                              )} ${server.breakdown.descriptionBytes}B · ${t('breakdownParams')} ${
                                server.breakdown.parameterBytes
                              }B`,
                            )
                          : null,
                        h('span', null, server.entryId),
                      ),
                    )
                  }),
                ),

        state.patchPath
          ? h(
              'div',
              { className: `${CLASS_PREFIX}hint` },
              `${t('patchPath')}: ${state.patchPath}`,
              h('br', null),
              t('estimateNote'),
              h('br', null),
              t('restartNote'),
            )
          : null,

        toast ? h('div', { className: `${CLASS_PREFIX}toast` }, toast) : null,

        h('div', { className: `${CLASS_PREFIX}hint` }, `${PACKAGE} v${VERSION}`),
      )
    }

    /**
     * The sidebar row's glyph: a list with a switch at its end, on a 16px grid — the box
     * the sidebar hands us. Hand-drawn because this bundle may not depend on an icon
     * package, and only `size` is supplied (OwnerProps: SidebarPanelIconOwnerProps).
     */
    function McpControlSidebarIcon(props) {
      const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M2.2 4.2h11.6', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        h('path', { d: 'M2.2 8h7.4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        h('path', { d: 'M2.2 11.8h4.4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        h('circle', { cx: '11.7', cy: '11.8', r: '2.3', stroke: 'currentColor', strokeWidth: '1.5' }),
        h('path', { d: 'M11.7 10.7v2.2', stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round' }),
      )
    }

    const PANEL_ENTRY_LABEL = {
      sidebar: 'panelEntryOptionSidebar',
      settings: 'panelEntryOptionSettings',
    }

    /**
     * The one control that decides which seat the console occupies.
     *
     * Rendered on the plugin's own bundle page (Settings → Plugins), never inside this
     * plugin's settings section: that section is one of the two seats, so parking it in
     * the sidebar would take the switcher out of reach in exactly the state where the
     * user needs it.
     */
    function McpControlPanelEntryCard(props) {
      const ctx = props && props.ctx ? props.ctx : null
      const view = props && props.view === 'summary' ? 'summary' : 'page'
      const lang = useLang(ctx)
      const [entry, setEntry] = React.useState(currentPanelEntry)
      const [readFailed, setReadFailed] = React.useState(panelEntryReadFailed)
      const [writeFailed, setWriteFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)

      const t = React.useCallback((key) => (TEXT[key] ? TEXT[key][lang] : key), [lang])

      const sync = React.useCallback(() => {
        setEntry(currentPanelEntry())
        setReadFailed(panelEntryReadFailed)
      }, [])

      React.useEffect(() => subscribePanelEntry(sync), [sync])

      React.useEffect(() => {
        let live = true
        void loadPanelEntry().then(() => {
          if (live) sync()
        })
        return () => {
          live = false
        }
      }, [sync])

      const choose = React.useCallback(
        async (next) => {
          // A ref, not the state value: two clicks inside the same render would both read
          // the pre-click seat and issue two writes.
          if (busyRef.current || next === currentPanelEntry()) return
          busyRef.current = true
          setBusy(true)
          try {
            await setPanelEntry(next)
            setWriteFailed(false)
          } catch (error) {
            console.error('[mcp-control] 切换面板入口失败：', error)
            setWriteFailed(true)
          } finally {
            busyRef.current = false
            setBusy(false)
            sync()
          }
        },
        [sync],
      )

      if (view === 'summary') {
        return h('span', null, `${t('panelEntryTitle')} · ${t(PANEL_ENTRY_LABEL[entry])}`)
      }

      const description = writeFailed
        ? t('panelEntryWriteFailed')
        : readFailed
          ? t('panelEntryReadFailed')
          : t('panelEntryDesc')

      return h(
        'div',
        { className: `${CLASS_PREFIX}card` },
        h(
          'div',
          { className: `${CLASS_PREFIX}cardText` },
          h('div', { className: `${CLASS_PREFIX}cardTitle` }, t('panelEntryTitle')),
          h('div', { className: `${CLASS_PREFIX}cardDesc` }, description),
        ),
        h(
          'div',
          { className: `${CLASS_PREFIX}seg`, role: 'group', 'aria-label': t('panelEntryTitle') },
          PANEL_ENTRY_VALUES.map((value) =>
            h(
              'button',
              {
                key: value,
                type: 'button',
                className:
                  entry === value
                    ? `${CLASS_PREFIX}segBtn ${CLASS_PREFIX}segOn`
                    : `${CLASS_PREFIX}segBtn`,
                'aria-pressed': entry === value ? 'true' : 'false',
                disabled: busy,
                onClick: () => {
                  void choose(value)
                },
              },
              t(PANEL_ENTRY_LABEL[value]),
            ),
          ),
        ),
      )
    }

    /**
     * Register the console's panel slots and hold the two seats mutually exclusive.
     *
     * The `main` key is registered unconditionally: while the console lives in the
     * settings page nothing dispatches it, and having it already present means flipping
     * the seat never depends on a mount having happened first.
     */
    function registerPanelEntries(ctx, slots) {
      ctx.effect(
        () =>
          slots.inject('main', () =>
            slots.register({ name: 'main', key: PANEL_KEY }, () => h(McpControlPage, { ctx })),
          ),
        'mcp-control.main-panel',
      )

      // Removing the row that is currently selected would leave the main column pointing
      // at a panel that no longer exists, so the row is deselected before it goes away.
      let layout
      try {
        ctx.inject(['layout'], (scoped) => {
          layout = scoped.layout
          return () => {
            layout = undefined
          }
        })
      } catch (error) {
        console.warn('[mcp-control] 未能取得 layout 服务，注销侧栏入口时将无法自动取消选中：', error)
      }

      function deselectIfActive() {
        try {
          if (!layout || typeof layout.panelInfo?.getSnapshot !== 'function') return
          if (layout.panelInfo.getSnapshot().activePanelId !== PANEL_KEY) return
          layout.selectPanel(null)
        } catch (error) {
          console.warn('[mcp-control] 取消选中侧栏入口失败：', error)
        }
      }

      // One seat: present while `visible`, absent otherwise. `stopRow` doubles as the
      // state flag — holding the disposer IS being registered — so the two can never
      // disagree about whether the row currently exists.
      function seat(slotName, registration, component) {
        let stopRow
        return (visible) => {
          if (visible && stopRow === undefined) {
            stopRow = slots.register(Object.assign({ name: slotName }, registration), component)
            return
          }
          if (!visible && stopRow !== undefined) {
            const stop = stopRow
            stopRow = undefined
            stop()
            if (slotName === 'sidebar.panellist') deselectIfActive()
          }
        }
      }

      const label = () => (detectLang(ctx) === 'zh' ? TEXT.pageTitle.zh : TEXT.pageTitle.en)

      const syncSidebarRow = seat(
        'sidebar.panellist',
        { id: PANEL_KEY, order: SIDEBAR_ORDER, label },
        McpControlSidebarIcon,
      )
      const syncSettingsSection = seat(
        'settings.section',
        { id: PANEL_KEY, order: 70, label },
        () => h(McpControlPage, { ctx }),
      )

      // Which seat exists is a function of the stored preference, so the subscriber is the
      // driver: every change re-evaluates both seats. The first evaluation runs before the
      // host has answered, which is exactly why it must render the default rather than
      // render nothing — a blank sidebar that fills in a moment later looks like a bug.
      //
      // Returns the `slots.inject` callback (setup → disposer), not the disposer itself:
      // handing the disposer over as the callback would run the teardown instead of the
      // setup.
      function driveSeat(sync, visibleNow) {
        return () => {
          let disposed = false
          const unsubscribe = subscribePanelEntry(() => sync(visibleNow()))
          sync(visibleNow())
          void loadPanelEntry().then(() => {
            if (disposed) return
            sync(visibleNow())
          })
          return () => {
            disposed = true
            unsubscribe()
            sync(false)
          }
        }
      }

      ctx.effect(
        () => slots.inject('sidebar.panellist', driveSeat(syncSidebarRow, panelEntryShowsSidebar)),
        'mcp-control.sidebar-row',
      )
      ctx.effect(
        () => slots.inject('settings.section', driveSeat(syncSettingsSection, panelEntryShowsSettings)),
        'mcp-control.settings-section',
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      let slots
      try {
        slots = ctx.get('slots')
      } catch (error) {
        slots = undefined
      }
      if (!slots) return

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', STYLE_ID)
        style.textContent = styles()
        document.head.appendChild(style)
        return () => {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'mcp-control.styles')

      registerPanelEntries(ctx, slots)

      // Keyed by the package name, matching how the host dispatches a bundle's own page.
      ctx.effect(
        () =>
          slots.inject('plugins.bundle.config', () =>
            slots.register(
              { name: 'plugins.bundle.config', key: PACKAGE, inject: () => ({ ctx }) },
              McpControlPanelEntryCard,
            ),
          ),
        'mcp-control.bundle-config',
      )
    }

    module.exports = { inject, apply }
    return module.exports
  },
})
