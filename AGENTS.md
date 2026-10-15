# AGENTS.md — maintenance contract for `dsh-mcp-control`

Fork of [`dsh-mcp-toggle`](https://github.com/Zenjibad/dsh-mcp-toggle) (MIT, v1.0.1).
The upstream is unmaintained; this copy is the living one. Read this before changing
anything — several invariants here are not obvious from the code and were established by
reading DSH's own shipped modules.

## Shape

Plain JavaScript, **no build step, no dependencies**. Two halves:

| File | Runs where | How it is loaded |
| --- | --- | --- |
| `index.js` | host (Node) | the loader imports it directly as an ESM module |
| `client.js` | browser | a ModuleLoader **CJS closure** — `window.__ModuleLoader__.load({ id, factory })` with a manual `module`/`exports` prelude |

`client.js` is hand-written, not bundled. Keep the wrapper byte-shape: the ModuleLoader
hands `factory` a `require` that resolves the module table (`react`, …) and takes
`module.exports` back. Do not "modernise" it to ESM and do not add a bundler — the fork's
whole point is that it installs and runs with zero toolchain.

`index.js` exports exactly one plugin form: `export function apply(ctx, config)`, plus
`export const name` and `export const inject`. The alternative form (a service class as
`default`) must not be mixed in — the loader rejects a module that presents both.

## The three facts that drive the design

**1. Disabling a loader entry really unregisters its tools — that is the entire value.**

`cordis-plugin-loader`'s `Entry#update()` disposes the entry's fiber when `disabled`
becomes true, which runs `dsh-mcp-client`'s `ctx.effect` cleanup, which closes the
transport *and* calls every `ctx.tools.register` disposer. So the `mcp__<server>__*`
tools leave the registry entirely and stop riding in every request. This is not
cosmetic hiding; re-enabling starts a fresh connection.

There is **no lazy registration path** in `dsh-mcp-client` (`syncTools` →
`listTools({cacheMode:"refresh"})` → `ctx.tools.register` per tool). So the only lever
that reduces cost is unregistering. Do not add a "hide but keep registered" mode and
describe it as saving tokens — it would not.

**2. The HOME layer outranks the profile layer, so that is where overrides go.**

Composition order is `bundle → profile cordis.patch.yml → $DSH_HOME/cordis.patch.yml →
overlays`. MCP rows are commonly split across both files, so a profile-layer write can be
shadowed and appear to do nothing. `resolveHomePatchPath()` honours `DSH_HOME` and
defaults to `~/.dsh/cordis.patch.yml`.

**3. Write an override row, never edit the row you found.**

An MCP row typically lives inside an `insert:` list. Editing it in place would mutate a
row the *host's own installer* wrote. Instead the plugin appends a separate top-level
`- id: <rawId>` / `  disabled: <bool>` row. This is correct because of how the shipped
applier works (`@deepseek-ai/cordis-plugin-include/lib/index.js`, `applyEntryPatches`):

- inserted entries are indexed **as they are added**, so a later id-targeted patch
  reaches a row an earlier insert created — the override must therefore come **after**
  the insert, which `upsertDisabled` guarantees;
- a patch's `name` assertion is skipped when the patch declares no `name`, so a
  `disabled`-only override is accepted;
- overrides are applied key-by-key, so `disabled` cannot disturb `config`.

`test/patch-contract.test.mjs` pins all three of these. If a DSH update breaks it, that
test fails first — treat it as the canary, not as a stale test.

## Repository layout

```
index.js                     host half — the whole HTTP API and the write path
client.js                    browser half — the settings panel (hand-written CJS closure)
cordis.patch.yml             the bundle patch that inserts this plugin's row
locale/{en,zh}.json          display metadata (meta.title / meta.description)
icon.svg                     panel icon
test/                        six dependency-free suites, run by `npm test`
tools/publish-release.mjs    release-flow step 5 (tag ≠ Release)
docs/release-notes-v*.md     one bilingual file per released version
README.md / README.en.md     user-facing, structurally mirrored
SECURITY.zh.md / SECURITY.md threat model, mirrored
DECISION.md                  why this fork exists, and what it refuses to do
PROJECT_STATUS.md            where it stands, and what is deliberately unbuilt
RELEASING.md                 the release flow, in order
```

`test/` — the suite names are load-bearing because `release-consistency.test.mjs` cross-checks
them against `package.json`'s `test` script and against the README test tables:

| Suite | Guards |
| --- | --- |
| `test/unit.test.mjs` | every pure helper, all `upsertDisabled` branches, CRLF, quoting |
| `test/patch-contract.test.mjs` | the applier canary (independent reimplementation) |
| `test/write-path.test.mjs` | backup, idempotence, live-first-persist-second |
| `test/package-contract.test.mjs` | manifest: version parity, `files` covers runtime, no deps, CJS shape |
| `test/docs-parity.test.mjs` | bilingual structure, shared numbers, no BOM/CRLF |
| `test/release-consistency.test.mjs` | test chain ↔ README tables ↔ release notes |

## Release flow

`git push origin vX.Y.Z` pushes a **tag**; a GitHub **Release** is a separate object that
must be created separately. The sibling project shipped 14 versions with tags and no
Releases before anyone noticed. So step 5 is a command, not a memory:

```
node tools/publish-release.mjs --check   # exit 1 = a version has a tag but no Release
```

Versions move **only when plugin behaviour changes** — docs, tests, CI and `tools/` land on
`main` directly. Full flow in `RELEASING.md`; there is also a real TLS gotcha documented
there (`--use-system-ca`) for hosts with a certificate-inspecting proxy.

## Rules

1. **`upsertDisabled` is line-wise and must stay that way.** Exactly one top-level row per
   id, ever. It must never rewrite the file wholesale, never reorder existing lines, and
   never touch a row inside an `insert:` list. Preserve CRLF-vs-LF and trailing newline.
2. **Live first, persist second.** `entry.update({disabled})` then `persistDisabled()`.
   If persistence fails the live toggle still stands and the response must report
   `persisted: false` + `persistError` — never a silent success.
3. **Entry-level `update` only.** Never call `EntryTree.update`: it calls `tree.write()`
   and flattens every patch into the concrete config, destroying the layering.
4. **Raw id vs prefixed id.** Patch rows use the **unprefixed** config id (`rea-mcp`); the
   loader's entry id is `include:rea-mcp`. `rawId` comes from `entry.options.id ?? entry.id`
   with the prefix stripped. Mixing them up produces a patch row that matches nothing.
5. **Identify MCP rows by plugin name**, not by position in the file:
   `entry.options.name === '@deepseek-ai/dsh-mcp-client'`. The display label is
   `entry.options.config.serverName`.
6. **`summarizeSchemas` bills only `mcp__` names** and splits at the first `__` after the
   prefix, so a built-in tool is never attributed to a server. It measures the
   *model-facing* projection — `name` + `description` + `JSON.stringify(parameters)` —
   which is why an advertised `outputSchema` is correctly absent (DSH forwards only
   `parameters`). Measured on REA: 785,262 B ≈ 196K tokens/request. `BYTES_PER_TOKEN = 4`
   is a rough constant on purpose; do not present the estimate as exact.
7. **Never throw across the HTTP route.** Every response is JSON, failures included.
   Status map: 400 bad body/non-MCP row, 403 empty `entryId` or locked row, 404 unknown
   entry, 405 wrong method, 500 loader threw, 503 `loader` unavailable. 1 MB body cap.
8. **Locked ids stay locked**: `include`, `cordis:include`, `dsh-mcp-control`,
   `dsh-mcp-toggle`. The plugin must not be able to toggle itself or the patch root.
9. **Client UI**: theme tokens only (`--dsw-alias-*`), no hardcoded colours, no
   `font-family`. Slot `settings.section`, id `mcp-control`, order 70. Use a **fresh** id —
   reusing a shipped one (e.g. `plugins`) would *replace* that section. Keep
   `role="switch"` + `aria-checked` on the toggles.
10. **Bilingual by data, not by branch.** All strings live in the `TEXT` table as
    `{en, zh}` pairs; `detectLang()` only selects. Adding a string means adding both.

## Install / reload

```
dsh plugin --profile desktop add "C:\Users\21450\.dsh\plugins\dsh-mcp-control"
```

**Check how the profile points at this directory; do not assume.** Two shapes were both
observed on this host, and they behave differently:

| Profile dependency spec | `node_modules/dsh-mcp-control` | Effect |
| --- | --- | --- |
| `link:<dir>` | **symlink** to this directory | the source *is* what runs; `files` filters nothing |
| `file:<dir>` | a **`files`-filtered copy** | source edits are invisible until re-added |

Verify with `fs.readlinkSync` / `fs.realpathSync`, not by reading the manifest. After the
first `install_bundle` here the spec was `link:`, so `test/`, `tools/` and `.git` are all
visible through `node_modules` — harmless, but it means a stray runtime import of a file
outside `files` would work locally and break for anyone installing from npm. That is what
`test/package-contract.test.mjs` checks: everything the runtime needs is in `files`.

A **patch-file** change hot-applies: `dsh-hmr` watches `profile.patchPath` and the home
patch, so toggling takes effect with no restart (that is the whole point of the plugin).

A **source** change to `index.js` or `client.js` does **not** hot-apply on this host.
Measured, not assumed: this profile's merged config has

```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  config:
    root: []          # ← no module watch roots
```

`dsh-hmr` builds its module watcher as `watch(root, …)`; with `root: []` chokidar watches
nothing, so `hmr/deliver` never fires for a plugin source. Node's ESM registry also keys
modules by URL and never re-evaluates one, so re-resolving the same path returns the
cached instance. **Bouncing the bundle through `plugin_manager set_bundle` does not fix
this** — it re-reconciles the patch rows, but the module stays cached. Expect to restart
DSH after editing a host half. The client half is fetched by the browser, so a hard
refresh is enough there.

**The consequence is worse than "my edit is not live yet", and it actually happened here.**
The plugin was first installed *before* the backup code existed. A toggle served by that
cached module at 22:05 wrote `disabled: true` into the home patch **and left no
`cordis.patch.yml.backup-*` file**, because the running code had no `backupPatchFile` at
all. Nothing in the response said so. So after any change to the write path:

1. confirm `install_bundle` returned `application: "applied"` — `"restart-required"` means
   the old code is still serving requests;
2. if it says `restart-required`, **do not treat the hardening as deployed**, and do not
   exercise the panel until DSH restarts;
3. when a write path changes, re-verify the artefact that proves it (here: that a
   `.backup-*` file appears), not just the response body.

"`persisted: true`" only ever means the file changed. It has never meant the code that
changed it was the code you just wrote.

If the panel is missing after install, check whether the bundle's own `cordis.patch.yml`
was picked up (the row is `mcp-control`, **not** `dsh-mcp-control`) — the bundle patch is
what inserts it, and the profile's `cordis.patch.yml` is not involved.

## Verifying a change

```
npm test          # 62 tests across 6 suites, no deps
```

Then the live route, which is the real acceptance check:

```
curl -s http://127.0.0.1:19387/mcp-control/api
```

and confirm the round trip — disable a server, check `totals.mcpToolCount` drops by that
server's tool count ("registered" is the only honest proof the saving is real), then
re-enable and confirm it returns. Also confirm `$DSH_HOME/cordis.patch.yml` grew by
exactly one override row and the original `insert:` block is byte-identical.

## Local environment notes

- Host route is served by the DSH web server, so the panel's fetch is same-origin; no CORS
  handling is needed. `inject = ['webServer']`.
- On this machine the desktop profile is the live one (`profiles/desktop`), and REA is a
  **home-layer** row (`~/.dsh/cordis.patch.yml`) — so the layer badge shows `home` and the
  override lands in the same file.
- Read DSH's shipped modules out of `app.asar` with
  `ELECTRON_RUN_AS_NODE=1 "D:/dsh/DeepSeek Harness.exe" <script>.js`: normal file tools
  cannot traverse the archive, and in that mode stdout carries an asar bootstrap blob, so
  write results to an absolute file path instead of printing them.
