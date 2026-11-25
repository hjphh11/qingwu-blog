/*
 * 后台 · 长亭
 *
 * 三个页签，对应站长真正会做的三件事：
 *   ① 举报 —— 有人按了那颗按钮，得有人看（在这之前举报只落库、没有读取方）；
 *   ② 最近消息 —— 举报是「别人替你发现的」，这一栏是自己扫一眼；待审的排最前；
 *   ③ 审核规则 —— 哪条在命中、哪条在误伤。这页之前 `chat_rule_stats` 只写不读，
 *      改清单只能靠猜。
 *
 * 三个动作的口径在 worker/src/admin/chat.ts：删消息是软删（前台留一行
 * 「这条被站长收走了」），封人写 chat_bans（发送时会查）。
 *
 * 为什么不放在评论收件箱里：两套东西的消息模型完全不同（评论有楼层、聊天没有），
 * 混在一页里「删」按钮的含义会飘。
 */
import { useCallback, useEffect, useState } from 'react';
import AdminTop from './AdminTop.tsx';

const API = '/api/admin';

interface ChatReport {
  id: number;
  status: 'open' | 'handled' | 'dismissed';
  reason: string;
  ts: number;
  message: {
    id: number;
    body: string;
    kind: string;
    status: string;
    ts: number;
    authorId: number;
    authorName: string;
  } | null;
  reporter: { id: number; name: string };
  /** 模型的复核结论；null = 还没判过 */
  ai: {
    verdict: string;
    score: number;
    note: string;
    reasons: string[];
    model: string;
    at: number;
  } | null;
}

interface ChatBan {
  accountId: number;
  name: string;
  until: number;
  reason: string;
  createdAt: number;
}

interface ChatMsg {
  id: number;
  body: string;
  kind: string;
  status: string;
  ts: number;
  authorId: number;
  authorName: string;
  reports: number;
}

interface Rule {
  id: string;
  note: string;
  hits: number;
  hurt: number;
  at: number;
}

const REASON_LABEL: Record<string, string> = {
  illegal: '违法',
  porn: '色情',
  abuse: '辱骂',
  privacy: '隐私',
  spam: '广告',
  other: '其他',
};

/** 判定类别 → 中文。和 worker/src/admin/settings.ts 的 VERDICT_DESC 同名同义 */
const VERDICT_LABEL: Record<string, string> = {
  ok: '正常',
  illegal: '违法',
  porn: '色情',
  abuse: '辱骂',
  privacy: '隐私',
  spam: '广告',
};

/** 建议动作 → 一句话。没有「建议封禁」：封人只由站长决定 */
const ADVISE_LABEL: Record<string, string> = {
  ignore: '建议放行',
  delete: '建议收走',
  review: '拿不准，你自己看',
};

/**
 * 建议动作。**与 worker/src/admin/chat.ts 的 judgeChatReport 同一口径**：
 * 判成正常 → 放行；命中类别且到阈值 → 收走；其余 → 拿不准。
 */
function adviseOf(verdict: string, score: number, threshold: number): 'ignore' | 'delete' | 'review' {
  if (verdict === 'ok') return 'ignore';
  return score >= threshold ? 'delete' : 'review';
}

const STATUS_LABEL: Record<string, string> = {
  visible: '正常',
  pending: '待审',
  recalled: '已撤回',
};

/** 封禁时长三个常用档，别让人填分钟数 */
const BAN_OPTIONS = [
  { label: '1 小时', minutes: 60 },
  { label: '1 天', minutes: 60 * 24 },
  { label: '7 天', minutes: 60 * 24 * 7 },
];

type Tab = 'reports' | 'messages' | 'rules';

