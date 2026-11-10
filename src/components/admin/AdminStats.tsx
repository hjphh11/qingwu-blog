/*
 * 后台 · 统计
 *
 * 2026-11-10 晚新开的一页，站长原话：「统计数据单独一个页面，要图表，有加载动画」。
 *
 * 数据全来自 GET /api/admin/stats?days=7|14|30，访问部分与对外 /stats 同一口径
 * （同一个站点不该有两个 PV 数），另外并上评论、拦截、AI 用量、自动回复四路序列。
 *
 * —— 图表为什么全手写 ——
 * 只有三种形状（折线面积 / 并排柱 / 横条），画一次比引一个图表库划算：
 * 这个后台到现在为止唯一的运行时依赖是 React，为四张图拉进 ECharts（≈300KB）
 * 或者 recharts（≈90KB + d3 的几个包）都不合适，何况它们默认的配色和圆角
 * 跟这套黑白点阵完全不是一回事，改样式的时间比画还长。
 *
 * —— 加载动画分两层 ——
 * ① 数据没到：骨架屏（.q-skel 的 shimmer）。接口在本机 20ms 就回来，骨架常常
 *    只闪一帧 —— 这是对的，不要为了「看得见」去加人为延迟。
 * ② 数据到了：图自己长出来。柱子从 0 长高（CSS transition）、折线用
 *    pathLength=1 + dashoffset 描边生长、大数字 rAF 数上去。
 *    这一层每次加载都会播，是真正看得见的那个「加载动画」。
 * 两层都走 prefers-reduced-motion：关掉之后直接给终值，不做位移。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

// ——————————————————————————————————————————————————————————
// 接口形状
// ——————————————————————————————————————————————————————————
interface Pair {
  name: string;
  pv: number;
}

interface Stats {
  ok: boolean;
  now: number;
  day: string;
  days: number;
  from: string;
  to: string;
  /** 哪几块没读出来。非空说明有表查询失败，别把 0 当成「真没数据」 */
  warnings: string[];
  trafficReady: boolean;
  totals: {
    pv: number;
    uv: number;
    comments: number;
    blocked: number;
    replies: number;
    aiCalls: number;
    tokens: number;
  };
  prev: { pv: number; uv: number };
  traffic: { day: string; pv: number; uv: number }[];
  pages: Pair[];
  referrers: Pair[];
  countries: Pair[];
  devices: Pair[];
  hours: { h: number; pv: number }[];
  comments: { day: string; total: number; spam: number }[];
  blocked: { day: string; n: number }[];
  verdicts: { verdict: string; n: number }[];
  ai: { day: string; channel: string; n: number; tokensIn: number; tokensOut: number }[];
  replies: { day: string; replied: number; skipped: number; blocked: number; failed: number }[];
}

function api<T>(path: string): Promise<T> {
  return fetch(API + path, { credentials: 'same-origin' }).then(async (r) => {
    if (r.status === 401) {
      window.location.replace('/admin/');
      throw new Error('unauthorized');
    }
    const d = (await r.json().catch(() => ({}))) as T & { message?: string };
    if (!r.ok) throw new Error(d?.message || `请求失败（${r.status}）`);
    return d;
  });
}

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————
const fmtNum = (n: number): string => Math.round(n).toLocaleString('zh-CN');

/** 'YYYY-MM-DD' → 'M/D' */
function fmtDay(d: string): string {
  const [, m, dd] = d.split('-');
  return `${Number(m)}/${Number(dd)}`;
}

/** 环比。前一段是 0 时不给百分比 —— 从 0 到 40 不是「+∞%」，是「刚开始有数」 */
function deltaOf(cur: number, prev: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (!prev) return cur > 0 ? { text: '上一段没有数据', tone: 'flat' } : { text: '持平', tone: 'flat' };
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return { text: '与上一段持平', tone: 'flat' };
  return { text: `${p > 0 ? '+' : ''}${p.toFixed(1)}% 较上一段`, tone: p > 0 ? 'up' : 'down' };
}

