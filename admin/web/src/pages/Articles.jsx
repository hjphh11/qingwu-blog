// 文章列表（珍珠玻璃版）。
//
// 版式照 scaffold 的「统一列表页」：页面标题 + 主操作 → 查询区 → 表格面板（工具栏）
// → 分页；置顶区与「还没发布的改动」放在页头下方的整宽区域（ListPage 的 before）。
//
// ⚠️ 功能与旧版（暖色 Articles.jsx）**完全一致**：
//   关键词 / 分类 / 状态 / 排序 四路筛选、每页 20 条分页、待发布排最前、
//   置顶区上下移动 + 保存顺序（方案决策 26 / 28）、置顶切换、编辑、删除进回收站、
//   「N 个文件待发布」可展开看明细。改动只在呈现层与组件复用。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { ArrowDown, ArrowUp, FileText, Pencil, Pin, PinOff, Plus, Search, Trash } from '../icons.js';
import { cls } from '../pearl/cls.js';
import { toastError, pushToast } from '../pearl/toast.js';
import Button from '../pearl/ui/Button.jsx';
import { confirm } from '../pearl/ui/confirm.js';
import Field from '../pearl/ui/Field.jsx';
import HoverCard from '../pearl/ui/HoverCard.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import ListPage from '../pearl/business/ListPage.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import Select from '../pearl/ui/Select.jsx';
import Switch from '../pearl/ui/Switch.jsx';
import Tag from '../pearl/ui/Tag.jsx';
import TextInput from '../pearl/ui/TextInput.jsx';

const KIND = {
  added: { label: '新增', tone: 'ok' },
  modified: { label: '修改', tone: 'info' },
  deleted: { label: '删除', tone: 'danger' },
  renamed: { label: '改名', tone: 'neutral' },
};

const STATUS_OPTIONS = [
  { label: '全部状态', value: '' },
  { label: '已发布', value: 'published' },
  { label: '草稿', value: 'draft' },
  { label: '置顶', value: 'pinned' },
];

const SORT_OPTIONS = [
  { label: '待发布排最前', value: 'pending' },
  { label: '按发布时间', value: 'pub' },
  { label: '按最近修改', value: 'mtime' },
];

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN');
};

// 列定义在组件内用 useMemo 生成（见下方）：排序要按「分类中文名」「待发布分组」
// 这类算出来的值排，依赖 labelOf / pendingRank，所以不能放在模块作用域。

