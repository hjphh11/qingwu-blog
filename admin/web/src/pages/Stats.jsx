// 访问统计（珍珠玻璃版）。
//
// 数据链路（2026-10-15 起）：访客 → 站内 /api/hit（薄转发）→ **Cloudflare Worker** → **D1**。
// 所以页面上的数字是**读取那一刻**的实时值；页头写清「数据到哪一天、什么时候读取的」。
// 旧链路（Upstash → GitHub Action 每 6 小时汇总 → 私有仓库 stats.json）已可下线，
// 后台侧的三条取数路优先级见 admin/.env.example（mock > ADMIN_STATS_ENDPOINT > GitHub 文件）。
//
// 字段与后端 `admin/server/stats.js` 的 getStats() 一一对应，没有一处是猜的：
//   enabled / empty / reason / repo / path / generatedAt / latestDay /
//   totals{pv,uv} / today{d,pv,uv} / last7{pv,uv} / last30{pv,uv} /
//   days[{d,pv,uv}]（近 90 天）/ pages[{p,pv}]（前 20）/ referrers[{r,pv}]（前 20）/
//   countries[{c,pv}]（前 20）/ devices[{v,pv}]（前 8）/ counts{days,pages,referrers,countries}
//
// 呈现层全部走珍珠组件：页头 PageHeader、区块 Panel、四张读数卡 Metric、
// 图表用 scaffold 的自绘 SVG（TrendChart / TickRing / BarChart），**不引图表库**（recharts 已从本页去掉）。
// 类名一律走 cls()，页内不再出现任何旧暖色类名。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { api } from '../api.js';
import {
  ChartNoAxesColumn,
  CircleAlert,
  Eye,
  Globe,
  Laptop,
  Link2,
  RefreshCw,
  Sparkles,
  Timer,
  User,
} from '../icons.js';
import { cls } from '../pearl/cls.js';
import { useEntrance } from '../pearl/useEntrance.js';
import BarChart from '../pearl/charts/BarChart.jsx';
import TickRing from '../pearl/charts/TickRing.jsx';
import TrendChart from '../pearl/charts/TrendChart.jsx';
import Button from '../pearl/ui/Button.jsx';
import EmptyState from '../pearl/ui/EmptyState.jsx';
import Metric from '../pearl/ui/Metric.jsx';
import PageHeader from '../pearl/ui/PageHeader.jsx';
import Panel from '../pearl/ui/Panel.jsx';
import SectionLabel from '../pearl/ui/SectionLabel.jsx';
import Tag from '../pearl/ui/Tag.jsx';

const DEVICE_LABEL = { mobile: '手机', tablet: '平板', desktop: '电脑', other: '其它' };
/** 来源里的英文占位换成中文（看着才像中文后台）*/
const REF_LABEL = { '(direct)': '直接打开', '(other)': '其它' };
const refName = (r) => REF_LABEL[r] ?? r;
const REGION_NAME = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门', US: '美国', JP: '日本', KR: '韩国',
  SG: '新加坡', GB: '英国', DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚', RU: '俄罗斯',
  IN: '印度', NL: '荷兰', XX: '未知',
};

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};
const n = (v) => Number(v ?? 0).toLocaleString('zh-CN');

/** 页面路径 → 柱状图那根柱的短标签（`/posts/astro-content` → `astro-content`） */
const shortPath = (p) => {
  const s = String(p ?? '');
  const seg = s.split('/').filter(Boolean);
  return seg.length ? seg[seg.length - 1] : s || '—';
};

/**
 * 读数卡下方的小标签：原来四张卡片各自带一个图标（总访问量 Eye / 今日 User /
 * 近 7 天 ChartNoAxesColumn / 近 30 天 Sparkles），换成 Metric 之后画在读数下面。
 */
