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
            数据到 {data.latestDay || '—'}（GitHub Action 每 6 小时汇总一次，汇总于 {fmt(data.generatedAt)}）
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
            <span className="hint">访客从哪儿点进来的</span>
          </div>
          {data.referrers?.length ? (
            <div style={{ width: '100%', height: Math.max(180, data.referrers.length * 30) }}>
              <ResponsiveContainer>
                <BarChart
                  data={data.referrers.slice(0, 8)}
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
            <span className="hint">按访客 IP 的国家/地区（不存明文 IP）</span>
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
            <span className="hint">手机 / 电脑 各占多少</span>
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
            <span className="hint">共 {data.counts?.pages ?? 0} 个页面有记录</span>
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

      <section className="card panel">
        <div className="panel-head">
          <h2>这套数据是怎么来的</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              <tr>
                <th style={{ width: 132 }}>采集</th>
                <td>
                  访客浏览器进入页面时向站内 <span className="mono">/api/hit</span> 打一个点（爬虫、监控 UA 直接跳过）；
                  只记路径、来源域名、国家/地区、设备类型，<strong>不存明文 IP</strong>（IP+UA 用盐做 HMAC 后截断成匿名标识）
                </td>
              </tr>
              <tr>
                <th>去重</th>
                <td>同一访客同一页 <strong>30 分钟内只算一次</strong>（刷新不会把数字刷上去）；独立访客用 HyperLogLog 估算基数</td>
              </tr>
              <tr>
                <th>汇总</th>
                <td>
                  GitHub Action「统计汇总」每 6 小时读一次 Redis（<MorphIcon icon={Timer} size={12} color="currentColor" /> 跑在境外，无跨境问题），
                  写进私有仓库 <span className="mono">{data.repo}/{data.path}</span>
                </td>
              </tr>
              <tr>
                <th>读取</th>
                <td>
                  这个页面读的就是那份文件（缓存 {Math.round((data.cacheMs ?? 300000) / 1000)} 秒）——
                  数据留在自己手里，后台不需要直连境外服务
                </td>
              </tr>
              <tr>
                <th>记录量</th>
                <td>
                  {data.counts?.days ?? 0} 天 · {data.counts?.pages ?? 0} 个页面 · {data.counts?.referrers ?? 0} 个来源 ·{' '}
                  {data.counts?.countries ?? 0} 个地区
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
