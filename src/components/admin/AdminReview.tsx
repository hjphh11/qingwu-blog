/*
 * 后台 · 评论审核规则
 *
 * **只管规则，不管「审不审」**：每一条留言提交时都会过一遍判定，没有总开关。
 * 站长要的是「用户发什么都要判一次」，而不是「想起来了才判」。
 *
 * 所以这一页只有两件事：
 *   ① 拦哪几类（违法 / 色情 / 辱骂 / 隐私 / 广告，五类可以单独关）；
 *   ② 把握到多少分才动手（阈值）。
 *
 * 命中之后怎么处置是写死的，不给选：落 `status='spam'` —— 前台不展示，
 * 收件箱「垃圾」里留着能复核、能放行。给三个选项只会让人以为「压到待审」
 * 和「标垃圾」有很大区别，其实访客那边看到的一样：都不显示。
 *
 * 口径文案不在这里写，来自 worker settings.ts 的 VERDICT_DESC ——
 * 提示词、Jev 的 criteria、这一页的说明共用同一份，改规则只改那一处。
 */
import { useCallback, useEffect, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

type VerdictKey = 'illegal' | 'porn' | 'abuse' | 'privacy' | 'spam';

interface JudgeSettings {
  categories: VerdictKey[];
  threshold: number;
}

interface Meta {
  verdicts: VerdictKey[];
  verdictLabel: Record<string, string>;
  verdictDesc: Record<string, string>;
  envHasWriter: boolean;
  envHasJudge: boolean;
  envModel: string;
  envBase: string;
}

/** worker 没给 meta 时的兜底顺序（旧版本后端不会带 verdicts） */
const FALLBACK_ORDER: VerdictKey[] = ['illegal', 'porn', 'abuse', 'privacy', 'spam'];

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

function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
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

export default function AdminReview() {
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [form, setForm] = useState<JudgeSettings | null>(null);
  const [saved, setSaved] = useState<JudgeSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<{ settings: { judge: JudgeSettings }; meta: Meta }>('/settings');
      setMeta(d.meta);
      setForm(d.settings.judge);
      setSaved(d.settings.judge);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取规则失败');
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
    (form.threshold !== saved.threshold ||
      form.categories.join(',') !== saved.categories.join(','));

  function toggleCat(k: VerdictKey) {
    if (!form) return;
    const has = form.categories.includes(k);
    // 至少留一类：全关掉等于「每条都判，但判出来什么都不拦」，白花一次模型调用
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
          'judge.categories': form.categories.join(','),
          'judge.threshold': String(form.threshold),
        }),
      });
      setSaved(form);
      setToast('规则已保存，下一条留言起生效');
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
        <AdminTop active="review" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  const judgeOff = meta ? !meta.envHasJudge : false;
  const order = meta?.verdicts?.length ? meta.verdicts : FALLBACK_ORDER;

  return (
    <>
      <AdminTop active="review" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>评论审核</h1>
            <p>
              {form
                ? `每条留言提交时都会判一次 · 拦 ${form.categories.length} / ${
                    order.length
                  } 类 · 阈值 ${form.threshold}`
                : '每条留言提交时都会判一次'}
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
              <li>环境变量里没有 AI_JUDGE_KEY / AI_API_KEY —— 规则存得下，但暂时判定不了。</li>
              <li>判定不了时留言照常收下（不会因为审核缺席就把人挡在门外），垃圾只能事后在收件箱清。</li>
              <li>配好 key 要重启 Worker 才生效（env 只在启动时读一次）。</li>
            </ul>
          </section>
        ) : null}

        {loading && !form ? <div className="q-admin-loading">读取规则…</div> : null}

        {form ? (
          <>
            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>拦截类别</h2>
                <p>关掉的类别不进提示词 —— 模型压根没机会往这个筐里归类</p>
              </header>

              <div className="q-admin-settings">
                {order.map((k) => (
                  <div className="q-admin-setting" key={k}>
                    <div className="q-admin-setting__label">
                      <b>{meta?.verdictLabel?.[k] ?? k}</b>
                      <span>{meta?.verdictDesc?.[k] ?? ''}</span>
                    </div>
                    <div className="q-admin-setting__ctrl">
                      <Switch
                        on={form.categories.includes(k)}
                        label={`拦截${meta?.verdictLabel?.[k] ?? k}`}
                        onChange={() => toggleCat(k)}
                      />
                    </div>
                  </div>
                ))}

                <div className="q-admin-setting">
                  <div className="q-admin-setting__label">
                    <b>拦截阈值</b>
                    <span>
                      判定为「应当拦截」的把握达到这个分数才动手。调低容易误伤正常批评，
                      调高容易放过广告。60 是「比较像」就拦，85 是「几乎确定」才拦。
                    </span>
                  </div>
                  <div className="q-admin-setting__ctrl">
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
                  </div>
                </div>
              </div>
            </section>

            <section className="q-admin-panel q-admin-stat">
              <header className="q-admin-stat__head">
                <h2>判定口径与后果</h2>
              </header>

              <div className="q-admin-prose">
                <p>
                  判定口径参照《网络信息内容生态治理规定》对违法信息与不良信息的划分：
                  违法的一律拦，不良的按上表逐类推定。正常交流、提问、合理批评、调侃都算正常 ——
                  <b>批评不等于辱骂</b>，这条写在提示词里，改规则时别删。
                </p>
                <p>
                  命中的留言<b>不会丢</b>：状态记为「垃圾」，前台不展示，
                  在「评论收件箱 → 垃圾」里还能看到原文、AI 给的判定和分数，误判了点一下就放行。
                </p>
                <p>
                  判定自己挂掉时（超时、key 失效、配额用尽）<b>一律放行</b>。
                  少拦一条垃圾的代价，比因为上游抖动让留言板收不到话小得多。
                </p>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}
