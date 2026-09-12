// 操作日志（方案 §4.13 / 第 43 条）：只记关键操作 —— 发布 / 回滚 / 审批友链 / 定时发布。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { CircleAlert, RefreshCw, ScrollText } from '../icons.js';

/**
 * 动作 → 中文标签。
 * ⚠️ 这里要**跟着后端一起长**：阶段 J 加了 approve/reject/reopen、阶段 K 加了 publish-scheduled，
 * 一开始没补，日志页就把它们原样显示成英文 action（阶段 L 的回归扫出来的）。
 */
const ACTION = {
  publish: { label: '发布', cls: 'tag-ok' },
  'publish-scheduled': { label: '定时发布', cls: 'tag-ok' },
  rollback: { label: '回滚', cls: 'tag-bad' },
  approve: { label: '通过友链', cls: 'tag-ok' },
  reject: { label: '拒绝友链', cls: 'tag-bad' },
  reopen: { label: '改回待审批', cls: 'tag-soft' },
  delete: { label: '删除内容', cls: 'tag-bad' },
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
          <span className="hint">只记关键操作：发布 / 回滚 / 审批友链 / 定时发布。存在服务器本地（已 gitignore）</span>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>

        {!items ? (
          <div className="empty">{error ? `读取失败：${error}` : '正在读取…'}</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <MorphIcon icon={ScrollText} size={16} color="currentColor" /> 还没有记录（发过一次之后就有了）
          </div>
        ) : (
          <div className="post-list">
            {items.map((it, i) => {
              const act = ACTION[it.action] ?? { label: it.action, cls: 'tag-soft' };
              const title =
                it.commit ||
                (it.application ? `友链申请「${it.application.name}」` : '') ||
                it.result ||
                act.label;
              return (
                <div key={`${it.time}-${i}`} className="post-item" style={{ flexWrap: 'wrap' }}>
                  <div className="post-main">
                    <div className="post-title">{title}</div>
                    <div className="post-meta">
                      {fmt(it.time)}
                      {it.application?.url && (
                        <>
                          <span className="sep">·</span>
                          <span className="mono">{it.application.url}</span>
                        </>
                      )}
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
                      {it.reason && (
                        <>
                          <span className="sep">·</span>
                          原因：{it.reason}
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
                    <span className={`tag ${act.cls}`}>{act.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
