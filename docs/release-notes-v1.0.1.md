# v1.0.1 — CI 抓到的两个真问题

[English](#english) | 中文

**这是一次"跑起来才发现"的补丁。** 两个问题都不是靠读代码发现的：一个来自 Linux 上
第一次跑 CI，另一个藏在毫秒级时间戳里——**备份会在同毫秒内互相覆盖**，
也就是说，那个"写前备份"的功能，在最需要它的时候可能根本没留下东西。

---

## 改了什么

### 1. 备份名前加了序号（真 bug，会丢数据）

备份原来叫 `cordis.patch.yml.backup-<ISO时间戳>`。时间戳只有**毫秒**精度，
所以同一毫秒内的第二次写入会拿到**同一个文件名**，`writeFile` 直接**覆盖**第一份——
而"备份"这个功能存在的全部意义，就是那份被覆盖的东西。

这不是理论问题。CI 在 **Linux + Node 24** 上跑现有的清理测试（写 12 次开关、
期望保留最新 10 份），数出来是 **8**：只有 8 个不同的毫秒溜过去了，
四份备份在生成的同时就被抹掉了。Windows 上三个 Node 版本全绿——因为文件系统慢一点，
每次写入都跨过了毫秒边界。**一个只有在快机器上才暴露的数据丢失 bug。**

现在名字是 `<文件>.backup-<时间戳>-<两位序号>`：

- 序号是**零填充**的。`pruneBackups` 按文件名字典序裁掉旧的，
  不填充的话 `-10` 会排在 `-9` 前面，裁掉的就不是最旧的了。
- 序号在写之前挑一个当前没被占用的，所以并发/连续的写入各留各的。
- 超过 99 次同毫秒写入时兜底加随机后缀——实际上到不了（每次写入都是完整的
  异步读写周期），留着只是不让时钟的极端情况再次造成碰撞。

### 2. 一条只在 Linux 上炸的断言（实现是对的，测试是错的）

```
+ actual   'C:\\custom/cordis.patch.yml'
- expected 'C:\\custom\\cordis.patch.yml'
```

`resolveHomePatchPath` 是跨平台的，拼路径用 `path.join`。错的是测试：它把期望值
写死成 Windows 路径，于是在 Linux 上**要求一个跨平台函数产出 Windows 路径**。

改法不是删断言、也不是按平台分叉，而是让期望值和实现用**同一个** `path.join` 构造，
于是断言的是契约（`DSH_HOME` 优先、回落 `~/.dsh`、追加哪个文件名），而不是分隔符。
顺手补了三个此前没有任何测试走到的边界：周围空白要 `trim`、`''` 和纯空白都必须
当作未设置（而不是 `.` 或根目录路径）。

### 3. `AGENTS.md` 修正两处与实测不符的说法

- **"`files` 白名单投影一份副本"只对一半情况成立。** 实测两种形态都存在且行为不同：
  `link:<目录>` 是**符号链接**（源码即运行物，`files` 不参与过滤）；
  `file:<目录>` 才是**经过滤的副本**。机制写反会让人以为改了源码不重装也能生效
  （或反之）——两种误判都要浪费一轮排查。现在要求"用 `readlinkSync` 量，不要假设"。
- **补上 `restart-required` 的真实后果。** 它不是"稍后生效"，而是**旧代码还在服务请求**。
  本插件首次安装时还没有备份代码；22:05 由那个被缓存的旧模块处理的一次开关，
  把 `disabled: true` 写进了 HOME patch，**且没有留下任何 `.backup-` 文件**——
  因为当时运行的代码里根本没有 `backupPatchFile`。响应里没有任何字段提到这一点。
  `persisted: true` 只说明**文件变了**，从来不说明改它的是你刚写的那份代码。

### 4. 测试 62 → 65

新增 `backupNameFor` 的两条纯函数测试（占用即递增、填充保证字典序＝时间序），
以及一条端到端测试：连续 4 次写入必须留下 **4 份不同的**备份文件。

---

## 没改什么

- **契约没动。** 路由、状态码、字段名、`upsertDisabled` 的行级语义、
  覆盖行写在 `insert` 之后、先活后存——全部原样。
- **没有新依赖、没有构建步骤。** 仍然是纯 JS，两个文件，零 `node_modules`。
- **粒度仍然是服务器，不是工具。** 见 `DECISION.md`。
- **`estTokens = bytes / 4` 仍是粗估**，用于排序与量级，不用于对账。

---

## English

**A patch that only running could have produced.** Neither problem came from reading the
code: one appeared the first time CI ran on Linux, and the other was hiding inside a
millisecond-resolution timestamp — **backups could overwrite each other**, meaning the
backup-before-write feature might leave nothing behind exactly when it mattered.

### 1. Backup names gained a sequence suffix (real bug, loses data)

Backups were named `cordis.patch.yml.backup-<ISO stamp>`. The stamp has only
**millisecond** resolution, so a second write in the same millisecond received the **same
filename** and `writeFile` **overwrote** the first copy — and that copy is the entire
point of the feature.

Not theoretical. On **Linux + Node 24** the existing prune test (12 toggles, expecting the
newest 10) counted **8**: only 8 distinct milliseconds had elapsed and four copies were
destroyed as they were created. All three Windows jobs passed — the filesystem is slower
there, so every write crossed a millisecond boundary. **A data-loss bug that only shows up
on a fast machine.**

Names are now `<file>.backup-<stamp>-<nn>`:

- The suffix is **zero-padded**. `pruneBackups` drops the oldest by lexicographic filename
  order; unpadded, `-10` would sort before `-9` and the wrong copy would go.
- The sequence is chosen before writing, so concurrent or successive writes each keep
  their own file.
- Past 99 writes in one millisecond it falls back to a random suffix — unreachable in
  practice, since each write is a full async read/write cycle, but it stops a pathological
  clock from colliding again.

### 2. An assertion that only failed on Linux (implementation right, test wrong)

```
+ actual   'C:\\custom/cordis.patch.yml'
- expected 'C:\\custom\\cordis.patch.yml'
```

`resolveHomePatchPath` is platform-generic; it joins with `path.join`. The test was wrong:
it hardcoded a Windows path and so **demanded that a platform-generic function produce a
Windows path on Linux**.

The fix is neither deleting the assertion nor branching per platform, but building the
expectation with the **same** `path.join` the implementation uses — so it asserts the
contract (`DSH_HOME` wins, falls back to `~/.dsh`, which filename is appended) rather than
a separator. Three previously untested boundaries came along: whitespace is trimmed, and
both `''` and blank mean "unset" (never `.` and never a root-level path).

### 3. Two claims in `AGENTS.md` corrected against measurement

- **"`files` is projected as a filtered copy" holds only half the time.** Both shapes exist
  and behave differently: `link:<dir>` is a **symlink** (the source *is* the running
  artefact; `files` is not applied), while `file:<dir>` really is a **filtered copy**.
  Stating the mechanism backwards makes you believe a source edit either does or does not
  take effect without a reinstall — both mistakes cost a debugging round. The rule is now
  "measure it with `readlinkSync`, do not assume".
- **The documented consequence of `restart-required` was missing.** It does not mean
  "applies later"; it means **the old code is still serving requests**. This plugin was
  first installed *before* the backup code existed; a toggle served by that cached module
  at 22:05 wrote `disabled: true` into the HOME patch and **left no `.backup-` file at
  all**, because the running code had no `backupPatchFile`. Nothing in the response said
  so. `persisted: true` only ever means **the file changed** — never that the code which
  changed it is the code you just wrote.

### 4. Tests 62 → 65

Two pure-function tests for `backupNameFor` (increments on collision; padding keeps
lexicographic order equal to chronological order), plus an end-to-end test: four
consecutive writes must leave **four distinct** backup files.

### Unchanged

The contract (routes, status codes, field names, the line-wise `upsertDisabled` semantics,
the override written after the `insert`, live-first-persist-second); no new dependencies
and no build step; granularity is still the server, not the tool (`DECISION.md`);
`estTokens = bytes / 4` is still a rough estimate for ordering and magnitude only.
