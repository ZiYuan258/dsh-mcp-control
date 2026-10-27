# v1.1.0 — 面板入口可以选了：侧栏一行，或者设置里一页

[English](#english) | 中文

**这一版只加了一件事：面板出现在哪里，由你决定。** 功能、数据、开关语义一个字没动——
控制台还是那个控制台，只是它原来只有一个座位（设置里的一页），现在多了一个
（左侧边栏一行图标），而且两个座位**不同时存在**。

---

## 改了什么

### 1. 新增"面板入口"：仅侧栏 / 仅设置页

设置 → 插件 → dsh-mcp-control 里多了一张卡片：

```
面板入口
决定 MCP 控制台出现在哪里。两个入口是同一个页面，任一时刻只保留一个。
[ 仅侧栏 ] [ 仅设置页 ]
```

选"仅侧栏"，左侧边栏会多出一行图标，点开就是控制台；同时设置里那一节**注销**。
选"仅设置页"，反过来。任一时刻只有一个座位存在——这比"两个都留着"更省事，
因为不会有第二个入口悄悄过期。

实现上，侧栏图标注册进 `sidebar.panellist`，它的 `id` 与中央面板 `main` 的 `key`
是**同一个值**（`mcp-control`）。这不是巧合，是这个槽位的约定：`panellist` 的
list id 指向匹配的 `main` 面板，侧栏只负责那个按钮，标签从 list 元数据里解析。
所以少写一个 id，或者两个 id 不一致，得到的就是"点了没反应的图标"。

### 2. 注销当前座位前，先取消选中

把侧栏入口撤掉的那一刻，如果它正好是当前选中的面板，界面会停在一个已经不存在
的面板 id 上。所以注销顺序是：**先 `layout.selectPanel(null)`，再撤注册**。
拿不到 `layout` 服务时（理论上不该发生），这一句会 `console.warn` 然后跳过——
宁可留一个需要手动点走的面板，也不要因为一次警告把整个注销流程中断。

### 3. 偏好存在 `state.json`，**不**写进 `cordis.patch.yml`

这是本版唯一一个值得单独解释的决定。补丁文件表达的是**组成**：谁被 insert、
哪一行的 `disabled` 被覆盖。而"面板放哪"没有任何组成会去读——它只是客户端在
注册槽位前要知道的一个值。写进补丁的代价是具体的：每次点一下切换，
patch watcher 都会被唤醒重放一遍组成，为了一个谁都不读的字段。

所以它进了 `$DSH_HOME/dsh-mcp-control/state.json`，写入走
"写 `.tmp` → `rename` 原子替换"，读完即用。

### 4. 非法值：读的时候兜底，写的时候拒绝

同一个白名单，两个方向：

- **读**（`sanitizePanelEntry`）：认不出来就回默认值 `settings`，并且**绝不回写**。
  读取失败和用户决定必须是两件事——猜测"上次看到的"会让它们变成一件事。
- **写**（`writePanelEntry`）：认不出来就返回 400，**什么都不写**。
  这是指令，不是记忆；指令含糊的时候，正确的动作是问，不是挑一个。

状态文件损坏时同理：报 `panelEntryError`，面板照样能用（回默认座位），
但**不覆盖**那个文件——它现在是唯一能说明"哪里坏了"的证据。

### 5. 默认值是 `settings`，不是 `sidebar`

参考实现（`dsh-providers-hub`）默认落在侧栏。这里反过来，理由只有一条：
**升级不该移动一个没人要求移动的面板**。本插件 1.0.x 一直住在设置页；
把新选项做成默认，等于让所有老用户升个版本就发现页面不见了。
新座位保持惰性，直到有人主动选它。

## 没改什么

- 开关语义、`estTokens` 口径、备份策略、HOME 层写入、只追加覆盖行的契约——全部原样。
- 已有的 `settings.section` 注册（`id: mcp-control`、`order: 70`）没有改名，
  所以老用户的设置页位置不会跳。
- 65 个既有测试一个都没改，新增 19 个覆盖这一版的行为。

## 升级会不会丢东西

不会。没有 `state.json` 就是"从没选过"，回默认座位（设置页），也就是你原来看到的样子。
有 `state.json` 但值是坏的，同上，且文件被保留。

## English

**The only thing this release adds is a choice about where the panel lives.** Features,
numbers, and toggle semantics are untouched — the console is the same console, it just
had one seat (a page inside Settings) and now has two (a row of icons in the left
sidebar), and the two seats never exist at the same time.

### 1. New "Panel entry": sidebar only, or settings only

Settings → Plugins → dsh-mcp-control gained a card with two options. Pick "Sidebar
only" and the left sidebar grows an icon row that opens the console while the settings
section unregisters; pick "Settings only" and it reverses. One seat at a time, because
a second entry point that silently expires is worse than no second entry point.

The sidebar icon registers into `sidebar.panellist` with the same value as the central
panel's `main` key (`mcp-control`). That is the slot's contract, not a coincidence: a
`panellist` list id addresses the matching `main` panel, the sidebar owns the button,
and the label resolves from list metadata. Get the two ids out of sync and the result
is an icon that does nothing when clicked.

### 2. Deselect before unregistering

Removing the sidebar entry while it is the selected panel would leave the UI parked on
a panel id that no longer exists. So the order is: `layout.selectPanel(null)` first,
then unregister. When the `layout` service is unavailable the call warns and is
skipped — leaving a panel the user can click away from beats aborting the whole
teardown over one warning.

### 3. The preference lives in `state.json`, never in `cordis.patch.yml`

A patch file states composition: what got inserted, whose `disabled` got overridden.
"Where does the panel live" is read by no composition at all — it is one value the
client needs before it registers slots. Writing it into the patch would wake the patch
watcher to replay composition on every click, for a field nothing reads.

So it goes to `$DSH_HOME/dsh-mcp-control/state.json`, written as "write `.tmp`, then
`rename`" for an atomic replace.

### 4. Invalid values: fall back when reading, refuse when writing

One whitelist, two directions. Reading (`sanitizePanelEntry`) falls back to the default
and **never writes back**, because a failed read and a user decision must stay
distinguishable — guessing "what it was last time" collapses them into one. Writing
(`writePanelEntry`) answers 400 and writes nothing, because an instruction is not a
memory: when it is ambiguous, the right move is to ask, not to pick.

A corrupt state file is reported as `panelEntryError`; the panel still works on the
default seat, and the file is **not** overwritten — it is the only evidence of what
broke.

### 5. The default is `settings`, not `sidebar`

The reference implementation defaults to the sidebar. This one does the opposite for a
single reason: **an upgrade must not move a panel nobody asked to move**. Through 1.0.x
this plugin lived in Settings; making the new seat the default would hide the page from
every existing user on upgrade. The new seat stays inert until someone chooses it.

### Unchanged

Toggle semantics, the `estTokens` definition, backup policy, HOME-layer writes, and the
append-only override contract. The existing `settings.section` registration keeps its
id and order, so nobody's settings page moves. All 65 existing tests are untouched;
19 new ones cover this release.