function MetricNote({ icon: Icon, children }) {
  return (
    <span className={cls('faint')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
      <MorphIcon icon={Icon} size={12} color="currentColor" />
      {children}
    </span>
  );
}

/**
 * 榜单条（来源 / 地区共用）。
 * 条宽按**本块最大值**归一，右边给读数 —— 画法沿用概览页的占比条，
 * 行高与字号由本页样式 `.rank-*` 收进 12/13 档（scaffold 的 share-list 行是 12.5px，不在阶梯上）。
 * `--cat-ink/--cat-bg` 由 `.cat-N` 给，只用来区分类别，不表示状态。
 */
function RankRows({ items }) {
  const max = Math.max(1, ...items.map((it) => Number(it.value ?? 0)));
  return (
    <ul className="rank-list">
      {items.map((it, i) => (
        <li key={it.key ?? it.label} className={`rank-row cat-${(i % 5) + 1}`}>
          <span className="rank-label ellipsis" title={it.title ?? it.label}>
            {it.label}
          </span>
          <span className="rank-track">
            {/* 宽度开方缩放，不是线性：榜单是长尾的（中国 1421 / 台湾 6），
                  线性归一会让第 2–8 名全被压到 3% 下限、条一样长，等于没信息。
                  开方后 86→25%、44→18%、21→12%、9→8%，可读；精确次数仍在右侧。 */}
              <i style={{ width: `${Math.max(4, Math.round(Math.sqrt(Number(it.value ?? 0) / max) * 100))}%` }} />
          </span>
          <span className="rank-value tnum">{n(it.value)} 次</span>
        </li>
      ))}
    </ul>
  );
}

export default function Stats() {
  const ready = useEntrance();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError('');
    try {
      setData(await api.get(`/api/stats${refresh ? '?refresh=1' : ''}`));
    } catch (err) {
      setError(err.message || '读取失败');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 读取失败：给一条提示 + 一块可重试的面板（原来也是这两块）
  if (error) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')}>
        <PageHeader title="访问统计" desc="访问量 · 阅读数 · 来源 · 地区 · 设备" />
        <Panel
          title="读取失败"
          status="danger"
          meta="点右侧重试；仍失败就看服务端日志里的 stats_read / stats_auth"
          tools={<Button icon={RefreshCw} disabled={busy} onClick={() => load(true)}>重试</Button>}
        >
          <EmptyState
            title={error}
            desc="统计接口是 Cloudflare Worker（api.qingwu.ink），读取要 ADMIN_STATS_ENDPOINT"
            icon={CircleAlert}
          />
        </Panel>
      </div>
    );
  }

  // 首次读取中
  if (!data) {
    return (
      <div className={cls('page', ready && 'is-entrance-ready')}>
        <PageHeader title="访问统计" desc="访问量 · 阅读数 · 来源 · 地区 · 设备" />
        <Panel>
          <EmptyState title="正在读取统计…" desc="读私有仓库里的 stats.json" icon={RefreshCw} />
        </Panel>
      </div>
    );
  }

  const trendDays = data.days ?? [];
  const trendLabels = trendDays.map((d) => String(d.d ?? '').slice(5));
  const trendPv = trendDays.map((d) => Number(d.pv ?? 0));
  const trendUv = trendDays.map((d) => Number(d.uv ?? 0));

  const referrers = (data.referrers ?? []).slice(0, 8);
  const countries = (data.countries ?? []).slice(0, 8);
  const devices = (data.devices ?? []).map((d) => ({ key: d.v, label: DEVICE_LABEL[d.v] ?? d.v, value: d.pv }));

  // 设备占比：后端已按 pv 降序，占比最高的那台进刻度环，其余在右边列出来
  const deviceTotal = devices.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const deviceTop = devices[0];
  const deviceTopPct = deviceTotal ? Math.round((Number(deviceTop?.value ?? 0) / deviceTotal) * 1000) / 10 : 0;

  const topPages = (data.pages ?? []).slice(0, 20);

  const trendMeta = `数据到 ${data.latestDay || '—'} · 实时读取${
    data.generatedAt ? `（${fmt(data.generatedAt)}）` : ''
  }`;

  return (
    <div className={cls('page', 'dashboard', ready && 'is-entrance-ready')}>
      <PageHeader
        title="访问统计"
        desc="访客进页面时自动记一笔，直接写进数据库；每次打开都是最新数字。"
        actions={
          <>
            <span className={cls('faint')} style={{ fontSize: 12 }}>{trendMeta}</span>
            <Button icon={RefreshCw} disabled={busy} onClick={() => load(true)}>
              {busy ? '刷新中…' : '刷新'}
            </Button>
          </>
        }
      />

      {/* 空态：① 统计接口没配好（enabled=false）② 接口通了但库里还没有数据（empty=true）
          两种都取后端 getStats() 的 reason，原文照显 */}
      {(data.enabled === false || data.empty) && (
        <Panel
          title="还没有可画的统计"
          status="info"
          className={cls('reveal')}
          style={{ marginBottom: 18 }}
          tools={<Button icon={RefreshCw} disabled={busy} onClick={() => load(true)}>重试</Button>}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 16px',
              marginBottom: 14,
              borderRadius: 'var(--r-lg)',
              background: 'var(--blue-soft)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          >
            <MorphIcon icon={CircleAlert} size={16} color="currentColor" />
            <span>{data.reason || '还没有数据'}</span>
          </div>
          <EmptyState
            desc={
              data.enabled === false
                ? '在服务器上配好 ADMIN_APPLY_TOKEN 后，这里会读到私有仓库里的 stats.json。'
                : '等第一个访客进来，这里就会有趋势、来源、地区与设备。'
            }
            icon={ChartNoAxesColumn}
          />
          <div className={cls('faint', 'mono')} style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            读取路径：{data.repo || '—'}/{data.path || '—'}
          </div>
        </Panel>
      )}

      <div className={cls('stack')}>
        {/* 四张概览读数卡（原来是 section.stats 里的 4 个 .card.stat） */}
        <Panel head={<SectionLabel title="访问概览" as="h2" />}>
          <div className="readout-strip">
            <Metric value={data.totals?.pv} label="总访问量" size="m">
              <MetricNote icon={Eye}>独立访客 {n(data.totals?.uv)}</MetricNote>
            </Metric>
            <Metric
              value={data.today?.pv}
              label={`今日${data.latestDay ? ` · ${data.latestDay}` : ''}`}
              size="m"
            >
              <MetricNote icon={User}>访客 {n(data.today?.uv)}</MetricNote>
            </Metric>
            <Metric value={data.last7?.pv} label="近 7 天" size="m">
              <MetricNote icon={ChartNoAxesColumn}>访客 {n(data.last7?.uv)}</MetricNote>
            </Metric>
            <Metric value={data.last30?.pv} label="近 30 天" size="m">
              <MetricNote icon={Sparkles}>访客 {n(data.last30?.uv)}</MetricNote>
            </Metric>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
            <Tag tone="info">今日访客 {n(data.today?.uv)}</Tag>
            <Tag>近 7 天访客 {n(data.last7?.uv)}</Tag>
            <Tag>近 30 天访客 {n(data.last30?.uv)}</Tag>
            <Tag tone="neutral">共 {n(data.counts?.days)} 天记录</Tag>
          </div>
        </Panel>

        {/* 访问趋势：自绘 SVG 折线（PV 主曲线 + UV 虚线副曲线），替代原 recharts LineChart */}
        <Panel
          className={cls('bento-hero', 'm-glow')}
          title="访问趋势"
          meta={`最近 ${trendDays.length} 天`}
          status={trendDays.length ? 'ok' : undefined}
          tools={
            <Button variant="ghost" size="sm" icon={RefreshCw} disabled={busy} onClick={() => load(true)}>
              {busy ? '刷新中…' : '刷新'}
            </Button>
          }
        >
          <span className="glow-layer" aria-hidden="true" />
          {trendDays.length === 0 ? (
            <EmptyState title="还没有数据" desc="等第一个访客就有了" icon={ChartNoAxesColumn} />
          ) : (
            <TrendChart
            secondaryTone="ink"
              values={trendPv}
              secondary={trendUv}
              labels={trendLabels}
              height={240}
              unit=" 次"
              primaryLabel="访问量"
              secondaryLabel="访客数"
              tone="blue"
            />
          )}
        </Panel>

        {/* 来源 / 地区 / 设备：三块并排（原来在 section.grid-2 里的三张卡片） */}
        <div className="stats-row">
          <Panel
            title="来源"
            meta={`前 ${referrers.length} 个 · 共 ${n(data.counts?.referrers)} 个`}
            tools={<MorphIcon icon={Link2} size={16} color="currentColor" />}
          >
            {referrers.length === 0 ? (
              <EmptyState title="还没有来源数据" desc="有站外链接点进来之后就有了" icon={Link2} />
            ) : (
              <RankRows items={referrers.map((r) => ({ key: r.r, label: refName(r.r), title: r.r, value: r.pv }))} />
            )}
          </Panel>

          <Panel
            title="地区"
            meta={`不存明文 IP · 共 ${n(data.counts?.countries)} 个`}
            tools={<MorphIcon icon={Globe} size={16} color="currentColor" />}
          >
            {countries.length === 0 ? (
              <EmptyState title="还没有地区数据" desc="访客带地区头之后就有了" icon={Globe} />
            ) : (
              <RankRows
                items={countries.map((c) => ({
                  key: c.c,
                  label: REGION_NAME[c.c] ?? c.c,
                  title: c.c,
                  value: c.pv,
                }))}
              />
            )}
          </Panel>

          <Panel
            title="设备"
            meta={`共 ${n(deviceTotal)} 次访问`}
            tools={<MorphIcon icon={Laptop} size={16} color="currentColor" />}
          >
            {devices.length === 0 ? (
              <EmptyState title="还没有设备数据" desc="记到 UA 之后就有了" icon={Laptop} />
            ) : (
              <div className="ring-wrap">
                <TickRing value={deviceTopPct} label={deviceTop?.label ?? '—'} size={140} decimals={1} />
                <dl className="ring-readouts">
                  {devices.map((d) => (
                    <div key={d.key}>
                      <dt>{d.label}</dt>
                      <dd className="tnum">
                        {n(d.value)}
                        <span className={cls('faint')} style={{ fontSize: 12, marginLeft: 4 }}>
                          {deviceTotal ? `${Math.round((Number(d.value ?? 0) / deviceTotal) * 100)}%` : '—'}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Panel>
        </div>

        {/* 每篇阅读数：自绘柱状图（原来是自己画的 post-list 进度条） */}
        <Panel
          title="每篇阅读数"
          meta={`${n(data.counts?.pages)} 个页面`}
          tools={<MorphIcon icon={Eye} size={16} color="currentColor" />}
        >
          {topPages.length === 0 ? (
            <EmptyState title="还没有页面数据" desc="有人读过文章之后就有了" icon={Eye} />
          ) : (
            <BarChart
              values={topPages.map((p) => Number(p.pv ?? 0))}
              labels={topPages.map((p) => shortPath(p.p))}
              height={176}
              unit=" 次"
            />
          )}
        </Panel>

        {/* 页面明细：给「每篇阅读数」配一份能看清完整路径与精确数字的清单 */}
        <Panel title="页面明细" meta="按阅读数降序 · 最多 20 条" status="ok">
          {topPages.length === 0 ? (
            <EmptyState title="还没有页面数据" icon={Eye} />
          ) : (
            <div className="activity-list">
              {topPages.map((p) => (
                <div className="activity" key={p.p}>
                  <span className={cls('quick-ico', 'm-groove')}>
                    <MorphIcon icon={Eye} size={15} color="currentColor" />
                  </span>
                  <div className="activity-main">
                    <div className={cls('ellipsis')} title={p.p}>
                      <span className={cls('mono')} style={{ fontSize: 13 }}>
                        {p.p}
                      </span>
                    </div>
                  </div>
                  <span className={cls('mono')} style={{ fontSize: 13 }}>
                    {n(p.pv)} 次
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* 数据来源说明（原文照旧，天数与汇总时间都保留） */}
        <Panel title="统计口径" meta={`${n(data.counts?.days)} 天记录`}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--ink-muted)' }}>
            <MorphIcon icon={Timer} size={14} color="currentColor" />
            <span>
              访客进页面时自动记一笔，只统计路径 / 来源 / 地区 / 设备，
              <strong>不存明文 IP</strong>，同一访客同一页 30 分钟内只算一次。共有{' '}
              {n(data.counts?.days)} 天的记录，读取于 {fmt(data.generatedAt)}。
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
