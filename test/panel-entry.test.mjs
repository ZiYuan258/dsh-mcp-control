// Panel entry: which seat the console occupies, and the two slots that express it.
//
// The host half and the client half are checked together on purpose — the feature only
// exists where they agree. The host validates and stores one of two strings; the client
// reads that same string back and decides which slot to register. A change to one side
// that is not mirrored in the other leaves a console that is either unreachable or
// duplicated, so the halves are tested against the same vocabulary.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

import {
  DEFAULT_PANEL_ENTRY,
  PANEL_ENTRY_VALUES,
  isPanelEntry,
  readState,
  resolveStatePath,
  sanitizePanelEntry,
  writePanelEntry,
} from '../index.js'

const CLIENT = new URL('../client.js', import.meta.url)

/* -------------------------------------------------------------------------- */
/* host half — the vocabulary and the state file                              */
/* -------------------------------------------------------------------------- */

test('only the two seats are seats', () => {
  assert.deepEqual(PANEL_ENTRY_VALUES, ['sidebar', 'settings'])
  for (const value of PANEL_ENTRY_VALUES) assert.equal(isPanelEntry(value), true)

  const notSeats = [undefined, null, '', 'Sidebar', 'SIDEBAR', ' sidebar', 'sidebar ', 'both', 0, 1, true, {}, []]
  for (const value of notSeats) {
    assert.equal(isPanelEntry(value), false, `${JSON.stringify(value)} must not count as a seat`)
  }
})

test('the default is itself a seat, and it is the settings page', () => {
  assert.ok(PANEL_ENTRY_VALUES.includes(DEFAULT_PANEL_ENTRY))
  // Pinned deliberately. Every install that predates this option renders in the settings
  // page, so defaulting to the sidebar would silently relocate a page on upgrade. The
  // reference implementation defaults the other way; this one must not.
  assert.equal(DEFAULT_PANEL_ENTRY, 'settings')
})

test('a value that is not a seat normalises to the default', () => {
  assert.equal(sanitizePanelEntry('sidebar'), 'sidebar')
  assert.equal(sanitizePanelEntry('settings'), 'settings')

  for (const value of [undefined, null, '', 'Side', 'sideways', 3, true, {}, ['sidebar']]) {
    assert.equal(sanitizePanelEntry(value), DEFAULT_PANEL_ENTRY)
  }
})

test('the state file lives under DSH_HOME and is not the patch layer', () => {
  const home = path.join(os.tmpdir(), 'mcp-control-state-probe')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const file = resolveStatePath()
    assert.equal(file, path.join(home, 'dsh-mcp-control', 'state.json'))
    // A preference kept in cordis.patch.yml would make every click re-apply a composition.
    assert.equal(file.includes('cordis.patch.yml'), false)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('a missing state file is the ordinary first-run state', async () => {
  await withState(async () => {
    const state = await readState()
    assert.equal(state.ok, true)
    assert.equal(state.panelEntry, DEFAULT_PANEL_ENTRY)
    assert.equal(state.error, undefined)
  })
})

test('a written seat survives a round trip, and the file keeps one key', async () => {
  await withState(async () => {
    const written = await writePanelEntry('sidebar')
    assert.equal(written.ok, true)
    assert.equal((await readState()).panelEntry, 'sidebar')

    await writePanelEntry('settings')
    assert.equal((await readState()).panelEntry, 'settings')

    const raw = JSON.parse(await readFile(resolveStatePath(), 'utf8'))
    assert.deepEqual(Object.keys(raw), ['panelEntry'])
  })
})

test('writing leaves no temporary file behind', async () => {
  await withState(async () => {
    await writePanelEntry('sidebar')
    const names = await readdir(path.join(process.env.DSH_HOME, 'dsh-mcp-control'))
    assert.deepEqual(names, ['state.json'])
  })
})

test('a value that is not a seat is rejected, not coerced, and nothing is written', async () => {
  await withState(async () => {
    for (const bad of ['Sidebar', 'side', 'both', '', undefined, 7, null]) {
      const result = await writePanelEntry(bad)
      assert.equal(result.ok, false, `${JSON.stringify(bad)} must be refused`)
      assert.equal(result.invalid, true)
    }
    // Refusing must mean refusing: coercing a typo into a seat would move a panel the
    // user never asked to move, and they would have no way to tell.
    assert.equal(existsSync(resolveStatePath()), false)
  })
})

test('a damaged state file is reported, never silently replaced', async () => {
  await withState(async () => {
    const file = resolveStatePath()
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{ not json', 'utf8')

    const state = await readState()
    assert.equal(state.ok, false)
    assert.ok(state.error && state.error.length > 0)
    // Still usable: a broken preference must not take the console down with it.
    assert.equal(state.panelEntry, DEFAULT_PANEL_ENTRY)
    // And still intact: overwriting it would destroy the only evidence of what went wrong.
    assert.equal(await readFile(file, 'utf8'), '{ not json')
  })
})

test('a readable file holding a foreign value falls back without being rewritten', async () => {
  await withState(async () => {
    const file = resolveStatePath()
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ panelEntry: 'floating' }), 'utf8')

    const state = await readState()
    assert.equal(state.ok, true)
    assert.equal(state.panelEntry, DEFAULT_PANEL_ENTRY)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).panelEntry, 'floating')
  })
})

