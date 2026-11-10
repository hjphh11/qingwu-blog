/*
 * 后台 · 评论审核
 *
 * 两件事，同一页：
 *   ① 规则 —— 提交前要不要审、审哪几类、分数到多少才拦、命中后怎么处置；
 *   ② 试判 —— 改完规则先拿一段文字试一次，看它会不会被误拦，再决定要不要开。
 *
 * 为什么要试判：阈值调低一格可能就把「合理批评」判成 abuse。光看开关不知道边界在哪，
 * 只有真喂几条进去，才知道这条线画得对不对。试判**不写任何表**，只花一次 judge 配额。
 *
 * 与「收件箱里的 AI 体检」的区别：体检是对已经发出来的留言事后看，
 * 这里是对还没发出去的留言事前拦。两个入口、同一套判定（worker 的 moderateComment）。
 */
import { useCallback, useEffect, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

// ——————————————————————————————————————————————————————————
// 接口形状
// ——————————————————————————————————————————————————————————
type VerdictKey = 'spam' | 'abuse' | 'privacy';
type Action = 'hold' | 'reject';

interface JudgeSettings {
  on: boolean;
  categories: VerdictKey[];
  threshold: number;
  action: Action;
  notice: string;
}

interface Meta {
  verdicts: VerdictKey[];
  verdictLabel: Record<string, string>;
  defaultNotice: string;
  envHasWriter: boolean;
  envHasJudge: boolean;
  envModel: string;
  envBase: string;
}

interface TestResult {
  ok: boolean;
  hit: boolean;
  verdict: string;
  score: number;
  reasons: string[];
  note: string;
  notice: string;
  probs: Record<string, number>;
  threshold: number;
  action: Action;
  categories: VerdictKey[];
  model: string;
  ms: number;
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

// ——————————————————————————————————————————————————————————
// 小件
// ——————————————————————————————————————————————————————————
function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="q-admin-switch"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

/** 一行设置：左标签说明，右控件。 */
function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
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

const VERDICT_ORDER: VerdictKey[] = ['spam', 'abuse', 'privacy'];

// ——————————————————————————————————————————————————————————
// 页面
// ——————————————————————————————————————————————————————————
export default function AdminReview() {
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [form, setForm] = useState<JudgeSettings | null>(null);
  const [saved, setSaved] = useState<JudgeSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  // 试判
  const [tAuthor, setTAuthor] = useState('路过的访客');
  const [tPath, setTPath] = useState('/friends/');
  const [tBody, setTBody] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [tErr, setTErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<{ settings: { judge: JudgeSettings }; meta: Meta }>('/settings');
      setMeta(d.meta);
      setForm(d.settings.judge);
      setSaved(d.settings.judge);
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
    !!form &&
    !!saved &&
    (form.on !== saved.on ||
      form.threshold !== saved.threshold ||
      form.action !== saved.action ||
      form.notice !== saved.notice ||
      form.categories.join(',') !== saved.categories.join(','));

  function toggleCat(k: VerdictKey) {
    if (!form) return;
    const has = form.categories.includes(k);
    // 至少留一类：全关掉等于「开着审核但什么都不拦」，那不如直接关总开关
    if (has && form.categories.length === 1) return;
    setForm({
      ...form,
      categories: has ? form.categories.filter((x) => x !== k) : [...form.categories, k],
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setErr('');
    setToast('');
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          'judge.on': form.on ? 'on' : 'off',
          'judge.categories': form.categories.join(','),
          'judge.threshold': String(form.threshold),
          'judge.action': form.action,
          'judge.notice': form.notice.trim(),
        }),
      });
      setSaved(form);
      setToast(form.on ? '规则已保存，下一条留言起生效' : '规则已保存（审核仍是关闭状态）');
      setTimeout(() => setToast(''), 3200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!tBody.trim()) {
      setTErr('先写一段要试的留言');
      return;
    }
    setTesting(true);
    setTErr('');
    setResult(null);
    try {
      const d = await api<TestResult>('/review/test', {
        method: 'POST',
        body: JSON.stringify({ author: tAuthor, body: tBody, path: tPath }),
      });
      setResult(d);
    } catch (e) {
      setTErr(e instanceof Error ? e.message : '试判失败');
    } finally {
      setTesting(false);
    }
  }

  if (!ready) {
    return (
      <>
        <AdminTop active="review" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  const judgeOff = meta ? !meta.envHasJudge : false;

  return (
    <>
      <AdminTop active="review" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>评论审核</h1>
            <p>
              {form?.on
                ? `已开启 · 命中 ${form.categories.length} 类 · 阈值 ${form.threshold} · ${
                    form.action === 'hold' ? '转待审' : '标为垃圾'
                  }`
                : '当前关闭 —— 留言直接进待审，不做内容判定'}
            </p>
          </div>
          <div className="q-admin-stat-actions">
            <button
              className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? '保存中…' : dirty ? '保存规则' : '无改动'}
            </button>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}
        {toast ? <p className="q-admin-saved">{toast}</p> : null}

        {judgeOff ? (
          <section className="q-admin-warnbox">
            <b>judge 通道没配</b>
            <ul>
              <li>环境变量里没有 AI_JUDGE_KEY / AI_API_KEY，审核与试判都跑不了。</li>
              <li>配好 key 要重启 Worker 才生效（env 只在启动时读一次）。</li>
            </ul>
          </section>
        ) : null}

        {loading && !form ? <div className="q-admin-loading">读取规则…</div> : null}

        {form ? (
          <>
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>规则</h2>
                <p>改动只在本页，点右上「保存规则」才落库</p>
              </header>

              <div className="q-admin-settings">
                <Row
                  title="提交前审核"
                  desc="打开后，每条留言先过一遍 judge。每条多花 200ms~1s（Jev 快，聊天模型慢）。"
                >
                  <Switch
                    on={form.on}
                    label="提交前审核"
                    onChange={(v) => setForm({ ...form, on: v })}
                  />
                </Row>

                <Row title="拦截类别" desc="关掉的类别即便模型判出来也不拦；至少留一类。">
                  <div className="q-admin-chips">
                    {VERDICT_ORDER.map((k) => (
                      <button
                        key={k}
                        className="q-admin-chip"
                        type="button"
                        aria-pressed={form.categories.includes(k)}
                        onClick={() => toggleCat(k)}
                      >
                        {meta?.verdictLabel[k] ?? k}
                      </button>
                    ))}
                  </div>
                </Row>

                <Row
                  title="拦截阈值"
                  desc="判定为「应当拦截」的把握达到这个分数才动手。调低容易误伤正常批评，调高容易放过广告。"
                >
                  <div className="q-admin-range">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={form.threshold}
                      aria-label="拦截阈值"
                      onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                    />
                    <output>{form.threshold}</output>
                  </div>
                </Row>

                <Row title="命中后" desc="两种都会落库，误判能复核 —— 直接丢掉就再也找不见了。">
                  <div className="q-admin-seg">
                    <button
                      type="button"
                      aria-pressed={form.action === 'hold'}
                      onClick={() => setForm({ ...form, action: 'hold' })}
                    >
                      转待审
                    </button>
                    <button
                      type="button"
                      aria-pressed={form.action === 'reject'}
                      onClick={() => setForm({ ...form, action: 'reject' })}
                    >
                      标为垃圾
                    </button>
                  </div>
                </Row>

                <div>
                  <div className="q-admin-field">
                    <label htmlFor="judge-notice">命中时给访客看的话</label>
                    <textarea
                      id="judge-notice"
                      value={form.notice}
                      maxLength={200}
                      rows={3}
                      onChange={(e) => setForm({ ...form, notice: e.target.value })}
                      placeholder={meta?.defaultNotice}
                    />
                  </div>
                  <div className="q-admin-notice">
                    <b>访客会看到：</b>
                    {form.notice.trim() || meta?.defaultNotice || '（用默认文案）'}
                  </div>
                  <p className="q-admin-hint" style={{ margin: '8px 0 0' }}>
                    只写这一句，不带判定理由。理由里常有「像广告」这类话，直接给访客看很冲。
                  </p>
                </div>
              </div>
            </section>

            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>试判</h2>
                <p>按当前已保存的规则跑，不写库、不改任何留言</p>
              </header>

              <div className="q-admin-grid2">
                <div className="q-admin-field">
                  <label htmlFor="t-author">访客昵称</label>
                  <input
                    id="t-author"
                    value={tAuthor}
                    maxLength={40}
                    onChange={(e) => setTAuthor(e.target.value)}
                  />
                </div>
                <div className="q-admin-field">
                  <label htmlFor="t-path">页面路径</label>
                  <input
                    id="t-path"
                    value={tPath}
                    maxLength={120}
                    onChange={(e) => setTPath(e.target.value)}
                    placeholder="/friends/"
                  />
                </div>
              </div>

              <div className="q-admin-field">
                <label htmlFor="t-body">留言正文</label>
                <textarea
                  id="t-body"
                  value={tBody}
                  maxLength={800}
                  rows={4}
                  onChange={(e) => setTBody(e.target.value)}
                  placeholder="贴一段真留言，或故意写一条广告试试会不会被拦"
                />
              </div>

              <div className="q-admin-stat-actions" style={{ justifyContent: 'flex-start' }}>
                <button
                  className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testing}
                >
                  {testing ? '判定中…' : '试判一次'}
                </button>
                {tBody ? (
                  <button
                    className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                    type="button"
                    onClick={() => {
                      setTBody('');
                      setResult(null);
                      setTErr('');
                    }}
                  >
                    清空
                  </button>
                ) : null}
                <span className="q-admin-hint" style={{ margin: 0 }}>
                  {tBody.length} / 800
                </span>
              </div>

              {tErr ? <p className="q-admin-error">{tErr}</p> : null}

              {result ? (
                <div style={{ marginTop: 16 }}>
                  <div className="q-admin-verdict">
                    <span
                      className={`q-admin-tag ${
                        result.hit ? 'q-admin-tag--danger' : 'q-admin-tag--ok'
                      }`}
                    >
                      {result.hit ? '会被拦下' : '会放行'}
                    </span>
                    <span className="q-admin-verdict__score">{result.score}</span>
                    <span className="q-admin-hint" style={{ margin: 0 }}>
                      {meta?.verdictLabel[result.verdict] ?? result.verdict}
                      {result.note ? ` · ${result.note}` : ''}
                      {` · 阈值 ${result.threshold} · ${result.ms}ms · ${result.model}`}
                    </span>
                  </div>

                  {result.reasons?.length ? (
                    <p className="q-admin-hint" style={{ margin: '8px 0 0' }}>
                      依据：{result.reasons.join('；')}
                    </p>
                  ) : null}

                  <div className="q-admin-probs">
                    {['ok', ...result.categories].map((k) => {
                      const v = Math.max(0, Math.min(100, Number(result.probs[k] ?? 0)));
                      return (
                        <div
                          key={k}
                          className={`q-admin-prob ${
                            k !== 'ok' && result.categories.includes(k as VerdictKey) ? 'q-admin-prob--hit' : ''
                          }`}
                        >
                          <span>{meta?.verdictLabel[k] ?? k}</span>
                          <span className="q-admin-prob__bar">
                            <span className="q-admin-prob__fill" style={{ width: `${v}%` }} />
                          </span>
                          <output>{v}%</output>
                        </div>
                      );
                    })}
                  </div>

                  {result.hit ? (
                    <div className="q-admin-notice">
                      <b>访客会看到：</b>
                      {result.notice || meta?.defaultNotice}
                      {result.action === 'reject' ? '（这条会直接标为垃圾，不进待审）' : '（这条会进待审）'}
                    </div>
                  ) : (
                    <div className="q-admin-notice">
                      不会拦：分数没到阈值，或者判的是「正常」。留言照常进待审。
                    </div>
                  )}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
