/*
 * 后台 · 设置
 *
 * 2026-11-10 晚从「运行与设置」拆出来的一页，站长原话：「把运行与设置分开页面」。
 * 分开之后职责很清楚：运行状态看数字，这一页只改参数。
 *
 * 这些值以前全在环境变量里：改一个参数要登服务器改 .dev.vars 再重启 Worker。
 * 现在落在 admin_settings 表，保存即生效 —— Worker 每次处理请求都现读一次。
 *
 * 优先级：**库里有值就以库为准，没有才回落到 env**。所以本页的初值可能来自 env，
 * 只要一保存就会写进库，从此以库为准。
 *
 * —— 2026-11-10 深夜第三次收窄 ——
 * 站长看过截图后说「这个不用限制」「这个也不要」：删掉「每天最多」与「安静时段」。
 * 小爱回多少条不再按天卡、也不再按时段闭嘴。真正防刷的是 AI 每日配额
 * （`AI_DAILY_LIMIT`，默认 300 次/通道/天），那条在 ai.ts 的 quotaGate，与本页无关。
 *
 * —— 第四次（同一晚更晚）——
 * 站长：「可以修改模型的 api，保存生效」。
 * 于是两条通道的**地址 / 密钥 / 模型**全部搬上表单，judge 也不再只读。
 * 以前 judge 只读的理由是「换判定模型要重调提示词」—— 那个提醒现在写在卡片里，
 * 但不再挡着人改：站长要的是能改，不是被保护。
 *
 * ⚠️ 密钥的回显规则（改之前先读）：
 *   · 后端只给「有没有配 + 尾号」，明文永远不进浏览器；
 *   · 输入框留空 = 不改，填了才覆盖；
 *   · 库里存过 key 时会出现「清除」，点它立即回落环境变量。
 */
import { useCallback, useEffect, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

interface AutoReply {
  on: boolean;
  perGuest: number;
  scope: 'top' | 'all';
  allowPaths: string[];
  blockPaths: string[];
  skipKeywords: string[];
}

/** writer 的生成参数。模型名在 `ai.writer.model`，这两项只管怎么生成 */
interface WriterGen {
  temperature: number;
  maxTokens: number;
}

interface AiEndpoint {
  base: string;
  key: string;
  model: string;
}

interface JudgeEndpoint extends AiEndpoint {
  provider: '' | 'jev' | 'openai';
}

interface AiCfg {
  writer: AiEndpoint;
  judge: JudgeEndpoint;
}

interface Settings {
  autoReply: AutoReply;
  writer: WriterGen;
  ai: AiCfg;
}

interface KeyMeta {
  set: boolean;
  tail: string;
  from: 'db' | 'env' | 'none';
}

interface Meta {
  envHasWriter: boolean;
  envHasJudge: boolean;
  envModel: string;
  envBase: string;
  aiEnv: {
    writer: { base: string; model: string };
    judge: { provider: 'jev' | 'openai'; base: string; model: string };
  };
}

/** 与 status.ts 的 aiSnapshot 同形。只取要显示的那几个字段。 */
interface ChannelState {
  on: boolean;
  provider: 'writer' | 'jev' | 'openai';
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
}

function api<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(API + path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }).then(async (r) => {
    if (r.status === 401) {
      window.location.replace('/admin/');
      throw new Error('unauthorized');
    }
    const d = (await r.json().catch(() => ({}))) as T & { message?: string; reason?: string };
    if (!r.ok) throw new Error(d?.message || d?.reason || `请求失败（${r.status}）`);
    return d;
  });
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="q-admin-switch"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="q-admin-setting">
      <div className="q-admin-setting__label">
        <b>{title}</b>
        {desc ? <span>{desc}</span> : null}
      </div>
      <div className="q-admin-setting__ctrl">{children}</div>
    </div>
  );
}

/** 通道状态标签：在线 / 未配 key。用现成的 tag，不另造一套。 */
function State({ on, label }: { on: boolean; label: string }) {
  return <span className={`q-admin-tag ${on ? 'q-admin-tag--ok' : 'q-admin-tag--muted'}`}>{label}</span>;
}

