// 访问统计（阶段 M · 方案 §11 路线 B + 第 8·9·10 条）
//
// 数据链路：访客 → 站内 /api/hit → Upstash Redis → **GitHub Action 每 6 小时汇总** →
//           私有仓库的 stats.json → 这个页面读它画图（后台读取零跨境）。
// 所以页面上的数字**最多滞后 6 小时**，顶部会写清「数据到哪一天、什么时候汇总的」。
import { useCallback, useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api.js';
import { ChartNoAxesColumn, CircleAlert, Eye, RefreshCw, Sparkles, Timer, User } from '../icons.js';

// 站点暖色调（和主题一致），图表里循环用
const COLORS = ['#e0526b', '#f6a5b8', '#e8b04b', '#8b5a3c', '#c98ba0', '#7ba05b', '#6b8cae', '#b07bb0'];

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

/** 空状态 / 未配置时的说明卡（组件放在外面 —— 组件写在组件内部会导致每次渲染重建子树）*/
function Notice({ tone = 'warn', icon: Icon = CircleAlert, title, children }) {
  return (
    <div className={`alert ${tone === 'warn' ? 'alert-warn' : ''}`}>
      <MorphIcon icon={Icon} size={15} color="currentColor" />
      <span>
        {title && <strong>{title}</strong>}
        {title && ' '}
        {children}
      </span>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="card stat">
      <div className="n stat-value">{value}</div>
      <div className="l">
        <MorphIcon icon={Icon} size={13} color="currentColor" /> {label}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Stats() {
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

  if (error) {
    return (
      <>
        <Notice tone="warn">{error}</Notice>
        <section className="card panel">
          <div className="panel-head">
            <h2>访问统计</h2>
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => load(true)} disabled={busy}>
              <MorphIcon icon={RefreshCw} size={15} color="currentColor" /> 重试
            </button>
          </div>
        </section>
      </>
    );
  }

  if (!data) {
    return (
      <section className="card panel">
        <div className="empty">正在读取统计…</div>
      </section>
    );
  }

  const trend = data.days ?? [];
  const devices = (data.devices ?? []).map((d) => ({ ...d, name: DEVICE_LABEL[d.v] ?? d.v }));
  const countries = (data.countries ?? []).map((c) => ({ ...c, name: REGION_NAME[c.c] ?? c.c }));
  const topPages = data.pages ?? [];

  return (
    <>
      {!data.enabled && <Notice>{data.reason}</Notice>}
      {data.enabled && data.empty && <Notice>{data.reason}</Notice>}

      <section className="stats">
        <Stat icon={Eye} label="总访问量" value={n(data.totals?.pv)} sub={`独立访客 ${n(data.totals?.uv)}`} />
        <Stat
          icon={User}
          label="今日"
          value={n(data.today?.pv)}
          sub={data.latestDay ? `${data.latestDay} · 访客 ${n(data.today?.uv)}` : ''}
        />
        <Stat icon={ChartNoAxesColumn} label="近 7 天" value={n(data.last7?.pv)} sub={`访客 ${n(data.last7?.uv)}`} />
        <Stat icon={Sparkles} label="近 30 天" value={n(data.last30?.pv)} sub={`访客 ${n(data.last30?.uv)}`} />
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>访问趋势</h2>
          <div className="spacer" />
          <span className="hint">
            数据到 {data.latestDay || '—'} · 每 6 小时汇总一次{data.generatedAt ? `（${fmt(data.generatedAt)}）` : ''}
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => load(true)} disabled={busy}>
            <MorphIcon icon={RefreshCw} size={15} color="currentColor" />
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
        {trend.length === 0 ? (
          <div className="empty">还没有数据 —— 等第一次汇总跑完就有了</div>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(246,165,184,.35)" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid rgba(246,165,184,.5)', fontSize: 12 }}
                  labelFormatter={(d) => `日期 ${d}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="pv" name="访问量" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="uv" name="访客数" stroke={COLORS[2]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="grid-2">
        <div className="card panel">
          <div className="panel-head">
            <h2>来源</h2>
            <div className="spacer" />

          </div>
          {data.referrers?.length ? (
            <div style={{ width: '100%', height: Math.max(180, data.referrers.length * 30) }}>
              <ResponsiveContainer>
                <BarChart
                  data={data.referrers.slice(0, 8).map((x) => ({ ...x, r: refName(x.r) }))}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="r" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="pv" name="访问量" radius={[0, 8, 8, 0]}>
                    {data.referrers.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty">还没有来源数据</div>
          )}
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h2>地区</h2>
            <div className="spacer" />
            <span className="hint">不存明文 IP</span>
          </div>
          {countries.length ? (
            <div style={{ width: '100%', height: Math.max(180, countries.length * 30) }}>
              <ResponsiveContainer>
                <BarChart
                  data={countries.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="pv" name="访问量" radius={[0, 8, 8, 0]}>
                    {countries.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty">还没有地区数据</div>
          )}
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h2>设备</h2>
            <div className="spacer" />

          </div>
          {devices.length ? (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={devices}
                    dataKey="pv"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={3}
                    label={(e) => `${e.name} ${e.pv}`}
                    labelLine={false}
                  >
                    {devices.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty">还没有设备数据</div>
          )}
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h2>每篇阅读数</h2>
            <div className="spacer" />
            <span className="hint">{data.counts?.pages ?? 0} 个页面</span>
          </div>
          {topPages.length === 0 ? (
            <div className="empty">还没有页面数据</div>
          ) : (
            <div className="post-list">
              {topPages.map((p) => {
                const max = topPages[0]?.pv || 1;
                return (
                  <div key={p.p} className="post-item">
                    <div className="post-main">
                      <div className="post-title mono" style={{ fontSize: 13 }}>
                        {p.p}
                      </div>
                      <div className="bar-track" title={`${p.pv} 次`}>
                        <span className="bar-fill" style={{ width: `${Math.max(3, Math.round((p.pv / max) * 100))}%` }} />
                      </div>
                    </div>
                    <div className="post-pills">
                      <span className="tag tag-soft num">{n(p.pv)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <p className="hint" style={{ marginTop: -6 }}>
        <MorphIcon icon={Timer} size={12} color="currentColor" /> 访客进页面时自动记一笔，每 6 小时汇总一次；
        只统计路径 / 来源 / 地区 / 设备，<strong>不存明文 IP</strong>，同一访客同一页 30 分钟内只算一次。
        共有 {data.counts?.days ?? 0} 天的记录。
      </p>
    </>
  );
}
