// 统一列表页（ListPage）：端口自 scaffold 的 business/ListPage.vue。
//
// 结构：页面头 → 查询区 → 表格面板（刷新 / 导出 / 批量条）→ 分页。
// Vue 版把 list（useListPage 返回值）整个传进来、从里面读 loading/rows/total/page…
// React 版改成扁平 props（见下面签名），页面自己持有查询 state。
//
// 与 Vue 源的差异（都是框架/模块不可用导致的，逐条列明）：
//   1. list.* → 扁平 props：rows/loading/total/page/pageSize/onPage/onPageSize/onRefresh/
//      onExport/exporting/canExport/selected/onSelected。
//      Vue 的 list.search() / list.reset() 在 React 里没有对应物（查询 state 归页面所有），
//      所以额外收 onSearch / onReset；不传时回落到 onRefresh。
//   2. isTree 在 Vue 里是 `'tree' in props.list`；这里收一个可选 tree，
//      没传时按 rows 里有没有 children 字段推断（树形数据唯一的信号）。
//   3. 页头的「全部展开 / 全部收起」两个 IconButton 不搬：它们要调用 DataTable 的
//      defineExpose 命令式 expandAll/collapseAll，而本任务的 DataTable 约定不暴露它们。
//   4. floatBarEnter/floatBarLeave（GSAP）与 Teleport 不搬：.float-bar 是 position: fixed，
//      原地渲染即可（约定如此）。
//   5. altView / #alt 版式不搬（不在本文件要实现的 props 里）。
import { useMemo, useRef } from 'react';
import { Download, RefreshCw } from '../../icons.js';
import { cls } from '../cls.js';
import { useEntrance } from '../useEntrance.js';
import PageHeader from '../ui/PageHeader.jsx';
import Panel from '../ui/Panel.jsx';
import DataTable from '../ui/DataTable.jsx';
import Pagination from '../ui/Pagination.jsx';
import IconButton from '../ui/IconButton.jsx';
import Button from '../ui/Button.jsx';
import SearchForm from './SearchForm.jsx';

export default function ListPage({
  title,
  desc,
  spec,
  actions,
  before,
  meta,
  tableTitle = '数据列表',
  columns = [],
  rowKey = 'id',
  rows = [],
  loading = false,
  total = 0,
  page = 1,
  pageSize = 10,
  onPage,
  onPageSize,
  onRefresh,
  onExport,
  exporting = false,
  canExport = false,
  /** 表格面板标题前的状态灯：'ok' | 'info' | 'danger'（不传就没有点） */
  status,
  selectable = false,
  selected = [],
  onSelected,
  search,
  onSearch,
  onReset,
  tools,
  batch,
  emptyText,
  /** 空态说明与图标（透传给 DataTable 的 EmptyState） */
  emptyDesc,
  emptyIcon,
  minWidth,
  side,
  tree,
  /** 单元格自定义渲染（透传给 DataTable，Vue 里对应的是一组 cell-<key> 插槽） */
  renderCell,
  onRowClick,
  children,
}) {
  const rootRef = useRef(null);
  // .page 根节点要补 is-entrance-ready，否则 .reveal 元素一直是 opacity: 0。
  // 必须走 state（不能手写 classList —— React 重渲染会整体重写 className）。
  const ready = useEntrance();

  const inferredTree = useMemo(() => rows.some((row) => row && Array.isArray(row.children)), [rows]);
  const isTree = tree === undefined ? inferredTree : tree;

  // Vue 的面板副标题写死「共 N 条」；这里允许页面用 meta 覆盖
  const panelMeta = meta !== undefined ? meta : `共 ${total} 条`;

  return (
    <div className={cls('page', ready && 'is-entrance-ready')} ref={rootRef}>
      <PageHeader title={title} desc={desc} spec={spec} actions={actions} />

      {/* before（置顶区 / 顺序调整这类"要先处理的东西"）与下面的列表块**必须包在同一个
          .stack 里**，否则它俩是 .page 下的兄弟节点、而 .page 没有竖向 gap，两块面板会
          直接贴在一起（用户截图：友链页的「顺序调整」和「友链」中间没有间距）。 */}
      <div className={cls('stack')}>
        {/* 页头下方的整宽内容（视图切换、概览横带等） */}
        {before}

        <div className={side ? cls('split') : undefined}>
          {side ? <aside className={cls('split-side', 'm-surface', 'reveal')}>{side}</aside> : null}
          <div className={cls('stack')}>
          {search ? (
            <SearchForm loading={loading} onSearch={onSearch ?? onRefresh} onReset={onReset ?? onRefresh}>
              {search}
            </SearchForm>
          ) : null}

          <Panel
            className={cls('reveal')}
            title={tableTitle}
            meta={panelMeta}
            status={status}
            tools={
              <>
                {tools}
                <IconButton icon={RefreshCw} label="刷新" bordered onClick={onRefresh} />
                {canExport ? (
                  <IconButton
                    icon={Download}
                    label="导出当前查询结果"
                    bordered
                    disabled={exporting}
                    onClick={onExport}
                  />
                ) : null}
              </>
            }
          >
            <DataTable
              columns={columns}
              data={rows}
              rowKey={rowKey}
              selectable={selectable}
              selected={selected}
              onSelected={onSelected}
              loading={loading}
              emptyText={emptyText}
              emptyDesc={emptyDesc}
              emptyIcon={emptyIcon}
              tree={isTree}
              minWidth={minWidth}
              renderCell={renderCell}
              onRowClick={onRowClick}
            />

            {/* 树形表格不分页（与 Vue 的 v-if="!isTree" 一致） */}
            {isTree ? null : (
              <Pagination
                total={total}
                page={page}
                pageSize={pageSize}
                onPage={onPage}
                onPageSize={onPageSize}
              />
            )}
          </Panel>
          </div>
        </div>
      </div>

      {/* 批量操作浮条：勾选后从底部升起 */}
      {selectable && selected.length > 0 ? (
        <div className={cls('float-bar')} role="region" aria-label="批量操作">
          <span className={cls('float-bar-count')}>
            已选 <b className={cls('tnum')}>{selected.length}</b> 项
          </span>
          <span className={cls('float-bar-sep')} aria-hidden="true" />
          {batch}
          <Button
            variant="text"
            size="sm"
            className={cls('float-bar-clear')}
            onClick={() => onSelected?.([])}
          >
            取消选择
          </Button>
        </div>
      ) : null}

      {children}
    </div>
  );
}
