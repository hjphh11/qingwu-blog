# 珍珠玻璃样式层（从 scaffold 搬来）

本目录的 7 个 CSS 文件**不是手写的**，是从另一个项目 **`D:\zm\scaffold`**（Spring Boot + Vue
的通用后台脚手架）的 `scaffold-vue/src/styles/` **逐字复制**过来的，只做了下面这套**最小改名**。

搬运脚本：[`admin/web/scripts/sync-pearl-css.mjs`](../../../scripts/sync-pearl-css.mjs) ——
scaffold 更新后重跑一次即可，改名规则写死在脚本里，不靠人记：

```bash
cd admin
node web/scripts/sync-pearl-css.mjs
# 源目录不在默认位置时：
# SCAFFOLD_VUE_STYLES=<路径> node web/scripts/sync-pearl-css.mjs
```

## 为什么只改名字

本后台原本有一套暖色 `app.css`（还有 12 个页面在用）。两套样式有 **25 个类名**、
**2 个自定义属性**、**1 个 keyframes** 重名 —— 直接叠加会互相覆盖。所以只给**重名的那些**
加 `p-` 前缀，其余一字不动：

| 类型 | 改动 | 例子 |
| --- | --- | --- |
| 类名（25 个） | `.X` → `.p-X` | `.btn`→`.p-btn`、`.panel`→`.p-panel`、`.table`→`.p-table`、`.topbar`→`.p-topbar`、`.content`→`.p-content`、`.tag`→`.p-tag`、`.empty`→`.p-empty`、`.field`→`.p-field`、`.kbd`→`.p-kbd`、`.pager`→`.p-pager`、`.stage`→`.p-stage`、`.spacer`→`.p-spacer`、`.mono`→`.p-mono`、`.nav-item`→`.p-nav-item`、`.table-wrap`→`.p-table-wrap`、`.panel-head`→`.p-panel-head`、`.btn-ghost`→`.p-btn-ghost`、`.btn-block`→`.p-btn-block`、`.brand-mark`→`.p-brand-mark`、`.login-brand`/`.login-card`、`.form-grid`、`.md`、`.preview`、`.spin` |
| 自定义属性（2 个） | `--line` / `--line-strong` → `--p-line` / `--p-line-strong`（与 `theme.css` 的暖色同名变量冲突） | — |
| keyframes（1 个） | `spin` → `p-spin`（`app.css` 也有 `spin`） | — |
| 挂载点 | `#app` → `#app, #root`（本后台挂在 `#root`） | — |

⚠️ **注意**：改名正则要求类名后面不跟 `-`，所以 `btn-primary` / `btn-secondary` /
`btn-text` / `btn-danger` / `btn-sm` **没有**加前缀，必须原样使用。
组件里一律通过 [`pearl/cls.js`](../../pearl/cls.js) 生成类名，它会自动处理这套映射 ——
**不要手写 `btn` / `panel` / `table` 这类字符串**，否则拿不到珍珠玻璃的样式。

`styles/pearl-local.css` 是本后台自己的补充层（React 版需要的过渡、未迁移页面的临时容器、
对比度修正的令牌覆盖），**不要往本目录的 7 个文件里加东西**，否则重跑同步脚本会覆盖掉。

## 来源与许可

- 来源项目：`D:\zm\scaffold`（通用后台管理脚手架，MIT License）
- 版权：Copyright (c) 2026 wbr664393425-lgtm
- 本项目（清吾博客）同為 MIT；按 MIT 要求**保留上述版权与许可声明**。
- 只搬了 CSS（样式），没有搬它的 Vue 组件、后端或任何运行时依赖。
