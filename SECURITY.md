# Security model

[中文](SECURITY.zh.md) | English

This document states what `dsh-mcp-control` **can actually change**, what protection
exists before it changes anything, how failures are surfaced, and where its threat
boundary lies. The goal is to let you decide whether to trust it — not to reassure you.

## 1. What it can do

Exactly one thing: **append or rewrite a single override row at the end of
`$DSH_HOME/cordis.patch.yml`**, carrying only the two keys `id` and `disabled`.
It writes no other file and no other location.

The write is line-wise: one top-level override row per id, ever; the `disabled:` line
is rewritten in place; nothing is reordered, the file is never rewritten wholesale,
rows inside an `insert:` list are never touched, and CRLF-vs-LF plus the trailing
newline are preserved.

## 2. Which file it writes

`$DSH_HOME/cordis.patch.yml` — **the `DSH_HOME` environment variable wins**,
otherwise `~/.dsh/cordis.patch.yml`.

That file was chosen because patches compose as
`bundle → profile cordis.patch.yml → $DSH_HOME/cordis.patch.yml → overlays`,
and **HOME outranks profile**. An override written to the profile layer is shadowed by
the HOME layer, producing a silent failure where the panel changes something and the
setting reverts on restart.

It is a file **shared by every profile**. That is exactly what makes it dangerous, and
it is why section 4 exists.

## 3. What it does not do

- It does not add, edit, or delete any MCP server definition (it never touches `config`
  or `name`).
- It does not read or write a connector plugin's private records
  (`mcp_connector.json` and the like).
- It does not touch `cordis.yml`.
- It does not use `EntryTree.update` — that calls `tree.write()`, which **flattens** the
  patch layer into `cordis.yml`.
- It does not execute MCP tools and does not proxy MCP traffic.
- It does not use the network. There is not one network request in the plugin.
- It does not read any file inside your workspace.

## 4. Backup and rollback

**Before every write**, the **original bytes** are saved beside the file:

```
cordis.patch.yml.backup-2026-10-15T14-32-07-123Z-00
```

- Only the newest **10** are kept; older ones are dropped by filename order.
- Backups are **best-effort**: a failure does not block the toggle, but the response
  carries `backupError`. **Pretending a backup succeeded is more dangerous than having
  none**, so that field must be filled in honestly.
- The response carries `backupPath`; rolling back means copying that file back over
  `cordis.patch.yml`.

## 5. How failures are surfaced

- **Live first, persist second.** The order cannot be reversed: reversed, you get a
  state where the disk says `disabled: true` while the server is still billing, and the
  user has no way to tell. In this order the worst case is that the change applies now
  and reverts on restart, with the response explicitly carrying `persisted: false` and
  `persistError`.
- **The runtime and on-disk states are reported separately**, never merged into one `ok`.
- **Nothing is ever thrown across the API**: every path returns JSON. Exceptions are
  caught and turned into a log line plus a status code.

| Status | Meaning |
|---|---|
| 400 | malformed body / `disabled` is not a boolean / target is not an MCP row |
| 403 | empty `entryId` / entry is locked (`include`, `cordis:include`, this plugin itself) |
| 404 | unknown entry |
| 405 | method not allowed |
| 500 | the loader threw |
| 503 | the loader service is unavailable |

The request-body cap is **1 MB**; anything larger is rejected before JSON parsing.

## 6. HTTP surface and binding

The route is `GET|POST http://127.0.0.1:<port>/mcp-control/api`, mounted on DSH's own
host web server — which listens on loopback only and **adds no new listening port**.

Access control is therefore the host web server's access control. Anything that can
reach that port can call this route. That is **intentional** (the settings panel is
same-origin and has to call it), but it means:

- If the local loopback port is forwarded outward (SSH port forwarding, container
  networking, a proxy), this route has **no additional token check**. Treat the host's
  port as a sensitive surface.
- This plugin implements no CSRF protection. It is same-origin with the panel, and
  DSH's own session mechanism is the boundary at that layer.

## 7. Threat model

**What it defends against:**

- **Mistakes**: every write has a backup, and the response names it.
- **Corrupting a shared file**: line-wise rewriting plus no-op writes (when the file is
  already in the target state, not one byte changes).
- **Silent failure**: writing to the wrong layer is reported explicitly (the panel lists
  every candidate layer it checked and whether each exists).
- **Fake success**: a failed backup and a failed persist each report their own field.
- **Capability loss**: it moves only the switch, never a server definition; deleting the
  override row restores everything.

**What it does not defend against:**

- A local process that can already read and write `$DSH_HOME` — it could do the same
  thing without this plugin.
- Anything that can already reach the host's loopback port.
- An **incompatible** change to DSH's patch semantics. `test/patch-contract.test.mjs`
  mitigates this by independently reimplementing `applyEntryPatches` and asserting this
  plugin's output satisfies it. But if DSH changes semantics and the test is not updated
  with it, the test gives **stale reassurance** — it pins *the semantics we understood*,
  not DSH itself.
- A malicious MCP server. This plugin does not parse, forward, or execute MCP traffic.
  All it reads is the byte length of tool **schemas**.

## 8. Reporting a vulnerability

Please open an issue: <https://github.com/ZiYuan258/dsh-mcp-control/issues>.

If the problem is **anything that can corrupt `cordis.patch.yml`**, say so in the title;
it will be handled first, because damage to that file affects the boot of every profile.
