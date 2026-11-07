# 项目状态

**当前版本：1.2.0**
**状态：** 已在本机桌面 profile 上安装并实测运行
**上游：** [`dsh-mcp-toggle`](https://www.npmjs.com/package/dsh-mcp-toggle) v1.0.1（已停更）

**宿主版本验证记录：** DSH 44.0.0 ✅（首次全链路实测）｜ DSH 44.7.0 ✅（2026-10-17 复验：
路由存活、开关往返 207→0→207、备份文件带序号落盘、真实 `applyEntryPatches` 复跑零警告、
`include:mcp-control` 条目 active、65/65 测试通过。44.7.0 的 `dsh-mcp-client` 仍是急切全量注册，
无懒加载路径——「关掉=真省」的前提未变）｜ DSH **0.2.1-rc.3** ✅（2026-10-27 复验：
`cordis-plugin-include` 1.0.10 / `cordis-plugin-loader` 1.0.6 / `dsh-mcp-client` 0.2.1-rc.3 三个
模块与 44.7.0 时期的 dump **逐字节相同**（sha256 前 16 位全等），`applyEntryPatches` 仍在
`cordis-plugin-include/lib/index.js:56` 并照旧导出；真实 applier dry-run → `warnings: 0`、
`row resolved: YES`、`disabled: true`、`name`/`config` 原样、home patch 逐字节未变、
二次 toggle 恰好一行 override；84/84 测试通过；面板路由 200。**结论：无需适配。**）
｜ DSH **0.2.1-rc.5** ✅（2026-10-30 复验：DSH 把 Harness 模块**重新打包回** `resources/app.asar`，
所以上游源码不能再当普通目录读——复验脚本改用 `ELECTRON_RUN_AS_NODE=1` 启动以便 asar 感知的 fs 能进去。
`cordis-plugin-include` 1.0.10 与 `cordis-plugin-loader` 1.0.6 与旧 dump **逐字节相同**；
`dsh-mcp-client` 升到 0.2.1-rc.5，整个模块**只差一处 7 行**——给 `resources/list` 与
`resources/templates/list` 加服务器能力判断（服务器未声明 `resources` 能力时返回空列表而不是抛错），
不碰 `publicToolName` 的 `mcp__<serverName>__<rawName>`、不碰 `serverName` 配置 schema、不碰条目形状；
`applyEntryPatches` 仍在 `cordis-plugin-include/lib/index.js:56` 并照旧导出；真实 applier dry-run →
`warnings: 0`、`row resolved: YES`、`disabled: true`、`name`/`config` 原样、home patch 逐字节未变、
二次 toggle 恰好一行 override；84/84 测试通过；面板路由 200 且 `panelEntry` 跨重启存活；
`sidebar.panellist` 占用者 `mcp-control` order 21 active、`plugins.bundle.config` 键
`dsh-mcp-control` active、loader 条目 `include:mcp-control` fiberPhase `active`。
rc.5 还新增了 profile 层 `profile:headless`——`inspectLayers` 是 `readdir($DSH_HOME/profiles)`
动态枚举的，所以自动认到，不需要改代码。**结论：无需适配。**）
｜ DSH **0.2.2-rc.1** ✅（2026-11-06 复验：两个 Cordis 模块终于动了——`cordis-plugin-include`
**1.0.10 → 1.1.0**（8606 B → 23265 B）、`cordis-plugin-loader` **1.0.6 → 1.1.0**（24077 B → 28635 B），
内部大改（新增 `ConfigFileError`、journal 与持久化）。**但公开契约没变**：`include` 1.1.0 把函数
改名成 `applyPatches`，却**仍以 `applyEntryPatches` 导出**（`export { … applyPatches as applyEntryPatches … }`），
所以本插件的 import 一行都不用改；`loader` 的 `entries()`、`resolve(id)`、
`entry.update(options, create, force)` 签名原样。`dsh-mcp-client` 升到 0.2.2-rc.1 但与 rc.5 dump
**逐字节相同**。`dsh-tools` 仍有 `schemas()`。真实 applier dry-run → `warnings: 0`、
`row resolved: YES`、`disabled: true`、`name`/`config` 原样、home patch 逐字节未变、二次 toggle 恰好
一行 override；84/84 测试通过；面板路由 200 且 `panelEntry` 跨重启存活；四个槽位 live：
`sidebar.panellist` 的 `mcp-control` order 21 active、`main` 键 `mcp-control` active、
`plugins.bundle.config` 键 `dsh-mcp-control` active、`settings.section` 里**没有** `mcp-control`
（座位在侧栏，互斥成立）。**结论：无需适配，代码零改动。**）

---

## 一句话

在 DSH 的设置里开关每一个 MCP 服务器，**看清它每轮吃掉多少 token**，
并把选择写进声明式补丁层，重启后依然生效。

## 已经到了哪一步

| 能力 | 状态 | 证据 |
|---|---|---|
| 按 loader 条目枚举 MCP 服务器（全部层） | ✅ 实测 | 面板列出 `include:rea-mcp`，`layer: home` |
| 成本统计（工具数 / 字节 / 折合 token / 分项） | ✅ 实测 | `207 工具 / 766,054 B / 191514 token` |
| 单条开关，且**真正注销**工具 | ✅ 实测 | 关闭后 `tools: 0`；重开后 `tools: 207` |
| 落盘为覆盖行，重启后生效 | ✅ 实测 | `cordis.patch.yml` 286 B → 319 B，单条覆盖行 |
| 写前备份 + 自动清理（保留 10 份） | ✅ 实测 | `backupPath` 字段；单测覆盖 |
| 备份名带序号，同毫秒不互相覆盖 | ✅ 测试 | `backupNameFor` 单测 + 连续 4 次写入留下 4 份不同文件 |
| 幂等写路径（同态不写文件） | ✅ 测试 | 同态返回 `mode: 'unchanged'` / `changed: false` |
| 批量启用 / 停用 | ✅ 已实现 | `POST {"action":"disable-all"\|"enable-all"}` |
| 中英双语界面与文档 | ✅ 已实现 | `docs-parity` 测试守卫 |
| 补丁语义测试（金丝雀） | ✅ 已用真实模块验证 | 真实 `applyEntryPatches` → `warnings: 0` |
| 面板在设置里挂载 | ✅ 实测 | `settings.section` 占用者 `mcp-control`（默认座位，order 70；v1.1.0 起可改到侧栏） |
| 面板入口可换座位（侧栏 / 设置页） | ✅ 测试（19 项） | `panel-entry.test.mjs`；两座位互斥、偏好存 `state.json` |
| 调用记录（谁真被调用 / 耗时 / 失败率） | ✅ 测试（13 项） | `calls.test.mjs`；只记 `mcp__*` 与 `skill`，结算时才写盘 |
| 从别的 MCP 客户端扫描导入 | ✅ 测试（11 项） | `scan.test.mjs`；白名单十个路径，含隐私边界用例 |
| 官方目录搜索 | ✅ 测试（14 项） | `catalog.test.mjs`；只接 `registry.modelcontextprotocol.io` |
| 安装 / 卸载服务器（写进补丁文件） | ✅ 测试（17 项） | `patch.test.mjs`；三层删除守卫，装一次再卸一次逐字节还原 |
| 服务器视图里显示「已写入但未挂载」的行 | ✅ 测试（5 项） | `servers-view.test.mjs`；安装后若宿主还没挂上，行不会凭空消失，可直接删除 |

## 已知边界（不是 bug，是范围）

- **粒度是服务器，不是工具。** 想只关掉一个服务器里的一部分工具，用工具级拦截那类方案。
- **`estTokens = bytes / 4`**，通常 ±15%。用于排序与量级判断，不用于对账。
- **只统计模型可见投影**（`name` + `description` + `parameters`）。MCP 的
  `outputSchema` 不进上下文，因此不计。
- **只统计 `mcp__<server>__` 前缀的工具。** 不带这个前缀的共享工具（例如 rc.5 起 DSH 自带的
  `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`）不属于任何 MCP 服务器，
  因此不计入任何服务器的开销，也不会被误算成一个服务器。
- **不管理"别人写的"服务器定义**：开关只改 `disabled:`；安装/卸载只碰本插件自己追加的
  `- insert:` 块与对应覆盖行。宿主的行一个字节不动。
- **客户端半冷加载**：改 `client.js` 后要重新 `add` 并硬刷新页面。
  宿主的 HMR 只跟踪它自己的 patch 文件，不跟踪本插件目录里的源码。

## 与本机环境的关系

本插件是在**本机桌面 profile** 上开发并实测的。

- 插件源目录：`~/.dsh/plugins/dsh-mcp-control`
- **装进 profile 的形态要量，不要假设。** 实测两种都存在，行为不同：
  `link:<目录>` → `node_modules` 里是**符号链接**，源码即运行物，`files` 不参与过滤；
  `file:<目录>` → 是**经 `files` 白名单过滤的副本**，改源码必须重新 `add` 一次。
  本机当前是 `link:`（`readlinkSync` 可验），所以改源码立刻到位，
  但宿主侧的 ESM 缓存仍需重启 DSH 才重新求值——见 `AGENTS.md` 的 Install / reload。
- 被实测的服务器 `rea` 是 HOME 层的一行 `@deepseek-ai/dsh-mcp-client`。

## 1.2.0 为什么是这个号

按 `RELEASING.md` 的版本策略，**只有插件行为变化才动版本号**。1.2.0 是一次
功能增量（三块新能力 + 一个新 API 视图族 + 四个新 POST 动作），旧的 HTTP 形状
和补丁语义**一个字没改**，所以是 minor 而不是 major。

三块的来源与取舍见 `DECISION.md` 子决策 7：调用记录、配置扫描导入、目录搜索
来自 [`dsh-overall-mcp`](https://github.com/YunzhouLi-hub/dsh-overall-mcp)，
**但它的核心机制没抄**——它用运行时 `ctx.plugin(mcpClient)` 动态挂载，装的东西
不进补丁文件；这里选择写补丁文件 + 让 DSH 自己的 HMR 热应用。

## 下一步（有意未做）

按优先级：

1. **回环端口的令牌校验。** 目前路由完全依赖宿主 web server 的绑定。
   若有人把回环端口转发出去，本路由没有额外防线（见 `SECURITY.zh.md` 第 6 节）。
2. **历史趋势。** 调用记录现在只回答"谁在用"，不回答"这个服务器被关了多久"。
3. **工具级开关。** 需要另一条缝（作用域拦截），且不落盘——
   要做得对，得先解决"重启后由谁重新施加"的问题。
4. **`outputSchema` 的可选统计。** 现在刻意不计（它不进上下文）。
   但如果用户想评估"这个 MCP 自描述得有多浪费"，它是个有用数字——
   前提是把"不进上下文"这件事说清楚，不能混进 token 估计里。
5. **更多目录源。** Smithery 实测 500，awesome-mcp-servers 只是链接集合。
   接一个半能用的源不如不接。

## 不做

见 `DECISION.md` 的"明确不做的事"一节。摘要：
不做"隐藏但保持注册"的模式（省不了 token 却显示省了）、
不做工具级开关、不管理别人写的服务器定义（只管本插件自己装的那些）、不读连接器私有记录、
不自动关闭服务器、不整文件重写 patch、不用 `EntryTree.update`、不加构建与依赖、
不用运行时 `ctx.plugin` 挂载（装的东西必须进补丁文件）。
