# dsh-mcp-control — 在设置里开关每个 MCP 服务器，并看清它每轮吃掉多少 token

[English](README.en.md) | 中文

> **这是 [`dsh-mcp-toggle`](https://www.npmjs.com/package/dsh-mcp-toggle) 的维护分支。**
> 上游已长期停更（最后发布 1.0.1）。它提供了正确的骨架，但只做单个开关，
> 且写入 `$DSH_HOME/cordis.patch.yml` 前**不留备份、无审批闸门**——
> 改坏一次，所有 profile 都可能起不来。
> 本分支保留骨架，补上三件上游缺的东西：**每个服务器的 token 成本可见**、
> **写入前自动备份**、**可批量操作**。

---

## 它是什么

DSH 的 MCP 服务器是**常驻成本**。服务器连接后，它每个工具的模式
（名字 + 描述 + 参数）都会进入**每一轮**请求的稳定前缀。服务器越重，这一项越贵：

| 服务器 | 工具数 | 模型可见的模式字节 | 折合每轮 |
|---|---|---|---|
| `rea`（本机实测） | 207 | 785,262 B | **~196K token** |

这不是估算，是面板读 `ctx.tools.schemas()` 得到的实测值。
在 320K token 的前缀里，它一个人占了六成——决定了一轮请求还能不能塞下别的。

本插件给你一个设置页（**设置 → MCP 控制台**），做三件事：

1. **看见**：每个 MCP 服务器当前注册了多少工具、占多少字节、折合多少 token；
2. **开关**：关掉即**真正注销**它的全部工具，省下**全额** token，而不是"隐藏"；
3. **记住**：写入 `$DSH_HOME/cordis.patch.yml` 的覆盖行，重启后依然生效。

## 它不是什么

- **不是**"隐藏但仍注册"的假省。见《关掉是真省》。
- **不是** MCP 服务器管理器：不新增、不编辑、不删除服务器配置，只改**开关状态**。
  要加服务器，仍用官方 `@deepseek-ai/dsh-mcp-client` 的行，或对应的连接器插件。
- **不是**连接器面板。`dsh-mcp-connector` 一类插件只枚举**它自己建的连接**；
  本插件按 loader 条目枚举，**看得见每一层里的每一行 MCP**，不受来源限制。
- **不需要**构建、**不需要**依赖。纯 JS：`index.js` + `client.js`。

## 你需要它吗

只有当你的 MCP 服务器**多到或重到值得开关**时才需要。判断方法：

- 打开面板看一眼"每轮约"。**单一轻量服务器（几十个工具、几万字节）不必装**——
  省下的 token 抵不上多一个插件的心智成本。
- **重服务器才划算**（数百工具 / 数十万字节），典型是 REA 这类自描述极强的 MCP。
- 如果你从不在多个项目间切换 MCP 组合，直接在 patch 里注释掉那一行更省事。

## 关掉是真省 —— 机制与证据

"禁用一个 MCP 条目"到底省不省 token，只有一个判据：**工具是否真的从注册表里消失**。

这条链路已逐行核对 DSH 源码，并在本机实测：

```
loader: Entry#update({disabled:true})
  → 该条目的 fiber 被 dispose
    → @deepseek-ai/dsh-mcp-client 的 ctx.effect 清理函数运行
      → 关闭 stdio 传输
      → 并调用它为每个工具登记的那个 disposer
        → ctx.tools.register 的登记被撤销
```

关键在于：`dsh-mcp-client` **没有惰性注册路径**。它只有一条路——
`syncTools` → `listTools({cacheMode:"refresh"})` → 对每个工具 `ctx.tools.register`。
所以"关掉"必然等于"注销"，不存在"关掉了但模式还留着"的中间态。

实测（本机桌面 profile，服务器 `rea`）：

| 步骤 | 结果 |
|---|---|
| 关闭前 | `enabled: true`，`fiberPhase: active`，`tools: 207`，`estTokens: 196316` |
| 关闭后 | `enabled: false`，`fiberPhase: null`（fiber 已销毁），**`tools: 0`**，`estTokens: 0` |
| 重开后 | `enabled: true`，`fiberPhase: active`，`tools: 207`，`estTokens: 196316` |

`tools: 0` 是关键——它读的是 `ctx.tools.schemas()`，即**当前真正注册在案**的工具表。
不是本插件自己记的账，是问的工具服务本身。

> 因此：**本插件不实现"隐藏但不注销"模式**。那种模式省不了 token，
> 却会让人以为省了——这是本仓库明确拒绝做的事（见 `DECISION.md`）。

## 为什么写进 HOME 层

DSH 的组合顺序是：

```
bundle  →  profile cordis.patch.yml  →  $DSH_HOME/cordis.patch.yml  →  overlays
```

**HOME 层压过 per-profile 层。** 而 MCP 行往往分散在两层里（例如 REA 装在 HOME）。
若把覆盖行写进 profile，HOME 那行会把它盖掉，你会得到一个"改了但没生效"的面板。

所以覆盖行写 **`$DSH_HOME/cordis.patch.yml`**（`DSH_HOME` 环境变量优先，
否则 `~/.dsh/cordis.patch.yml`）。面板还会列出它检查过的**全部候选层**及各自是否存在。

## 不修改你写的那一行 —— 只追加覆盖行

面板**从不重写**它找到的 MCP 行。那一行通常在 `insert:` 列表里，是安装器写的。

它做的是**追加一条独立覆盖行**：

```yaml
- insert:
    - id: rea-mcp
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: rea
        # ...

- id: rea-mcp          # ← 只有这一行是本插件加的
  disabled: true
```

这么写能成立，是因为 DSH 内置的补丁应用器 `applyEntryPatches` 有三条性质：

1. 插入的条目**边插边建索引**，所以"后来的补丁"能命中"先前的插入"
   → 覆盖行**必须在 insert 之后**；`upsertDisabled()` 保证这一点；
2. 补丁**不写 `name` 就跳过名字校验** → 覆盖行只带 `id` + `disabled` 即可；
3. 覆盖是**逐键应用**的 → `disabled` 碰不到 `config`，改不动你的服务器配置。

三条都写进了 `test/patch-contract.test.mjs`——它把这套语义独立实现一遍，
再断言本插件产出的 YAML 满足它。**该测试是金丝雀，不是历史遗留。**

写入是**逐行**的：同一 id 永远只有一条顶层覆盖行；就地改写 `disabled:`；
不重排、不整文件重写、不碰 `insert:` 里的行；保留 CRLF/LF 与结尾换行。
**若目标状态与当前状态相同，则文件一个字节都不动。**

## 安全

上游最大的短板是**改 patch 前不备份**。本分支补上了。

- **写前备份**：每次写入前先把**原文件字节**存为
  `cordis.patch.yml.backup-<ISO时间戳>-<两位序号>`（同目录），响应回传 `backupPath`。
  序号不是装饰：时间戳只有毫秒精度，同毫秒内的第二次写入会**覆盖**第一份备份
  （CI 在 Linux 上真的这样丢过 4 份）。序号保证每份都在。
- **自动清理**：只保留最近 **10** 份，按文件名排序裁掉更旧的。
- **备份失败不阻断**：备份是尽力而为。真失败了，开关照常生效，
  响应报 `backupError`——**绝不假装备份成功**。
- **先活后存**：先改运行时（立即生效），再落盘。落盘失败则响应 `persisted: false`
  + `persistError`：运行时状态是真的，磁盘状态是假的，两者分开报。
- **绝不跨越 API 抛错**：任何路径都返回 JSON。
- **锁定条目**：`include`、`cordis:include`、`dsh-mcp-control`、`dsh-mcp-toggle` 一律 403。
- **1 MB 请求体上限**。
- **只动开关**：不新增、不编辑、不删除任何服务器定义；不碰 `cordis.yml`。

回滚：把 `backupPath` 指向的文件复制回 `cordis.patch.yml` 即可。

## 安装

```bash
# 从 GitHub（推荐——名字带 owner，避免撞上同名仓库）
dsh plugin --profile desktop add github:ZiYuan258/dsh-mcp-control

# 或从本机目录（开发时用这个，改完重新 add 一次即可）
dsh plugin --profile desktop add "<本目录绝对路径>"
```

- 插件行 id 是 **`mcp-control`**（不是包名——`cordis.patch.yml` 插入的是短 id）。
- **客户端半是冷加载的**：装完、改了 `client.js` 之后要**硬刷新**页面。
  宿主的 HMR 只跟踪**它自己**的 patch 文件，**不会**跟踪本插件目录里源码的改动；
  改了 `index.js` / `client.js` 要重新 `add` 一次才会投影到 profile。
- 宿主路由：`GET|POST http://127.0.0.1:<端口>/mcp-control/api`。

## 测试

```bash
npm test
```

```
test/unit.test.mjs                 纯函数（upsertDisabled 全部分支、CRLF、引号 id）
test/patch-contract.test.mjs       产出的 YAML 必须满足 DSH 真实补丁语义（金丝雀）
test/write-path.test.mjs           写路径契约：备份、幂等、失败不假装成功
test/package-contract.test.mjs     版本一致性、files 白名单、无 @deepseek-ai 运行时依赖
test/docs-parity.test.mjs          中英 README 章节对齐、发布说明双语结构
test/release-consistency.test.mjs  每个版本都有发布说明
```

零依赖，用 Node 内置 `node:test`。

## HTTP API

`GET /mcp-control/api` → 快照：

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
    "schemaBytes": 785262,
    "estTokens": 196316,
    "breakdown": { "nameBytes": 6148, "descriptionBytes": 90143, "parameterBytes": 688971 },
    "layer": "home"
  }],
  "totals": { "servers": 1, "enabled": 1, "disabled": 0, "mcpToolCount": 207,
              "mcpSchemaBytes": 785262, "mcpEstTokens": 196316,
              "activeEstTokens": 196316, "bytesPerToken": 4 },
  "patchPath": "C:\\Users\\<you>\\.dsh\\cordis.patch.yml",
  "layersReadable": true
}
```

`POST /mcp-control/api`，二选一：

```json
{ "entryId": "include:rea-mcp", "disabled": true }
{ "action": "disable-all" }
```

单条响应：`{ ok, entryId, rawId, serverName, disabled, fiberPhase, persisted,
persistMode, patchPath, backupPath?, persistError? }`

| 状态码 | 含义 |
|---|---|
| 400 | 请求体非法 / `disabled` 不是布尔 / 目标不是 MCP 行 |
| 403 | `entryId` 为空 / 条目被锁定 |
| 404 | 未知条目 |
| 405 | 方法不支持 |
| 500 | loader 抛错 |
| 503 | loader 服务不可用 |

## 两个诚实的说明

**一、`estTokens` 是除法，不是分词器。** 它等于 `bytes / 4`。
中英混排、JSON 结构、重复字段都会让它偏离真实值，通常 ±15%。
它的用途是**排序和量级判断**——"这个服务器值不值得常驻"——
而不是"这一轮精确花了多少 token"。绝对值以账单为准。

**二、统计的是模型可见投影，不是 MCP 原始载荷。**
本插件只计 `name` + `description` + `JSON.stringify(parameters)`。
MCP 工具若声明了 `outputSchema`，**它不进模型上下文**（DSH 只转发 `parameters`），
所以本插件**不计**它。这正是 REA 原始载荷 3.0 MB 里约 73% 被排除的原因——
面板的 785 KB 是**真实进入上下文**的那部分，比原始 `tools/list` 小得多，
也比它诚实得多。

## 目录

```
index.js          宿主半：路由 + 枚举 + 成本统计 + 落盘（逐行 upsert + 备份）
client.js         浏览器半：设置页（手写 ModuleLoader CJS 闭包，无构建步骤）
cordis.patch.yml  插入插件行 mcp-control
locale/           en.json / zh.json —— 插件列表里的标题与描述
icon.svg          插件图标
AGENTS.md         维护契约（改这个仓库之前先读）
DECISION.md       为什么 fork、为什么写覆盖行、为什么拒绝"假省"模式
SECURITY.md       安全模型与威胁边界（英文）
SECURITY.zh.md    同上，中文
docs/             发布说明
test/            零依赖测试（node:test）
```

## 许可与署名

MIT，见 `LICENSE`。

骨架来自 **`dsh-mcp-toggle`**，Copyright (c) 2026 **Zenjibad**（MIT）。
条目枚举、按 `entry.options.name` 识别 MCP 行、`settings.section` 注册方式，
以及"用 `Entry#update` 而**不是** `EntryTree.update`"这个关键判断，都源自上游。
其中最后一条尤其重要：`EntryTree.update` 会调用 `tree.write()`，把补丁**摊平**进
`cordis.yml`，摧毁补丁层的意义——上游踩过这个坑，本分支沿用了它的结论。

本分支的增量：成本可见性、写前备份、批量操作、幂等写路径、双语界面，
以及一套把 DSH 补丁语义钉死的测试。
