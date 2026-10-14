// 操作日志（方案 §4.13 / 第 43 条）：只记关键操作 —— 发布 / 回滚 / 审批友链 / 定时发布。
//
// 组件级珍珠玻璃版：
//   · 页面上方 = **泳道时间线**（scaffold 的 `Swimlane`）：泳道 = 动作类型，每格 6 小时，
//     有失败的格子红描边；这是"这些操作发生在什么时候、密不密"的一眼可见的答案。
//   · 下方 = 统一列表页（`ListPage` + `DataTable`）：时间 / 动作 / 内容 / 结果 / 文件，
//     列可排序、可分页 —— 需要逐条核对时用它。
//
// ⚠️ 动作 → 中文标签这张表**要跟着后端一起长**：阶段 J 加了 approve/reject/reopen、
//    阶段 K 加了 publish-scheduled，一开始没补，日志页就把它们原样显示成英文 action
//    （阶段 L 的回归扫出来的）。这里保留同一条约束。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, RefreshCw, ScrollText } from '../icons.js';
import { cls } from '../pearl/cls.js';
import { toastError } from '../pearl/toast.js';
import ListPage from '../pearl/business/ListPage.jsx';
import Button from '../pearl/ui/Button.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import Swimlane from '../pearl/charts/Swimlane.jsx';

/** 动作 → 中文标签 + 珍珠玻璃的四色语义（ok 青柠 / info 蓝 / danger 红 / neutral 灰） */
const ACTION = {
  publish: { label: '发布', tone: 'ok' },
  'publish-scheduled': { label: '定时发布', tone: 'ok' },
  rollback: { label: '回滚', tone: 'danger' },
  approve: { label: '通过友链', tone: 'ok' },
  reject: { label: '拒绝友链', tone: 'danger' },
  reopen: { label: '改回待审批', tone: 'info' },
  delete: { label: '删除内容', tone: 'danger' },
};

const actionOf = (a) => ACTION[a] ?? { label: a || '未知操作', tone: 'neutral' };

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN');
};

const fmtClock = (sec) => {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 这一条算不算失败：动作本身是拒绝/回滚，或结果文案里带失败字样 */
const isFailed = (it) =>
  it.action === 'reject' || it.action === 'rollback' || /(失败|错误|被拒|拒绝|不通过)/.test(it.result ?? '');

/** 每条日志「一句话内容」——原来那套优先级照搬 */
function titleOf(it) {
  const act = actionOf(it.action);
  return (
    it.commit ||
    (it.application ? `友链申请「${it.application.name}」` : '') ||
    it.result ||
    act.label
  );
}

/** 泳道：按动作分组，每 6 小时一格 */
const BUCKET_SEC = 6 * 3600;

const COLUMNS = [
  { key: 'time', title: '时间', width: 180, className: cls('mono'), sortable: true, sortValue: (r) => String(r.time ?? '') },
  { key: 'action', title: '动作', width: 108, sortable: true, sortValue: (r) => actionOf(r.action).label },
  { key: 'title', title: '内容', minWidth: 260 },
  { key: 'result', title: '结果', minWidth: 160 },
  { key: 'files', title: '涉及文件', minWidth: 180 },
];

export default function Logs() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.get('/api/publish/log?limit=200');
      setItems(r.items ?? []);
    } catch (err) {
      setError(err.message || '读取失败');
      toastError(err, '读取操作日志失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 泳道数据：动作 → 泳道，6 小时一格 */
  const lanes = useMemo(() => {
    if (!items?.length) return [];
    const byAction = new Map();
    for (const it of items) {
      const sec = Date.parse(it.time) / 1000;
      if (!Number.isFinite(sec)) continue;
      const key = it.action || 'other';
      if (!byAction.has(key)) byAction.set(key, new Map());
      const bucket = Math.floor(sec / BUCKET_SEC);
      const m = byAction.get(key);
      const cur = m.get(bucket) ?? {
        startSec: bucket * BUCKET_SEC,
        endSec: (bucket + 1) * BUCKET_SEC,
        count: 0,
        failed: 0,
        maxCost: 0,
      };
      cur.count += 1;
      if (isFailed(it)) cur.failed += 1;
      m.set(bucket, cur);
    }
    return [...byAction.entries()]
      .map(([action, m]) => {
        const blocks = [...m.values()].sort((a, b) => a.startSec - b.startSec);
        return {
          module: actionOf(action).label,
          count: blocks.reduce((n, b) => n + b.count, 0),
          failed: blocks.reduce((n, b) => n + b.failed, 0),
          blocks,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const rows = items ?? [];
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  const failedCount = rows.filter(isFailed).length;

  const renderCell = (row, col) => {
    switch (col.key) {
      case 'action': {
        const act = actionOf(row.action);
        return (
          <Tag tone={act.tone} dot>
            {act.label}
          </Tag>
        );
      }
      case 'time':
        return <span className={cls('mono')}>{fmt(row.time)}</span>;
      case 'title':
        return (
          <div>
            <div style={{ fontWeight: 600 }}>{titleOf(row)}</div>
            {row.application?.url ? (
              <div className={cls('mono')} style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                {row.application.url}
              </div>
            ) : null}
            {row.reason ? (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>原因：{row.reason}</div>
            ) : null}
          </div>
        );
      case 'result':
        return row.result ? (
          <span style={isFailed(row) ? { color: 'var(--red-text)' } : undefined}>{row.result}</span>
        ) : (
          <span className="faint">—</span>
        );
      case 'files':
        if (!Array.isArray(row.files) || row.files.length === 0) return <span className="faint">—</span>;
        return (
          <span className={cls('mono')} title={row.files.join('\n')} style={{ fontSize: 12 }}>
            {row.files.slice(0, 2).join(', ')}
            {row.files.length > 2 ? ` 等 ${row.files.length} 个` : ''}
          </span>
        );
      default:
        return undefined;
    }
  };

  return (
    <ListPage
      title="操作日志"
      desc="发布 / 回滚 / 审批记录 · 存在服务器本地，不会同步到别处"
      status={error ? 'danger' : failedCount > 0 ? 'info' : 'ok'}
      actions={<IconButton icon={RefreshCw} label="刷新" bordered disabled={busy} onClick={load} />}
      before={
        error ? (
          <div className="alert alert-error" role="alert">
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>{error}</span>
          </div>
        ) : lanes.length > 0 ? (
          <Panel
            title="操作时间线"
            meta="每格 6 小时 · 红描边＝这一格里有失败"
            status="info"
            className="reveal"
            tools={<span className="hint">共 {rows.length} 条记录{failedCount ? ` · 其中 ${failedCount} 条失败` : ''}</span>}
          >
            <Swimlane lanes={lanes} maxLanes={8} nowSec={Math.floor(Date.now() / 1000)} />
          </Panel>
        ) : null
      }
      tableTitle="操作明细"
      columns={COLUMNS}
      rows={pageRows}
      rowKey="time"
      renderCell={renderCell}
      loading={busy || items === null}
      total={rows.length}
      page={current}
      pageSize={pageSize}
      onPage={setPage}
      onPageSize={(n) => {
        setPageSize(n);
        setPage(1);
      }}
      onRefresh={load}
      canExport={false}
      emptyText={error ? '读取失败' : '还没有记录'}
      emptyDesc={error ? '点右上角刷新重试' : '发过一次之后就有了'}
    />
  );
}