function timeAgo(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} 小时前`;
  return `${Math.round(d / 86_400_000)} 天前`;
}

function kindLabel(kind: string): string {
  if (kind === 'image') return '[图片]';
  if (kind === 'video') return '[视频]';
  if (kind === 'file') return '[文件]';
  return '';
}

export default function AdminChat() {
  const [tab, setTab] = useState<Tab>('reports');

  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [bans, setBans] = useState<ChatBan[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [openCount, setOpenCount] = useState(0);
  /** AI 判定的拦截阈值。建议动作按它算，和 worker 里同一个数 */
  const [threshold, setThreshold] = useState(60);

  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [msgsMore, setMsgsMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  /** 正在填封禁时长的那条举报（message.id） */
  const [banFor, setBanFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/chat`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/admin';
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reports?: ChatReport[];
        bans?: ChatBan[];
        rules?: Rule[];
        openCount?: number;
        threshold?: number;
      };
      if (!data.ok) {
        setErr('读不到举报列表，刷新再试');
        return;
      }
      setReports(data.reports ?? []);
      setBans(data.bans ?? []);
      setRules(data.rules ?? []);
      setOpenCount(data.openCount ?? 0);
      if (typeof data.threshold === 'number') setThreshold(data.threshold);
      setErr('');
    } catch {
      setErr('网络好像不太顺');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMsgs = useCallback(async (before = 0) => {
    try {
      const res = await fetch(`${API}/chat/messages${before ? `?before=${before}` : ''}`, {
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        messages?: ChatMsg[];
        hasMore?: boolean;
      };
      if (!data.ok) return;
      setMsgs((prev) => (before && prev ? [...prev, ...(data.messages ?? [])] : (data.messages ?? [])));
      setMsgsMore(Boolean(data.hasMore));
    } catch {
      /* 巡查栏读不到不影响举报那两栏 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'messages' && msgs === null) void loadMsgs();
  }, [tab, msgs, loadMsgs]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  async function act(key: string, fn: () => Promise<Response>, after: string) {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        flash(d.message || '没成功，再试一次');
        return;
      }
      flash(after);
      await load();
      if (msgs !== null) await loadMsgs();
    } catch {
      flash('网络好像不太顺');
    } finally {
      setBusy('');
    }
  }

  const removeMessage = (id: number) =>
    act(
      `del:${id}`,
      () => fetch(`${API}/chat/messages/${id}/delete`, { method: 'POST', credentials: 'include' }),
      '那条已经收走了，前台会显示「被站长收走」',
    );

  const dismiss = (id: number) =>
    act(
      `skip:${id}`,
      () =>
        fetch(`${API}/chat/reports/${id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'dismissed' }),
        }),
      '这条举报忽略了',
    );

  const ban = (accountId: number, minutes: number, label: string) =>
    act(
      `ban:${accountId}`,
      () =>
        fetch(`${API}/chat/ban`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accountId, minutes, reason: '站长手动' }),
        }),
      `封了 ${label}`,
    );

  const unban = (accountId: number) =>
    act(
      `unban:${accountId}`,
      () => fetch(`${API}/chat/ban/${accountId}`, { method: 'DELETE', credentials: 'include' }),
      '解封了',
    );

  const hurt = (ruleId: string) =>
    act(
      `hurt:${ruleId}`,
      () => fetch(`${API}/chat/rules/${ruleId}/hurt`, { method: 'POST', credentials: 'include' }),
      `${ruleId} 记了一次误伤`,
    );

  /** 交给模型看一眼。结论落库，所以这个按钮点第二次是「重判」 */
  const judge = (reportId: number) =>
    act(
      `judge:${reportId}`,
      () => fetch(`${API}/chat/reports/${reportId}/judge`, { method: 'POST', credentials: 'include' }),
      '看完了',
    );

  const confirmDelete = (id: number, ask: string) => {
    if (window.confirm(`${ask}前台会显示「这条被站长收走了」。`)) void removeMessage(id);
  };

  return (
    <>
      <AdminTop active="chat" />
      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>长亭</h1>
            <p>
              举报一进来就会交给模型看一眼，结论和分数就在卡片上；它只给建议，
              删和封仍然由你按。删掉的消息不会变成空白 —— 前台会留一行「这条被站长收走了」。
            </p>
          </div>
          <div className="q-admin-stat-actions">
            <span className="q-chat-adm__count">{openCount} 条待处理</span>
          </div>
        </div>

        <div className="q-chat-adm__tabs" role="tablist" aria-label="长亭后台分区">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reports'}
            className={tab === 'reports' ? 'is-on' : ''}
            onClick={() => setTab('reports')}
          >
            举报 {openCount > 0 ? <em>{openCount}</em> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'messages'}
            className={tab === 'messages' ? 'is-on' : ''}
            onClick={() => setTab('messages')}
          >
            最近消息
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rules'}
            className={tab === 'rules' ? 'is-on' : ''}
            onClick={() => setTab('rules')}
          >
            审核规则
          </button>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}
        {toast ? <p className="q-admin-saved">{toast}</p> : null}
        {loading && !reports ? <div className="q-admin-loading">正在读举报…</div> : null}

        {/* ——— ① 举报 ——— */}
        {tab === 'reports' ? (
          <>
            {reports && reports.length === 0 ? (
              <section className="q-admin-panel">
                <p className="q-admin-empty">还没有人举报过。这一页空着是好事。</p>
              </section>
            ) : null}

            {reports?.map((r) => (
              <section
                className={`q-admin-panel q-chat-adm${r.status === 'open' ? ' is-open' : ''}`}
                key={r.id}
              >
                <header className="q-chat-adm__head">
                  <span className={`q-chat-adm__badge is-${r.status}`}>
                    {r.status === 'open' ? '待处理' : r.status === 'handled' ? '已处理' : '已忽略'}
                  </span>
                  <span className="q-chat-adm__reason">{REASON_LABEL[r.reason] || r.reason}</span>
                  <span className="q-chat-adm__meta">
                    {r.reporter.name} 举报 · {timeAgo(r.ts)}
                  </span>
                </header>

                {r.message ? (
                  <>
                    <p className="q-chat-adm__quote">
                      {kindLabel(r.message.kind) || r.message.body || '（空消息）'}
                    </p>
                    <p className="q-chat-adm__from">
                      —— {r.message.authorName}
                      {r.message.status === 'deleted' ? '（已收走）' : ''}
                    </p>
                  </>
                ) : (
                  <p className="q-chat-adm__quote">这条消息已经不在了</p>
                )}

                {/*
                  模型复核。结论是落库的（判定要花钱，翻页回来不该重判），
                  所以这里有两种形态：判过就摆结论，没判过就摆按钮。
                  **它只是建议** —— 删和封仍然是下面那两个按钮。
                */}
                {r.ai ? (
                  <div className={`q-chat-adm__ai is-${adviseOf(r.ai.verdict, r.ai.score, threshold)}`}>
                    <div className="q-chat-adm__aihead">
                      <span className="q-chat-adm__aiv">
                        {VERDICT_LABEL[r.ai.verdict] || r.ai.verdict}
                      </span>
                      <span className="q-chat-adm__aiscore">{r.ai.score}%</span>
                      <b>{ADVISE_LABEL[adviseOf(r.ai.verdict, r.ai.score, threshold)]}</b>
                      <button
                        type="button"
                        className="q-chat-adm__cancel"
                        disabled={busy === `judge:${r.id}`}
                        onClick={() => void judge(r.id)}
                      >
                        {busy === `judge:${r.id}` ? '正在看…' : '重新判'}
                      </button>
                    </div>
                    {r.ai.note || r.ai.reasons.length > 0 ? (
                      <p className="q-chat-adm__ainote">
                        {r.ai.note}
                        {r.ai.reasons.length > 0 ? (
                          <span className="q-chat-adm__aitags">
                            {r.ai.reasons.map((x) => (
                              <em key={x}>{x}</em>
                            ))}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="q-chat-adm__aimeta">
                      {/*
                        没配真模型时，note 里那句「未调用真模型」已经说明白了，
                        这里只写 mock —— 两行都说一遍是啰嗦。
                      */}
                      {r.ai.model === 'mock' ? 'mock' : r.ai.model}
                      {' · '}
                      {timeAgo(r.ai.at)}
                      {' · 阈值 '}
                      {threshold}
                    </p>
                  </div>
                ) : r.message ? (
                  <div className="q-chat-adm__ai is-idle">
                    <span>还没让模型看过这条。</span>
                    <button
                      type="button"
                      className="q-admin-btn q-admin-btn--sm"
                      disabled={busy === `judge:${r.id}`}
                      onClick={() => void judge(r.id)}
                    >
                      {busy === `judge:${r.id}` ? '正在看…' : '交给 DeepSeek 看'}
                    </button>
                  </div>
                ) : null}

                <div className="q-chat-adm__acts">
                  {r.message && r.message.status !== 'deleted' ? (
                    <button
                      type="button"
                      className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                      disabled={busy === `del:${r.message.id}`}
                      onClick={() => confirmDelete(r.message!.id, '删掉这条？')}
                    >
                      删掉这条
                    </button>
                  ) : null}

                  {r.message && r.status === 'open' ? (
                    banFor === r.message.id ? (
                      <span className="q-chat-adm__banopts">
                        封 {r.message.authorName}：
                        {BAN_OPTIONS.map((o) => (
                          <button
                            key={o.minutes}
                            type="button"
                            className="q-admin-btn q-admin-btn--sm"
                            disabled={busy === `ban:${r.message!.authorId}`}
                            onClick={() => {
                              void ban(r.message!.authorId, o.minutes, o.label);
                              setBanFor(null);
                            }}
                          >
                            {o.label}
                          </button>
                        ))}
                        <button type="button" className="q-chat-adm__cancel" onClick={() => setBanFor(null)}>
                          算了
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="q-admin-btn q-admin-btn--sm"
                        onClick={() => setBanFor(r.message!.id)}
                      >
                        封禁作者
                      </button>
                    )
                  ) : null}

                  {r.status === 'open' ? (
                    <button
                      type="button"
                      className="q-admin-btn q-admin-btn--sm"
                      disabled={busy === `skip:${r.id}`}
                      onClick={() => void dismiss(r.id)}
                    >
                      忽略
                    </button>
                  ) : null}
                </div>
              </section>
            ))}

            <section className="q-admin-panel">
              <header className="q-chat-adm__head">
                <h2 className="q-chat-adm__h">正在封禁</h2>
                <span className="q-chat-adm__count">{bans.length} 人</span>
              </header>
              {bans.length === 0 ? (
                <p className="q-admin-empty">现在没有人被禁言。</p>
              ) : (
                <ul className="q-chat-adm__bans">
                  {bans.map((b) => (
                    <li key={b.accountId}>
                      <b>{b.name}</b>
                      <span>还剩 {Math.max(1, Math.ceil((b.until - Date.now()) / 60_000))} 分钟</span>
                      <span className="q-chat-adm__bansr">{b.reason || '—'}</span>
                      <button
                        type="button"
                        className="q-admin-btn q-admin-btn--sm"
                        disabled={busy === `unban:${b.accountId}`}
                        onClick={() => void unban(b.accountId)}
                      >
                        解封
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}

        {/* ——— ② 最近消息（巡查） ——— */}
        {tab === 'messages' ? (
          <section className="q-admin-panel">
            {msgs === null ? (
              <div className="q-admin-loading">正在读最近的消息…</div>
            ) : msgs.length === 0 ? (
              <p className="q-admin-empty">这间屋子还没有人说过话。</p>
            ) : (
              <ul className="q-chat-adm__list">
                {msgs.map((m) => (
                  <li key={m.id} className={m.status === 'pending' ? 'is-pending' : ''}>
                    <span className="q-chat-adm__t">{timeAgo(m.ts)}</span>
                    <span className="q-chat-adm__who">{m.authorName}</span>
                    <span className="q-chat-adm__bodytxt">{kindLabel(m.kind) || m.body || '（空）'}</span>
                    <span className="q-chat-adm__tags">
                      {m.status !== 'visible' ? (
                        <em className={`is-${m.status}`}>{STATUS_LABEL[m.status] || m.status}</em>
                      ) : null}
                      {m.reports > 0 ? <em className="is-report">{m.reports} 举报</em> : null}
                    </span>
                    <button
                      type="button"
                      className="q-admin-btn q-admin-btn--sm"
                      disabled={busy === `del:${m.id}`}
                      onClick={() => confirmDelete(m.id, '收走这条？')}
                    >
                      收走
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {msgsMore ? (
              <div className="q-chat-adm__more">
                <button
                  type="button"
                  className="q-admin-btn q-admin-btn--sm"
                  onClick={() => void loadMsgs(msgs?.[msgs.length - 1]?.id ?? 0)}
                >
                  再看早一些的
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ——— ③ 审核规则 ——— */}
        {tab === 'rules' ? (
          <section className="q-admin-panel">
            <header className="q-chat-adm__head">
              <h2 className="q-chat-adm__h">命中与误伤</h2>
              <span className="q-chat-adm__note">
                命中多不代表有问题；误伤多的那条，是清单该收窄的那条。
              </span>
            </header>
            <ul className="q-chat-adm__rules">
              {rules.map((r) => (
                <li key={r.id} className={r.hits === 0 ? 'is-idle' : ''}>
                  <b>{r.id}</b>
                  <span className="q-chat-adm__rule-note">{r.note}</span>
                  <span className="q-chat-adm__num">{r.hits} 次</span>
                  <span className={`q-chat-adm__num${r.hurt > 0 ? ' is-bad' : ''}`}>误伤 {r.hurt}</span>
                  <button
                    type="button"
                    className="q-admin-btn q-admin-btn--sm"
                    title="这条规则判错了：记一次误伤，方便回头看要不要收窄"
                    disabled={busy === `hurt:${r.id}`}
                    onClick={() => void hurt(r.id)}
                  >
                    误伤了
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
