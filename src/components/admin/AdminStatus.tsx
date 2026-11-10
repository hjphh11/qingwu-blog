/*
 * 后台 · 运行与设置
 *
 * 一个只读的状态总览：两条 AI 通道、小爱的自动回复、内容与友链的待办、
 * 发信队列与基础设施开关。数据全部来自 `GET /api/admin/status`，
 * 唯一的写操作是「探活」—— 真打一次两条通道，验证 key 不只是存在、而是能用。
 *
 * 为什么单独一页：这些数字此前散在六张表里，要 ssh 上去 sqlite3 一条条敲。
 * 排查 2026-11-10 那次 judge 401 时，配置界面全绿但它在 401 —— 只有真打一次才看得见。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

// ——————————————————————————————————————————————————————————
// 接口形状
// ——————————————————————————————————————————————————————————
type Provider = 'writer' | 'jev' | 'openai';

interface ChannelState {
  on: boolean;
  provider: Provider;
  model: string;
  used: number | null;
  quota: number;
  missing?: string;
}

interface PingResult {
  ok: boolean;
  ms: number;
  model?: string;
  detail: string;
  verdict?: string;
  score?: number;
  tokens?: number;
}

interface Status {
  ok: boolean;
  now: number;
  day: string;
  warnings: string[];
  ai: { writer: ChannelState; judge: ChannelState };
  autoReply: {
    on: boolean;
    daily: number;
    perGuest: number;
    today: { replied: number; skipped: number; blocked: number; failed: number };
    days: { day: string; replied: number; skipped: number; blocked: number; failed: number }[];
    log: {
      id: number;
      commentId: number;
      action: string;
      verdict: string | null;
      note: string | null;
      model: string | null;
      tokens: number | null;
      ms: number | null;
      ts: number;
      author: string;
      body: string;
    }[];
  };
  usage: { day: string; channel: string; n: number; tokensIn: number; tokensOut: number }[];
  comments: { total: number; byStatus: Record<string, number>; today: number; noReply: number };
  friends: {
    applications: { pending: number; approved: number; rejected: number; total: number };
    backlink: { total: number; broken: number; errored: number };
    states: { normal: number; unstable: number; violation: number };
  };
  mail: { channel: 'relay' | 'resend' | 'none'; queued: number; stuck: number; oldest: number | null };
  traffic: { pv: number; uv: number; lastHit: number | null };
  runtime: {
    readonly: boolean;
    github: boolean;
    turnstile: boolean;
    salt: boolean;
    devSkipTurnstile: boolean;
    sessions: number;
    siteUrl: string;
    persona: string;
  };
}

// ——————————————————————————————————————————————————————————
// 小工具
// ——————————————————————————————————————————————————————————
const pad = (n: number) => String(n).padStart(2, '0');

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时间：只看「刚 / 多久前」，超过一天就给日期。 */
function fmtAgo(ts: number | null): string {
  if (!ts) return '还没有';
  const d = Date.now() - ts;
  if (d < 0) return '刚刚';
  const m = Math.floor(d / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return fmtTime(ts);
}

/** 「YYYY-MM-DD」→「M/D」，柱状图标签用 */
function fmtDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (r.status === 401) {
    window.location.replace('/admin/');
    throw new Error('unauthorized');
  }
  const d = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
  return d;
}

// ——————————————————————————————————————————————————————————
// 小元件
// ——————————————————————————————————————————————————————————
function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  return <span className={`q-admin-tag q-admin-tag--${tone}`}>{children}</span>;
}

