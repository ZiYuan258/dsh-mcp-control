# v1.2.1 — 面板换到侧栏以后，终于能往下滚了

[English](#english) | 中文

**这是一个 bug 修复版。** 1.2.0 加了面板入口选项，可以把它放到左侧边栏。放到侧栏以后，
目录页（以及任何超出一屏的页面）**滚不动**——内容被裁掉，滚轮没有东西可滚。
设置页座位一直正常，所以这个缺陷只在「仅侧栏」下出现。

---

## 改了什么

### 1. 侧栏座位下面板自己滚

`main` 槽的宿主是 `.mainPanel`，规则是 `flex: 1; min-height: 0; display: flex`——**没有 `overflow`**；
它的祖辈 `.centerCol` 是 `overflow: hidden`。也就是说这个座位里**没有任何人替面板滚**，
超出一屏的内容直接被裁掉，滚轮自然找不到可滚的东西。

设置页座位相反：节内容包在一个 `overflow-y: auto` 的容器里，外面已经在滚。
这也解释了为什么同一个页面在两个座位下的表现不同。

改法是让页面知道自己坐在哪个座位：`main` 座位注册时传 `seat: 'main'`，只在那一个座位加上

```css
.mcc-pageMain { flex: 1 1 auto; min-height: 0; padding: 20px 24px 0; }
.mcc-bodyMain { flex: 1 1 auto; min-height: 0; overflow-y: auto;
                overscroll-behavior: contain; scrollbar-gutter: stable; }
```

设置页座位不加这两条，避免出现双滚动条。

### 2. 页面结构拆成「tab 栏固定 + 内容滚动」

原来四个视图和 tab 栏是同一个容器的兄弟节点，容器一滚，tab 栏会跟着滚走。
现在外层只放 tab 栏与版本号，中间那一层才是滚动区。这样滚的只有内容，切 tab 的按钮一直在原位。

`overscroll-behavior: contain` 是配套的：滚到底之后不会把滚动传递给宿主页面。
`scrollbar-gutter: stable` 让滚动条出现时不挤动布局。

## 没改什么

开关语义、token 成本估算、备份、安装/卸载的三层删除守卫、调用记录、扫描导入、目录搜索，
全部原样。HTTP API 的形状一个字段都没动。

## 升级

源码即生效（profile 里是 `link:` 规格），重启 DSH 后侧栏面板可以正常滚动。
原有的 152 项测试全部保留，新增 1 项覆盖座位与滚动归属，共 **153 项**。

## English

**A bug-fix release.** 1.2.0 added the panel-entry option, which lets the console live in
the left sidebar. In that seat, the catalog page — and anything else taller than one
screen — could not scroll. The content was clipped, and the wheel had nothing to scroll.
The settings seat was always fine, so the defect only appeared under "sidebar only".

### What changed

**1. The panel scrolls itself in the sidebar seat.** The `main` slot's host is
`.mainPanel`, whose rule is `flex: 1; min-height: 0; display: flex` — with **no
`overflow`** — and its ancestor `.centerCol` is `overflow: hidden`. Nobody scrolls for the
panel in that seat, so content beyond one screen was clipped and the wheel had nothing to
grab. The settings seat is the opposite: the section body already sits inside an
`overflow-y: auto` container. That is why the same page behaved differently in the two seats.

The fix tells the page which seat it occupies: the `main` registration passes
`seat: 'main'`, and only that seat gets the two rules above. The settings seat gets
neither, so no double scrollbar appears.

**2. The page now splits into a fixed tab bar and a scrolling body.** The four views used
to be siblings of the tab bar inside one container, so scrolling the container also
scrolled the tab bar away. The outer layer now holds only the tab bar and the version
line, and the middle layer is the scroll region. Only the content moves; the tab buttons
stay put.

`overscroll-behavior: contain` keeps a scroll that reaches the end from propagating to the
host page, and `scrollbar-gutter: stable` stops an appearing scrollbar from shifting the layout.

### What did not change

Toggle semantics, token-cost estimation, backups, the three-layer removal guard for
install/uninstall, the call log, config scanning, and catalog search are all untouched.
No field of the HTTP API changed.

### Upgrading

Source takes effect directly (the profile uses a `link:` spec); restart DSH and the
sidebar panel scrolls. All 152 existing tests are kept, plus one new test covering the
seat and who owns the scrolling — **153 in total**.
