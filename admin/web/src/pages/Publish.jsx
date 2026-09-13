// 发布页（方案 §4.10）
//   构建校验 → 暂存 → 提交 → 拉取变基 → 推送 → 触发重建
//   默认「一键全发」，也可以只勾选要发布的文件；下面还有发布历史与一键回滚。
import { useCallback, useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash,
  TriangleAlert,
  X,
} from '../icons.js';

const KIND = {
  added: { label: '新增', cls: 'tag-ok' },
  modified: { label: '修改', cls: 'tag-amber' },
  deleted: { label: '删除', cls: 'tag-bad' },
  renamed: { label: '改名', cls: 'tag-soft' },
};

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false });
};

// 让顶栏那个「发布 N」的数字跟着一起更新（Shell.jsx 里监听）
const syncPending = () => window.dispatchEvent(new Event('qingwu:pending'));

export default function Publish() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // null = 全选
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  // 阶段 K：定时发布（到点由服务器自动跑一遍发布）
  const [schedule, setSchedule] = useState({ jobs: [] });
  const [at, setAt] = useState('');
  const [articleId, setArticleId] = useState('');
  const [note, setNote] = useState('');
  const [schedBusy, setSchedBusy] = useState(false);
  const [articles, setArticles] = useState([]);
  // 阶段 L：刚「跑完」的步骤 —— 给它的勾一个弹跳（只在状态真正翻转时加 400ms）
  const [popped, setPopped] = useState([]);
  const prevStates = useRef({});

  useEffect(() => {
    const steps = status?.job?.steps;
    if (!steps) return;
    const flipped = steps
      .filter((s) => s.state === 'ok' && prevStates.current[s.key] && prevStates.current[s.key] !== 'ok')
      .map((s) => s.key);
    prevStates.current = Object.fromEntries(steps.map((s) => [s.key, s.state]));
    if (flipped.length === 0) return;
    setPopped(flipped);
    const t = setTimeout(() => setPopped([]), 450);
    return () => clearTimeout(t);
  }, [status]);

  const loadSchedule = useCallback(async () => {
    try {
      setSchedule(await api.get('/api/schedule'));
    } catch {
      /* 定时待办读不到不影响发布本身 */
    }
  }, []);

  useEffect(() => {
    loadSchedule();
    api
      .get('/api/articles?pageSize=200')
      .then((r) => setArticles(r.articles ?? []))
      .catch(() => setArticles([]));
  }, [loadSchedule]);

  const addSchedule = async () => {
    setError('');
    setSchedBusy(true);
    try {
      const r = await api.post('/api/schedule', { at, articleId: articleId || null, note });
      setSchedule(r);
      setAt('');
      setArticleId('');
      setNote('');
    } catch (err) {
      setError(err.message || '加定时任务失败');
    } finally {
      setSchedBusy(false);
    }
  };

  const cancelSchedule = async (id) => {
    setError('');
    try {
      setSchedule(await api.post('/api/schedule/cancel', { id }));
    } catch (err) {
      setError(err.message || '取消失败');
    }
  };

  const clearSchedule = async () => {
    try {
      setSchedule(await api.post('/api/schedule/clear', {}));
    } catch (err) {
      setError(err.message || '清理失败');
    }
  };

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [s, h] = await Promise.all([api.get('/api/publish/status'), api.get('/api/publish/history')]);
      setStatus(s);
      setHistory(h.history ?? []);
      syncPending();
      if (s.job && !s.job.running) setSelected(null);
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 有任务在跑就轮询（1.2s）
  useEffect(() => {
    const running = status?.job?.running;
    if (running) {
      pollRef.current = setTimeout(async () => {
        try {
          const s = await api.get('/api/publish/status');
          setStatus(s);
          if (s.job && !s.job.running) {
            const h = await api.get('/api/publish/history');
            setHistory(h.history ?? []);
            syncPending();
          }
        } catch {
          /* 轮询失败就下一次再说 */
        }
      }, 1200);
    }
    return () => clearTimeout(pollRef.current);
  }, [status]);

  const files = status?.files ?? [];
  const picked = selected === null ? files.map((f) => f.file) : selected;

  const doPublish = async (paths) => {
    setError('');
    try {
      const r = await api.post('/api/publish', paths && paths.length ? { paths } : {});
      setStatus((s) => ({ ...s, job: r.job }));
    } catch (err) {
      setError(err.message || '发布失败');
    }
  };

  const doRollback = async (commit, subject) => {
    if (!window.confirm(`把这次提交回滚掉并重新上线？\n\n${subject}`)) return;
    setError('');
    try {
      const r = await api.post('/api/publish/rollback', { commit });
      setStatus((s) => ({ ...s, job: r.job }));
    } catch (err) {
      setError(err.message || '回滚失败');
    }
  };

  const job = status?.job;

  return (
    <>
      {error && (
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
      )}

      {/* 状态卡 */}
      <section className="card panel">
        <div className="panel-head">
          <h2>发布</h2>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => doPublish(null)}
            disabled={!status?.canPublish || job?.running}
          >
            <MorphIcon icon={Send} size={15} color="#fff" />
            {job?.running
              ? '发布中…'
              : status && status.onMain === false
                ? '先切回 main 再发布'
                : files.length === 0 && (status?.ahead ?? 0) > 0
                  ? `重试推送 ${status.ahead} 个提交`
                  : '构建校验并发布全部'}
          </button>
        </div>

        {/* 只留真正需要看的一句话：正常情况不用解释「发布」是什么 */}
        {(!status?.hasToken || !status?.hasDeployHook) && (
          <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
            {!status?.hasToken && <strong>还没配「发布令牌」，现在只能保存、不能发布。</strong>}
            {status?.hasToken && !status?.hasDeployHook && '站点会在推送后自己重建，稍慢一点。'}
          </p>
        )}

        {/* 窄屏时表格自己横向滚动（.table 有 min-width，不套 .table-wrap 会把整页撑宽）*/}
        <div className="table-wrap">
          <table className="table" style={{ marginBottom: 4 }}>
            <tbody>
              <tr>
                <th style={{ width: 120 }}>分支</th>
                <td className="mono">
                  {status?.branch ?? '—'}
                  {status && status.branch !== 'main' && (
                    <span className="tag tag-bad" style={{ marginLeft: 8 }}>
                      不在 main 上 —— 发布只会推 main，先切回 main
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th>与远端</th>
                <td>
                  领先 <b>{status?.ahead ?? 0}</b> 个提交、落后 <b>{status?.behind ?? 0}</b> 个
                  {(status?.behind ?? 0) > 0 && (
                    <span className="tag tag-amber" style={{ marginLeft: 8 }}>
                      远端有新提交，发布时会先自动拉取变基
                    </span>
                  )}
                  {(status?.ahead ?? 0) > 0 && status?.onMain !== false && (
                    <span className="tag tag-amber" style={{ marginLeft: 8 }}>
                      本地有 {status.ahead} 个提交还没推上去（上次推送没成功？再发一次即可）
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th>待发布</th>
                <td>
                  <b>{files.length}</b> 个文件
                  {files.length === 0 && <span className="hint">（没有待发布的改动 — 保存内容后这里会出现）</span>}
                  {files.length === 0 && (status?.ahead ?? 0) > 0 && status?.onMain !== false && (
                    <div className="hint" style={{ marginTop: 4 }}>
                      上次推送没成功：本地攒了 {status.ahead} 个提交还没上去 —— 点上面的「重试推送」推上去即可（改动没丢）。
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 定时发布（阶段 K · 方案 §4.12）：到点由服务器自己跑一遍发布 */}
      <section className="card panel">
        <div className="panel-head">
          <h2>定时发布</h2>
          <div className="spacer" />
          <span className="hint">每 15 秒检查一次，重启后会补跑</span>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          到点自动发一次；指定文章时，会先把<strong>草稿</strong>改成已发布再发。
        </p>

        <div className="form-grid">
          <label className="field">
            <span>什么时候发</span>
            <input
              className="input"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <label className="field">
            <span>发哪篇（可不选 = 发布当时所有待发布改动）</span>
            <select className="select" value={articleId} onChange={(e) => setArticleId(e.target.value)}>
              <option value="">（不指定：发全部待发布）</option>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {a.draft ? '（草稿）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>备注（选填）</span>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：早上八点发新文章"
            />
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <button type="button" className="btn" onClick={addSchedule} disabled={!at || schedBusy}>
              <MorphIcon icon={CalendarClock} size={15} color="#fff" />
              {schedBusy ? '添加中…' : '加一条定时'}
            </button>
          </div>
        </div>

        {schedule.jobs?.length > 0 && (
          <div className="post-list" style={{ marginTop: 12 }}>
            {schedule.jobs.map((j) => (
              <div key={j.id} className="post-item">
                <span className="cat-icon">
                  <MorphIcon icon={j.state === 'pending' ? Clock : CircleCheck} size={16} color="currentColor" spring="snappy" reducedMotion="user" />
                </span>
                <div className="post-main">
                  <div className="post-title">
                    {fmt(j.at)}
                    <span
                      className={`tag ${
                        j.state === 'pending' ? 'tag-amber' : j.state === 'done' ? 'tag-ok' : j.state === 'running' ? 'tag-soft' : 'tag-bad'
                      }`}
                      style={{ marginLeft: 8 }}
                    >
                      {j.state === 'pending' ? '等待中' : j.state === 'running' ? '发布中' : j.state === 'done' ? '已发布' : j.state === 'canceled' ? '已取消' : '失败'}
                    </span>
                  </div>
                  <div className="post-meta">
                    {j.articleId ? `文章 ${j.articleId}` : '全部待发布改动'}
                    {j.note && <> · {j.note}</>}
                    {j.result && <> · {j.result}</>}
                  </div>
                </div>
                <div className="post-acts">
                  {j.state === 'pending' && (
                    <button type="button" className="iconbtn danger" title="取消这条定时" onClick={() => cancelSchedule(j.id)}>
                      <MorphIcon icon={X} size={16} color="currentColor" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {schedule.jobs.some((j) => j.state !== 'pending') && (
              <div className="pager">
                <button type="button" className="btn btn-ghost" onClick={clearSchedule}>
                  <MorphIcon icon={Trash} size={15} color="currentColor" />
                  清掉已结束的
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 待发布文件（可勾选）*/}
      {files.length > 0 && (
        <section className="card panel">
          <div className="panel-head">
            <h2>待发布的改动</h2>
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
              全选
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSelected([])}>
              全不选
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => doPublish(picked)}
              disabled={picked.length === 0 || job?.running}
            >
              <MorphIcon icon={Send} size={15} color="#fff" />
              只发布勾选的 {picked.length} 个
            </button>
          </div>
          <div className="unpub-box">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }} />
                    <th style={{ width: 76 }}>改动</th>
                    <th>文件</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const on = picked.includes(f.file);
                    return (
                      <tr key={f.file}>
                        <td>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setSelected(
                                on ? picked.filter((p) => p !== f.file) : [...picked, f.file],
                              )
                            }
                          />
                        </td>
                        <td>
                          <span className={`tag ${KIND[f.kind]?.cls ?? 'tag-soft'}`}>
                            {KIND[f.kind]?.label ?? f.kind}
                          </span>
                        </td>
                        <td className="mono" style={{ wordBreak: 'break-all' }}>{f.file}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* 发布进度 */}
      {job && (
        <section className="card panel">
          <div className="panel-head">
            <h2>
              {job.kind === 'rollback' ? '回滚' : '发布'}
              {job.running ? '进行中' : job.ok ? '成功' : '失败'}
            </h2>
            <div className="spacer" />
            <span className="hint">{fmt(job.startedAt)}</span>
          </div>

          {job.error && (
            <div className="alert alert-warn">
              <MorphIcon icon={TriangleAlert} size={15} color="currentColor" />
              <span>{job.error}</span>
            </div>
          )}
          {job.ok === true && !job.error && (
            <div className="alert alert-success-pop" style={{ background: 'rgba(47,122,85,.12)', border: '1px solid rgba(47,122,85,.3)', color: '#2f7a55' }}>
              <MorphIcon icon={CircleCheck} size={15} color="currentColor" />
              <span>已推送 —— 站点通常 1 分钟左右更新（可以刷新首页看看）。</span>
            </div>
          )}

          <div className="steps">
            {job.steps.map((s) => (
              // 阶段 L：正在跑的那步呼吸、刚跑完的那步打勾时弹一下 —— 进度看得见
              <div
                key={s.key}
                className={`step ${s.state}${s.state === 'running' ? ' step-running' : ''}${
                  popped.includes(s.key) ? ' step-done-pop' : ''
                }`}
              >
                <span className="dot">{s.state === 'ok' ? '✓' : s.state === 'failed' ? '✗' : s.state === 'running' ? '…' : s.state === 'skip' ? '–' : ''}</span>
                <span className="lbl">{s.label}</span>
                {s.message && <span className="msg">{s.message}</span>}
              </div>
            ))}
          </div>

          {job.log?.length > 0 && <pre className="raw">{job.log.join('\n')}</pre>}
        </section>
      )}

      {/* 发布历史 + 回滚 */}
      <section className="card panel">
        <div className="panel-head">
          <h2>发布历史</h2>
          <div className="spacer" />
          <span className="hint">回滚 = 撤销那次提交再发一遍（不改写历史）</span>
        </div>
        <div className="post-list">
          {history.map((h) => (
            <div key={h.hash} className="post-item">
              <div className="post-main">
                <div className="post-title">{h.subject}</div>
                <div className="post-meta">
                  <span className="mono">{h.short}</span>
                  <span className="sep">·</span>
                  {h.date}
                </div>
              </div>
              <div className="post-acts">
                <button
                  type="button"
                  className="iconbtn danger"
                  title={h.isRoot ? '这是仓库的第一个提交，回滚不了' : '回滚这次提交'}
                  onClick={() => doRollback(h.hash, h.subject)}
                  disabled={h.isRoot || job?.running}
                >
                  <MorphIcon icon={RotateCcw} size={16} color="currentColor" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {job?.ok === true && !job.running && (
        <div className="alert" style={{ background: 'rgba(246,165,184,.16)', border: '1px solid var(--line)', color: 'var(--color-ink)' }}>
          <MorphIcon icon={Sparkles} size={15} color="currentColor" />
          <span>想确认线上？打开 <a href="https://www.qingwu.ink" target="_blank" rel="noreferrer">www.qingwu.ink</a> 看一眼即可（Vercel 大约 1 分钟生效）。</span>
        </div>
      )}
    </>
  );
}
