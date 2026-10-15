# v1.0.0 — 从 dsh-mcp-toggle fork 出来的第一个版本

[English](#english) | 中文

这是本仓库的第一个版本，也是一个 **fork**：骨架来自 `dsh-mcp-toggle@1.0.1`，
它给出的判断（按 loader 条目枚举、用条目级 `Entry#update` 而不碰 `EntryTree.update`、
客户端半用手写 ModuleLoader CJS 闭包）全部沿用。这一版把上游缺的三件事补上，
并把上游一个**危险**的做法修掉。

## 为什么 fork 而不是直接用上游

上游最大的一条：写入 `$DSH_HOME/cordis.patch.yml` 前**不备份**。
那个文件是所有 profile 共用的，写坏了没有任何回退路径，也没有审批闸门——
上游是在原地用正则改行。这不是"能跑就行"的程度，是**不能交给用户跑**。

另外两条是能力缺口：只有单个开关，没有批量；面板只显示"开/关"，
**不显示关掉能省多少**，于是用户没有依据判断该关哪个。

## 新增

### 1. 成本可见

面板对每个服务器显示：工具数、模型可见的模式字节、折合 token、以及分项
（`name` / `description` / `parameters`）。本机实测的 `rea`：

| 工具数 | 模型可见字节 | 折合每轮 |
|---|---|---|
| 207 | 785,262 B | ~196K token |

`estTokens` 是 `bytes / 4`，**不是分词器**。它用于排序与量级判断，通常 ±15%。
统计的是**模型可见投影**（`name` + `description` + `JSON.stringify(parameters)`）——
MCP 的 `outputSchema` 不进上下文，所以**不计**。这正是 `rea` 原始载荷 3.0 MB 里
约 73% 被排除的原因。

### 2. 写前备份

每次写入前把**原文件字节**存为同目录下的
`cordis.patch.yml.backup-<ISO时间戳>`，响应回传 `backupPath`；
只保留最近 10 份。备份失败**不阻断**开关，但响应带 `backupError`——
**假装备份成功比不备份更危险**。

### 3. 批量操作

`POST {"action":"disable-all"|"enable-all"}`，返回逐条结果与新的总量。
面板上对应两个按钮，另加"只显示启用中"的过滤。

### 4. 幂等写路径

若目标状态与当前状态相同，**文件一个字节都不动**。上游会重写——
那会churn mtime、丢一份无意义的备份、并唤醒 patch 的 HMR 监视者。

### 5. 双语界面与文档

面板文案走一张 `{en, zh}` 数据表，由 `locale.getLocale().active` 决定显示哪种，
回退到 `navigator.language`。文档中英双份，结构由测试对齐。

## 修复

- **先改运行时，再落盘。** 顺序反了会出现"磁盘上写着 `disabled: true`、
  服务器还在收费"，用户无从判断。现在两个状态**分开报**：`persisted` 与
  `persistError` 各自如实填写。
- **幂等**（见上第 4 条）：上游的无操作开关也会改写文件。
- 面板不再只是开关：加了服务器层标记（`layer: home`）、
  以及"检查过哪些候选层、各自是否存在"。

## 实测（本机桌面 profile）

| 步骤 | `enabled` | `fiberPhase` | `tools` | `estTokens` |
|---|---|---|---|---|
| 关闭前 | true | active | 207 | 196316 |
| 关闭后 | false | null（fiber 已销毁） | **0** | 0 |
| 重开后 | true | active | 207 | 196316 |

`tools: 0` 是关键：它读的是 `ctx.tools.schemas()`，即**当前真正注册在案**的工具表，
不是本插件自己记的账。`cordis.patch.yml` 从 286 B 变成 319 B，
只多了**一条**覆盖行（`id: rea-mcp` / `disabled: false`），原有的 `insert:` 块逐字节未动。

## 验证过的机制（不是推测）

`loader: Entry#update({disabled:true})` → 条目 fiber 被 dispose →
`dsh-mcp-client` 的 `ctx.effect` 清理运行 → 关闭 stdio 传输，
并调用它为每个工具登记的 disposer → `ctx.tools.register` 的登记被撤销。

`dsh-mcp-client` **没有惰性注册路径**（只有 `syncTools` → `listTools` →
逐工具 `register`），所以"关掉"必然等于"注销"。

因此本插件**不实现**"隐藏但保持注册"模式——那种模式省不了 token 却显示省了。

## 测试

6 个零依赖脚本（Node 内置 `node:test`），`npm test`：

- 纯函数：`upsertDisabled` 全部分支、CRLF、引号 id、锁定名单
- **补丁契约（金丝雀）**：独立实现一遍 `applyEntryPatches` 的语义，
  断言本插件产出的 YAML 满足它。这套语义已用 app.asar 里的**真实模块**验证过
  （喂进去后 `warnings: 0`、`config` 完好、`disabled` 生效）
- 写路径契约：备份、幂等、失败不假装成功
- 清单契约：版本一致性、`files` 白名单覆盖运行时、无 `@deepseek-ai/*` 运行时依赖、
  保持手写 CJS 形状
- 文档一致性：中英结构对齐、共享事实一致、无 BOM/CRLF
- 发版一致性：测试表与脚本链一致、每个版本都有发布说明

## 哪些没做（有意）

不做"隐藏但保持注册"、不做工具级开关、不管理服务器定义、
不读连接器私有记录、不自动关闭服务器、不整文件重写 patch、
不用 `EntryTree.update`、不加构建与依赖。理由见 `DECISION.md`。

---

## English

This is the first release of the repository, and it is a **fork**: the skeleton comes
from `dsh-mcp-toggle@1.0.1`, and every judgement it made is kept — enumerate loader
entries, use entry-level `Entry#update` and never `EntryTree.update`, and keep the
client half as a hand-written ModuleLoader CJS closure. This release adds the three
things upstream lacked and fixes one **dangerous** habit of its.

### Why a fork rather than using upstream

Upstream's worst habit: it wrote `$DSH_HOME/cordis.patch.yml` with **no backup**.
That file is shared by every profile, so a bad write has no rollback path and no
approval gate — upstream rewrote lines in place with a regex. That is not a
"good enough to run" level of risk; it is not something that can be handed to a user.

The other two gaps were capability: a single switch with no bulk action, and a panel
that showed only on/off, never **what turning a server off would save** — leaving the
user with no basis for choosing which one to switch off.

### Added

1. **Visible cost.** Per server the panel shows tool count, model-facing schema bytes,
   estimated tokens, and a breakdown (`name` / `description` / `parameters`). Measured
   here for `rea`: 207 tools, 785,262 B, roughly 196K tokens per request. `estTokens`
   is `bytes / 4`, **not a tokenizer** — it is for ranking and order of magnitude,
   typically within ±15%. It measures the model-facing projection
   (`name` + `description` + `JSON.stringify(parameters)`); an MCP `outputSchema` never
   enters the context, so it is **not counted**. That is exactly why about 73% of
   `rea`'s raw 3.0 MB payload is excluded.
2. **A backup before every write.** The original bytes are saved beside the file as
   `cordis.patch.yml.backup-<ISO timestamp>`, the response carries `backupPath`, and
   only the newest 10 are kept. A failed backup does **not** block the toggle, but the
   response carries `backupError` — pretending a backup succeeded is more dangerous
   than having none.
3. **Bulk actions.** `POST {"action":"disable-all"|"enable-all"}` returns per-row
   results plus new totals; the panel has both buttons and an "only enabled" filter.
4. **An idempotent write path.** If the file is already in the target state, **not one
   byte changes**. Upstream rewrote anyway, churning mtime, dropping a pointless
   backup, and waking the patch HMR watcher.
5. **A bilingual UI and documentation.** Panel strings come from an `{en, zh}` data
   table selected by `locale.getLocale().active`, falling back to `navigator.language`.
   Both READMEs are kept structurally aligned by a test.

### Fixed

- **Live first, persist second.** Reversed, you get a state where the disk says
  `disabled: true` while the server is still billing, with no way for the user to tell.
  The two states are now reported **separately**: `persisted` and `persistError` are
  each filled in honestly.
- **Idempotence**, as above: upstream's no-op toggle still rewrote the file.
- The panel is no longer just a switch: it reports the layer a server came from
  (`layer: home`) and which candidate layers were checked and whether each exists.

### Measured on this machine (desktop profile)

| Step | `enabled` | `fiberPhase` | `tools` | `estTokens` |
|---|---|---|---|---|
| Before | true | active | 207 | 196316 |
| After disable | false | null (fiber disposed) | **0** | 0 |
| After re-enable | true | active | 207 | 196316 |

`tools: 0` is the load-bearing number: it is read from `ctx.tools.schemas()`, the table
of what is **actually registered right now**, not this plugin's own accounting.
`cordis.patch.yml` went from 286 B to 319 B with **one** override row
(`id: rea-mcp` / `disabled: false`) added, and the original `insert:` block unchanged
byte for byte.

### Mechanism verified, not assumed

`loader: Entry#update({disabled:true})` disposes the entry's fiber, which runs
`dsh-mcp-client`'s `ctx.effect` cleanup: it closes the stdio transport and calls the
disposer it registered per tool, withdrawing each `ctx.tools.register` registration.
`dsh-mcp-client` has **no lazy registration path** (only `syncTools` → `listTools` →
`register` per tool), so "disabled" necessarily means "unregistered".

This plugin therefore does **not** implement a "hidden but still registered" mode: such
a mode saves nothing while showing that it saved.

### Tests

Six dependency-free scripts (Node's built-in `node:test`), run by `npm test`: pure
functions, the **patch-semantics canary** (an independent reimplementation of
`applyEntryPatches`, already validated against the real modules inside `app.asar`),
the write-path contract, the manifest contract, documentation parity, and release
consistency.

### Deliberately not done

No "hidden but still registered" mode, no per-tool switches, no server-definition
management, no reading of connector-private records, no automatic disabling of servers,
no whole-file rewriting of the patch, no `EntryTree.update`, no build step and no
dependencies. See `DECISION.md`.