/* -------------------------------------------------------------------------- */
/* client half — which slot actually gets registered                          */
/* -------------------------------------------------------------------------- */

const REACT_STUB = {
  // `flat(Infinity)` because React flattens array children, and a stub that does not would
  // make a correct component look like it renders one child instead of several.
  createElement: (type, props, ...children) => ({ type, props: props ?? null, children: children.flat(Infinity) }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useEffect: () => {},
}

function makeHarness() {
  const rows = []
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
    selectPanel() {},
  }

  const slots = {
    register(registration, component) {
      const row = Object.assign({}, registration, { component })
      rows.push(row)
      let live = true
      return () => {
        if (!live) return
        live = false
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
      if (name === 'locale') return { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} }
      return undefined
    },
    effect(fn) {
      return fn()
    },
    inject(_deps, callback) {
      return callback({ layout })
    },
  }

  return { ctx, rows }
}

/** Boot client.js exactly the way the host does, then run its plugin body. */
async function boot({ panelEntry = 'settings', ok = true } = {}) {
  const source = await readFile(CLIENT, 'utf8')
  let definition = null

  const sandbox = {
    console,
    setTimeout,
    navigator: { language: 'en' },
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
    document: { createElement: () => ({ setAttribute() {}, parentNode: null }), head: { appendChild() {} } },
    fetch: async () => ({ json: async () => (ok ? { ok: true, panelEntry } : { ok: false, error: 'boom' }) }),
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'mcp-control/client.js' })

  assert.ok(definition, 'client.js must hand its definition to window.__ModuleLoader__')
  assert.equal(definition.id, 'dsh-mcp-control')

  const client = definition.factory((name) => {
    if (name === 'react') return REACT_STUB
    throw new Error(`client.js must not require "${name}"`)
  })

  const harness = makeHarness()
  client.apply(harness.ctx)
  // The seat is decided after the host answers, so let the fetch chain settle.
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))

  return { client, rows: harness.rows }
}

const rowFor = (rows, name) => rows.find((row) => row.name === name)

test('the client exports one plugin shape and registers through the slots service', async () => {
  const { client, rows } = await boot()
  // Array.from because the plugin's array comes from the sandbox realm, and deepEqual
  // compares prototypes across realms.
  assert.deepEqual(Array.from(client.inject), ['slots'])
  assert.equal(typeof client.apply, 'function')

  const names = rows.map((row) => row.name).sort()
  assert.deepEqual(names, ['main', 'plugins.bundle.config', 'settings.section'])
})

