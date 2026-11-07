# v1.2.0 — 从"看清成本"到"管住整个服务器"

[English](#english) | 中文

**这一版把三件事接了进来：谁真的在调这个服务器、别的客户端里已经配好的服务器能不能搬过来、
没装过的服务器能不能直接从官方目录装上。** 开关语义一个字没动——关掉还是真的注销工具。
新增的每一种改动，**落地方式都是同一个：写进补丁文件。**

---

## 改了什么

### 1. 调用记录：从"它占多少 token"到"它到底在不在用"

原来面板只回答"这个服务器每轮吃多少 token"。但"吃 token"和"值不值得留"是两回事：
一个每秒被调用十次的服务器和一个三个月没被碰过的服务器，都可能占 19 万 token。

现在订阅宿主的 `session/event`，取 `tool/call` 与 `tool/result` 两类事件，按 `callId` 配对，
记下每次调用：服务器名、工具名、是否失败、耗时、会话尾号、参数与结果的开头一段。
只看得到两类东西——`mcp__<server>__<tool>` 形状的 MCP 工具，以及 `skill` 工具调用。

有两条口径是刻意写死的：

- **今天**按本地时区算，不是 UTC。否则中国用户晚上八点看到的"今天"是错的。
- **成功率与平均耗时只算已结算的记录。** 把还在跑的算进去，平均值会被拉成 0。

### 2. 只在结算时写盘（一处和参考实现不同的决定）

参考实现在调用**开始**时就写一行 running 记录，读取时再按 id 合并。好处是面板能实时
看到"正在跑"，代价是：进程在这两次写之间被杀，磁盘上就留下一条永远 running 的行。
面板上那个"已经转了一个星期的调用"就是这么来的。

这里改成**只在结算时写一行**。代价是面板看不到进行中的调用（刷新一下才会有新数据），
收益是磁盘上永远不会出现无法自愈的状态。日志按 `appendFile` 追加而不是读改写——
两个会话同时结算时，读改写会互相吞掉对方的行。

保留 7 天、最多 20000 行、写在 `$DSH_HOME/dsh-mcp-control/calls.jsonl`。

### 3. 从别的 MCP 客户端导入配置

扫十个白名单路径：Claude Desktop、Claude Code（两个文件）、VS Code 与 Insiders、
Cursor、Windsurf（两个路径）、Gemini CLI、Codex CLI。认三种 JSON schema
（`mcpServers` / `servers` / `mcp.servers`），外加一个**零依赖的极简 TOML 提取器**
处理 Codex 的 `[mcp_servers.<name>]`。

**白名单是隐私边界，不是性能优化。** 扫描器绝不递归遍历 home 目录去找配置文件——
那会把 `.ssh`、项目里的 `.env` 之类的路径也拖进候选集合。测试里专门放了一个
假 home 目录，塞进 `secret.json` 和 `projects/mcp.json`，断言它们绝不出现在结果里。

`SSE` 传输的条目不能导入，因为 `dsh-mcp-client` 不支持；面板会显示原因而不是静默丢弃。

### 4. 官方目录搜索与一键安装

只接 `registry.modelcontextprotocol.io` 一个源。Smithery 实测返回 500，
`awesome-mcp-servers` 只是链接集合（条目是网页链接，不是可安装配置）——
**接一个半能用的源不如不接。**

安装的落点是补丁文件：往 `$DSH_HOME/cordis.patch.yml` 追加**一整块新的** `- insert:`。
已有块一个字节不动，行号也不动。安装后不需要重启：宿主的 HMR 监听这个文件，
reconcile 之后自己热应用。

卸载只删本插件自己写的那块，三层闸：只删 body 含 `@deepseek-ai/dsh-mcp-client` 的行、
只删空掉之后的 `- insert:` 块（非空块原样保留）、锁定 id 由调用方拒绝。
删完折叠连续空行。

### 5. 为什么不用运行时动态挂载（本次最重要的不抄）

参考实现的核心机制是 `ctx.plugin(mcpClient, config)`——在运行时直接挂一个
MCP 客户端实例上去。它很省事，但代价是：装的东西**不进补丁文件**，
`git diff` 里看不见，卸载即全没，而且它的"停用"对别人挂载的行是假动作
（回复里带 `stillProvided`）。

这里选择另一条路：**写补丁文件，让宿主自己去挂。** 好处是真相始终在文件里，
坏处是每次安装都真的落一次盘。这个取舍写在 `DECISION.md` 子决策 7。

## 没改什么

开关语义、`estTokens = bytes / 4` 的估算口径、备份与清理策略（保留 10 份、名字带序号）、
补丁覆盖行的写法和幂等性、以及原有的 84 项测试——全部原样。

## 升级会不会丢东西

不会。新增的三块都读自己新建的文件（`calls.jsonl`）或现成的补丁文件，
没有迁移、没有格式变更；旧的 HTTP 形状与 `panelEntry` 状态文件一字未改。
不装新服务器的话，补丁文件不会被碰。

## English

**This release adds three things: who actually calls a server, whether servers already
configured in other clients can be brought over, and whether an uninstalled server can be
installed straight from the official catalog.** The toggle semantics did not change by a
single byte — turning a server off still really unregisters its tools. Every new kind of
mutation lands the same way: **it is written into the patch file.**

### 1. Call log: from "how many tokens" to "is it even used"

The panel used to answer only "how many tokens does this server cost per request". But
costing tokens and being worth keeping are different questions: a server called ten times
a second and one untouched for three months can both occupy 190K tokens.

The plugin now subscribes to the host's `session/event`, takes `tool/call` and
`tool/result`, pairs them by `callId`, and records server name, tool name, failure,
duration, session tail, and the head of the arguments and result. Only two shapes are
recorded — MCP tools shaped `mcp__<server>__<tool>`, and `skill` invocations.

Two conventions are deliberate. "Today" is computed in the local time zone, not UTC.
Success rate and average duration count settled records only — including in-flight ones
would drag the average to zero.

### 2. Written once, at settlement

The reference implementation writes a running row when a call starts and merges by id on
read. That shows in-flight calls, but if the process dies between the two writes, a row
stays running forever — the "call that has been spinning for a week" on the panel.

Here, one row is written only at settlement. The panel cannot show in-flight calls, but
the file can never hold a state it cannot heal. Lines are appended rather than
read-modify-written, because two sessions settling at once would otherwise swallow each
other's rows. Seven days, at most 20000 lines, in `$DSH_HOME/dsh-mcp-control/calls.jsonl`.

### 3. Import from another MCP client

Ten whitelisted paths: Claude Desktop, Claude Code (two files), VS Code and Insiders,
Cursor, Windsurf (two paths), Gemini CLI, Codex CLI. Three JSON schemas are recognised
(`mcpServers`, `servers`, `mcp.servers`), plus a zero-dependency minimal TOML extractor
for Codex's `[mcp_servers.<name>]`.

The whitelist is a privacy boundary, not a performance tweak. The scanner never walks the
home directory looking for config files — that would drag `.ssh` and project `.env` paths
into the candidate set. A test plants `secret.json` and `projects/mcp.json` in a fake home
directory and asserts they never appear in the result.

`SSE` entries cannot be imported because `dsh-mcp-client` does not support the transport;
the panel shows the reason instead of silently dropping them.

### 4. Catalog search and one-click install

Only `registry.modelcontextprotocol.io` is wired up. Smithery returned 500 in testing and
`awesome-mcp-servers` is just a link collection — one working source beats three
half-working ones.

Installation lands in the patch file: a whole new `- insert:` block is appended to
`$DSH_HOME/cordis.patch.yml`. Existing blocks are not touched and keep their line numbers.
No restart is needed: the host's HMR watches that file and reconciles.

Removal deletes only the block this plugin wrote, behind three guards: only lines whose
body contains `@deepseek-ai/dsh-mcp-client`, only `- insert:` blocks that became empty
(non-empty blocks are kept byte for byte), and locked ids are refused by the caller.

### 5. Why not runtime mounting

The reference implementation's core mechanism is `ctx.plugin(mcpClient, config)` — mounting
an MCP client instance at runtime. It is convenient, but what it installs never enters the
patch file, never shows up in `git diff`, disappears on uninstall, and its "disable" is a
no-op for rows mounted by someone else (the reply carries `stillProvided`).

This plugin takes the other road: write the patch file and let the host mount it. The truth
always lives in the file; the cost is that every install really writes to disk. That
trade-off is recorded as decision 7 in `DECISION.md`.

### Unchanged

Toggle semantics, the `estTokens = bytes / 4` estimate, backups and pruning (ten copies,
sequence-suffixed names), the override-row format and its idempotence, and the existing 84
tests are all untouched.

### Upgrading

Nothing is lost. The three new areas read their own new file (`calls.jsonl`) or the existing
patch file; there is no migration and no format change, and the old HTTP shapes and the
`panelEntry` state file are unchanged. If no server is installed, the patch file is never
written.
