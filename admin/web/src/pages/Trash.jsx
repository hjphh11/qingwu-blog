// 回收站（珍珠玻璃版）：软删除的内容可以恢复或彻底清除（方案 §4.11，决策 14 / 42）。
//
// ⚠️ 功能与旧版（暖色 Trash.jsx）**完全一致**：
//   列表读取（GET /api/trash）、恢复（POST …/restore）、彻底清除（POST …/purge）、
//   按类型筛选、破坏性操作要确认。改动只在呈现层：
//   - 旧版整页只有「列表 + 两个图标按钮」，这里换成 scaffold 的统一列表页骨架
//     （页面头 → 查询区 → 表格面板 → 分页），类型/标题/删除时间都变成可排序的列；
//   - 确认弹窗从 window.confirm 换成珍珠玻璃的 confirm()（ConfirmHost），
//     「彻底清除」的文案里写明不可恢复；
//   - 顶部两条自绘 alert 换成 toast（pushToast / toastError）；读取失败仍会在
//     空表处就地写出来，方便排查后台服务没起来的情况。
//
// 新增（不删旧能力，纯增量，容易回退）：关键词筛选、分页、单行请求期间禁用按钮。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { FileText, Inbox, Link2, Quote, RotateCcw, Search, Trash as TrashIcon } from '../icons.js';
import ListPage from '../pearl/business/ListPage.jsx';
import { cls } from '../pearl/cls.js';
import { pushToast, toastError } from '../pearl/toast.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import Field from '../pearl/ui/Field.jsx';
import HoverCard from '../pearl/ui/HoverCard.jsx';
import Select from '../pearl/ui/Select.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

/**
 * 条目类型 → 中文名 / 语义色 / 图标。
 * 类型名来自服务端（server/trash.js 的 `<type>--<key>--<时间戳>.json`，
 * 目前只有 article / friend / share 三种，见 server/routes/trash.js 的 RESTORERS）。
 * 认不出的类型不隐藏、按原样显示，免得将来新类型默默消失。
 */
const TYPE_META = {
  article: { label: '文章', tone: 'info', icon: FileText },
  friend: { label: '友链', tone: 'ok', icon: Link2 },
  share: { label: '分享', tone: 'neutral', icon: Quote },
};

function typeMeta(type) {
  return TYPE_META[type] ?? { label: type || '未知类型', tone: 'neutral', icon: FileText };
}

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

