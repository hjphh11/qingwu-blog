// 数据表格（DataTable）：端口自 scaffold 的 ui/DataTable.vue。
//
// 结构、类名、aria 全部照抄。三处与 Vue 版的环境差异：
//   1. Vue 的具名插槽 cell-<key> → React 用 renderCell(row, col) 回调；
//      返回非 undefined 就用它，否则回落成 <span className="cell-text">。
//      树形首列照 Vue 的默认插槽语义，回落成**裸文本**（Vue 那一支没有 .cell-text 外壳）。
//   2. revealRows（GSAP 逐行显现）不可用 → 省略。表格行本身没有 .reveal 类，
//      少的是入场动画，不是终态。
//   3. Vue 的 expandAll/collapseAll 是 defineExpose 的命令式 API，ListPage 用它接
//      「全部展开 / 全部收起」按钮；这里按约定不暴露，展开状态由内部 state 管理。
import { useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { ArrowDown, ArrowUp, ChevronRight } from '../../icons.js';
import { cls } from '../cls.js';
import Checkbox from './Checkbox.jsx';
import EmptyState from './EmptyState.jsx';

/** 骨架屏行数：Vue 里是 v-for="i in 6" */
const SKELETON_ROWS = [1, 2, 3, 4, 5, 6];

/** 收集「有子节点且还没到深度上限」的行 key：首次挂载按 expandDepth 展开用 */
function collectKeys(rows, depthLimit, rowKey, depth = 0, acc = new Set()) {
  rows.forEach((row) => {
    const children = row.children ?? [];
    if (children.length && depth < depthLimit) {
      acc.add(row[rowKey]);
      collectKeys(children, depthLimit, rowKey, depth + 1, acc);
    }
  });
  return acc;
}

export default function DataTable({
  columns = [],
  data = [],
  rowKey = 'id',
  selectable = false,
  selected = [],
  onSelected,
  loading = false,
  emptyText = '暂无数据',
  /** 空态下面那行说明（提示用户下一步做什么） */
  emptyDesc,
  emptyIcon,
  tree = false,
  expandDepth = 1,
  minWidth,
  onRowClick,
  renderCell,
  /**
   * 表头排序：列上标 `sortable: true` 即变成可点表头（CSS 里本来就有
   * `.p-table th.is-sortable` 与 `.sort-ico` 的样式，Vue 版由页面驱动排序）。
   * 不传 `sortValue` 时按 `row[col.key]` 比较；数字比大小，其余按中文拼音序。
   * **不点表头就保持页面给的顺序**（例如文章页的「待发布排最前」）。
   */
  onSortChange,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [sort, setSort] = useState(null);

  function toggleSort(key) {
    setSort((prev) => {
      const next = !prev || prev.key !== key
        ? { key, dir: 'asc' }
        : prev.dir === 'asc'
          ? { key, dir: 'desc' }
          : null; // 第三次点击回到「页面原顺序」
      onSortChange?.(next);
      return next;
    });
  }

  /** 排序后的数据（点了表头才生效） */
  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    const get = col.sortValue ?? ((row) => row[col.key]);
    const list = [...data].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va).localeCompare(String(vb), 'zh-Hans-CN');
    });
    return sort.dir === 'desc' ? list.reverse() : list;
  }, [data, sort, columns]);
  // 只在「第一次拿到数据」时按 expandDepth 展开一次（对应 Vue 的 initialized 标志）
  const initialized = useRef(false);

  useEffect(() => {
    if (!tree || initialized.current || !data.length) return;
    setExpanded(collectKeys(data, expandDepth, rowKey));
    initialized.current = true;
  }, [tree, data, expandDepth, rowKey]);

  // 树形：把 data 按展开状态拍平成可见行；非树形：原样一行一条
  const flatRows = useMemo(() => {
    if (!tree) return sortedData.map((row) => ({ row, depth: 0, hasChildren: false }));
    const list = [];
    const walk = (rows, depth) =>
      rows.forEach((row) => {
        const children = row.children ?? [];
        list.push({ row, depth, hasChildren: children.length > 0 });
        if (children.length && expanded.has(row[rowKey])) walk(children, depth + 1);
      });
    walk(sortedData, 0);
    return list;
  }, [tree, sortedData, expanded, rowKey]);

  const keys = flatRows.map((item) => item.row[rowKey]);
  const allChecked = keys.length > 0 && keys.every((k) => selected.includes(k));
  const someChecked = !allChecked && keys.some((k) => selected.includes(k));
  const colspan = columns.length + (selectable ? 1 : 0);

  function toggleAll() {
    onSelected?.(allChecked ? [] : [...keys]);
  }

  function toggleRow(key) {
    onSelected?.(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  function toggleExpand(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function cellStyle(col) {
    return {
      width: col.width ? `${col.width}px` : undefined,
      minWidth: col.minWidth ? `${col.minWidth}px` : undefined,
      textAlign: col.align,
    };
  }

  /**
   * 单元格内容。plainText=true 用于树形首列：Vue 那支的默认插槽直接输出文本，
   * 没有 .cell-text 外壳，保持逐字一致。
   */
  function cellContent(item, col, plainText) {
    const custom = renderCell ? renderCell(item.row, col) : undefined;
    if (custom !== undefined) return custom;
    const raw = item.row[col.key];
    if (plainText) return raw ?? '—';
    return (
      <span className={cls('cell-text')} title={String(raw ?? '')}>
        {raw ?? '—'}
      </span>
    );
  }

  return (
    <div className={cls('table-wrap')}>
      <table
        className={cls('table')}
        style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
        aria-busy={loading || undefined}
      >
        <thead>
          <tr>
            {selectable ? (
              <th className={cls('col-check')}>
                <Checkbox checked={allChecked} indeterminate={someChecked} label="" onChange={toggleAll} />
              </th>
            ) : null}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cls(col.className, col.sortable && 'is-sortable')}
                style={cellStyle(col)}
                scope="col"
                aria-sort={sort?.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                title={col.sortable ? `${col.title}：点击排序` : undefined}
              >
                <span className={cls('th-inner')}>
                  {col.title}
                  {/* 箭头只在**当前排序列**显示：7 列都挂个 ↑ 太吵，其余列靠 hover 与 title 提示 */}
                  {col.sortable && sort?.key === col.key ? (
                    <MorphIcon
                      className={cls('sort-ico', 'is-on')}
                      icon={sort.dir === 'desc' ? ArrowDown : ArrowUp}
                      size={12}
                      color="currentColor"
                    />
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !data.length ? (
            SKELETON_ROWS.map((i) => (
              <tr key={`sk${i}`}>
                {selectable ? (
                  <td className={cls('col-check')}>
                    <span className={cls('skeleton')} style={{ width: '17px', height: '17px', borderRadius: '5px' }} />
                  </td>
                ) : null}
                {columns.map((col, ci) => (
                  <td key={col.key}>
                    <span className={cls('skeleton')} style={{ width: `${36 + ((i * 7 + ci * 13) % 48)}%` }} />
                  </td>
                ))}
              </tr>
            ))
          ) : !flatRows.length ? (
            <tr>
              <td colSpan={colspan} style={{ height: 'auto' }}>
                <EmptyState title={emptyText} desc={emptyDesc} icon={emptyIcon} />
              </td>
            </tr>
          ) : (
            flatRows.map((item) => {
              const key = item.row[rowKey];
              const isOpen = expanded.has(key);
              return (
                <tr
                  key={key}
                  className={cls('data-row', selected.includes(key) && 'is-selected')}
                  style={loading ? { opacity: 0.55 } : undefined}
                  onClick={() => onRowClick?.(item.row)}
                >
                  {selectable ? (
                    // 勾选不触发 row-click：Checkbox 根节点自己 stopPropagation（对应 Vue 的 @click.stop）
                    <td className={cls('col-check')}>
                      <Checkbox checked={selected.includes(key)} onChange={() => toggleRow(key)} />
                    </td>
                  ) : null}
                  {columns.map((col, ci) =>
                    tree && ci === 0 ? (
                      <td key={col.key} className={cls(col.className) || undefined} style={{ textAlign: col.align }}>
                        <span className={cls('tree-cell')} style={{ paddingLeft: `${item.depth * 20}px` }}>
                          <button
                            type="button"
                            className={cls('tree-toggle', !item.hasChildren && 'is-leaf', isOpen && 'is-open')}
                            aria-label={isOpen ? '收起' : '展开'}
                            aria-expanded={item.hasChildren ? isOpen : undefined}
                            tabIndex={item.hasChildren ? 0 : -1}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpand(key);
                            }}
                          >
                            <MorphIcon icon={ChevronRight} size={14} color="currentColor" />
                          </button>
                          {cellContent(item, col, true)}
                        </span>
                      </td>
                    ) : (
                      <td key={col.key} className={cls(col.className) || undefined} style={{ textAlign: col.align }}>
                        {cellContent(item, col, false)}
                      </td>
                    ),
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
