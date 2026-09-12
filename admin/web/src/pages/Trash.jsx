// 回收站：软删除的内容可以恢复或彻底清除（方案 §4.11，决策 14 / 42）
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, Inbox, RefreshCw, RotateCcw, Sparkles, Trash as TrashIcon } from '../icons.js';

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

export default function Trash() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.get('/api/trash');
      setItems(r.items ?? []);
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const restore = async (it) => {
    setError('');
    try {
      await api.post(`/api/trash/${encodeURIComponent(it.entry)}/restore`);
      setNotice(`已恢复《${it.title}》`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const purge = async (it) => {
    if (!window.confirm(`彻底清除《${it.title}》？这一步不可恢复。`)) return;
    setError('');
    try {
      await api.post(`/api/trash/${encodeURIComponent(it.entry)}/purge`);
      setNotice('已彻底清除');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div
          className="alert"
          style={{ background: 'rgba(47,122,85,.12)', border: '1px solid rgba(47,122,85,.3)', color: '#2f7a55' }}
        >
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>{notice}</span>
        </div>
      )}

      <section className="card panel">
        <div className="panel-head">
          <h2>回收站</h2>
          <div className="spacer" />
          <span className="hint">删除的内容会一直留在这里，直到你手动清除</span>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>

        {!items ? (
          <div className="empty">{error ? `读取失败：${error}` : '正在读取…'}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <MorphIcon icon={Inbox} size={16} color="currentColor" /> 回收站是空的
          </div>
        ) : (
          <div className="post-list">
            {items.map((it) => (
              <div className="post-item" key={it.entry}>
                <div className="post-main">
                  <div className="post-title">{it.title}</div>
                  <div className="post-meta">
                    {it.type === 'article' ? '文章' : it.type}
                    <span className="sep">·</span>
                    删除于 {fmt(it.deletedAt)}
                    {it.note && (
                      <>
                        <span className="sep">·</span>
                        {it.note}
                      </>
                    )}
                  </div>
                </div>
                <div className="post-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title="恢复"
                    onClick={() => restore(it)}
                  >
                    <MorphIcon icon={RotateCcw} size={16} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    className="iconbtn danger"
                    title="彻底清除"
                    onClick={() => purge(it)}
                  >
                    <MorphIcon icon={TrashIcon} size={16} color="currentColor" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