/** 今日用量 / 配额。used 为 null 表示接口没读到（迁移没跑），此时不画条，只写「—」。 */
function Meter({ used, quota }: { used: number | null; quota: number }) {
  const n = used ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((n / quota) * 100)) : 0;
  const tone = pct >= 100 ? 'is-full' : pct >= 80 ? 'is-high' : '';
  return (
    <div className="q-admin-meter">
      <span className={`q-admin-meter__bar ${tone}`}>
        <i style={{ width: `${used === null ? 0 : pct}%` }} />
      </span>
      <span className="q-admin-meter__num">
        {used === null ? '—' : n} / {quota}
      </span>
    </div>
  );
}

function Ping({ r }: { r?: PingResult }) {
  if (!r) return null;
  if (r.ok) return <p className="q-admin-ping is-ok"><b>通</b>{r.ms} ms · {r.model} · {r.detail}</p>;
  return <p className="q-admin-ping is-bad"><b>不通</b>{r.detail}</p>;
}

/** 逗号分隔的列表 ↔ 数组。空串表示「不限」，不要写成「空数组 = 全禁」。 */
const toList = (s: string): string[] =>
  s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const toText = (a: string[]): string => a.join(', ');

/** 密钥输入框下面那句提示 —— 三种来源三种说法，别都写成「已配置」 */
function keyHint(k: KeyMeta | undefined): string {
  if (!k || !k.set) return '还没配 key。填一个就能用，也可以继续用服务器上的环境变量。';
  if (k.from === 'db') return `当前用的是本页保存的 key（尾号 ${k.tail || '••'}）。留空不改；点「清除」回落环境变量。`;
  return `当前用的是环境变量里的 key${k.tail ? `（尾号 ${k.tail}）` : ''}。在这里填一条会覆盖它。`;
}