/** 国家码 → 中文。只列常见的，认不出来的直接显示代码（比瞎猜好） */
const COUNTRY: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  TW: '中国台湾',
  MO: '中国澳门',
  US: '美国',
  JP: '日本',
  SG: '新加坡',
  KR: '韩国',
  GB: '英国',
  DE: '德国',
  FR: '法国',
  NL: '荷兰',
  CA: '加拿大',
  AU: '澳大利亚',
  RU: '俄罗斯',
  IN: '印度',
  MY: '马来西亚',
  TH: '泰国',
  VN: '越南',
  ID: '印度尼西亚',
  PH: '菲律宾',
  BR: '巴西',
  IT: '意大利',
  ES: '西班牙',
  SE: '瑞典',
  CH: '瑞士',
  FI: '芬兰',
  PL: '波兰',
  TR: '土耳其',
  AE: '阿联酋',
  XX: '未知',
};

const DEVICE: Record<string, string> = { desktop: '桌面', mobile: '手机', tablet: '平板' };

const VERDICT: Record<string, string> = {
  illegal: '违法违规',
  porn: '色情低俗',
  abuse: '侮辱攻击',
  privacy: '隐私侵权',
  spam: '垃圾广告',
};

const REF_LABEL: Record<string, string> = { '(direct)': '直接访问', '(other)': '其他来源' };

/** 大数字数上去。prefers-reduced-motion 直接给终值。 */
function useCountUp(target: number, dur = 820): number {
  const [v, setV] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const next = Math.round(a + (target - a) * e);
      setV(next);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);

  return v;
}

/** 数据到位后置 true —— 柱子/折线的入场动画靠它触发（先渲染 0，再改真值） */
function useGrown(dep: unknown): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setOn(true);
      return;
    }
    setOn(false);
    const raf = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(raf);
  }, [dep]);
  return on;
}

// ——————————————————————————————————————————————————————————
// 图表
// ——————————————————————————————————————————————————————————
/**
 * 折线面积图（PV + UV）。
 *
 * viewBox 固定 0 0 720 200 + preserveAspectRatio="none" —— 横向拉伸会把描边一起
 * 拉变形，所以线和网格都加 `vector-effect: non-scaling-stroke`，线宽交给 CSS。
 * 桌面和 390 宽共用同一套坐标，不用 ResizeObserver 重算。
 */