test('the default seat renders in the settings page, with no sidebar row', async () => {
  const { rows } = await boot({ panelEntry: DEFAULT_PANEL_ENTRY })
  const section = rowFor(rows, 'settings.section')
  assert.ok(section, 'the settings section must exist')
  assert.equal(rowFor(rows, 'sidebar.panellist'), undefined)
  assert.equal(section.id, 'mcp-control')
  assert.equal(typeof section.label, 'function', 'the label must be a thunk so it follows the locale')
})

test("a stored 'sidebar' seat moves the console and drops the settings section", async () => {
  const { rows } = await boot({ panelEntry: 'sidebar' })
  const row = rowFor(rows, 'sidebar.panellist')
  assert.ok(row, 'the sidebar row must exist')
  assert.equal(rowFor(rows, 'settings.section'), undefined)
  assert.equal(row.id, 'mcp-control')
  assert.equal(row.order, 21)
  assert.equal(typeof row.label, 'function')
})

test('the sidebar row and the main panel are addressed by the same id', async () => {
  const { rows } = await boot({ panelEntry: 'sidebar' })
  // Slots: "Each list id addresses the matching main panel" — one string, both jobs.
  assert.equal(rowFor(rows, 'main').key, 'mcp-control')
  assert.equal(rowFor(rows, 'sidebar.panellist').id, rowFor(rows, 'main').key)
})

test('the main panel is registered even while the console sits in the settings page', async () => {
  const { rows } = await boot({ panelEntry: 'settings' })
  // Ready before it is needed, so flipping the seat never waits on a mount.
  assert.equal(rowFor(rows, 'main').key, 'mcp-control')
})

test('the sidebar glyph honours the size the sidebar supplies', async () => {
  const { rows } = await boot({ panelEntry: 'sidebar' })
  const glyph = rowFor(rows, 'sidebar.panellist').component({ size: 22 })
  assert.equal(glyph.type, 'svg')
  assert.equal(glyph.props.width, 22)
  assert.equal(glyph.props.height, 22)
  assert.equal(glyph.props.viewBox, '0 0 16 16')
})

test('a host that does not answer still leaves the console reachable', async () => {
  const { rows } = await boot({ ok: false })
  assert.ok(rowFor(rows, 'settings.section'), 'the fallback seat must be registered')
  assert.equal(rowFor(rows, 'sidebar.panellist'), undefined)
})

test('the switcher rides on the bundle page and stays reachable in either seat', async () => {
  for (const panelEntry of PANEL_ENTRY_VALUES) {
    const { rows } = await boot({ panelEntry })
    const row = rowFor(rows, 'plugins.bundle.config')
    assert.ok(row, `the switcher must exist with the seat at ${panelEntry}`)
    // Keyed by the package name: this is how the host dispatches a bundle's own page, and
    // it is deliberately NOT the plugin's settings section — that section is one of the
    // two seats, so the switcher must not live inside it.
    assert.equal(row.key, 'dsh-mcp-control')
    assert.equal(typeof row.component, 'function')
  }
})

test('the switcher renders a one-liner in summary and a card in the page view', async () => {
  const { rows } = await boot({ panelEntry: 'sidebar' })
  const Switcher = rowFor(rows, 'plugins.bundle.config').component

  const summary = Switcher({ view: 'summary' })
  assert.equal(summary.type, 'span')

  const page = Switcher({ view: 'page' })
  assert.equal(page.type, 'div')

  const group = page.children.find((child) => child && child.props && child.props.role === 'group')
  assert.ok(group, 'the two options must form a labelled group')
  assert.equal(group.children.length, 2)

  const pressed = group.children.filter((child) => child.props['aria-pressed'] === 'true')
  assert.equal(pressed.length, 1, 'exactly one seat is pressed at a time')

  for (const option of group.children) {
    const label = option.children[0]
    assert.equal(typeof label, 'string')
    assert.ok(label.length > 0, 'every option needs a label')
  }
})

async function withState(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mcp-control-panel-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}