export default function AdminSettings() {
  const [ready, setReady] = useState(false);
  const [ar, setAr] = useState<AutoReply | null>(null);
  const [wr, setWr] = useState<WriterGen | null>(null);
  const [ai, setAi] = useState<AiCfg | null>(null);
  const [savedAr, setSavedAr] = useState<AutoReply | null>(null);
  const [savedWr, setSavedWr] = useState<WriterGen | null>(null);
  const [savedAi, setSavedAi] = useState<AiCfg | null>(null);
  const [keyMeta, setKeyMeta] = useState<{ writer: KeyMeta; judge: KeyMeta } | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chan, setChan] = useState<{ writer: ChannelState; judge: ChannelState } | null>(null);

  // 三个列表字段用单独的文本 state：边打逗号边解析会把「a, 」里的空格吃掉，
  // 手感很差。保存时再一次性转成数组。
  const [allowText, setAllowText] = useState('');
  const [blockText, setBlockText] = useState('');
  const [kwText, setKwText] = useState('');

  // 密钥用独立 state 且初值恒为空：后端压根不给明文，这里也就没有「回填」这回事。
  const [wrKey, setWrKey] = useState('');
  const [jdKey, setJdKey] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [ping, setPing] = useState<{ writer?: PingResult; judge?: PingResult }>({});
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<{ settings: Settings; meta: Meta; keyMeta: { writer: KeyMeta; judge: KeyMeta } }>(
        '/settings',
      );
      setAr(d.settings.autoReply);
      setWr(d.settings.writer);
      setAi(d.settings.ai);
      setSavedAr(d.settings.autoReply);
      setSavedWr(d.settings.writer);
      setSavedAi(d.settings.ai);
      setKeyMeta(d.keyMeta);
      setAllowText(toText(d.settings.autoReply.allowPaths));
      setBlockText(toText(d.settings.autoReply.blockPaths));
      setKwText(toText(d.settings.autoReply.skipKeywords));
      setWrKey('');
      setJdKey('');
      setMeta(d.meta);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取设置失败');
    } finally {
      setLoading(false);
    }

    // 通道快照单独一条请求：读不到不影响改设置（它是「补充信息」，不是必需品）。
    // 之所以不复用 /settings：judge 的协议判定在 ai.ts 里，抄一份到 settings 就会有两份真相。
    try {
      const s = await api<{ ai: { writer: ChannelState; judge: ChannelState } }>('/status');
      setChan(s.ai);
    } catch {
      setChan(null);
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
      await load();
    })();
  }, [load]);

  const dirty =
    !!ar &&
    !!wr &&
    !!ai &&
    !!savedAr &&
    !!savedWr &&
    !!savedAi &&
    (JSON.stringify({
      ...ar,
      allowPaths: toList(allowText),
      blockPaths: toList(blockText),
      skipKeywords: toList(kwText),
    }) !== JSON.stringify(savedAr) ||
      JSON.stringify(wr) !== JSON.stringify(savedWr) ||
      JSON.stringify(ai) !== JSON.stringify(savedAi) ||
      wrKey.trim().length > 0 ||
      jdKey.trim().length > 0);

  async function save() {
    if (!ar || !wr || !ai) return;
    setSaving(true);
    setErr('');
    setToast('');
    try {
      const nextAr: AutoReply = {
        ...ar,
        allowPaths: toList(allowText),
        blockPaths: toList(blockText),
        skipKeywords: toList(kwText),
      };
      const patch: Record<string, string> = {
        'autoReply.on': nextAr.on ? 'on' : 'off',
        'autoReply.perGuest': String(nextAr.perGuest),
        'autoReply.scope': nextAr.scope,
        'autoReply.allowPaths': nextAr.allowPaths.join(','),
        'autoReply.blockPaths': nextAr.blockPaths.join(','),
        'autoReply.skipKeywords': nextAr.skipKeywords.join(','),
        'writer.temperature': String(wr.temperature),
        'writer.maxTokens': String(wr.maxTokens),
        'ai.writer.base': ai.writer.base.trim(),
        'ai.writer.model': ai.writer.model.trim(),
        'ai.judge.provider': ai.judge.provider,
        'ai.judge.base': ai.judge.base.trim(),
        'ai.judge.model': ai.judge.model.trim(),
      };
      // **空着就不发**：发了空串等于把 key 清掉，而「留空不改」才是人的预期
      if (wrKey.trim()) patch['ai.writer.key'] = wrKey.trim();
      if (jdKey.trim()) patch['ai.judge.key'] = jdKey.trim();

      const d = await api<{ settings: Settings; keyMeta: { writer: KeyMeta; judge: KeyMeta } }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });

      // 用**服务端解析后的值**回填，而不是本地的：地址填错（少了 https://）会被丢弃，
      // 只改本地状态的话界面会显示一个其实没存进去的地址。
      const dropped: string[] = [];
      if (ai.writer.base.trim() && !d.settings.ai.writer.base) dropped.push('writer 的接口地址');
      if (ai.judge.base.trim() && !d.settings.ai.judge.base) dropped.push('judge 的接口地址');

      setAr(d.settings.autoReply);
      setWr(d.settings.writer);
      setAi(d.settings.ai);
      setSavedAr(d.settings.autoReply);
      setSavedWr(d.settings.writer);
      setSavedAi(d.settings.ai);
      setKeyMeta(d.keyMeta);
      setAllowText(toText(d.settings.autoReply.allowPaths));
      setBlockText(toText(d.settings.autoReply.blockPaths));
      setKwText(toText(d.settings.autoReply.skipKeywords));
      setWrKey('');
      setJdKey('');

      setToast(
        dropped.length
          ? `已保存，但${dropped.join('、')}格式不对（要 http:// 或 https:// 开头），那一条按环境变量走`
          : '已保存，下一条留言起按新设置跑',
      );
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  /** 清除库里的 key，回落环境变量。单独一次请求，不做「待保存」—— 免得两种语义混在一起 */
  async function clearKey(ch: 'writer' | 'judge') {
    setErr('');
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [`ai.${ch}.key`]: '' }),
      });
      await load();
      setToast(`已清除 ${ch} 的 key，回落到环境变量`);
      setTimeout(() => setToast(''), 3200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '清除失败');
    }
  }

  async function doPing() {
    setPinging(true);
    setErr('');
    try {
      const d = await api<{ writer: PingResult; judge: PingResult }>('/status/ping', { method: 'POST' });
      setPing({ writer: d.writer, judge: d.judge });
      // 探活也记账，顺手把用量条刷新一下
      try {
        const s = await api<{ ai: { writer: ChannelState; judge: ChannelState } }>('/status');
        setChan(s.ai);
      } catch {
        /* 刷新失败不影响探活结果 */
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '探活失败');
    } finally {
      setPinging(false);
    }
  }

  if (!ready) {
    return (
      <>
        <AdminTop active="settings" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  const writerModel = ai?.writer.model.trim() || meta?.aiEnv.writer.model || 'deepseek-chat';
  const judgeProvider: 'jev' | 'openai' =
    ai?.judge.provider || meta?.aiEnv.judge.provider || 'openai';

  return (
    <>
      <AdminTop active="settings" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>设置</h1>
            <p>保存即生效，不用重启 Worker。地址、密钥、模型都可以在这里改。</p>
          </div>
          <div className="q-admin-stat-actions">
            <button
              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
              type="button"
              onClick={() => void load()}
              disabled={loading || saving}
            >
              重新读取
            </button>
            <button
              className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? '保存中…' : dirty ? '保存设置' : '无改动'}
            </button>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}
        {toast ? <p className="q-admin-saved">{toast}</p> : null}

        {loading && !ar ? <div className="q-admin-loading">读取设置…</div> : null}
        {!ar || !wr || !ai ? (
          loading ? null : <p className="q-admin-error">{err || '设置读不到'}</p>
        ) : (
          <>
            {/* ——— ① 小爱的作息 ——— */}
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <div>
                  <h2>小爱的作息</h2>
                  <p>决定她要不要说话、在哪儿说、哪些话不接。</p>
                </div>
              </header>

              <div className="q-admin-settings">
                <Row title="自动回复" desc="关掉后访客留言照常收，只是她不接话。手动回复不受影响。">
                  <Switch on={ar.on} label="自动回复" onChange={(v) => setAr({ ...ar, on: v })} />
                </Row>

                <Row title="同一访客每天" desc="同一个人一天最多被自动回几次。1 表示只接一句，0 表示不限。">
                  <div className="q-admin-range" style={{ minWidth: 160 }}>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={ar.perGuest}
                      aria-label="单访客每日上限"
                      onChange={(e) => setAr({ ...ar, perGuest: Number(e.target.value) })}
                    />
                    <output>{ar.perGuest === 0 ? '不限' : ar.perGuest}</output>
                  </div>
                </Row>

                <Row title="回复范围" desc="默认只回顶层留言。楼里访客之间聊起来，AI 插嘴很怪。">
                  <div className="q-admin-seg">
                    <button type="button" aria-pressed={ar.scope === 'top'} onClick={() => setAr({ ...ar, scope: 'top' })}>
                      只回顶层
                    </button>
                    <button type="button" aria-pressed={ar.scope === 'all'} onClick={() => setAr({ ...ar, scope: 'all' })}>
                      楼中楼也回
                    </button>
                  </div>
                </Row>

                <div className="q-admin-grid2">
                  <div className="q-admin-field">
                    <label htmlFor="ar-allow">只在哪些路径回（空 = 全部）</label>
                    <input
                      id="ar-allow"
                      value={allowText}
                      onChange={(e) => setAllowText(e.target.value)}
                      placeholder="/friends/, /guestbook/"
                    />
                  </div>
                  <div className="q-admin-field">
                    <label htmlFor="ar-block">哪些路径不回（优先于左边）</label>
                    <input
                      id="ar-block"
                      value={blockText}
                      onChange={(e) => setBlockText(e.target.value)}
                      placeholder="/about/"
                    />
                  </div>
                </div>

                <div className="q-admin-field">
                  <label htmlFor="ar-kw">跳过关键词（正文命中就不回）</label>
                  <input
                    id="ar-kw"
                    value={kwText}
                    onChange={(e) => setKwText(e.target.value)}
                    placeholder="抽奖, 加我微信, 互赞"
                  />
                  <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                    逗号分隔，不区分大小写。用来挡那些「回了就等于帮她转发广告」的留言。
                  </p>
                </div>

                <div className="q-admin-notice">
                  <b>不再按天卡总量：</b>
                  回多少条由「单访客额度」和 judge 判断决定，没有每日总上限、也没有夜间闭嘴时段。
                  真被刷时先撑住的是 AI 每日配额（每通道 300 次），额度用满会自动停手。
                </div>
              </div>
            </section>

            {/* ——— ② 模型设置 ——— */}
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <div>
                  <h2>模型设置</h2>
                  <p>writer 说话，judge 判断。两条通道各自计配额，互不影响。</p>
                </div>
                <button
                  className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                  type="button"
                  onClick={() => void doPing()}
                  disabled={pinging}
                >
                  {pinging ? '正在打两条通道…' : '测一下'}
                </button>
              </header>

              <div className="q-admin-channels">
                {/* —— writer —— */}
                <article className="q-admin-channel">
                  <div className="q-admin-channel__title">
                    <b>writer · 起草与润色</b>
                    <State
                      on={chan ? chan.writer.on : Boolean(meta?.envHasWriter)}
                      label={chan && !chan.writer.on ? `未配 ${chan.writer.missing ?? 'key'}` : '在线'}
                    />
                  </div>
                  <p className="q-admin-channel__model">
                    {writerModel}
                    {ai.writer.model.trim() ? <em>本页指定</em> : <em>跟随环境变量</em>}
                  </p>
                  <Meter used={chan?.writer.used ?? null} quota={chan?.writer.quota ?? 300} />

                  <div className="q-admin-field" style={{ marginTop: 12 }}>
                    <label htmlFor="wr-base">接口地址</label>
                    <input
                      id="wr-base"
                      value={ai.writer.base}
                      onChange={(e) => setAi({ ...ai, writer: { ...ai.writer, base: e.target.value } })}
                      placeholder={meta?.aiEnv.writer.base || 'https://api.deepseek.com'}
                      spellCheck={false}
                    />
                    <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                      留空用环境变量里的（{meta?.aiEnv.writer.base || 'https://api.deepseek.com'}）。
                      要写到域名，别带 `/chat/completions` —— 那是我们自己拼的。
                    </p>
                  </div>

                  <div className="q-admin-field">
                    <label htmlFor="wr-key">密钥</label>
                    <div className="q-admin-keyrow">
                      <input
                        id="wr-key"
                        type="password"
                        value={wrKey}
                        onChange={(e) => setWrKey(e.target.value)}
                        placeholder={keyMeta?.writer.set ? `已配置 ····${keyMeta.writer.tail}（留空不改）` : '还没配'}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {keyMeta?.writer.from === 'db' ? (
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => void clearKey('writer')}
                          disabled={saving}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                    <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                      {keyHint(keyMeta?.writer)}
                    </p>
                  </div>

                  <div className="q-admin-field">
                    <label htmlFor="wr-model">模型名</label>
                    <input
                      id="wr-model"
                      value={ai.writer.model}
                      onChange={(e) => setAi({ ...ai, writer: { ...ai.writer, model: e.target.value } })}
                      placeholder={meta?.aiEnv.writer.model || 'deepseek-chat'}
                      spellCheck={false}
                    />
                    <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                      留空 = 用环境变量里的（{meta?.aiEnv.writer.model || 'deepseek-chat'}）。
                      别填推理模型 —— 它们把正文写在另一个字段里，回出来会是空的。
                    </p>
                  </div>

                  <Row title="温度" desc="越高越发散。0.8 左右像人在说话；0.3 会一板一眼。">
                    <div className="q-admin-range" style={{ minWidth: 150 }}>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={wr.temperature}
                        aria-label="生成温度"
                        onChange={(e) => setWr({ ...wr, temperature: Number(e.target.value) })}
                      />
                      <output>{wr.temperature.toFixed(2)}</output>
                    </div>
                  </Row>

                  <Row title="最大长度" desc="单位 token。400 够两三句中文，回复本来就该短。">
                    <div className="q-admin-range" style={{ minWidth: 150 }}>
                      <input
                        type="range"
                        min={80}
                        max={1000}
                        step={20}
                        value={wr.maxTokens}
                        aria-label="最大生成长度"
                        onChange={(e) => setWr({ ...wr, maxTokens: Number(e.target.value) })}
                      />
                      <output>{wr.maxTokens}</output>
                    </div>
                  </Row>

                  <Ping r={ping.writer} />
                </article>

                {/* —— judge —— */}
                <article className={`q-admin-channel${chan && !chan.judge.on ? ' is-off' : ''}`}>
                  <div className="q-admin-channel__title">
                    <b>judge · 判定</b>
                    <State
                      on={chan ? chan.judge.on : Boolean(meta?.envHasJudge)}
                      label={chan && !chan.judge.on ? `未配 ${chan.judge.missing ?? 'key'}` : '在线'}
                    />
                  </div>
                  <p className="q-admin-channel__model">
                    {chan?.judge.model || ai.judge.model || meta?.aiEnv.judge.model || '—'}
                    <em>{judgeProvider === 'jev' ? '决策协议' : 'OpenAI 兼容'}</em>
                    {ai.judge.provider ? null : <em>跟随环境变量</em>}
                  </p>
                  <Meter used={chan?.judge.used ?? null} quota={chan?.judge.quota ?? 300} />

                  <Row
                    title="协议"
                    desc={`Jev 只回 label 与置信度，不生成文字；OpenAI 兼容则让它输出一段 JSON。当前生效：${
                      judgeProvider === 'jev' ? 'Jev 决策' : 'OpenAI 兼容'
                    }${ai.judge.provider ? '（本页指定）' : '（跟随环境变量）'}`}
                  >
                    <div className="q-admin-seg">
                      <button
                        type="button"
                        aria-pressed={judgeProvider === 'openai'}
                        onClick={() => setAi({ ...ai, judge: { ...ai.judge, provider: 'openai' } })}
                      >
                        OpenAI 兼容
                      </button>
                      <button
                        type="button"
                        aria-pressed={judgeProvider === 'jev'}
                        onClick={() => setAi({ ...ai, judge: { ...ai.judge, provider: 'jev' } })}
                      >
                        Jev 决策
                      </button>
                    </div>
                  </Row>

                  <div className="q-admin-field" style={{ marginTop: 12 }}>
                    <label htmlFor="jd-base">接口地址</label>
                    <input
                      id="jd-base"
                      value={ai.judge.base}
                      onChange={(e) => setAi({ ...ai, judge: { ...ai.judge, base: e.target.value } })}
                      placeholder={meta?.aiEnv.judge.base || 'https://api.typesafe.ai'}
                      spellCheck={false}
                    />
                    <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                      留空用当前的（{meta?.aiEnv.judge.base || 'https://api.typesafe.ai'}）。
                      Jev 的端点是 <code>{"{地址}/v1/systemone"}</code>，地址只写到域名。
                    </p>
                  </div>

                  <div className="q-admin-field">
                    <label htmlFor="jd-key">密钥</label>
                    <div className="q-admin-keyrow">
                      <input
                        id="jd-key"
                        type="password"
                        value={jdKey}
                        onChange={(e) => setJdKey(e.target.value)}
                        placeholder={keyMeta?.judge.set ? `已配置 ····${keyMeta.judge.tail}（留空不改）` : '还没配'}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {keyMeta?.judge.from === 'db' ? (
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => void clearKey('judge')}
                          disabled={saving}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                    <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                      {keyHint(keyMeta?.judge)}
                    </p>
                  </div>

                  <div className="q-admin-field">
                    <label htmlFor="jd-model">模型名</label>
                    <input
                      id="jd-model"
                      value={ai.judge.model}
                      onChange={(e) => setAi({ ...ai, judge: { ...ai.judge, model: e.target.value } })}
                      placeholder={meta?.aiEnv.judge.model || 'jev-latest'}
                      spellCheck={false}
                    />
                  </div>

                  <p className="q-admin-channel__hint">
                    换判定模型或协议之后，提示词不一定要跟着变，但**要回来点一次「测一下」**：
                    探活会拿一句正常留言真打一次，判不出「正常」就说明提示词与模型不匹配。
                    拦哪几类、多少分才动手，在
                    <a className="q-admin-head__link" href="/admin/review">评论审核</a>页。
                  </p>

                  <Ping r={ping.judge} />
                </article>
              </div>

              <p className="q-admin-stat__foot">
                探活会真发一次请求（writer 约 30 token，judge 输出不计费），各受每日配额约束。
                测的是**已保存**的配置 —— 改完先保存，再点。
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
