// 概览（珍珠玻璃版）。
//
// 版式照 scaffold 的「工作台」：主次布局的 bento 网格 ——
// 主卡（内容规模 + 分类占比）+ 侧块（待发布 / 数据健康）+ 三分栏 + 整宽明细 + 常用入口。
//
// ⚠️ 信息量与旧版（暖色 Overview.jsx）**完全一致**，一处没少：
//   文章统计 / 数据文件健康 / 分类分布 / 最近文章 / 原始 JSON 预览 /
//   备份与定时发布 / 仓库信息 / 出错可重试。
// 差别只在呈现：卡片列表换成了读数、占比条与规格铭牌（scaffold 的"仪器化"语汇），
// 并且不引图表库 —— 分类占比用 share-list 横条，这也是 scaffold 里本来就有的画法。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import { downloadBackup } from '../backup.js';
import {
  ArrowRight,
  ChartNoAxesColumn,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  Inbox,
  Link2,
  Music,
  Quote,
  RefreshCw,
  ScrollText,
  Settings,
  Trash,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import { toastError } from '../pearl/toast.js';
import BarChart from '../pearl/charts/BarChart.jsx';
import TickRing from '../pearl/charts/TickRing.jsx';
import TrendChart from '../pearl/charts/TrendChart.jsx';
import Button from '../pearl/ui/Button.jsx';
import EmptyState from '../pearl/ui/EmptyState.jsx';
import IconButton from '../pearl/ui/IconButton.jsx';
import Metric from '../pearl/ui/Metric.jsx';
import Select from '../pearl/ui/Select.jsx';
import SectionLabel from '../pearl/ui/SectionLabel.jsx';
import SpecPlate from '../pearl/ui/SpecPlate.jsx';
import Tag from '../pearl/ui/Tag.jsx';

const RAW_FILES = ['links.json', 'share.json', 'about.json', 'music.json', 'categories.json'];
const RAW_OPTIONS = RAW_FILES.map((f) => ({ label: f, value: f }));

/** 常用入口（与侧栏模块一致，点一下直接过去） */
const SHORTCUTS = [
  { key: 'posts', label: '文章', sub: '内容', icon: FileText },
  { key: 'cats', label: '分类', sub: '内容', icon: Settings },
  { key: 'music', label: '音乐', sub: '内容', icon: Music },
  { key: 'links', label: '友链', sub: '站点', icon: Link2 },
  { key: 'apply', label: '友链申请', sub: '站点', icon: Inbox },
  { key: 'share', label: '分享 · 语录', sub: '站点', icon: Quote },
  { key: 'publish', label: '发布', sub: '运维', icon: ScrollText },
  { key: 'trash', label: '回收站', sub: '运维', icon: Trash },
  { key: 'stats', label: '访问统计', sub: '运维', icon: ChartNoAxesColumn },
];

const fmtBytes = (b) => {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN');
};

/** 顶部那句日期戳（scaffold 工作台也有这一行） */
function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${'日一二三四五六'[now.getDay()]}`;
}

export default function Overview({ go }) {
  const pageRef = useRef(null);
  // 入场类由 state 驱动（见 pearl/useEntrance.js）：手写 classList 会被 React 重写抹掉
  const ready = useEntrance();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rawName, setRawName] = useState('links.json');
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState('');
  const [backup, setBackup] = useState({});
  const [schedule, setSchedule] = useState({ jobs: [] });
  /** 全部文章的发布日期（画「发布趋势」用；概览接口只给最近 8 篇，不够画趋势） */
  const [allArticles, setAllArticles] = useState([]);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api.get('/api/overview'));
    } catch (err) {
      setError(err.message || '读取数据失败');
      toastError(err, '概览数据加载失败');
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
    // 文章列表接口带全部文章的发布日期，用来把「发布趋势」画出来
    api
      .get('/api/articles')
      .then((r) => setAllArticles(r.articles ?? []))
      .catch(() => setAllArticles([]));
  }, []);

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

  const a = data?.articles;
  const repo = data?.repo ?? {};

  /** 分类占比：按篇数降序的横条（原版是彩色标签，这里用 scaffold 的 share-list） */
  const catBars = useMemo(() => {
    if (!a) return [];
    const list = [...a.byCategory].sort((x, y) => y.count - x.count);
    const total = list.reduce((n, c) => n + c.count, 0) || 1;
    const max = Math.max(1, ...list.map((c) => c.count));
    return list.map((c, i) => ({
      ...c,
      pct: Math.round((c.count / total) * 100),
      w: (c.count / max) * 100,
      cat: (i % 5) + 1,
    }));
  }, [a]);

  /** 内容构成占比条 */
  const makeBars = useMemo(() => {
    if (!a) return [];
    const total = a.total || 1;
    const max = Math.max(1, a.published, a.drafts, a.pinned);
    return [
      { label: '已发布', value: a.published, cat: 2 },
      { label: '草稿', value: a.drafts, cat: 4 },
      { label: '置顶', value: a.pinned, cat: 1 },
    ].map((r) => ({ ...r, pct: Math.round((r.value / total) * 100), w: (r.value / max) * 100 }));
  }, [a]);

  /** 近 12 个月的发布篇数（趋势图） */
  const monthly = useMemo(() => {
    const now = new Date();
    const slots = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      slots.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: i === 0 ? '本月' : `${d.getMonth() + 1}月`,
        count: 0,
      });
    }
    const byKey = new Map(slots.map((s) => [s.key, s]));
    allArticles.forEach((a) => {
      const slot = byKey.get(String(a.pubDateText ?? '').slice(0, 7));
      if (slot) slot.count += 1;
    });
    return { values: slots.map((s) => s.count), labels: slots.map((s) => s.label) };
  }, [allArticles]);

  /** 各数据文件的条目数（柱状图；有问题的文件按 0 计并在标签上暴露） */
  const fileBars = useMemo(() => {
    const list = data?.data ?? [];
    return {
      values: list.map((d) => (d.ok ? Number(d.count ?? 0) : 0)),
      labels: list.map((d) => d.file.replace(/\.json$/, '')),
    };
  }, [data]);

  const publishPct = a && a.total ? Math.round((a.published / a.total) * 1000) / 10 : 0;

  const fileOk = (data?.data ?? []).filter((d) => d.ok).length;  const bad = (data?.data ?? []).filter((d) => !d.ok);
  const articleWarn = (!repo.articlesOk && repo.articlesError) || bad.length > 0;
  const pendingJobs = (schedule.jobs ?? []).filter((j) => j.state === 'pending');

  const onBackup = () => {
    downloadBackup();
    setTimeout(() => api.get('/api/backup/info').then(setBackup).catch(() => {}), 2500);
  };

  if (error && !data) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')} ref={pageRef}>
        <header className="page-head reveal">
          <div className="page-head-main">
            <h1 className="page-title">概览</h1>
            <p className="page-desc">清清的小屋 · 内容与发布</p>
          </div>
        </header>
        <section className={cls('panel', 'm-surface', 'reveal')} style={{ padding: 20 }}>
          <div className="toast tone-danger" style={{ position: 'static', maxWidth: 'none' }}>
            <span className="toast-dot" aria-hidden="true" />
            <span className="toast-msg">{error}</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="ghost" icon={RefreshCw} onClick={load}>
              重试
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')} ref={pageRef}>
        <section className={cls('panel', 'm-surface')} style={{ padding: 24 }}>
          <EmptyState title="正在读取仓库数据…" desc="文章、数据文件与发布状态" icon={RefreshCw} />
        </section>
      </div>
    );
  }

  return (
    <div className={cls('page', 'dashboard', ready && 'is-entrance-ready')} ref={pageRef}>
      <header className="page-head reveal">
        <div className="page-head-main">
          <span className="page-date">{dateStamp()}</span>
          <h1 className="page-title">概览</h1>
          <p className="page-desc">清清的小屋 · 内容规模、数据文件健康与发布状态。</p>
        </div>
        <div className="page-head-side">
          <SpecPlate
            title="待发布"
            rows={[
              { label: '文件', value: data.unpublished.count ?? '—', tone: (data.unpublished.count ?? 0) > 0 ? 'lime' : undefined },
              { label: '文章', value: a.total },
            ]}
          />
          <div className="page-actions">
            <IconButton icon={RefreshCw} label="刷新" bordered disabled={busy} onClick={load} />
            <Button variant="primary" icon={Download} onClick={onBackup}>
              导出备份
            </Button>
          </div>
        </div>
      </header>

      {articleWarn && (
        <section className={cls('panel', 'm-surface', 'reveal')} style={{ padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--red-text)', fontSize: 13 }}>
            <MorphIcon icon={CircleAlert} size={16} color="currentColor" />
            <span>
              {!repo.articlesOk && repo.articlesError ? `${repo.articlesError}　` : null}
              {bad.length > 0 && (
                <>
                  {bad.length} 个数据文件有问题（会导致构建失败）：{bad.map((b) => b.file).join('、')}
                </>
              )}
            </span>
          </div>
        </section>
      )}

      <div className="bento-grid">
        {/* 主卡：内容规模 + 分类占比 */}
        <section className={cls('bento', 'bento-hero', 'm-glow')}>
          <span className="glow-layer" aria-hidden="true" />
          <div className="hero-head">
            <SectionLabel title="内容规模" status={a.broken > 0 ? 'danger' : 'ok'} />
            <span className="bento-meta">文章目录已连接</span>
          </div>
          <div className="hero-body">
            <div className="hero-figure">
              <Metric value={a.total} unit="篇" size="xl" />
              <div className="hero-delta">
                <Tag tone={a.broken > 0 ? 'danger' : 'ok'} dot>
                  {a.broken > 0 ? `${a.broken} 篇格式有问题` : '格式全部正常'}
                </Tag>
              </div>
              <dl className="hero-readouts">
                <div>
                  <dt>已发布</dt>
                  <dd className="tnum">{a.published}</dd>
                </div>
                <div>
                  <dt>草稿</dt>
                  <dd className="tnum">{a.drafts}</dd>
                </div>
                <div>
                  <dt>置顶</dt>
                  <dd className="tnum">{a.pinned}</dd>
                </div>
                <div>
                  <dt>正文</dt>
                  <dd className="tnum">{a.totalChars.toLocaleString('zh-CN')}</dd>
                </div>
              </dl>
            </div>
            <div className="hero-chart">
              {/* 发布趋势：scaffold 自绘的 SVG 折线（不引图表库）；数据来自文章列表的发布日期 */}
              <TrendChart
                values={monthly.values}
                labels={monthly.labels}
                height={196}
                unit=" 篇"
                primaryLabel="发布"
                tone="ink"
              />
            </div>
          </div>
          <div className="hero-actions">
            <button type="button" className="pill-btn is-dark" onClick={() => go?.('posts')}>
              查看文章 <MorphIcon icon={ArrowRight} size={14} color="currentColor" />
            </button>
            <button type="button" className="pill-btn" disabled={busy} onClick={load}>
              <MorphIcon icon={RefreshCw} size={14} color="currentColor" /> 刷新
            </button>
          </div>
        </section>

        {/* 侧块：待发布 / 数据健康 */}
        <section className={cls('bento', 'bento-side')}>
          <div className="side-top">
            <span className="side-label">待发布 · 已保存未推送</span>            <span className={cls('side-ico', 'm-groove')}>
              <MorphIcon icon={ScrollText} size={16} color="currentColor" />
            </span>
          </div>
          <Metric value={data.unpublished.count} unit="个文件" size="l" />
          <div className="side-foot">
            <span className="muted">{pendingJobs.length > 0 ? `另有 ${pendingJobs.length} 条定时待办` : '没有定时待办'}</span>
          </div>
        </section>

        <section className={cls('bento', 'bento-side')}>
          <div className="side-top">
            <span className="side-label">数据文件健康</span>
            <span className={cls('side-ico', 'm-groove')}>
              <MorphIcon icon={bad.length ? CircleAlert : CircleCheck} size={16} color="currentColor" />
            </span>
          </div>
          <Metric value={fileOk} unit={`/ ${(data.data ?? []).length}`} size="l" />
          <div className="side-foot">
            <span className="muted">{bad.length ? `${bad.length} 个文件有问题` : '全部正常'}</span>
          </div>
        </section>

        {/* 三分栏 */}
        <section className={cls('bento', 'bento-third')}>
          <div className="bento-head">
            <SectionLabel title="内容构成" />
            <span className="bento-meta tnum">{a.total} 篇</span>
          </div>
          <ul className="share-list">
            {makeBars.map((r) => (
              <li key={r.label} className={`cat-${r.cat}`}>
                <span className="share-label">{r.label}</span>
                <span className="share-track">
                  <i style={{ width: `${r.w}%` }} />
                </span>
                <span className="share-value tnum">
                  {r.value}
                  <small> 篇 · {r.pct}%</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 分类占比（原来在主卡右侧，主卡改用趋势图后挪到这里） */}
        <section className={cls('bento', 'bento-third')}>
          <div className="bento-head">
            <SectionLabel title="分类占比" />
            <span className="bento-meta">前台筛选跟着变</span>
          </div>
          {catBars.length === 0 ? (
            <EmptyState title="还没有文章" desc="写下第一篇后这里会显示各分类的占比" icon={FileText} />
          ) : (
            <ul className="share-list">
              {catBars.map((c) => (
                <li key={c.id} className={`cat-${c.cat}`}>
                  <span className="share-label">{c.label}</span>
                  <span className="share-track">
                    <i style={{ width: `${c.w}%` }} />
                  </span>
                  <span className="share-value tnum">
                    {c.count}
                    <small> 篇 · {c.pct}%</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 已发布占比：刻度环（scaffold 自绘，刻度逐根表达真实比例） */}
        <section className={cls('bento', 'bento-third', 'bento-ring')}>
          <div className="bento-head">
            <SectionLabel title="已发布占比" />
            <span className="bento-meta">草稿不计入前台构建</span>
          </div>
          <div className="ring-wrap">
            <TickRing value={publishPct} label="已发布" size={152} decimals={0} />
            <dl className="ring-readouts">
              <div>
                <dt>已发布</dt>
                <dd className="tnum">{a.published}</dd>
              </div>
              <div>
                <dt>草稿</dt>
                <dd className="tnum">{a.drafts}</dd>
              </div>
              <div>
                <dt>占比</dt>
                <dd className="tnum">{publishPct}%</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* 数据文件条目数：柱状图（一眼看出各文件规模与是否有文件异常掉到 0） */}
        <section className={cls('bento', 'bento-third')}>
          <div className="bento-head">
            <SectionLabel title="数据文件条目" status={bad.length ? 'danger' : 'ok'} />
            <span className="bento-meta tnum">共 {(data.data ?? []).length} 个</span>
          </div>
          <BarChart values={fileBars.values} labels={fileBars.labels} height={152} unit=" 条" />
        </section>

        <section className={cls('bento', 'bento-half')}>
          <div className="bento-head">
            <SectionLabel title="数据文件明细" status={bad.length ? 'danger' : 'ok'} />
            <span className="bento-meta">后台只读</span>
          </div>
          <div className="activity-list">
            {(data.data ?? []).map((d) => (
              <div className="activity" key={d.file}>
                <span className={cls('quick-ico', 'm-groove')}>
                  <MorphIcon icon={d.ok ? CircleCheck : CircleAlert} size={15} color="currentColor" />
                </span>
                <div className="activity-main">
                  <div className={cls('ellipsis')}>
                    <b>{d.label}</b>{' '}
                    <span className={cls('mono')} style={{ fontSize: 13 }}>
                      src/data/{d.file}
                    </span>
                  </div>
                  <div className={cls('faint', 'mono-time')}>
                    {d.ok ? `${d.count} ${d.unit ?? ''} · ${fmtTime(d.mtime)}` : d.error}
                  </div>
                </div>
                <span className={cls('mono')} style={{ fontSize: 13 }}>
                  {fmtBytes(d.bytes)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={cls('bento', 'bento-third')}>
          <div className="bento-head">
            <SectionLabel title="备份与定时发布" status={pendingJobs.length > 0 ? 'info' : 'ok'} />
            <span className="bento-meta">{backup.at ? `内容文件 ${backup.count} 个` : '读取中…'}</span>
          </div>
          <dl className="ring-readouts" style={{ marginBottom: 12 }}>
            <div>
              <dt>当前提交</dt>
              <dd className="tnum">{backup.commit ?? '—'}</dd>
            </div>
            <div>
              <dt>定时待办</dt>
              <dd className="tnum">{pendingJobs.length}</dd>
            </div>
            <div>
              <dt>最近一条</dt>
              <dd className="tnum">{pendingJobs.length ? fmtTime(pendingJobs[0].at) : '—'}</dd>
            </div>
          </dl>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button icon={Download} onClick={onBackup}>
              导出备份 zip
            </Button>
            <Button variant="ghost" icon={ArrowRight} onClick={() => go?.('publish')}>
              去发布页
            </Button>
          </div>
        </section>

        {/* 整宽：最近文章 */}
        <section className={cls('bento', 'bento-wide')}>
          <div className="bento-head">
            <SectionLabel title="最近文章" />
            <span className="bento-meta">按修改时间倒序前 8 篇</span>
          </div>
          <div className={cls('table-wrap')}>
            <table className={cls('table')}>
              <thead>
                <tr>
                  <th>标题</th>
                  <th style={{ width: 120 }}>分类</th>
                  <th style={{ width: 120 }}>发布日期</th>
                  <th style={{ width: 150 }}>状态</th>
                  <th style={{ width: 170, textAlign: 'right' }}>最后修改</th>
                </tr>
              </thead>
              <tbody>
                {a.recent.map((p) => (
                  <tr key={p.id} className="data-row">
                    <td>
                      <div style={{ fontWeight: 620 }}>{p.title}</div>
                      <div className={cls('mono')} style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
                        {p.id}
                      </div>
                    </td>
                    <td>
                      <Tag>{p.categoryLabel || '未分类'}</Tag>
                    </td>
                    <td className={cls('mono')}>{fmtDate(p.pubDate)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        <Tag tone={p.draft ? 'neutral' : 'ok'} dot>
                          {p.draft ? '草稿' : '已发布'}
                        </Tag>
                        {p.pinned && <Tag tone="info">置顶</Tag>}
                      </span>
                    </td>
                    <td className={cls('mono')} style={{ textAlign: 'right' }}>{fmtTime(p.mtime)}</td>
                  </tr>
                ))}
                {a.recent.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ height: 'auto' }}>
                      <EmptyState title="还没有文章" icon={FileText} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 常用入口 */}
        <section className={cls('bento', 'bento-half')}>
          <div className="bento-head">
            <SectionLabel title="常用入口" />
          </div>
          <div className="shortcut-grid">
            {SHORTCUTS.map((s) => {
              const Ico = s.icon;
              return (
                <button key={s.key} type="button" className={cls('quick-link', 'm-surface')} onClick={() => go?.(s.key)}>
                  <span className={cls('quick-ico', 'm-groove')}>
                    <MorphIcon icon={Ico} size={17} color="currentColor" />
                  </span>
                  <span className="quick-text">
                    <span className="quick-title">{s.label}</span>
                    <span className="quick-sub">{s.sub}</span>
                  </span>
                  <MorphIcon className="quick-go" icon={ArrowRight} size={15} color="currentColor" />
                </button>
              );
            })}
          </div>
        </section>

        {/* 仓库铭牌 */}
        <section className={cls('bento', 'bento-half')}>
          <div className="bento-head">
            <SectionLabel title="仓库" />
            <span className="bento-meta">只读</span>
          </div>
          <SpecPlate
            title="qingwu.ink"
            rows={[
              { label: '仓库路径', value: repo.path ?? '—' },
              { label: '文章目录', value: repo.articlesDir ?? '—' },
              { label: '正文字数', value: `${a.totalChars.toLocaleString('zh-CN')} 字` },
              { label: '文章格式', value: repo.articlesOk ? '正常' : '有问题', tone: repo.articlesOk ? 'lime' : 'red' },
            ]}
          />
        </section>

        {/* 原始 JSON 预览 */}
        <section className={cls('bento', 'bento-full')}>
          <div className="bento-head">
            <SectionLabel title="原始 JSON 预览" />
            <div style={{ width: 190 }}>
              <Select value={rawName} options={RAW_OPTIONS} onChange={(v) => setRawName(v)} />
            </div>
          </div>
          {rawError ? (
            <div className="alert-calm" style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}>
              <MorphIcon icon={CircleAlert} size={16} color="currentColor" />
              <span>{rawError}</span>
            </div>
          ) : (
            <pre
              className={cls('mono')}
              style={{
                maxHeight: 320,
                overflow: 'auto',
                margin: 0,
                padding: 14,
                borderRadius: 'var(--r-md)',
                background: 'var(--groove-bg)',
                color: 'var(--ink-muted)',
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              {rawText || '（空）'}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}
