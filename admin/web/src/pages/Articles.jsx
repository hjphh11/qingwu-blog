// 文章列表：搜索 / 分类筛选 / 状态筛选 / 排序 / 每页 20 条分页
// + 置顶区「上下移动 + 保存」（方案决策 26 / 28）
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash,
  Pencil,
} from '../icons.js';

const PAGE_SIZE = 20;

/** 未发布改动的类型 → 中文标签与配色 */
const KIND = {
  added: { label: '新增', cls: 'tag-ok' },
  modified: { label: '修改', cls: 'tag-amber' },
  deleted: { label: '删除', cls: 'tag-bad' },
  renamed: { label: '改名', cls: 'tag-soft' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN');
};

export default function Articles({ go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('pending');
  const [page, setPage] = useState(1);
  const [cats, setCats] = useState([]);
  const [pinOrder, setPinOrder] = useState([]); // 置顶区当前顺序
  const [pinDirty, setPinDirty] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [notice, setNotice] = useState('');
  const [showUnpub, setShowUnpub] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
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
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const labelOf = useMemo(
    () => Object.fromEntries(cats.map((c) => [c.id, c.label])),
    [cats],
  );

  // 每篇的「待发布」状态：新增(0) → 修改(1) → 没有待发布(2)
  // 默认排序按它分组：新增的排最上面，然后是改过的，最后是正常的文章。
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
      // 默认：新增 → 修改 → 正常
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageItems = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q, cat, status, sort]);

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
    setNotice(okText);
    await load();
  };

  const onTogglePin = async (a) => {
    try {
      await patchArticle(a.id, { pinned: !a.pinned }, a.pinned ? '已取消置顶' : '已置顶');
    } catch (err) {
      setError(err.message);
    }
  };

  const onDelete = async (a) => {
    if (!window.confirm(`把《${a.title}》移进回收站？（可以恢复）`)) return;
    try {
      await api.post(`/api/articles/${encodeURIComponent(a.id)}/delete`);
      setNotice('已移进回收站');
      await load();
    } catch (err) {
      setError(err.message);
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
    setError('');
    try {
      for (let i = 0; i < pinOrder.length; i += 1) {
        await patchArticle(pinOrder[i], { pinned: true, pinOrder: i + 1 }, '');
      }
      setNotice('置顶顺序已保存');
      setPinDirty(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPin(false);
    }
  };

  const byId = useMemo(
    () => Object.fromEntries((data?.articles ?? []).map((a) => [a.id, a])),
    [data],
  );

  const filtering = Boolean(q.trim() || cat || status);

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="alert" style={{ background: 'rgba(47,122,85,.12)', border: '1px solid rgba(47,122,85,.3)', color: '#2f7a55' }}>
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>{notice}</span>
        </div>
      )}

      {/* 置顶区：上下移动 + 保存（决策 28，不做拖拽）*/}
      {pinOrder.length > 0 && !filtering && (
        <section className="card panel">
          <div className="panel-head">
            <MorphIcon icon={Pin} size={16} color="var(--color-rose)" />
            <h2>置顶区</h2>
            <div className="spacer" />
            <span className="hint">用上下箭头调顺序，再点保存（前台按这个顺序排）</span>
            <button type="button" className="btn" onClick={savePin} disabled={!pinDirty || savingPin}>
              {savingPin ? '保存中…' : '保存顺序'}
            </button>
          </div>
          <div className="post-list">
            {pinOrder.map((id, i) => {
              const a = byId[id];
              if (!a) return null;
              return (
                <div className="post-item" key={id}>
                  <span className="tag tag-rose">#{i + 1}</span>
                  <div className="post-main">
                    <div className="post-title">{a.title}</div>
                    <div className="post-meta">
                      {labelOf[a.category] ?? a.category}
                      <span className="sep">·</span>
                      {fmtDate(a.pubDate)}
                    </div>
                  </div>
                  <div className="post-acts">
                    <button
                      type="button"
                      className="iconbtn"
                      onClick={() => movePin(i, -1)}
                      disabled={i === 0}
                      aria-label="上移"
                      title="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      onClick={() => movePin(i, 1)}
                      disabled={i === pinOrder.length - 1}
                      aria-label="下移"
                      title="下移"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="card panel">
        <div className="panel-head">
          <h2>文章</h2>
          <div className="spacer" />
          {typeof data?.unpublished?.count === 'number' && data.unpublished.count > 0 && (
            <button
              type="button"
              className="tag tag-amber"
              style={{ cursor: 'pointer', font: 'inherit', fontSize: '11.5px' }}
              onClick={() => setShowUnpub((v) => !v)}
              title="点开看是哪几个文件"
            >
              {data.unpublished.count} 个文件待发布 {showUnpub ? '▴' : '▾'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn" onClick={() => go('edit', { id: null })}>
            <MorphIcon icon={Plus} size={15} color="#fff" />
            新建文章
          </button>
        </div>

        <div className="filter-bar">
          <div className="grow">
            <input
              className="input"
              placeholder="搜索标题 / 地址 / 标签…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">全部分类</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
            <option value="pinned">置顶</option>
          </select>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="pending">待发布排最前</option>
            <option value="pub">按发布时间</option>
            <option value="mtime">按最近修改</option>
          </select>
        </div>

        {showUnpub && (data?.unpublished?.files?.length ?? 0) > 0 && (
          <div className="unpub-box">
            <div className="panel-head" style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 15 }}>
                <MorphIcon icon={FileText} size={15} color="var(--color-rose)" /> 还没发布的改动
              </h2>
              <div className="spacer" />
              <span className="hint">
                这些已经写进仓库文件，但还没提交上线。「发布」在阶段 I 做
              </span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 76 }}>改动</th>
                    <th>文件</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unpublished.files.map((f) => (
                    <tr key={f.file}>
                      <td>
                        <span className={`tag ${KIND[f.kind]?.cls ?? 'tag-soft'}`}>
                          {KIND[f.kind]?.label ?? f.kind}
                        </span>
                      </td>
                      <td className="mono" style={{ wordBreak: 'break-all' }}>
                        {f.file}
                        {f.renamedFrom && (
                          <span style={{ opacity: 0.6 }}>（原 {f.renamedFrom}）</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!data ? (
          <div className="empty">正在读取…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <MorphIcon icon={Search} size={16} color="currentColor" /> 没有符合条件的文章
          </div>
        ) : (
          <>
            <div className="post-list">
              {pageItems.map((a) => (
                <div className={`post-item${a.draft ? ' is-draft' : ''}`} key={a.id}>
                  <div className="post-main">
                    <div className="post-title" title={a.title}>
                      {a.title}
                    </div>
                    <div className="post-meta">
                      {labelOf[a.category] ?? (a.category || '未分类')}
                      <span className="sep">·</span>
                      {a.pubDateText || '无日期'}
                      {a.tags.length > 0 && (
                        <>
                          <span className="sep">·</span>
                          {a.tags.join(' / ')}
                        </>
                      )}
                      <span className="sep">·</span>
                      改于 {fmtDate(a.mtime)}
                      {a.error && <span style={{ color: '#a33246' }}> · {a.error}</span>}
                    </div>
                  </div>
                  <div className="post-pills">
                    {pendingRank.get(a.id) === 0 && (
                      <span className="tag tag-pending" title="新建了但还没发布">
                        待发布 · 新增
                      </span>
                    )}
                    {pendingRank.get(a.id) === 1 && (
                      <span className="tag tag-pending" title="改过了但还没发布">
                        待发布 · 修改
                      </span>
                    )}
                    {a.pinned && <span className="tag tag-rose">置顶</span>}
                    {a.draft ? (
                      <span className="tag tag-amber">草稿</span>
                    ) : (
                      <span className="tag tag-ok">已发布</span>
                    )}
                  </div>
                  <div className="post-acts">
                    <button
                      type="button"
                      className="iconbtn"
                      title={a.pinned ? '取消置顶' : '置顶'}
                      onClick={() => onTogglePin(a)}
                    >
                      <MorphIcon icon={a.pinned ? PinOff : Pin} size={16} color="currentColor" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      title="编辑"
                      onClick={() => go('edit', { id: a.id })}
                    >
                      <MorphIcon icon={Pencil} size={16} color="currentColor" />
                    </button>
                    <button
                      type="button"
                      className="iconbtn danger"
                      title="删除（进回收站）"
                      onClick={() => onDelete(a)}
                    >
                      <MorphIcon icon={Trash} size={16} color="currentColor" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {pageCount > 1 && (
              <div className="pager">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPage(current - 1)}
                  disabled={current <= 1}
                >
                  <MorphIcon icon={ChevronLeft} size={15} color="currentColor" />
                  上一页
                </button>
                <span>
                  第 {current} / {pageCount} 页 · 共 {filtered.length} 篇
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount}
                >
                  下一页
                  <MorphIcon icon={ChevronRight} size={15} color="currentColor" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
