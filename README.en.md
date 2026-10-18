# dsh-mcp-control — toggle each MCP server from Settings, and see what it costs you every turn

English | [中文](README.md)

> **This is a maintained fork of [`dsh-mcp-toggle`](https://www.npmjs.com/package/dsh-mcp-toggle).**
> Upstream has been dormant for a long time (last release 1.0.1). It got the skeleton
> right, but it offers a single switch and writes `$DSH_HOME/cordis.patch.yml`
> with **no backup and no approval gate** — one bad write and no profile can boot.
> This fork keeps the skeleton and adds the three things upstream lacked:
> **per-server token cost is visible**, **every write is backed up first**, and
> **you can act on all servers at once**.

---

## What it is

An MCP server in DSH is a **resident cost**. Once connected, the schema of every one
of its tools — name, description, parameters — enters the **stable prefix of every
single request**. The heavier the server, the more it costs:

| Server | Tools | Model-facing schema bytes | Per turn |
|---|---|---|---|
| `rea` (measured on this machine) | 207 | 766,054 B | **~191K tokens** |

That is not an estimate; it is what the panel reads back from `ctx.tools.schemas()`.
Inside a 320K-token prefix, one server owns three fifths of it — which decides whether
a request can carry anything else at all.

The plugin adds one settings page (**Settings → MCP Control**) that does three things:

1. **Show** how many tools each MCP server has registered, how many bytes that is,
   and what it costs in tokens.
2. **Toggle** it — disabling genuinely **unregisters** all of its tools and saves the
   **full** amount, rather than hiding them.
3. **Remember** the choice by writing an override row into `$DSH_HOME/cordis.patch.yml`,
   so it survives a restart.

## What it is not

- **Not** fake saving. "Hidden but still registered" is not a mode here — see
  *Disabling really saves* below.
- **Not** an MCP server manager: it never adds, edits, or deletes a server definition.
  It only changes the **enabled state**. To add a server, keep using an official
  `@deepseek-ai/dsh-mcp-client` row or the connector plugin you already use.
- **Not** a connector panel. Plugins like `dsh-mcp-connector` enumerate only the
  connections **they** created. This one enumerates loader entries, so it sees **every
  MCP row in every layer**, whatever put it there.
- **No build step and no dependencies.** Plain JS: `index.js` + `client.js`.

## Do you need it

Only if you have MCP servers that are **numerous enough or heavy enough to be worth
switching**. The test:

- Open the panel and look at the *per turn* column. **A single light server** (a few
  dozen tools, tens of kilobytes) **does not justify it** — the tokens you save are
  worth less than the cost of one more plugin.
- **Heavy servers pay off** (hundreds of tools, hundreds of kilobytes). REA, an MCP
  that describes itself exhaustively, is the archetype.
- If you never switch MCP combinations between projects, commenting the row out of the
  patch is simpler than installing anything.

## Disabling really saves — the mechanism and the evidence

Whether disabling an MCP entry actually saves tokens has exactly one test: **do the
tools really disappear from the registry?**

The chain below was verified line by line in the DSH sources and then measured live:

```
loader: Entry#update({disabled:true})
  → the entry's fiber is disposed
    → @deepseek-ai/dsh-mcp-client's ctx.effect cleanup runs
      → the stdio transport is closed
      → and the disposer it registered per tool is called
        → the ctx.tools.register registration is withdrawn
```

The load-bearing fact: `dsh-mcp-client` has **no lazy registration path**. There is one
route only — `syncTools` → `listTools({cacheMode:"refresh"})` → `ctx.tools.register`
per tool. So "disabled" necessarily means "unregistered". There is no intermediate state
where the entry is off but the schemas are still around.

Measured on this machine (desktop profile, server `rea`):

| Step | Result |
|---|---|
| Before | `enabled: true`, `fiberPhase: active`, `tools: 207`, `estTokens: 191514` |
| After disable | `enabled: false`, `fiberPhase: null` (fiber disposed), **`tools: 0`**, `estTokens: 0` |
| After re-enable | `enabled: true`, `fiberPhase: active`, `tools: 207`, `estTokens: 191514` |

`tools: 0` is the point: it comes from `ctx.tools.schemas()`, the table of what is
**actually registered right now**. It is not this plugin's own accounting — it is the
tool service's answer.

> Consequently this plugin **does not implement a "hide but keep registered" mode**.
> Such a mode saves nothing while making you believe it did — this repository refuses
> to ship that (see `DECISION.md`).

## Why the HOME layer

DSH composes patches in this order:

```
bundle  →  profile cordis.patch.yml  →  $DSH_HOME/cordis.patch.yml  →  overlays
```

**The HOME layer outranks the per-profile layer.** MCP rows are typically split across
both (REA, for instance, lives in HOME). Write the override into the profile and the
HOME row shadows it — you get a panel that changed something and had no effect.

So the override goes to **`$DSH_HOME/cordis.patch.yml`** (honouring the `DSH_HOME`
environment variable, defaulting to `~/.dsh/cordis.patch.yml`). The panel also lists
**every candidate layer** it checked and whether each one exists.

## Never edit your row — append an override row instead

The panel **never rewrites** the MCP row it finds. That row normally sits inside an
`insert:` list written by the official installer.

What it does instead is append a separate override row:

```yaml
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        # ...

- id: rea-mcp          # ← the only line this plugin added
  disabled: true
```

That works because DSH's built-in patch applier, `applyEntryPatches`, has three
properties:

1. Inserted entries are **indexed as they are added**, so a *later* patch can target an
   *earlier* insert → the override **must come after** the insert, which
   `upsertDisabled()` guarantees;
2. A patch that declares **no `name` skips the name assertion** → the override needs
   only `id` + `disabled`;
3. Overrides apply **key by key** → `disabled` cannot disturb `config`, so your server
   configuration is untouchable.

All three are pinned in `test/patch-contract.test.mjs`, which reimplements that
semantics independently and then asserts the YAML this plugin emits satisfies it.
**That test is a canary, not a leftover.**

The write is **line-wise**: one top-level override row per id, ever; the `disabled:`
line is rewritten in place; nothing is reordered, the file is never rewritten wholesale,
rows inside an `insert:` list are never touched, and CRLF-vs-LF plus the trailing newline
are preserved. **If the file is already in the target state, not one byte changes.**

## Safety

Upstream's weakest point was that it **did not back the patch up before writing**.
This fork does.

- **Backup before write.** Before each write the **original bytes** are saved as
  `cordis.patch.yml.backup-<ISO timestamp>-<nn>` in the same directory, and the response
  reports `backupPath`. The sequence suffix is not decoration: the timestamp has only
  millisecond resolution, so a second write in the same millisecond used to **overwrite**
  the first backup — CI on Linux really did lose four copies that way.
- **Automatic pruning.** Only the newest **10** are kept; older ones are dropped by
  filename order.
- **A failed backup does not block.** Backups are best-effort. If one genuinely fails,
  the toggle still takes effect and the response carries `backupError` — it **never
  pretends the backup succeeded**.
- **Live first, persist second.** The runtime change happens first (taking effect
  immediately), then the file is written. If persistence fails, the response reports
  `persisted: false` plus `persistError`: the runtime state is real and the on-disk
  state is not, and the two are reported separately.
- **Nothing is ever thrown across the API.** Every path returns JSON.
- **Locked entries.** `include`, `cordis:include`, `dsh-mcp-control`, `dsh-mcp-toggle`
  are always 403.
- **1 MB request-body cap.**
- **Only the switch is touched.** No server definition is added, edited, or deleted, and
  `cordis.yml` is never touched.

To roll back: copy the file that `backupPath` points at back over `cordis.patch.yml`.

## Install

```bash
# from GitHub (preferred — the owner-qualified name avoids a same-name repo)
dsh plugin --profile desktop add github:ZiYuan258/dsh-mcp-control

# or from a local directory (use this while developing; re-run add after each change)
dsh plugin --profile desktop add "<absolute path to this directory>"
```

- The plugin row id is **`mcp-control`**, not the package name — the short id is what
  `cordis.patch.yml` inserts.
- **The client half loads cold.** After installing, and after changing `client.js`,
  **hard-refresh** the page. The host's HMR watches **only its own** patch files and
  does **not** watch sources inside this plugin's directory; changing `index.js` or
  `client.js` needs another `add` before it is projected into the profile.
- Host route: `GET|POST http://127.0.0.1:<port>/mcp-control/api`.

## Tests

```bash
npm test
```

```
test/unit.test.mjs                 pure functions (every upsertDisabled branch, CRLF, quoted ids)
test/patch-contract.test.mjs       emitted YAML must satisfy real DSH patch semantics (canary)
test/write-path.test.mjs           write-path contract: backups, idempotence, no fake success
test/package-contract.test.mjs     version consistency, files whitelist, no runtime @deepseek-ai dep
test/docs-parity.test.mjs          zh/en README section parity, bilingual release-note structure
test/release-consistency.test.mjs  every version has a release note
```

Zero dependencies, using Node's built-in `node:test`.

## HTTP API

`GET /mcp-control/api` → a snapshot:

```json
{
  "ok": true,
  "servers": [{
    "entryId": "include:rea-mcp",
    "rawId": "rea-mcp",
    "serverName": "rea",
    "enabled": true,
    "fiberPhase": "active",
    "toolCount": 207,
    "schemaBytes": 766054,
    "estTokens": 191514,
    "breakdown": { "nameBytes": 6148, "descriptionBytes": 92265, "parameterBytes": 667641 },
    "layer": "home"
  }],
  "totals": { "servers": 1, "enabled": 1, "disabled": 0, "mcpToolCount": 207,
              "mcpSchemaBytes": 766054, "mcpEstTokens": 191514,
              "activeEstTokens": 191514, "bytesPerToken": 4 },
  "patchPath": "C:\\Users\\<you>\\.dsh\\cordis.patch.yml",
  "layersReadable": true
}
```

`POST /mcp-control/api`, one of two shapes:

```json
{ "entryId": "include:rea-mcp", "disabled": true }
{ "action": "disable-all" }
```

Single-toggle response: `{ ok, entryId, rawId, serverName, disabled, fiberPhase,
persisted, persistMode, patchPath, backupPath?, persistError? }`

| Status | Meaning |
|---|---|
| 400 | malformed body / `disabled` is not a boolean / target is not an MCP row |
| 403 | empty `entryId` / entry is locked |
| 404 | unknown entry |
| 405 | method not allowed |
| 500 | the loader threw |
| 503 | the loader service is unavailable |

## Two honest caveats

**One: `estTokens` is a division, not a tokenizer.** It is `bytes / 4`. Mixed scripts,
JSON structure, and repeated fields all push it away from the true value, typically by
±15%. Its job is **ranking and order of magnitude** — *is this server worth keeping
resident* — not *exactly how many tokens did this turn cost*. Trust the bill for
absolutes.

**Two: it measures the model-facing projection, not the raw MCP payload.** The plugin
counts only `name` + `description` + `JSON.stringify(parameters)`. If an MCP tool
advertises an `outputSchema`, **it does not enter the model context** (DSH forwards only
`parameters`), so this plugin **does not count it**. That is exactly why roughly 73% of
REA's raw 3.0 MB payload is excluded — the panel's 785 KB is the part that **actually
enters the context**, far smaller than the raw `tools/list`, and far more honest.

## Layout

```
index.js          host half: route + enumeration + cost accounting + persist (line-wise upsert + backups)
client.js         browser half: the settings page (hand-written ModuleLoader CJS closure, no build step)
cordis.patch.yml  inserts the plugin row mcp-control
locale/           en.json / zh.json — title and description in the plugin list
icon.svg          plugin icon
AGENTS.md         the maintenance contract (read this before changing the repo)
DECISION.md       why the fork, why an override row, why no "fake saving" mode
SECURITY.md       security model and threat boundaries (English)
SECURITY.zh.md    the same, in Chinese
docs/             release notes
test/            zero-dependency tests (node:test)
```

## License and attribution

MIT, see `LICENSE`.

The skeleton comes from **`dsh-mcp-toggle`**, Copyright (c) 2026 **Zenjibad** (MIT).
Entry enumeration, identifying MCP rows by `entry.options.name`, the way the
`settings.section` slot is registered, and above all the judgement to use
`Entry#update` and **not** `EntryTree.update` all originate upstream. That last one
matters: `EntryTree.update` calls `tree.write()`, which **flattens** the patches into
`cordis.yml` and destroys the point of a patch layer. Upstream hit that trap; this fork
inherits its conclusion.

This fork's additions: cost visibility, backups before writing, bulk actions, an
idempotent write path, a bilingual UI, and a test suite that pins DSH's patch semantics
so they cannot drift unnoticed.
