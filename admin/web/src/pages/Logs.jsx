// 操作日志（方案 §4.13 / 第 43 条）：只记关键操作 —— 发布 / 回滚 / 删内容。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, RefreshCw, ScrollText } from '../icons.js';

const ACTION = {
  publish: { label: '发布', cls: 'tag-ok' },
  rollback: { label: '回滚', cls: 'tag-bad' },
};

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

export default function Logs() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.get('/api/publish/log?limit=100');
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

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      <section className="card panel">
        <div className="panel-head">
          <h2>操作日志</h2>
          <div className="spacer" />
          <span className="hint">只记关键操作：发布 / 回滚。存在服务器本地（已 gitignore）</span>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>

        {!items ? (
          <div className="empty">正在读取…</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <MorphIcon icon={ScrollText} size={16} color="currentColor" /> 还没有记录（发过一次之后就有了）
          </div>
        ) : (
          <div className="post-list">
            {items.map((it, i) => (
              <div key={`${it.time}-${i}`} className="post-item" style={{ flexWrap: 'wrap' }}>
                <div className="post-main">
                  <div className="post-title">{it.commit || it.result || it.action}</div>
                  <div className="post-meta">
                    {fmt(it.time)}
                    {Array.isArray(it.files) && (
                      <>
                        <span className="sep">·</span>
                        {it.files.length} 个文件
                      </>
                    )}
                    {it.result && (
                      <>
                        <span className="sep">·</span>
                        {it.result}
                      </>
                    )}
                    {it.commit && Array.isArray(it.files) && it.files.length > 0 && (
                      <>
                        <span className="sep">·</span>
                        <span className="mono" title={it.files.join('\n')}>
                          {it.files.slice(0, 3).join(', ')}
                          {it.files.length > 3 ? ` 等 ${it.files.length} 个` : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="post-pills">
                  <span className={`tag ${ACTION[it.action]?.cls ?? 'tag-soft'}`}>
                    {ACTION[it.action]?.label ?? it.action}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
