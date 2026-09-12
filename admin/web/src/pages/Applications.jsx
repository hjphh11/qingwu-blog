// 友链申请审批（阶段 J · 方案 §4.5 + 第 35/36/49 条）
//
// 申请数据在**私有仓库**里（含访客邮箱，不进公开仓库），这个页面读它、
// 并把审批结果写回去：
//   · 通过 = 追加进 links.json（→ 出现在「待发布」里，去发布页点一下就上线）
//   · 拒绝 = 标记（可留原因）；对方之后可以重新申请
//   · 点错了能「改回待审批」
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  Ban,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  Globe,
  Inbox,
  Mail,
  RefreshCw,
  Sparkles,
  Undo2,
} from '../icons.js';

const FILTERS = [
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'all', label: '全部' },
];

const STATUS = {
  pending: { label: '待审批', cls: 'tag-amber' },
  approved: { label: '已通过', cls: 'tag-ok' },
  rejected: { label: '已拒绝', cls: 'tag-bad' },
};

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
};

export default function Applications() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // 正在处理的申请 id
  const [rejecting, setRejecting] = useState(null); // { id, name }
  const [reason, setReason] = useState('');

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      setData(await api.get(`/api/applications${refresh ? '?refresh=1' : ''}`));
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (kind, id, body = {}) => {
    setActing(id);
    setError('');
    setNotice('');
    try {
      const r = await api.post(`/api/applications/${kind}`, { id, ...body });
      setData((d) => ({ ...d, ...r }));
      setNotice(
        kind === 'approve'
          ? `已把「${r.application?.name}」写进友链 —— 去发布页点发布就上线`
          : kind === 'reject'
            ? `已拒绝「${r.application?.name}」`
            : `「${r.application?.name}」已改回待审批`,
      );
      setRejecting(null);
      setReason('');
      window.dispatchEvent(new Event('qingwu:pending')); // 让顶栏「发布 N」跟着变
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setActing(null);
    }
  };

  const items = data?.items ?? [];
  const shown = filter === 'all' ? items : items.filter((a) => a.status === filter);
  const counts = data?.counts ?? { pending: 0, approved: 0, rejected: 0, total: 0 };

  const notConfigured = data && data.enabled === false;

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

      <section className="card panel">
        <div className="panel-head">
          <h2>友链申请</h2>
          <div className="spacer" />
          <span className="hint">
            {data?.repo ? (
              <>
                数据在私有仓库 <span className="mono">{data.repo}</span>
                {data.fetchedAt && <>（读于 {fmt(data.fetchedAt)}）</>}
              </>
            ) : (
              '数据在私有仓库里'
            )}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => load(true)} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>

        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
          访客在 <span className="mono">/links/apply</span> 提交的申请会落到私有仓库（带邮箱，所以不进公开仓库）。
          「通过」会直接写进 <span className="mono">links.json</span> —— 之后回<strong>发布页</strong>点发布，友链才真正上线。
          「拒绝」会标记回去，对方之后可以重新申请。
        </p>

        {notConfigured && (
          <div className="alert alert-warn">
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>
              {data?.reason} —— 在服务器上给 <span className="mono">/opt/qingwu/.env</span> 加一项{' '}
              <span className="mono">ADMIN_APPLY_TOKEN</span>（该私有仓库的 Contents 读写权限）再重启后台即可。
            </span>
          </div>
        )}

        <div className="panel-head" style={{ marginBottom: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] > 0 && <b> {counts[f.key]}</b>}
            </button>
          ))}
          <div className="spacer" />
          <span className="hint">共 {counts.total} 条申请</span>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <MorphIcon icon={Inbox} size={18} color="currentColor" />{' '}
            {filter === 'pending' ? '没有待审批的申请' : '这里还没有内容'}
          </div>
        ) : (
          <div className="post-list">
            {shown.map((a) => {
              const st = STATUS[a.status] ?? STATUS.pending;
              return (
                <div key={a.id} className="post-item" style={{ flexWrap: 'wrap' }}>
                  <span className="app-avatar">
                    {/* 图标垫在下面：头像链接失效（图挂了 / 是假域名）时把它藏掉，露出图标兜底 */}
                    <MorphIcon icon={Globe} size={16} color="currentColor" />
                    {a.avatar && (
                      <img
                        src={a.avatar}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                  </span>

                  <div className="post-main">
                    <div className="post-title">
                      {a.name}
                      <span className={`tag ${st.cls}`} style={{ marginLeft: 8 }}>
                        {st.label}
                      </span>
                    </div>
                    <div className="post-meta">
                      <a href={a.url} target="_blank" rel="noreferrer">
                        {a.url} <MorphIcon icon={ExternalLink} size={11} color="currentColor" />
                      </a>
                      <span className="sep">·</span>
                      <a href={`mailto:${a.email}`}>
                        <MorphIcon icon={Mail} size={11} color="currentColor" /> {a.email}
                      </a>
                    </div>
                    {a.intro && <div className="post-meta">{a.intro}</div>}
                    <div className="post-meta">
                      <MorphIcon icon={Clock} size={11} color="currentColor" /> 提交于 {fmt(a.submittedAt)}
                      {a.reviewedAt && <> · 处理于 {fmt(a.reviewedAt)}</>}
                      {a.reason && <> · 原因：{a.reason}</>}
                    </div>
                  </div>

                  <div className="post-acts">
                    {a.status !== 'approved' && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '7px 14px', fontSize: 13 }}
                        onClick={() => act('approve', a.id)}
                        disabled={acting === a.id}
                      >
                        <MorphIcon icon={CircleCheck} size={14} color="#fff" />
                        通过
                      </button>
                    )}
                    {a.status === 'pending' && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '7px 14px', fontSize: 13 }}
                        onClick={() => {
                          setRejecting(rejecting?.id === a.id ? null : { id: a.id, name: a.name });
                          setReason('');
                        }}
                        disabled={acting === a.id}
                      >
                        <MorphIcon icon={Ban} size={14} color="currentColor" />
                        拒绝
                      </button>
                    )}
                    {a.status !== 'pending' && (
                      <button
                        type="button"
                        className="iconbtn"
                        title="改回待审批"
                        onClick={() => act('reopen', a.id)}
                        disabled={acting === a.id}
                      >
                        <MorphIcon icon={Undo2} size={16} color="currentColor" />
                      </button>
                    )}
                  </div>

                  {rejecting?.id === a.id && (
                    <div className="inline-box" style={{ flexBasis: '100%' }}>
                      <label className="field full">
                        <span>拒绝原因（选填，只给自己看）</span>
                        <input
                          className="input"
                          value={reason}
                          placeholder="例如：站点打不开 / 内容不合适"
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <div className="form-actions" style={{ marginTop: 10 }}>
                        <button type="button" className="btn" onClick={() => act('reject', a.id, { reason })} disabled={acting === a.id}>
                          确认拒绝
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
