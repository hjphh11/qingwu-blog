# 把一页旧暖色页面改写成珍珠玻璃：改写规范

> 这份文件是给「正在把某一张 `admin/web/src/pages/*.jsx` 改成珍珠玻璃样式」的人/智能体看的。
> 完整样板见已经改好的 `pages/Articles.jsx`（列表页）与 `pages/Overview.jsx`（仪表盘页）。

## 一句话原则

**只换呈现层，逻辑一行不丢。** 先完整读一遍现有页面，把接口调用、state、校验、排序、确认、错误处理原样保留；
标签、类名、组件换成珍珠玻璃那一套。改完要能逐条对照出「原来有的能力现在都还在」。

## 一、组件在哪（全部现成，别自己造）

| 需要什么 | 用什么 | 关键 props |
| --- | --- | --- |
| 列表页整套骨架（页面头 → 查询区 → 表格面板 → 分页） | `../pearl/business/ListPage.jsx` | `title/desc/status/actions/before/meta/tableTitle/columns/rows/rowKey/loading/total/page/pageSize/onPage/onPageSize/onRefresh/search/onSearch/onReset/tools/batch/emptyText/emptyDesc/minWidth/renderCell/onRowClick` |
| 查询区外壳 | `../pearl/business/SearchForm.jsx` | `loading/onSearch/onReset`（用 ListPage 时它自己会渲染） |
| 表单字段 | `../pearl/ui/Field.jsx` | `label/required/error/hint/wide/group` |
| 文本 / 下拉 / 开关 / 勾选 | `TextInput.jsx` `Select.jsx` `Switch.jsx` `Checkbox.jsx` | `value/onChange`（`onChange` 收**值**，不是事件）；`Switch` 另有 `ariaLabel` 供"只有开关不显示文字"的紧凑形态 |
| 表格 | `../pearl/ui/DataTable.jsx` | 列：`{ key, title, width, minWidth, align, className, sortable, sortValue }`；单元格自定义用 `renderCell(row, col)`；行操作列给 `className: 'col-actions'` 让它吸附右侧 |
| 面板 / 页面头 / 区块标题 | `Panel.jsx` `PageHeader.jsx` `SectionLabel.jsx` | `Panel`: `title/meta/tools/status`；`SectionLabel`: `title/status` |
| 标签 / 状态标签 | `Tag.jsx` `StatusTag.jsx` | `tone`: `ok`(青柠) / `info`(蓝) / `danger`(红) / `neutral`(灰)，可加 `dot` |
| 按钮 | `Button.jsx` `IconButton.jsx` | `variant`: `primary/secondary/ghost/text/danger`；`size`: `md/sm`；`icon` 传 **lucide IconNode**（不是字符串）；其余属性会透传（`title/autoFocus/aria-*`） |
| 弹窗 / 确认 | `Modal.jsx` + `../pearl/ui/confirm.js` | `Modal`: `open/onClose/title/sub/width/footer/closeOnOverlay`；确认：`const ok = await confirm({ title, message, confirmText, danger })` —— **不要再用 `window.confirm`** |
| 悬停提示 | `HoverCard.jsx` | 触发元素作 `children`，`content` 放浮层内容 |
| 读数 / 刻度 / 图表 | `Metric.jsx` `Odometer.jsx` `DeltaPill.jsx` `SpecPlate.jsx` `Segmented.jsx` + `../pearl/charts/*` | 图表：`TrendChart/BarChart/TickRing/HeatGrid/Swimlane`（自绘 SVG，**不要引图表库**） |
| 空态 / 头像 / 提示牌 | `EmptyState.jsx`（`title/desc/icon`）`Avatar.jsx` `ToastHost.jsx` | 提示：`import { pushToast, toastError } from '../pearl/toast.js'` |
| 图标 | `import { MorphIcon } from 'morphicons/react'`；图标组件从 `../icons.js` 取 | `icons.js` **没有** `Check/Github/Home/BarChart3`，需要就内联 SVG |

## 二、四条硬性规则（踩过坑的）

1. **类名必须走 `cls()`**：`import { cls } from '../pearl/cls.js'`。
   它与旧暖色 `app.css` 有 **25 个重名类**：`panel` `panel-head` `btn` `btn-ghost` `btn-block` `table` `table-wrap`
   `tag` `empty` `field` `kbd` `mono` `pager` `spacer` `nav-item` `brand-mark` `stage` `topbar` `content` `preview`
   `form-grid` `md` `spin` `login-brand` `login-card`。pearl 样式里这些已加 `p-` 前缀，cls() 负责补。
   ⚠️ **手写这些字符串会静默拿到旧暖色样式**（已踩：`Panel.jsx` 里手写 `className="panel-head"`，导致面板头一直用旧样式、标题 17px）。
   注意 `btn-primary` / `btn-sm` 这类**没有**改名，原样写。
2. **页面自建 `.page` 根节点时**入场类要由 state 驱动：
   ```jsx
   const ready = useEntrance();               // 不接参数，返回布尔值
   <div className={cls('page', ready && 'is-entrance-ready')}>
   ```
   （用 `ListPage` 则它内部已处理；`.page:not(.is-entrance-ready) .reveal` 会是 `opacity:0`。）
3. **不要把组件定义在组件内部**——旧后台踩过「输入框每打一个字就丢焦点」。
4. **不要手写暖色类名**：`card` `panel` `table` `btn` `tag` `post-list` `filter-bar` `stats` `hint` `chip`
   这些都是旧样式；珍珠玻璃里换成上面的组件。

## 三、页面骨架（照这个排）

```
.page
├─ 页面头：标题 + 说明 + 右侧主操作（ListPage 的 title/desc/actions，或自写 .page-head）
├─ before（可选）：页头下方的整宽内容（如「置顶区」这种要先处理的东西）
├─ 查询区：SearchForm（字段用 Field 包起来，每个字段可给 hint 说明）
├─ 面板：Panel（title = 表格名，meta = 共 N 条，tools = 刷新/导出/批量入口）
│   ├─ DataTable（列定义 + renderCell）
│   └─ Pagination（ListPage 已内置）
└─ （可选）批量浮条：selectable + batch
```

## 四、状态灯（`status`）

`Panel` / `SectionLabel` / `ListPage` 都收 `status`：

| 值 | 颜色 | 什么时候用 |
| --- | --- | --- |
| `'ok'` | 青柠 | 数据正常、没有待处理 |
| `'info'` | 蓝 | **有未保存改动 / 有待发布 / 有待审批** |
| `'danger'` | 红 | 数据有问题（解析失败、文件损坏） |
| 不传 | 不画 | 纯信息面板（读数、占比、只读明细）—— 别加装饰 |

## 五、验收（每页都要做）

```bash
cd D:\zm\gerbok\admin
npx --no-install esbuild web/src/pages/<你的页面>.jsx --outfile=NUL   # 语法
# 不要跑 npm run build：多页并行时会抢 dist
```
回报时必须写清：**保留的原有能力清单**、用了哪些 pearl 组件、拿不准或降级处理的地方、语法检查结果。

页面改完后，路由名要加进 `pearl/layout/PearlShell.jsx` 的 `PEARL_PAGES`（否则会被套进 `.legacy-slot` 暖色容器）——
这一步由集成方统一做，改页的人不用碰 `PearlShell.jsx`。
