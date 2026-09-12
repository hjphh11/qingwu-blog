import { useCallback, useEffect, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { useCountUp } from '../anim.js';
import { downloadBackup } from '../backup.js';
import { CircleAlert, CircleCheck, Download, RefreshCw, Sparkles } from '../icons.js';

const RAW_FILES = ['links.json', 'share.json', 'about.json', 'music.json', 'categories.json'];

const fmtBytes = (b) => {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN');
};

/**
 * 统计卡（⚠️ 必须放在组件外面 —— 组件写在组件内部会导致每次渲染都重建子树，
 * 这也是阶段 L 之前踩过的「输入框每打一个字就丢焦点」那个坑）。
 * 数字滚动到位（阶段 L），系统开了「减少动效」时直接显示终值。
 */
function StatCard({ n, label, sub }) {
  const shown = useCountUp(n);
  return (
    <div className="card stat">
      <div className="n stat-value">{shown}</div>
      <div className="l">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Overview({ go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rawName, setRawName] = useState('links.json');
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState('');
  // 阶段 K：备份与定时发布
  const [backup, setBackup] = useState({});
  const [schedule, setSchedule] = useState({ jobs: [] });
  const [backing, setBacking] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api.get('/api/overview'));
    } catch (err) {
      setError(err.message || '读取数据失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 备份元信息 + 定时待办（失败也不影响概览其它部分）
  useEffect(() => {
    api.get('/api/backup/info').then(setBackup).catch(() => setBackup({}));
    api.get('/api/schedule').then(setSchedule).catch(() => setSchedule({ jobs: [] }));
  }, []);

  const doBackup = async () => {
    setBacking(true);
    try {
      downloadBackup();
      // 打包要一两秒，给个提前量再刷新元信息
      setTimeout(() => api.get('/api/backup/info').then(setBackup).catch(() => {}), 2500);
    } finally {
      setTimeout(() => setBacking(false), 1200);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setRawError('');
    api
      .get(`/api/data/${rawName}/raw`)
      .then((r) => {
        if (!cancelled) setRawText(r.text);
      })
      .catch((err) => {
        if (!cancelled) {
          setRawText('');
          setRawError(err.message || '读取失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rawName]);

  const stats = useMemo(() => {
    if (!data) return [];
    const a = data.articles;
    const find = (f) => data.data.find((d) => d.file === f);
    const share = find('share.json');
    const links = find('links.json');
    const music = find('music.json');
    const cats = find('categories.json');
    return [
      {
        n: a.total,
        l: '篇文章',
        sub: `已发布 ${a.published} · 草稿 ${a.drafts}`,
      },
      { n: a.pinned, l: '置顶', sub: a.broken > 0 ? `⚠ ${a.broken} 篇解析失败` : 'frontmatter 正常' },
      { n: links?.count ?? '—', l: '位友链', sub: links?.ok ? 'links.json 正常' : 'links.json 有问题' },
      {
        n: share?.count ?? '—',
        l: '条分享 / 语录',
        sub: share?.extra ? `收藏 ${share.extra.收藏} · 语录 ${share.extra.语录}` : '',
      },
      { n: music?.count ?? '—', l: '首歌曲', sub: 'music.json' },
      { n: cats?.count ?? '—', l: '个分类', sub: 'categories.json' },
    ];
  }, [data]);

  if (error) {
    return (
      <div className="card panel">
        <div className="alert alert-error" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>{error}</span>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={load}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card panel" style={{ textAlign: 'center', color: 'rgba(74,55,40,.55)' }}>
        正在读取仓库数据…
      </div>
    );
  }

  const a = data.articles;
  const bad = data.data.filter((d) => !d.ok);

  return (
    <>
      <section className="stats">
        {stats.map((s) => (
          <StatCard key={s.l} n={s.n} label={s.l} sub={s.sub} />
        ))}
      </section>

      {(!a.articlesOk || bad.length > 0) && (
        <div className="alert alert-warn" role="alert">
          <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
          <span>
            {!a.articlesOk && <>{a.articlesError}　</>}
            {bad.length > 0 && (
              <>
                有 {bad.length} 个数据文件有问题：{bad.map((b) => b.file).join('、')} ——
                这会让站点<strong>构建失败</strong>，下面「数据文件健康」里有具体原因。
              </>
            )}
          </span>
        </div>
      )}

      <section className="card panel">
        <div className="panel-head">
          <MorphIcon icon={Sparkles} size={17} color="var(--color-rose)" />
          <h2>数据文件健康</h2>
          <div className="spacer" />
          <span className="hint">后台只读，不会改动它们</span>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>文件</th>
              <th>状态</th>
              <th className="num">条目</th>
              <th>最后修改</th>
              <th className="right">大小</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((d) => (
              <tr key={d.file}>
                <td>
                  <div>{d.label}</div>
                  <div className="mono">src/data/{d.file}</div>
                </td>
                <td>
                  {d.ok ? (
                    <span className="tag tag-ok">
                      <MorphIcon icon={CircleCheck} size={12} color="currentColor" /> 正常
                    </span>
                  ) : (
                    <span className="tag tag-bad" title={d.error}>
                      <MorphIcon icon={CircleAlert} size={12} color="currentColor" /> {d.error}
                    </span>
                  )}
                </td>
                <td className="num">{d.ok ? `${d.count} ${d.unit ?? ''}` : '—'}</td>
                <td className="mono">{fmtTime(d.mtime)}</td>
                <td className="right mono">{fmtBytes(d.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>分类分布</h2>
          <div className="spacer" />
          <span className="hint">分类改 categories.json，前台筛选会自动跟着变</span>
        </div>
        <div className="raw-tools" style={{ marginBottom: 0 }}>
          {a.byCategory.length === 0 && <span className="empty">还没有文章</span>}
          {a.byCategory.map((c) => (
            <span className="tag tag-rose" key={c.id}>
              {c.label} · {c.count} 篇 <span style={{ opacity: 0.6 }}>({c.id})</span>
            </span>
          ))}
          {data.categories
            .filter((c) => !a.byCategory.some((x) => x.id === c.id))
            .map((c) => (
              <span className="tag tag-soft" key={c.id}>
                {c.label} · 0 篇 <span style={{ opacity: 0.6 }}>({c.id})</span>
              </span>
            ))}
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>最近文章</h2>
          <div className="spacer" />
          <span className="hint">按发布时间倒序的前 8 篇</span>
        </div>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>标题</th>
              <th>分类</th>
              <th>发布日期</th>
              <th>状态</th>
              <th className="right">最后修改</th>
            </tr>
          </thead>
          <tbody>
            {a.recent.map((p) => (
              <tr key={p.id}>
                <td>
                  <div>{p.title}</div>
                  <div className="mono">{p.id}</div>
                </td>
                <td>
                  <span className="tag tag-soft">{p.categoryLabel || '—'}</span>
                </td>
                <td className="mono">{fmtDate(p.pubDate)}</td>
                <td>
                  {p.draft ? (
                    <span className="tag tag-amber">草稿</span>
                  ) : (
                    <span className="tag tag-ok">已发布</span>
                  )}
                  {p.pinned && <span className="tag tag-rose" style={{ marginLeft: 6 }}>置顶</span>}
                </td>
                <td className="right mono">{fmtTime(p.mtime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>原始 JSON 预览</h2>
          <div className="spacer" />
          <span className="hint">只读；改内容要等阶段 E 起的编辑功能</span>
        </div>
        <div className="raw-tools">
          {RAW_FILES.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${rawName === f ? ' on' : ''}`}
              onClick={() => setRawName(f)}
            >
              {f}
            </button>
          ))}
        </div>
        {rawError ? (
          <div className="alert alert-error">
            <MorphIcon icon={CircleAlert} size={15} color="currentColor" />
            <span>{rawError}</span>
          </div>
        ) : (
          <pre className="raw">{rawText}</pre>
        )}
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>备份与定时发布</h2>
          <div className="spacer" />
          <span className="hint">
            {backup.at ? `内容文件 ${backup.count} 个 · 当前提交 ${backup.commit ?? '—'}` : '正在读取…'}
          </span>
          <button type="button" className="btn" onClick={doBackup} disabled={backing}>
            <MorphIcon icon={Download} size={15} color="#fff" />
            {backing ? '打包中…' : '一键导出备份（zip）'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          备份里是<strong>内容</strong>（文章 + 各 JSON + 歌词 + 生成好的 <span className="mono">music.ts</span>），
          附 <span className="mono">MANIFEST.json</span>（每个文件的 sha256）和恢复说明 —— 解压覆盖回仓库就能完整还原。
          代码不在里面（代码在 git 里）。
        </p>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <th style={{ width: 120 }}>定时发布</th>
                <td>
                  {schedule.jobs?.length ? (
                    <>
                      有 <b>{schedule.jobs.filter((j) => j.state === 'pending').length}</b> 条待办，
                      最近一条 {fmtTime(schedule.jobs.find((j) => j.state === 'pending')?.at)}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ marginLeft: 10, padding: '5px 12px', fontSize: 13 }}
                        onClick={() => go?.('publish')}
                      >
                        去发布页管理
                      </button>
                    </>
                  ) : (
                    <>
                      没有待办 <span className="hint">（在发布页可以设「到点自动发布」）</span>
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>仓库</h2>
        </div>
        <div className="table-wrap">
        <table className="table">
          <tbody>
            <tr>
              <th style={{ width: 120 }}>仓库路径</th>
              <td className="mono">{data.repo.path}</td>
            </tr>
            <tr>
              <th>文章目录</th>
              <td className="mono">{data.repo.articlesDir ?? '—'}</td>
            </tr>
            <tr>
              <th>正文字数</th>
              <td className="num">{a.totalChars.toLocaleString('zh-CN')} 字（不含空白）</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </>
  );
}