function TrendChart({ data }: { data: { day: string; pv: number; uv: number }[] }) {
  const W = 720;
  const H = 200;
  const PAD = { t: 14, r: 8, b: 24, l: 8 };
  const grow = useGrown(data.map((d) => d.pv).join(','));

  const max = Math.max(1, ...data.map((d) => d.pv));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => (data.length <= 1 ? PAD.l + iw / 2 : PAD.l + (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;

  const line = (key: 'pv' | 'uv') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = `${line('pv')} L${x(data.length - 1).toFixed(1)},${PAD.t + ih} L${x(0).toFixed(1)},${PAD.t + ih} Z`;

  // 标签抽稀：7 天全给，14 天隔一，30 天每 5 天
  const step = data.length > 20 ? 5 : data.length > 10 ? 2 : 1;

  return (
    <svg className="q-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="访问趋势">
      {/* 三条参考线，只画不给数值 —— 数值在折线末端的标注里 */}
      {[0, 0.5, 1].map((k) => (
        <line
          key={k}
          x1={PAD.l}
          x2={W - PAD.r}
          y1={PAD.t + ih * k}
          y2={PAD.t + ih * k}
          className="q-chart__grid"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      <path d={area} className={`q-chart__area ${grow ? 'is-in' : ''}`} />

      <path
        d={line('uv')}
        className={`q-chart__line q-chart__line--uv ${grow ? 'is-in' : ''}`}
        pathLength={1}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line('pv')}
        className={`q-chart__line q-chart__line--pv ${grow ? 'is-in' : ''}`}
        pathLength={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* 悬停热区：每格一根透明柱，title 是浏览器原生提示 */}
      {data.map((d, i) => {
        const w = iw / Math.max(1, data.length);
        return (
          <rect
            key={d.day}
            x={x(i) - w / 2}
            y={PAD.t}
            width={Math.max(2, w)}
            height={ih}
            fill="transparent"
          >
            <title>{`${d.day}　浏览 ${d.pv}　访客 ${d.uv}`}</title>
          </rect>
        );
      })}

      {data.map((d, i) =>
        i % step === 0 || i === data.length - 1 ? (
          <text key={`t-${d.day}`} x={x(i)} y={H - 6} className="q-chart__x" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
            {fmtDay(d.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/**
 * 并排柱（每日评论 vs 其中被拦 / AI 两个通道）。
 *
 * 用 DOM 而不是 SVG：bar 的高度是一次 CSS transition 的事，
 * SVG 里得靠 scaleY + transform-box，多一层不可靠的东西换不来什么。
 */
function BarChart({
  data,
  aName,
  bName,
  aTone = 'ink',
  bTone = 'danger',
  unit = '',
}: {
  data: { label: string; a: number; b: number; tip?: string }[];
  aName: string;
  bName: string;
  aTone?: 'ink' | 'grey';
  bTone?: 'danger' | 'ink' | 'grey';
  unit?: string;
}) {
  const grow = useGrown(data.map((d) => d.a + '/' + d.b).join(','));
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const step = data.length > 20 ? 5 : data.length > 10 ? 2 : 1;
  // 全为 0 时不占位：时段分布没有第二序列，多留一根 0 高的柱只会把 24 根挤成 48 格
  const hasB = data.some((d) => d.b > 0);

  return (
    <div className="q-bars">
      <div className="q-bars__plot">
        {data.map((d, i) => (
          <div className="q-bars__col" key={d.label + i} title={d.tip ?? `${d.label}　${aName} ${d.a}${unit}　${bName} ${d.b}${unit}`}>
            <i
              className={`q-bars__bar is-${aTone}`}
              style={{ height: grow ? `${(d.a / max) * 100}%` : 0 }}
            />
            {hasB ? (
              <i
                className={`q-bars__bar is-${bTone}`}
                style={{ height: grow ? `${(d.b / max) * 100}%` : 0 }}
              />
            ) : null}
            {i % step === 0 || i === data.length - 1 ? <span>{d.label}</span> : <span aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 横条榜：Top 页面 / 国家 / 设备 / 来源 */
function RankList({
  items,
  total,
  labelOf,
  empty = '这段时间没有数据',
  max: maxN = 8,
}: {
  items: Pair[];
  total: number;
  labelOf?: (name: string) => string;
  empty?: string;
  max?: number;
}) {
  const grow = useGrown(items.map((i) => i.name).join(','));
  const top = items.slice(0, maxN);
  const peak = Math.max(1, ...top.map((i) => i.pv));

  if (top.length === 0) return <p className="q-chart__empty">{empty}</p>;

  return (
    <ul className="q-rank">
      {top.map((i) => (
        <li key={i.name}>
          <span className="q-rank__name" title={labelOf ? labelOf(i.name) : i.name}>
            {labelOf ? labelOf(i.name) : i.name}
          </span>
          <span className="q-rank__track">
            <i style={{ width: grow ? `${(i.pv / peak) * 100}%` : 0 }} />
          </span>
          <b>{fmtNum(i.pv)}</b>
          <em>{total > 0 ? `${Math.round((i.pv / total) * 100)}%` : '0%'}</em>
        </li>
      ))}
    </ul>
  );
}

/** KPI 一格：大数字 + 标签 + 一行副文案 */
function Kpi({
  n,
  label,
  sub,
  tone,
}: {
  n: number;
  label: string;
  sub?: { text: string; tone: 'up' | 'down' | 'flat' };
  tone?: 'danger';
}) {
  const v = useCountUp(n);
  return (
    <div className={`q-admin-kpi ${tone === 'danger' && n > 0 ? 'q-admin-kpi--danger' : ''}`}>
      <b>{fmtNum(v)}</b>
      <span>{label}</span>
      {sub ? <em className={`q-kpi-sub is-${sub.tone}`}>{sub.text}</em> : null}
    </div>
  );
}

/** 骨架屏：形状照真图排，切过去不跳 */
function Skeleton() {
  return (
    <div className="q-admin-skel" aria-busy="true" aria-label="正在读取统计">
      <div className="q-admin-kpis q-admin-kpis--4">
        {[0, 1, 2, 3].map((i) => (
          <div className="q-skel q-skel--kpi" key={i} />
        ))}
      </div>
      <div className="q-skel q-skel--chart" />
      <div className="q-admin-stat-grid">
        <div className="q-skel q-skel--half" />
        <div className="q-skel q-skel--half" />
      </div>
      <div className="q-skel q-skel--chart" style={{ height: 180 }} />
    </div>
  );
}

// ——————————————————————————————————————————————————————————
// 主组件
// ——————————————————————————————————————————————————————————
const RANGES = [7, 14, 30] as const;

export default function AdminStats() {
  const [ready, setReady] = useState(false);
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [at, setAt] = useState(0);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setErr('');
    try {
      const r = await api<Stats>(`/stats?days=${d}`);
      setData(r);
      setAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await api('/session');
        setReady(true);
      } catch {
        return;
      }
      await load(days);
    })();
    // 只在挂载时跑一次 —— days 的后续变化由下面的点击处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function pick(d: number) {
    if (d === days) return;
    setDays(d);
    void load(d);
  }

  // 汇总几个只在渲染时算的小数
  const peakTraffic = useMemo(() => {
    if (!data) return null;
    const top = [...data.traffic].sort((a, b) => b.pv - a.pv)[0];
    return top && top.pv > 0 ? top : null;
  }, [data]);

  if (!ready) {
    return (
      <>
        <AdminTop active="stats" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  return (
    <>
      <AdminTop active="stats" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>统计</h1>
            <p>
              {data ? `近 ${data.days} 天（${fmtDay(data.from)} – ${fmtDay(data.to)}）` : '访问、内容与 AI 用量'}
              {at ? ` · 读取于 ${new Date(at).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
            </p>
          </div>
          <div className="q-admin-stat-actions">
            <div className="q-admin-seg">
              {RANGES.map((d) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => pick(d)} disabled={loading && days === d}>
                  {d} 天
                </button>
              ))}
            </div>
            <button
              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
              type="button"
              onClick={() => void load(days)}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}

        {/* 切区间时把旧图换成骨架：数字会变，留着旧图容易看串行 */}
        {loading && !data ? <Skeleton /> : null}

        {data ? (
          <>
            {loading ? <Skeleton /> : null}

            {!loading ? (
              <>
                {!data.trafficReady || data.warnings.length ? (
                  <section className="q-admin-warnbox">
                    <b>
                      {data.warnings.length
                        ? `有 ${data.warnings.length} 块没读出来`
                        : '访问数据没读到'}
                    </b>
                    <ul>
                      {!data.trafficReady ? (
                        <li>对外 /stats 的聚合失败（D1 查询出错），所以趋势图是空的。</li>
                      ) : null}
                      {data.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                    <em>读不到的那几块会显示 0 —— 是「查不出来」，不是「这段时间没数据」。</em>
                  </section>
                ) : null}

                <div className="q-admin-kpis q-admin-kpis--4">
                  <Kpi n={data.totals.pv} label="浏览量 PV" sub={deltaOf(data.totals.pv, data.prev.pv)} />
                  <Kpi n={data.totals.uv} label="访客 UV" sub={deltaOf(data.totals.uv, data.prev.uv)} />
                  <Kpi n={data.totals.comments} label="新留言" sub={{ text: `其中 AI 回了 ${fmtNum(data.totals.replies)} 条`, tone: 'flat' }} />
                  <Kpi
                    n={data.totals.blocked}
                    label="被审核拦下"
                    tone="danger"
                    sub={{ text: data.totals.aiCalls ? `判定共 ${fmtNum(data.totals.aiCalls)} 次` : '还没有判定记录', tone: 'flat' }}
                  />
                </div>

                {/* ——— 访问趋势 ——— */}
                <section className="q-admin-panel q-admin-stat">
                  <header className="q-admin-stat__head">
                    <div>
                      <h2>访问趋势</h2>
                      <p>按天聚合，天界是北京时间 0 点。</p>
                    </div>
                    <div className="q-chart__legend">
                      <span className="is-pv">浏览量</span>
                      <span className="is-uv">访客数</span>
                    </div>
                  </header>

                  <TrendChart data={data.traffic} />

                  <p className="q-admin-stat__foot">
                    峰值 {peakTraffic ? `${fmtNum(peakTraffic.pv)} PV · ${peakTraffic.day}` : '—'}
                    {' · '}
                    日均 {data.days > 0 ? fmtNum(data.totals.pv / data.days) : 0} PV
                    {' · '}
                    鼠标停在图上能看当天的两个数。
                  </p>
                </section>

                {/* ——— 榜单两列 ——— */}
                <div className="q-admin-stat-grid">
                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <h2>页面</h2>
                      <p>这段时间被打开最多的 {Math.min(8, data.pages.length || 8)} 个</p>
                    </header>
                    <RankList items={data.pages} total={data.totals.pv} />
                  </section>

                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <h2>来源</h2>
                      <p>访客从哪儿点进来的</p>
                    </header>
                    <RankList
                      items={data.referrers}
                      total={data.totals.pv}
                      max={6}
                      labelOf={(n) => REF_LABEL[n] ?? n}
                    />
                  </section>
                </div>

                {/* ——— 内容：评论与拦截 ——— */}
                <section className="q-admin-panel q-admin-stat">
                  <header className="q-admin-stat__head">
                    <div>
                      <h2>留言与拦截</h2>
                      <p>灰柱是当天新留言，红柱是其中被审核直接拦下的。</p>
                    </div>
                    <div className="q-chart__legend">
                      <span className="is-ink">新留言</span>
                      <span className="is-danger">拦下</span>
                    </div>
                  </header>

                  <BarChart
                    data={data.comments.map((c) => ({ label: fmtDay(c.day), a: c.total, b: c.spam, tip: `${c.day}　新留言 ${c.total}　拦下 ${c.spam}` }))}
                    aName="新留言"
                    bName="拦下"
                    bTone="danger"
                  />

                  {data.verdicts.length ? (
                    <div className="q-verdicts">
                      {data.verdicts.map((v) => (
                        <span key={v.verdict}>
                          {VERDICT[v.verdict] ?? v.verdict}
                          <b>{fmtNum(v.n)}</b>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <p className="q-admin-stat__foot">
                    拦下的留言不会消失，在「评论收件箱 → 垃圾」里能复核；误判点一下就放行。
                  </p>
                </section>

                {/* ——— 时段 + 设备/国家 ——— */}
                <div className="q-admin-stat-grid">
                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <h2>时段分布</h2>
                      <p>0–23 点，北京时间</p>
                    </header>
                    <BarChart
                      data={data.hours.map((h) => ({ label: String(h.h), a: h.pv, b: 0, tip: `${h.h}:00　${h.pv} PV` }))}
                      aName="浏览"
                      bName=""
                      aTone="grey"
                    />
                  </section>

                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <h2>设备</h2>
                      <p>按 UA 粗分，爬虫不计</p>
                    </header>
                    <RankList items={data.devices} total={data.totals.pv} labelOf={(n) => DEVICE[n] ?? n} />
                  </section>
                </div>

                <div className="q-admin-stat-grid">
                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <h2>地区</h2>
                      <p>来自 nginx 的 GeoIP</p>
                    </header>
                    <RankList items={data.countries} total={data.totals.pv} labelOf={(n) => COUNTRY[n] ?? n} />
                  </section>

                  <section className="q-admin-panel q-admin-stat">
                    <header className="q-admin-stat__head">
                      <div>
                        <h2>AI 用量</h2>
                        <p>writer 起草回复，judge 判留言</p>
                      </div>
                      <span className="q-chart__legend is-token">
                        {fmtNum(data.totals.tokens)} token
                      </span>
                    </header>
                    <BarChart
                      data={data.traffic.map((t) => {
                        const w = data.ai.find((a) => a.day === t.day && a.channel === 'writer');
                        const j = data.ai.find((a) => a.day === t.day && a.channel === 'judge');
                        return {
                          label: fmtDay(t.day),
                          a: w?.n ?? 0,
                          b: j?.n ?? 0,
                          tip: `${t.day}　writer ${w?.n ?? 0} 次 / judge ${j?.n ?? 0} 次`,
                        };
                      })}
                      aName="writer"
                      bName="judge"
                      bTone="grey"
                    />
                  </section>
                </div>

                {/* ——— 自动回复 ——— */}
                <section className="q-admin-panel q-admin-stat">
                  <header className="q-admin-stat__head">
                    <div>
                      <h2>小爱回过多少</h2>
                      <p>黑柱是回出去的，灰柱是被闸门挡下的。</p>
                    </div>
                    <div className="q-chart__legend">
                      <span className="is-ink">已回复</span>
                      <span className="is-grey">挡下</span>
                    </div>
                  </header>
                  <BarChart
                    data={data.replies.map((r) => ({
                      label: fmtDay(r.day),
                      a: r.replied,
                      b: r.skipped + r.blocked + r.failed,
                      tip: `${r.day}　回复 ${r.replied}　挡下 ${r.skipped}　判否 ${r.blocked}　失败 ${r.failed}`,
                    }))}
                    aName="已回复"
                    bName="挡下"
                    bTone="grey"
                  />
                  <p className="q-admin-stat__foot">
                    挡下的原因（超总量 / 同访客 / 安静时段 / 关键词 / 判定不该回）在「运行状态」的最近流水里能逐条看。
                  </p>
                </section>
              </>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
