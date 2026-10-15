# 发版流程（每一步都要做，缺一步就会留下不一致）

**GitHub 的 tag 和 Release 是两个不同的对象。** `git push origin vX.Y.Z` 只推送 tag；
`/releases` 页面上的 Release 必须**另外创建**。这个坑在姊妹项目
（`dsh-skill-router`）上真实发生过：连续 14 个版本 tag 页有、Release 页没有，
直到有人翻发行版页面才发现——**那种不一致不会给任何人发通知。**

## 什么时候才发版

**版本号只在插件行为变化时才动。** 判断标准是"装上它的人会不会观察到不同"：

| 改动 | 是否发版 |
|---|---|
| `index.js` / `client.js` 的行为、`package.json` 的元数据（入口、`dsh.bundle`、`files`、`dsh.requires`） | **要**，补丁位 +1 |
| `cordis.patch.yml` 的插件行（短 id、name） | **要**，且是破坏性的——已安装的 profile 会留下孤儿行 |
| 文档、测试、CI、`tools/` 脚本 | **不要**，直接提交 `main` |

文档、测试、工具脚本没有版本号也能正常工作，给它们发版会让版本历史看起来像
"插件更新了很多次"。`test/release-consistency.test.mjs` 里**有意不检查**
"当前版本必须有发布说明"——那条会变成"仓库每次有改动就得发一版"的强制来源。
检查是用来防"漏建 Release"的，不该被用来给"每次提交都发版"背书。

## 顺序（只在发版时执行）

```sh
# 1. 改版本号：两处必须一致，test/package-contract.test.mjs 会核对
#    ① package.json 的 version
#    ② client.js 的 const VERSION = 'X.Y.Z'
#       —— 这一处是面板底部印出来的那个号，漏改会让界面说谎

# 2. 写发布说明：单文件双语，中文在前，必须含 "## English" 一节，
#    且整个文件**恰好一个 H1**（英文节用 ## English，不另起大标题）
#    docs/release-notes-vX.Y.Z.md

# 3. 全套测试（含 docs-parity：双语结构、编码、发布说明格式）
npm test

# 4. 提交、打标签、推送
git add -A
git commit -m "..."
git tag -a vX.Y.Z -m "vX.Y.Z — <一句话>"
git push origin main && git push origin vX.Y.Z

# 5. 创建 GitHub Release（必须另做，第 4 步不会替你完成）
node tools/publish-release.mjs            # 当前版本
node tools/publish-release.mjs --check    # 只检查有没有 Release，不创建
node tools/publish-release.mjs --all      # 回填所有缺 Release 的版本
```

第 5 步的脚本会读 `package.json` 的版本、读 `docs/release-notes-vX.Y.Z.md`、
用它的 H1 作标题、全文作正文来创建 Release；已存在则跳过，所以重复执行是安全的。

需要 `gh` 已登录（或 `GH_TOKEN` 环境变量）。

### 如果第 5 步抛 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**症状**：`node tools/publish-release.mjs` 直接失败，`TypeError: fetch failed`，
cause 是 `unable to verify the first certificate`（`code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'`）。

**原因**：本机存在 TLS 拦截（代理或安全软件替换了证书链），而 Node 默认**不读**
Windows 证书存储，所以它不认那张拦截证书。

**解法**：让 Node 使用系统证书存储。

```sh
node --use-system-ca tools/publish-release.mjs
```

**适用条件**：这个参数等于让 Node 信任系统证书存储里的拦截证书。只在**你确认本机
拦截来源可信**时使用——在不受控的环境里加它是在降低安全性，不要无脑复制这条命令。

## 为什么要有"发布说明"这一步，而不是直接写 commit

因为 Release 页面上的正文是**给人看的**，commit 是给 diff 看的。
用户升级前想知道的是"装上它我会观察到什么不同"，不是"你改了哪三行"。
`## English` 一节不是为了好看——它让不会中文的读者也能判断要不要升级，
而 `test/docs-parity.test.mjs` 会检查它非空、且**不含中文**。

## 检查清单

| 步骤 | 验证方式 |
|---|---|
| 版本号两处一致 | `npm test` → `package-contract` 里的版本断言 |
| 发布说明双语且中文在前 | `npm test` → `docs-parity` |
| 发布说明恰好一个 H1、文件名规范 | `npm test` → `docs-parity` + `release-consistency` |
| README 的测试表与脚本链一致 | `npm test` → `release-consistency` |
| `docs/` 里有当前版本的说明 | `npm test` → `release-consistency` |
| tag 已推送 | `git ls-remote --tags origin` 里有 `vX.Y.Z` |
| **Release 已创建** | `node tools/publish-release.mjs --check`，或打开 `/releases` |