export default function Articles({ go }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('pending');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [cats, setCats] = useState([]);
  const [pinOrder, setPinOrder] = useState([]); // 置顶区当前顺序
  const [pinDirty, setPinDirty] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [showUnpub, setShowUnpub] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [list, c] = await Promise.all([api.get('/api/articles'), api.get('/api/categories')]);
      setData(list);
      setCats(c.categories ?? []);
      const pinned = (list.articles ?? [])
        .filter((a) => a.pinned)
        .sort((a, b) => (a.pinOrder ?? 9999) - (b.pinOrder ?? 9999));
      setPinOrder(pinned.map((a) => a.id));
      setPinDirty(false);
    } catch (err) {
      toastError(err, '读取文章失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const labelOf = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.label])), [cats]);

  // 每篇的「待发布」状态：新增(0) → 修改/改名(1) → 没有待发布(2)
  const pendingRank = useMemo(() => {
    const m = new Map();
    for (const f of data?.unpublished?.files ?? []) {
      if (!f.file.endsWith('.md')) continue; // 只管文章，src/data/*.json 不算
      const id = f.file.replace(/^.*\//, '').replace(/\.md$/, '');
      const rank = f.kind === 'added' ? 0 : f.kind === 'modified' || f.kind === 'renamed' ? 1 : 2;
      m.set(id, Math.min(m.get(id) ?? 9, rank));
    }
    return m;
  }, [data]);

  // 可排序的列：点表头在「升序 → 降序 → 回到页面原顺序」之间轮换。
  // 时间列用原始 ISO 字符串排（显示的是中文本地格式，直接比字符串会把 9/12 排到 10/1 后面）。
  const columns = useMemo(
    () => [
      { key: 'title', title: '文章', minWidth: 260, sortable: true, sortValue: (r) => r.title },
      { key: 'category', title: '分类', width: 110, sortable: true, sortValue: (r) => labelOf[r.category] ?? r.category ?? '' },
      { key: 'pending', title: '待发布', width: 120, sortable: true, sortValue: (r) => pendingRank.get(r.id) ?? 2 },
      { key: 'status', title: '状态', width: 116, sortable: true, sortValue: (r) => (r.draft ? 1 : 0) },
      // 置顶单独一列：状态格里塞「标签 + 开关」会换行，把行高撑到 56px，
      // 开关看起来就"掉到下一行去了"（实测过）。拆开后每格都只有一行。
      { key: 'pinned', title: '置顶', width: 84, align: 'center', sortable: true, sortValue: (r) => (r.pinned ? 0 : 1) },
      { key: 'pubDateText', title: '发布日期', width: 116, className: cls('mono'), sortable: true, sortValue: (r) => String(r.pubDateText ?? '') },
      { key: 'mtimeText', title: '最后修改', width: 116, className: cls('mono'), sortable: true, sortValue: (r) => String(r.mtime ?? '') },
      { key: 'actions', title: '操作', width: 132, className: 'col-actions' },
    ],
    [labelOf, pendingRank],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = [...data.articles];
    const kw = q.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(kw) ||
          a.id.toLowerCase().includes(kw) ||
          a.tags.some((t) => t.toLowerCase().includes(kw)),
      );
    }
    if (cat) list = list.filter((a) => a.category === cat);
    if (status === 'published') list = list.filter((a) => !a.draft);
    else if (status === 'draft') list = list.filter((a) => a.draft);
    else if (status === 'pinned') list = list.filter((a) => a.pinned);

    list.sort((a, b) => {
      if (sort === 'pending') {
        const ra = pendingRank.get(a.id) ?? 2;
        const rb = pendingRank.get(b.id) ?? 2;
        if (ra !== rb) return ra - rb;
      }
      if (sort === 'mtime') return String(b.mtime).localeCompare(String(a.mtime));
      return String(b.pubDateText).localeCompare(String(a.pubDateText));
    });
    return list;
  }, [data, q, cat, status, sort, pendingRank]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const rows = useMemo(
    () =>
      filtered.slice((current - 1) * pageSize, current * pageSize).map((a) => ({
        ...a,
        mtimeText: fmtDate(a.mtime),
      })),
    [filtered, current, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [q, cat, status, sort]);

  const catOptions = useMemo(
    () => [{ label: '全部分类', value: '' }, ...cats.map((c) => ({ label: c.label, value: c.id }))],
    [cats],
  );

  /** 取单篇全文再改一个字段 —— 避免列表数据不全把正文覆盖没了 */
  const patchArticle = async (id, patch, okText) => {
    const full = await api.get(`/api/articles/${encodeURIComponent(id)}`);
    await api.put(`/api/articles/${encodeURIComponent(id)}`, {
      title: full.title,
      slug: full.id,
      category: full.category,
      pubDate: full.pubDateText,
      tags: full.tags,
      description: full.description,
      draft: full.draft,
      pinned: full.pinned,
      ...(typeof full.pinOrder === 'number' ? { pinOrder: full.pinOrder } : {}),
      body: full.body,
      ...patch,
    });
    if (okText) pushToast(okText, 'ok');
    await load();
  };

  const onTogglePin = async (a) => {
    try {
      await patchArticle(a.id, { pinned: !a.pinned }, a.pinned ? '已取消置顶' : '已置顶');
    } catch (err) {
      toastError(err, '置顶操作失败');
    }
  };

  const onDelete = async (a) => {
    // 珍珠玻璃的确认浮层（scaffold 的 ConfirmHost），不再是浏览器原生 confirm
    const ok = await confirm({
      title: '移入回收站',
      message: `把《${a.title}》移进回收站？之后可以在「回收站」里恢复，不会真丢。`,
      confirmText: '移入回收站',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/api/articles/${encodeURIComponent(a.id)}/delete`);
      pushToast('已移进回收站', 'ok');
      await load();
    } catch (err) {
      toastError(err, '删除失败');
    }
  };

  const movePin = (i, dir) => {
    const next = [...pinOrder];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPinOrder(next);
    setPinDirty(true);
  };

  const savePin = async () => {
    setSavingPin(true);
    try {
      for (let i = 0; i < pinOrder.length; i += 1) {
        await patchArticle(pinOrder[i], { pinned: true, pinOrder: i + 1 }, '');
      }
      pushToast('置顶顺序已保存', 'ok');
      setPinDirty(false);
      await load();
    } catch (err) {
      toastError(err, '保存置顶顺序失败');
    } finally {
      setSavingPin(false);
    }
  };

  const byId = useMemo(() => Object.fromEntries((data?.articles ?? []).map((a) => [a.id, a])), [data]);
  const filtering = Boolean(q.trim() || cat || status);
  const unpubFiles = data?.unpublished?.files ?? [];
  // 表格标题前的状态灯：有文章的 frontmatter 解析失败 → 红；有待发布改动 → 蓝；其余 → 青柠
  const brokenCount = (data?.articles ?? []).filter((a) => a.error).length;
  const listStatus = brokenCount > 0 ? 'danger' : unpubFiles.length > 0 ? 'info' : 'ok';

  const renderCell = (row, col) => {
    switch (col.key) {
      case 'title':
        return (
          <div>
            {/* 悬停 300ms / 键盘聚焦出现摘要卡；点标题直接进编辑页 */}
            <HoverCard
              width={300}
              content={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 660, lineHeight: 1.45 }}>{row.title}</div>
                  <div style={{ color: 'var(--ink-soft)', lineHeight: 1.6, fontSize: 13 }}>
                    {labelOf[row.category] ?? (row.category || '未分类')} · {row.pubDateText || '无日期'} ·{' '}
                    {row.draft ? '草稿' : '已发布'}
                    {row.pinned ? ' · 置顶' : ''}
                  </div>
                  {row.tags?.length ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {row.tags.map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </div>
                  ) : null}
                  <div className={cls('mono')} style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                    {row.id}
                  </div>
                </div>
              }
            >
              <button
                type="button"
                className={cls('link-btn')}
                title={`${row.title}（点击编辑）`}
                onClick={() => go?.('edit', { id: row.id })}
              >
                {row.title}
              </button>
            </HoverCard>
            <div className={cls('mono')} style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
              {row.id}
              {row.error ? ` · ${row.error}` : ''}
            </div>
          </div>
        );
      case 'category':
        return <Tag>{labelOf[row.category] ?? (row.category || '未分类')}</Tag>;
      case 'pending': {
        const rank = pendingRank.get(row.id);
        if (rank === 0) return <Tag tone="ok" dot>待发布 · 新增</Tag>;
        if (rank === 1) return <Tag tone="info" dot>待发布 · 修改</Tag>;
        return <span className="faint">—</span>;
      }
      case 'status':
        return (
          <Tag tone={row.draft ? 'neutral' : 'ok'} dot>
            {row.draft ? '草稿' : '已发布'}
          </Tag>
        );
      case 'pinned':
        // 表格里用紧凑形态：只有开关（文字由 ariaLabel 提供给读屏），避免换行
        return (
          <Switch
            checked={Boolean(row.pinned)}
            onChange={() => onTogglePin(row)}
            ariaLabel={`${row.pinned ? '取消置顶' : '置顶'}《${row.title}》`}
          />
        );
      case 'actions':
        return (
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <IconButton icon={Pencil} label="编辑" size={16} onClick={() => go?.('edit', { id: row.id })} />
            <IconButton icon={Trash} label="移入回收站（可恢复）" size={16} danger onClick={() => onDelete(row)} />
          </span>
        );
      default:
        return undefined;
    }
  };

  return (
    <ListPage
      title="文章"
      desc="管理文章 · 前台按置顶顺序与发布时间排"
      actions={
        <Button variant="primary" icon={Plus} onClick={() => go?.('edit', { id: null })}>
          新建文章
        </Button>
      }
      search={
        <>
          <Field label="关键词" hint="匹配标题 / 地址（slug）/ 标签">
            <TextInput
              value={q}
              onChange={(v) => setQ(v ?? '')}
              placeholder="搜索标题 / 地址 / 标签…"
              icon={Search}
              clearable
            />
          </Field>
          <Field label="分类" hint="前台筛选按钮跟着分类走">
            <Select value={cat} options={catOptions} onChange={(v) => setCat(v ?? '')} />
          </Field>
          <Field label="状态" hint="草稿不会被前台构建输出">
            <Select value={status} options={STATUS_OPTIONS} onChange={(v) => setStatus(v ?? '')} />
          </Field>
          <Field label="排序" hint="点表头也可以排序">
            <Select value={sort} options={SORT_OPTIONS} onChange={(v) => setSort(v ?? 'pending')} />
          </Field>
        </>
      }
      onSearch={load}
      onReset={() => {
        setQ('');
        setCat('');
        setStatus('');
        setSort('pending');
      }}
      tableTitle="文章"
      status={listStatus}
      tools={
        unpubFiles.length > 0 ? (
          <Button variant="ghost" size="sm" icon={FileText} onClick={() => setShowUnpub((v) => !v)}>
            {data.unpublished.count} 个文件待发布 {showUnpub ? '▴' : '▾'}
          </Button>
        ) : null
      }
      before={
        <>
          {/* 置顶区：上下移动 + 保存（决策 28，不做拖拽） */}
          {pinOrder.length > 0 && !filtering && (
            <Panel
              title="置顶区"
              meta="前台按这个顺序排"
              className="reveal"
              /* 只有改了还没保存时才亮蓝灯（把"未保存"这件事交给状态灯说） */
              status={pinDirty ? 'info' : undefined}
              tools={
                <Button variant="primary" size="sm" loading={savingPin} disabled={!pinDirty} onClick={savePin}>
                  保存顺序
                </Button>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {pinOrder.map((id, i) => {
                  const a = byId[id];
                  if (!a) return null;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '9px 0',
                        borderTop: i === 0 ? 'none' : '1px solid var(--p-line)',
                      }}
                    >
                      <Tag tone="info">#{i + 1}</Tag>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.title}
                        </div>
                        <div className="faint" style={{ fontSize: 13 }}>
                          {labelOf[a.category] ?? a.category} · {fmtDate(a.pubDate)}
                        </div>
                      </div>
                      <IconButton icon={ArrowUp} label="上移" size={16} bordered disabled={i === 0} onClick={() => movePin(i, -1)} />
                      <IconButton
                        icon={ArrowDown}
                        label="下移"
                        size={16}
                        bordered
                        disabled={i === pinOrder.length - 1}
                        onClick={() => movePin(i, 1)}
                      />
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* 还没发布的改动：文件级明细 */}
          {showUnpub && unpubFiles.length > 0 && (
            <Panel title="还没发布的改动" meta="已保存到仓库，还没发布上线" className="reveal" status="info">
              <div className={cls('table-wrap')}>
                <table className={cls('table')}>
                  <thead>
                    <tr>
                      <th style={{ width: 84 }}>改动</th>
                      <th>文件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpubFiles.map((f) => (
                      <tr key={f.file} className="data-row">
                        <td>
                          <Tag tone={KIND[f.kind]?.tone ?? 'neutral'}>{KIND[f.kind]?.label ?? f.kind}</Tag>
                        </td>
                        <td className={cls('mono')} style={{ wordBreak: 'break-all' }}>
                          {f.file}
                          {f.renamedFrom && <span className="faint">（原 {f.renamedFrom}）</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      }
      columns={columns}
      rows={rows}
      renderCell={renderCell}
      loading={busy}
      total={filtered.length}
      page={current}
      pageSize={pageSize}
      onPage={setPage}
      onPageSize={(n) => {
        setPageSize(n);
        setPage(1);
      }}
      onRefresh={load}
      canExport={false}
      emptyText={filtering ? '没有符合条件的文章' : '还没有文章'}
      emptyDesc={filtering ? '试试清空筛选条件或换一个关键词' : '点右上角「新建文章」写下第一篇'}
    />
  );
}