/** 用量条：配额用满变红，80% 变琥珀 */
function Meter({ used, quota }: { used: number | null; quota: number }) {
  if (used === null) return <span className="q-admin-stat__na">用量不可读（迁移没跑？）</span>;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const tone = pct >= 100 ? 'is-full' : pct >= 80 ? 'is-high' : '';
  return (
    <div className="q-admin-meter">
      <div className={`q-admin-meter__bar ${tone}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="q-admin-meter__num">
        {used} / {quota}
      </span>
    </div>
  );
}

/** 一格指标：大数字 + 标签，可选副标题 */
function Kpi({
  n,
  label,
  hint,
  tone,
}: {
  n: number | string;
  label: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  return (
    <div className={`q-admin-kpi ${tone ? `q-admin-kpi--${tone}` : ''}`}>
      <b>{n}</b>
      <span>{label}</span>
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

const ACTION_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  replied: { text: '已回复', tone: 'ok' },
  skipped: { text: '被闸门挡下', tone: 'warn' },
  blocked: { text: '判为不该回', tone: 'danger' },
  failed: { text: '失败', tone: 'danger' },
};

const VERDICT_LABEL: Record<string, string> = {
  ok: '看着正常',
  spam: '疑似广告',
  abuse: '疑似辱骂',
  privacy: '疑似泄露隐私',
};

// ——————————————————————————————————————————————————————————
// 主组件
// ——————————————————————————————————————————————————————————
export default function AdminStatus() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [at, setAt] = useState(0);

  const [pinging, setPinging] = useState(false);
  const [ping, setPing] = useState<{ writer: PingResult; judge: PingResult } | null>(null);
  const [pingErr, setPingErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<Status>('/status');
      setData(d);
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
        await api<{ username: string }>('/session');
        setReady(true);
      } catch {
        /* api() 已经跳转了 */
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const doPing = useCallback(async () => {
    setPinging(true);
    setPingErr('');
    try {
      const d = await api<{ writer: PingResult; judge: PingResult }>('/status/ping', { method: 'POST' });
      setPing({ writer: d.writer, judge: d.judge });
      // 探活也记了用量，顺手把卡片数字刷新一下
      void load();
    } catch (e) {
      setPingErr(e instanceof Error ? e.message : '探活失败');
    } finally {
      setPinging(false);
    }
  }, [load]);

  if (!ready) {
    return (
      <>
        <AdminTop active="status" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  const s = data;

  return (
    <>
      <AdminTop active="status" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>运行与设置</h1>
            <p>
              {s ? `今天 ${s.day}` : '只读状态总览'}
              {at ? ` · 数据更新于 ${fmtClock(at)}` : ''}
            </p>
          </div>
          <div className="q-admin-stat-actions">
            <button
              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
              type="button"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button
              className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
              type="button"
              onClick={() => void doPing()}
              disabled={pinging}
            >
              {pinging ? '正在打两条通道…' : 'AI 探活'}
            </button>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}

        {!s && loading ? <div className="q-admin-loading">读取运行状态…</div> : null}

        {s ? (
          <>
            {s.warnings.length ? (
              <section className="q-admin-warnbox">
                <b>有 {s.warnings.length} 项读不到</b>
                <ul>
                  {s.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <em>通常是迁移没跑。部署脚本不会自动 apply，要手动补一次。</em>
              </section>
            ) : null}

            {/* ——— ① AI 双通道 ——— */}
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <div>
                  <h2>AI 双通道</h2>
                  <p>writer 负责说话，judge 负责判断。两条各自计配额。</p>
                </div>
                {s.ai.writer.on && s.ai.judge.on ? (
                  <Pill tone="ok">两条都在线</Pill>
                ) : (
                  <Pill tone="danger">有通道没开</Pill>
                )}
              </header>

              <div className="q-admin-channels">
                <div className={`q-admin-channel ${s.ai.writer.on ? '' : 'is-off'}`}>
                  <div className="q-admin-channel__title">
                    <b>writer · 起草与回复</b>
                    {s.ai.writer.on ? <Pill tone="ok">已启用</Pill> : <Pill tone="danger">未配置</Pill>}
                  </div>
                  {s.ai.writer.on ? (
                    <>
                      <p className="q-admin-channel__model">{s.ai.writer.model}</p>
                      <Meter used={s.ai.writer.used} quota={s.ai.writer.quota} />
                    </>
                  ) : (
                    <p className="q-admin-channel__hint">缺 {s.ai.writer.missing}，写好后再重启 Worker。</p>
                  )}
                  {ping ? <PingLine r={ping.writer} /> : null}
                </div>

                <div className={`q-admin-channel ${s.ai.judge.on ? '' : 'is-off'}`}>
                  <div className="q-admin-channel__title">
                    <b>judge · 判断</b>
                    {s.ai.judge.on ? <Pill tone="ok">已启用</Pill> : <Pill tone="danger">未配置</Pill>}
                  </div>
                  {s.ai.judge.on ? (
                    <>
                      <p className="q-admin-channel__model">
                        {s.ai.judge.model}
                        <em>{s.ai.judge.provider === 'jev' ? 'Jev 决策协议' : 'OpenAI 兼容 JSON'}</em>
                      </p>
                      <Meter used={s.ai.judge.used} quota={s.ai.judge.quota} />
                      {s.ai.judge.provider !== 'jev' && s.ai.judge.model ? (
                        <p className="q-admin-channel__hint">
                          当前是回落路径（DeepSeek JSON 模式）。想换成 Jev，把 AI_JUDGE_PROVIDER 设成 jev 并配 AI_JUDGE_KEY。
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="q-admin-channel__hint">缺 {s.ai.judge.missing}，写好后再重启 Worker。</p>
                  )}
                  {ping ? <PingLine r={ping.judge} /> : null}
                </div>
              </div>

              {pingErr ? <p className="q-admin-error">{pingErr}</p> : null}
              <p className="q-admin-stat__foot">
                探活会真发一次请求：writer 约 30 token，judge 输出不计费。两条都受每日配额约束。
              </p>
            </section>

            {/* ——— ② 小爱自动回复 ——— */}
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <div>
                  <h2>小爱自动回复</h2>
                  <p>访客一留言她就回一句。无人值守，所以有四道闸。</p>
                </div>
                {s.autoReply.on ? <Pill tone="ok">开着</Pill> : <Pill tone="warn">已关闭</Pill>}
              </header>

              <dl className="q-admin-gates">
                <div>
                  <dt>总开关</dt>
                  <dd>{s.autoReply.on ? 'AUTO_REPLY = on' : 'AUTO_REPLY = off，只剩后台手动起草'}</dd>
                </div>
                <div>
                  <dt>今日总量</dt>
                  <dd>
                    {s.autoReply.today.replied} / {s.autoReply.daily}
                  </dd>
                </div>
                <div>
                  <dt>单访客每日</dt>
                  <dd>{s.autoReply.perGuest === 0 ? '不限' : `${s.autoReply.perGuest} 条`}</dd>
                </div>
                <div>
                  <dt>judge 前置</dt>
                  <dd>{s.ai.judge.on ? '先判垃圾，判成 spam/abuse/privacy 不回' : 'judge 没开，跳过这道闸'}</dd>
                </div>
              </dl>

              <div className="q-admin-kpis q-admin-kpis--4">
                <Kpi n={s.autoReply.today.replied} label="今天已回" tone="ok" />
                <Kpi n={s.autoReply.today.skipped} label="被闸门挡下" hint="超总量 / 同访客 / 已有回复" />
                <Kpi n={s.autoReply.today.blocked} label="判为不该回" hint="垃圾、辱骂、隐私" />
                <Kpi n={s.autoReply.today.failed} label="失败" hint="上游报错，留言仍在" tone={s.autoReply.today.failed > 0 ? 'danger' : undefined} />
              </div>

              {s.autoReply.days.length === 0 ? (
                <p className="q-admin-stat__na q-admin-stat__na--block">最近 7 天没有自动回复记录。</p>
              ) : (
                <div className="q-admin-days">
                  {s.autoReply.days.map((d) => {
                    const total = d.replied + d.skipped + d.blocked + d.failed;
                    const h = (n: number) => (total > 0 ? Math.max(2, Math.round((n / total) * 100)) : 0);
                    return (
                      <div className="q-admin-day" key={d.day} title={`${d.day}：回 ${d.replied} · 挡 ${d.skipped} · 判否 ${d.blocked} · 失败 ${d.failed}`}>
                        <div className="q-admin-day__bar">
                          {d.replied > 0 ? <i className="is-ok" style={{ height: `${h(d.replied)}%` }} /> : null}
                          {d.skipped > 0 ? <i className="is-warn" style={{ height: `${h(d.skipped)}%` }} /> : null}
                          {d.blocked + d.failed > 0 ? <i className="is-bad" style={{ height: `${h(d.blocked + d.failed)}%` }} /> : null}
                        </div>
                        <b>{d.replied}</b>
                        <span>{fmtDay(d.day)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="q-admin-stat__foot">
                柱子是该天「已回复」的条数；灰色部分是被挡下 / 判否 / 失败。鼠标停住看明细。
              </p>
            </section>

            {/* ——— ③ 内容与友链 ——— */}
            <div className="q-admin-stat-grid">
              <section className="q-admin-panel q-admin-stat">
                <header className="q-admin-stat__head">
                  <div>
                    <h2>评论</h2>
                    <p>留言板与文章评论共用一张表。</p>
                  </div>
                  {s.comments.byStatus.pending ? <Pill tone="warn">{s.comments.byStatus.pending} 条待审</Pill> : <Pill tone="ok">没有待审</Pill>}
                </header>
                <div className="q-admin-kpis q-admin-kpis--4">
                  <Kpi n={s.comments.total} label="全部" />
                  <Kpi n={s.comments.byStatus.visible ?? 0} label="已通过" tone="ok" />
                  <Kpi n={s.comments.today} label="今日新增" />
                  <Kpi n={s.comments.noReply} label="还没人回" hint="含访客提问" />
                </div>
                <dl className="q-admin-gates">
                  <div>
                    <dt>待审核</dt>
                    <dd>{s.comments.byStatus.pending ?? 0}</dd>
                  </div>
                  <div>
                    <dt>垃圾</dt>
                    <dd>{s.comments.byStatus.spam ?? 0}</dd>
                  </div>
                  <div>
                    <dt>已删除</dt>
                    <dd>{s.comments.byStatus.deleted ?? 0}</dd>
                  </div>
                </dl>
              </section>

              <section className="q-admin-panel q-admin-stat">
                <header className="q-admin-stat__head">
                  <div>
                    <h2>友链</h2>
                    <p>内容归仓库，状态归数据库。</p>
                  </div>
                  {s.runtime.github ? (
                    <Pill tone="ok">GitHub 已授权</Pill>
                  ) : (
                    <Pill tone="warn">没配 GITHUB_TOKEN</Pill>
                  )}
                </header>
                <div className="q-admin-kpis q-admin-kpis--4">
                  <Kpi n={s.friends.applications.pending} label="待审申请" tone={s.friends.applications.pending > 0 ? 'warn' : undefined} />
                  <Kpi n={s.friends.applications.approved} label="已通过" tone="ok" />
                  <Kpi n={s.friends.backlink.broken} label="找不到回链" tone={s.friends.backlink.broken > 0 ? 'danger' : undefined} />
                  <Kpi n={s.friends.states.unstable + s.friends.states.violation} label="失联 / 整改中" hint="按倒计时隐藏" />
                </div>
                <dl className="q-admin-gates">
                  <div>
                    <dt>回链已检查</dt>
                    <dd>{s.friends.backlink.total} 站</dd>
                  </div>
                  <div>
                    <dt>抓取失败</dt>
                    <dd>{s.friends.backlink.errored}</dd>
                  </div>
                  <div>
                    <dt>申请总数</dt>
                    <dd>
                      {s.friends.applications.total}（拒 {s.friends.applications.rejected}）
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {/* ——— ④ 基础设施 ——— */}
            <div className="q-admin-stat-grid">
              <section className="q-admin-panel q-admin-stat">
                <header className="q-admin-stat__head">
                  <div>
                    <h2>发信</h2>
                    <p>留言通知与友链回信走这条路。</p>
                  </div>
                  {s.mail.channel === 'none' ? (
                    <Pill tone="danger">没配发信</Pill>
                  ) : s.mail.queued === 0 ? (
                    <Pill tone="ok">队列空</Pill>
                  ) : (
                    <Pill tone="warn">{s.mail.queued} 封待补发</Pill>
                  )}
                </header>
                <dl className="q-admin-gates">
                  <div>
                    <dt>通道</dt>
                    <dd>
                      {s.mail.channel === 'relay'
                        ? '本机中继（127.0.0.1:8790）'
                        : s.mail.channel === 'resend'
                          ? 'Resend'
                          : '未配置'}
                    </dd>
                  </div>
                  <div>
                    <dt>待补发</dt>
                    <dd>{s.mail.queued} 封</dd>
                  </div>
                  <div>
                    <dt>最老积压</dt>
                    <dd>{s.mail.queued > 0 ? fmtAgo(s.mail.oldest) : '—'}</dd>
                  </div>
                  <div>
                    <dt>放弃重试</dt>
                    <dd>{s.mail.stuck} 封</dd>
                  </div>
                </dl>
              </section>

              <section className="q-admin-panel q-admin-stat">
                <header className="q-admin-stat__head">
                  <div>
                    <h2>打点链路</h2>
                    <p>访客上报 → nginx → 本地 Worker → SQLite。</p>
                  </div>
                  {s.traffic.lastHit && Date.now() - s.traffic.lastHit < 3_600_000 ? (
                    <Pill tone="ok">活着</Pill>
                  ) : (
                    <Pill tone="warn">近一小时没打点</Pill>
                  )}
                </header>
                <div className="q-admin-kpis q-admin-kpis--4">
                  <Kpi n={s.traffic.pv} label="今日 PV" />
                  <Kpi n={s.traffic.uv} label="今日 UV" />
                  <Kpi n={fmtAgo(s.traffic.lastHit)} label="最后一条打点" />
                  <Kpi n={s.runtime.sessions} label="在线后台会话" />
                </div>
                <p className="q-admin-stat__foot">
                  打点静默归零最常见的原因是 wrangler dev 改写了 Host / Origin —— 见三坑记录。
                </p>
              </section>
            </div>

            {/* ——— ⑤ 开关清单 ——— */}
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <div>
                  <h2>环境开关</h2>
                  <p>这些只读，改要上服务器改 .dev.vars / wrangler.toml。</p>
                </div>
                {s.runtime.readonly ? <Pill tone="danger">归档只读</Pill> : <Pill tone="ok">可写</Pill>}
              </header>
              <ul className="q-admin-flags">
                <Flag on={!s.runtime.readonly} label="数据库可写" yes="本地 D1 在写" no="配了 READONLY，POST 全 410" />
                <Flag on={s.runtime.github} label="GitHub 提交" yes="友链改动能直接写仓库" no="只能出成品 JSON 手动粘贴" />
                <Flag on={s.runtime.turnstile} label="人机验证" yes="提交入口开着" no="没配 secret，提交入口是关的" />
                <Flag on={s.runtime.salt} label="访客哈希盐" yes="统计能落库" no="没配盐，只探测不采集" />
                <Flag
                  on={!s.runtime.devSkipTurnstile}
                  label="跳过 Turnstile 校验"
                  yes="线上正确状态"
                  no="本地调试开关还开着，别带上线"
                />
              </ul>
              <p className="q-admin-stat__foot">
                小爱署名「{s.runtime.persona}」· 站点 {s.runtime.siteUrl}
              </p>
            </section>

            {/* ——— ⑥ 最近流水 ——— */}
            <section className="q-admin-panel q-admin-stat q-admin-stat--flush">
              <header className="q-admin-stat__head">
                <div>
                  <h2>最近自动回复</h2>
                  <p>每一笔都落 auto_reply_log：回过谁、挡了谁、为什么。</p>
                </div>
                <Pill tone="muted">最近 {s.autoReply.log.length} 条</Pill>
              </header>

              {s.autoReply.log.length === 0 ? (
                <div className="q-admin-empty">
                  <b>还没有记录</b>
                  访客留言后小爱回过话，这里就会出现。
                </div>
              ) : (
                <table className="q-admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: '13%' }}>时间</th>
                      <th style={{ width: '15%' }}>结果</th>
                      <th>留言</th>
                      <th style={{ width: '14%' }}>判定</th>
                      <th style={{ width: '11%' }}>耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.autoReply.log.map((r) => {
                      const a = ACTION_LABEL[r.action] ?? { text: r.action, tone: 'muted' as const };
                      return (
                        <tr key={r.id}>
                          <td className="q-admin-who-cell">
                            <span>{fmtTime(r.ts)}</span>
                          </td>
                          <td>
                            <Pill tone={a.tone}>{a.text}</Pill>
                          </td>
                          <td className="q-admin-body-cell">
                            <p>
                              <b>#{r.commentId}</b> {r.author || '（留言已删）'}：{r.body || '—'}
                            </p>
                            {r.note ? <em>{r.note}</em> : null}
                          </td>
                          <td>
                            {r.verdict ? <span className="q-admin-stat__mini">{VERDICT_LABEL[r.verdict] ?? r.verdict}</span> : <span className="q-admin-stat__na">—</span>}
                          </td>
                          <td className="q-admin-stat__mini">
                            {r.ms ? `${r.ms} ms` : '—'}
                            {r.tokens ? ` · ${r.tokens} tok` : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

/** 探活结果一行 */
function PingLine({ r }: { r: PingResult }) {
  if (r.ok) {
    const extra =
      r.verdict !== undefined
        ? ` · 判为 ${VERDICT_LABEL[r.verdict] ?? r.verdict}（${r.score ?? 0} 分）`
        : '';
    return (
      <p className="q-admin-ping is-ok">
        <b>通</b> {r.ms} ms · {r.model}
        {extra} · {r.detail}
      </p>
    );
  }
  return (
    <p className="q-admin-ping is-bad">
      <b>不通</b> {r.detail}
    </p>
  );
}

/** 开关一行 */
function Flag({ on, label, yes, no }: { on: boolean; label: string; yes: string; no: string }) {
  return (
    <li className={on ? 'is-on' : 'is-off'}>
      <i aria-hidden="true" />
      <b>{label}</b>
      <span>{on ? yes : no}</span>
    </li>
  );
}