export default function Trash() {
  const [items, setItems] = useState(null); // null = 还没读到（首次加载 / 读取失败）
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // { entry, kind } —— 单行请求进行中
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setBusy(true);
    setLoadError('');
    try {
      const r = await api.get('/api/trash');
      setItems(r.items ?? []);
    } catch (err) {
      // 读取失败不把列表清成空：上一次的结果留着，失败原因就地写在空表里
      setLoadError(err.message || '读取失败');
      toastError(err, '读取回收站失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (it) => {
    const name = it.title || it.key || it.entry;
    setActing({ entry: it.entry, kind: 'restore' });
    try {
      await api.post(`/api/trash/${encodeURIComponent(it.entry)}/restore`);
      pushToast(`已恢复《${name}》`, 'ok');
      await load();
    } catch (err) {
      toastError(err, '恢复失败');
    } finally {
      setActing(null);
    }
  };

  const purge = async (it) => {
    const name = it.title || it.key || it.entry;
    // 不可逆：走珍珠玻璃的确认浮层（ConfirmHost），文案里写明不可恢复
    const ok = await confirm({
      title: '彻底清除这一条？',
      message: `《${name}》会被永久删除，回收站里不会再有它，这一步不可恢复。`
        + `（想反悔请点「取消」，改选「恢复」。）`,
      confirmText: '彻底清除',
      danger: true,
    });
    if (!ok) return;
    setActing({ entry: it.entry, kind: 'purge' });
    try {
      await api.post(`/api/trash/${encodeURIComponent(it.entry)}/purge`);
      pushToast('已彻底清除', 'ok');
      await load();
    } catch (err) {
      toastError(err, '彻底清除失败');
    } finally {
      setActing(null);
    }
  };

  // 筛选：关键词（标题 / 标识 / 备注 / 原路径）+ 类型，两个条件同时生效
  const filtering = Boolean(q.trim() || type);
  const filtered = useMemo(() => {
    const list = items ?? [];
    const kw = q.trim().toLowerCase();
    return list.filter((it) => {
      if (type && it.type !== type) return false;
      if (!kw) return true;
      return [it.title, it.key, it.note, it.originalPath].some((v) =>
        String(v ?? '').toLowerCase().includes(kw),
      );
    });
  }, [items, q, type]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const rows = useMemo(
    () =>
      filtered.slice((current - 1) * pageSize, current * pageSize).map((it) => ({
        ...it,
        // 显示中文本地时间，排序仍用原始 ISO（列上给了 sortValue）
        deletedAtText: fmt(it.deletedAt),
      })),
    [filtered, current, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [q, type, pageSize]);

  /** 下拉里的类型选项：已知三种 + 数据里出现的其它类型（按原样列出，不丢条目） */
  const typeOptions = useMemo(() => {
    const known = Object.keys(TYPE_META);
    const extra = [...new Set((items ?? []).map((it) => it.type).filter((t) => t && !known.includes(t)))];
    return [
      { label: '全部类型', value: '' },
      ...[...known, ...extra].map((t) => ({ label: TYPE_META[t]?.label ?? String(t), value: t })),
    ];
  }, [items]);

  const columns = useMemo(
    () => [
      { key: 'type', title: '类型', width: 116, sortable: true, sortValue: (r) => typeMeta(r.type).label },
      // 「原始标题」：条目进回收站时的标题（文章是 title，友链是 name，分享是 text）
      { key: 'title', title: '原始标题', minWidth: 240, sortable: true, sortValue: (r) => String(r.title ?? r.key ?? '') },
      { key: 'note', title: '备注', width: 150, sortable: true, sortValue: (r) => String(r.note ?? '') },
      {
        key: 'deletedAtText',
        title: '删除时间',
        width: 176,
        className: cls('mono'),
        sortable: true,
        sortValue: (r) => String(r.deletedAt ?? ''),
      },
      // 行操作放最右列（sticky，见 pearl components.css 的 .col-actions）
      { key: 'actions', title: '操作', width: 196, className: 'col-actions' },
    ],
    [],
  );

  const renderCell = (row, col) => {
    const meta = typeMeta(row.type);
    // 名字兜底链与服务端 listTrash() 的一致：title → key → 条目文件名
    const name = row.title || row.key || row.entry;
    switch (col.key) {
      case 'type':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <MorphIcon icon={meta.icon} size={15} color="currentColor" reducedMotion="user" />
            <Tag tone={meta.tone} dot>
              {meta.label}
            </Tag>
          </span>
        );
      case 'title':
        return (
          <div style={{ minWidth: 0 }}>
            {/* 悬停 300ms / 键盘聚焦（tabIndex）看详情卡；这一列只读，没有可点的动作 */}
            <HoverCard
              width={320}
              content={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 660, lineHeight: 1.45 }}>{name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tag tone={meta.tone} dot>
                      {meta.label}
                    </Tag>
                    <Tag>删除于 {row.deletedAtText}</Tag>
                  </div>
                  {row.note ? (
                    <div style={{ color: 'var(--ink-soft)', lineHeight: 1.6, fontSize: 13 }}>{row.note}</div>
                  ) : null}
                  <div className={cls('mono')} style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                    {row.key}
                  </div>
                  {row.originalPath ? (
                    <div className={cls('mono')} style={{ fontSize: 12, color: 'var(--ink-faint)', wordBreak: 'break-all' }}>
                      {row.originalPath}
                    </div>
                  ) : null}
                </div>
              }
            >
              <span tabIndex={0} style={{ fontWeight: 620 }}>
                {name}
              </span>
            </HoverCard>
            <div className={cls('mono')} style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              {row.key}
            </div>
          </div>
        );
      case 'note':
        return row.note ? <span>{row.note}</span> : <span className="faint">—</span>;
      case 'actions': {
        const busyRow = acting?.entry === row.entry;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {/* 恢复是安全操作：次要（胶囊）按钮，不加确认，不吓人 */}
            <Button
              size="sm"
              variant="secondary"
              icon={RotateCcw}
              disabled={busyRow}
              loading={busyRow && acting.kind === 'restore'}
              title={`恢复《${name}》`}
              onClick={() => restore(row)}
            >
              恢复
            </Button>
            {/* 彻底清除不可逆：danger 按钮 + 确认浮层 */}
            <Button
              size="sm"
              variant="danger"
              icon={TrashIcon}
              disabled={busyRow}
              loading={busyRow && acting.kind === 'purge'}
              title={`彻底清除《${name}》（不可恢复）`}
              onClick={() => purge(row)}
            >
              彻底清除
            </Button>
          </span>
        );
      }
      default:
        return undefined;
    }
  };

  const hasContent = (items?.length ?? 0) > 0;
  const emptyText = loadError
    ? `读取失败：${loadError}`
    : filtering
      ? '没有符合条件的条目'
      : '回收站是空的';
  const emptyDesc = loadError
    ? '确认后台服务在运行，再点面板右上角的刷新按钮重试'
    : filtering
      ? '试试清空筛选条件或换一个关键词'
      : '被删除的文章、友链、分享都会留在这里，直到你手动「彻底清除」；在那之前随时可以恢复';

  return (
    <ListPage
      title="回收站"
      desc="删除的内容会一直留在这里，直到你手动清除 · 「恢复」安全，「彻底清除」不可逆"
      search={
        <>
          <Field label="关键词" hint="匹配标题 / 标识 / 备注 / 原路径">
            <TextInput
              value={q}
              onChange={(v) => setQ(v ?? '')}
              placeholder="搜索标题 / 标识 / 备注…"
              icon={Search}
              clearable
            />
          </Field>
          <Field label="类型" hint="文章 / 友链 / 分享">
            <Select value={type} options={typeOptions} onChange={(v) => setType(v ?? '')} />
          </Field>
        </>
      }
      onSearch={load}
      onReset={() => {
        setQ('');
        setType('');
      }}
      tableTitle="已删除的内容"
      /* 有内容 → 蓝灯（有待处理的删除）；空 → 青柠灯 */
      status={hasContent ? 'info' : 'ok'}
      tools={
        <Tag tone="danger" dot>
          「彻底清除」不可恢复
        </Tag>
      }
      columns={columns}
      rows={rows}
      rowKey="entry"
      renderCell={renderCell}
      loading={busy}
      total={filtered.length}
      page={current}
      pageSize={pageSize}
      onPage={setPage}
      onPageSize={setPageSize}
      onRefresh={load}
      canExport={false}
      emptyText={emptyText}
      emptyDesc={emptyDesc}
      emptyIcon={Inbox}
    />
  );
}
