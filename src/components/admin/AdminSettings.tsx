/*
 * 后台 · 设置
 *
 * 2026-11-10 晚从「运行与设置」拆出来的一页，站长原话：「把运行与设置分开页面」。
 * 分开之后职责很清楚：运行状态看数字，这一页只改参数。
 *
 * 这些值以前全在环境变量里：改一个日上限要登服务器改 .dev.vars 再重启 Worker。
 * 现在落在 admin_settings 表，保存即生效 —— Worker 每次处理请求都现读一次。
 *
 * 优先级：**库里有值就以库为准，没有才回落到 env**。所以本页的初值可能来自 env，
 * 只要一保存就会写进库，从此以库为准。
 *
 * 与「评论审核」页的分工：这里管**小爱要不要说话、说多少**；
 * 那边管**访客的话要不要拦**。两件事各有开关，别混。
 */
import { useCallback, useEffect, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

interface AutoReply {
  on: boolean;
  daily: number;
  perGuest: number;
  scope: 'top' | 'all';
  allowPaths: string[];
  blockPaths: string[];
  skipKeywords: string[];
  quietFrom: string;
  quietTo: string;
}

interface Writer {
  model: string;
  temperature: number;
  maxTokens: number;
}

interface Meta {
  envHasWriter: boolean;
  envHasJudge: boolean;
  envModel: string;
  envBase: string;
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

/** 逗号分隔的列表 ↔ 数组。空串表示「不限」，不要写成「空数组 = 全禁」。 */
const toList = (s: string): string[] =>
  s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const toText = (a: string[]): string => a.join(', ');

export default function AdminSettings() {
  const [ready, setReady] = useState(false);
  const [ar, setAr] = useState<AutoReply | null>(null);
  const [wr, setWr] = useState<Writer | null>(null);
  const [savedAr, setSavedAr] = useState<AutoReply | null>(null);
  const [savedWr, setSavedWr] = useState<Writer | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);

  // 三个列表字段用单独的文本 state：边打逗号边解析会把「a, 」里的空格吃掉，
  // 手感很差。保存时再一次性转成数组。
  const [allowText, setAllowText] = useState('');
  const [blockText, setBlockText] = useState('');
  const [kwText, setKwText] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<{ settings: { autoReply: AutoReply; writer: Writer }; meta: Meta }>('/settings');
      setAr(d.settings.autoReply);
      setWr(d.settings.writer);
      setSavedAr(d.settings.autoReply);
      setSavedWr(d.settings.writer);
      setAllowText(toText(d.settings.autoReply.allowPaths));
      setBlockText(toText(d.settings.autoReply.blockPaths));
      setKwText(toText(d.settings.autoReply.skipKeywords));
      setMeta(d.meta);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取设置失败');
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
      await load();
    })();
  }, [load]);

  const dirty =
    !!ar &&
    !!wr &&
    !!savedAr &&
    !!savedWr &&
    (JSON.stringify({
      ...ar,
      allowPaths: toList(allowText),
      blockPaths: toList(blockText),
      skipKeywords: toList(kwText),
    }) !== JSON.stringify(savedAr) ||
      JSON.stringify(wr) !== JSON.stringify(savedWr));

  async function save() {
    if (!ar || !wr) return;
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
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          'autoReply.on': nextAr.on ? 'on' : 'off',
          'autoReply.daily': String(nextAr.daily),
          'autoReply.perGuest': String(nextAr.perGuest),
          'autoReply.scope': nextAr.scope,
          'autoReply.allowPaths': nextAr.allowPaths.join(','),
          'autoReply.blockPaths': nextAr.blockPaths.join(','),
          'autoReply.skipKeywords': nextAr.skipKeywords.join(','),
          'autoReply.quietFrom': nextAr.quietFrom,
          'autoReply.quietTo': nextAr.quietTo,
          'writer.model': wr.model.trim(),
          'writer.temperature': String(wr.temperature),
          'writer.maxTokens': String(wr.maxTokens),
        }),
      });
      setAr(nextAr);
      setSavedAr(nextAr);
      setSavedWr(wr);
      setToast('已保存，下一条留言起按新设置跑');
      setTimeout(() => setToast(''), 3200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
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

  return (
    <>
      <AdminTop active="settings" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>设置</h1>
            <p>
              保存即生效，不用重启 Worker
              {meta?.envModel ? ` · 环境变量里的模型是 ${meta.envModel}` : ''}
            </p>
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
        {!ar || !wr ? (
          loading ? null : <p className="q-admin-error">{err || '设置读不到'}</p>
        ) : (
          <div className="q-admin-stat-grid">
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>小爱的作息</h2>
                <p>决定她要不要说话、在哪儿说、说多少</p>
              </header>

              <div className="q-admin-settings">
                <Row title="自动回复" desc="关掉后访客留言照常收，只是她不接话。手动回复不受影响。">
                  <Switch on={ar.on} label="自动回复" onChange={(v) => setAr({ ...ar, on: v })} />
                </Row>

                <Row title="每天最多" desc="只算自动回复。手动发的回复不占这个额度。">
                  <div className="q-admin-range" style={{ minWidth: 160 }}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={ar.daily}
                      aria-label="每日自动回复上限"
                      onChange={(e) => setAr({ ...ar, daily: Number(e.target.value) })}
                    />
                    <output>{ar.daily}</output>
                  </div>
                </Row>

                <Row title="同一访客每天" desc="同一个人一天最多被自动回几次。1 表示只接一句。">
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
                    <output>{ar.perGuest}</output>
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

                <div className="q-admin-grid2">
                  <div className="q-admin-field">
                    <label htmlFor="ar-qf">安静时段起</label>
                    <input
                      id="ar-qf"
                      type="time"
                      value={ar.quietFrom}
                      onChange={(e) => setAr({ ...ar, quietFrom: e.target.value })}
                    />
                  </div>
                  <div className="q-admin-field">
                    <label htmlFor="ar-qt">安静时段止（可跨午夜）</label>
                    <input
                      id="ar-qt"
                      type="time"
                      value={ar.quietTo}
                      onChange={(e) => setAr({ ...ar, quietTo: e.target.value })}
                    />
                  </div>
                </div>
                <p className="q-admin-hint" style={{ margin: 0 }}>
                  例：22:00 → 08:00 表示这段时间她说「明天见」。两端留空或填相同时间表示不设。
                </p>
              </div>
            </section>

            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>生成参数</h2>
                <p>只影响 writer（起草与润色）</p>
              </header>

              <div className="q-admin-settings">
                <div className="q-admin-field">
                  <label htmlFor="wr-model">模型</label>
                  <input
                    id="wr-model"
                    value={wr.model}
                    onChange={(e) => setWr({ ...wr, model: e.target.value })}
                    placeholder={meta?.envModel || 'deepseek-chat'}
                  />
                  <p className="q-admin-hint" style={{ margin: '6px 0 0' }}>
                    留空 = 用环境变量里的模型。换成便宜的小模型可以直接填名字，地址不用动。
                  </p>
                </div>

                <Row title="温度" desc="越高越发散。0.8 左右像人在说话；调到 0.3 会变得一板一眼。">
                  <div className="q-admin-range" style={{ minWidth: 180 }}>
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

                <Row title="最大长度" desc="单位 token。400 大约够两三句中文，回复本来就该短。">
                  <div className="q-admin-range" style={{ minWidth: 180 }}>
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

                <div className="q-admin-notice">
                  <b>两件事改不了：</b>
                  接口地址（AI_BASE_URL）与 key 仍在环境变量里。key 属于凭据，不该从网页改；
                  地址换了通常意味着换了服务商，值得重启一次 Worker 确认。
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
