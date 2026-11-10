import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminTop from './AdminTop';

const API = '/api/admin';
const DRAFT_KEY = (id: number) => `q:admin:draft:${id}`;
/** 后台回复的唯一署名，与 worker 的 AI_PERSONA_NAME 对应（只用于界面文案） */
const AI_PERSONA = '爱弥斯';

interface Item {
  id: number;
  author: string;
  body: string;
  path: string;
  status: string;
  ts: number;
  replies: number;
}

interface Thread {
  root: Item;
  replies: Item[];
}

/** judge 通道的单条体检结果 —— 只是建议，不改任何状态 */
interface JudgeResult {
  verdict: 'ok' | 'spam' | 'abuse' | 'privacy';
  score: number;
  reasons: string[];
  note: string;
  model: string;
  ms: number;
}

interface AiStatus {
  quota: number;
  writer: { on: boolean; model?: string; used?: number | null };
  judge: { on: boolean; model?: string; used?: number | null };
}

const JUDGE_LABEL: Record<JudgeResult['verdict'], string> = {
  ok: '看着正常',
  spam: '疑似广告',
  abuse: '疑似辱骂',
  privacy: '疑似泄露隐私',
};

const STATUS_LABEL: Record<string, string> = {
  visible: '已通过',
  pending: '待审核',
  spam: '垃圾',
  deleted: '已删除',
};
const STATUS_CLASS: Record<string, string> = {
  visible: 'q-admin-tag q-admin-tag--ok',
  pending: 'q-admin-tag q-admin-tag--warn',
  spam: 'q-admin-tag q-admin-tag--danger',
  deleted: 'q-admin-tag q-admin-tag--muted',
};

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'visible', label: '已通过' },
  { key: 'spam', label: '垃圾' },
];

function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

export default function AdminInbox() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // —— AI（双通道）——
  // ai 为 null = 还没问出来；能拿到就说明接口活着，按 on 决定显示哪些按钮。
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiBusy, setAiBusy] = useState<'' | 'draft' | 'polish' | 'judge'>('');
  const [aiErr, setAiErr] = useState('');
  /** 等待期间站长自己又打了字 → AI 结果先停在这里，点「替换」才覆盖 */
  const [aiSug, setAiSug] = useState('');
  const [judged, setJudged] = useState<Record<number, JudgeResult>>({});

  // —— 会话 ——
  useEffect(() => {
    (async () => {
      try {
        await api<{ username: string }>('/session');
        setReady(true);
        // AI 状态拉不到不影响后台本身（没配 key 时就是 503）
        void api<AiStatus>('/ai/status')
          .then(setAi)
          .catch(() => setAi(null));
      } catch {
        /* api() 已经跳转了 */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<{
        items: Item[];
        total: number;
        page: number;
        pages: number;
        counts: Record<string, number>;
      }>(`/comments?status=${encodeURIComponent(tab)}&q=${encodeURIComponent(q)}&page=${page}`);
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
      setPages(d.pages ?? 1);
      setCounts(d.counts ?? {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, q, tab]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // 搜索防抖
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1);
      setQ(qInput.trim());
    }, 320);
    return () => window.clearTimeout(t);
  }, [qInput]);

  // —— 展开楼层 ——
  const toggle = useCallback(
    async (id: number) => {
      if (openId === id) {
        setOpenId(null);
        setThread(null);
        return;
      }
      setOpenId(id);
      setThread(null);
      setThreadLoading(true);
      setDraft(window.localStorage.getItem(DRAFT_KEY(id)) || '');
      setAiSug('');
      setAiErr('');
      try {
        const d = await api<Thread>(`/comments/${id}`);
        setThread(d);
      } catch (e) {
        setErr(e instanceof Error ? e.message : '读取对话失败');
      } finally {
        setThreadLoading(false);
      }
    },
    [openId],
  );

  // 草稿本地留存：发送成功才清掉
  const onDraft = useCallback(
    (id: number, v: string) => {
      setDraft(v);
      if (v) window.localStorage.setItem(DRAFT_KEY(id), v);
      else window.localStorage.removeItem(DRAFT_KEY(id));
    },
    [],
  );

  const sendReply = useCallback(async () => {
    if (openId == null || sending) return;
    const text = draftRef.current.trim();
    if (!text) return;
    const id = openId;
    setSending(true);
    setErr('');
    try {
      // 后台出去的话一律是爱弥斯说的 —— 署名由 worker 决定，前端不传身份。
      await api(`/comments/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: text }) });
      window.localStorage.removeItem(DRAFT_KEY(id));
      setDraft('');
      setAiSug('');
      const d = await api<Thread>(`/comments/${id}`);
      setThread(d);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [load, openId, sending]);

  // —— AI 起草 / 润色 ——
  // 关键点：AI 只往草稿框里写，**永远不替我们发布**。
  // 另外，等待期间如果站长自己又敲了字，就不覆盖他的输入，把 AI 版本挂到 aiSug 上等他决定。
  const runAi = useCallback(
    async (mode: 'draft' | 'polish') => {
      if (openId == null || aiBusy) return;
      const base = draftRef.current;
      if (mode === 'polish' && !base.trim()) return;

      setAiBusy(mode);
      setAiErr('');
      setAiSug('');
      try {
        const d = await api<{ text: string }>('/ai/draft', {
          method: 'POST',
          body: JSON.stringify({ id: openId, mode, text: mode === 'polish' ? base : undefined }),
        });
        if (draftRef.current.trim() === base.trim()) {
          onDraft(openId, d.text);
        } else {
          setAiSug(d.text);
        }
      } catch (e) {
        setAiErr(e instanceof Error ? e.message : 'AI 请求失败');
      } finally {
        setAiBusy('');
      }
    },
    [aiBusy, onDraft, openId],
  );

  // —— AI 体检（judge 通道，只给建议）——
  const runJudge = useCallback(async () => {
    if (openId == null || aiBusy) return;
    setAiBusy('judge');
    setAiErr('');
    try {
      const d = await api<JudgeResult>('/ai/judge', {
        method: 'POST',
        body: JSON.stringify({ id: openId }),
      });
      setJudged((prev) => ({ ...prev, [openId]: d }));
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'AI 判断失败');
    } finally {
      setAiBusy('');
    }
  }, [aiBusy, openId]);

  const adoptSug = useCallback(() => {
    if (openId == null || !aiSug) return;
    onDraft(openId, aiSug);
    setAiSug('');
  }, [aiSug, onDraft, openId]);

  const setStatus = useCallback(
    async (id: number, status: string) => {
      try {
        await api(`/comments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        void load();
        if (openId === id) {
          const d = await api<Thread>(`/comments/${id}`);
          setThread(d);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '修改失败');
      }
    },
    [load, openId],
  );

  const tabCount = useMemo(
    () => (key: string) => (key === 'all' ? counts.all ?? 0 : counts[key] ?? 0),
    [counts],
  );

  if (!ready) {
    return (
      <>
        <AdminTop active="comments" />
        <div className="q-admin-loading">正在确认身份…</div>
      </>
    );
  }

  return (
    <>
      <AdminTop active="comments" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>评论收件箱</h1>
            <p>
              {total} 条 · 默认按时间倒序 · 回复会立刻出现在前台对应页面
            </p>
          </div>
          {/* 右侧这一行照他：页序 + 刷新，全是灰字，不占按钮的视觉重量 */}
          <div className="q-admin-head__meta">
            <span>
              {page} / {pages} 页
            </span>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '刷新中…' : '刷新评论'}
            </button>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}

        <section className="q-admin-panel">
          <div className="q-admin-filters">
            <div className="q-admin-seg" role="group" aria-label="审核状态">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
                  }}
                >
                  {t.label}
                  <span className="n">{tabCount(t.key)}</span>
                </button>
              ))}
            </div>

            <input
              className="q-admin-search"
              type="search"
              placeholder="搜昵称或留言内容…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="q-admin-loading">加载中…</div>
          ) : items.length === 0 ? (
            <div className="q-admin-empty">
              <b>这里空着</b>
              {q ? '换个关键词试试。' : '没有符合当前筛选的留言。'}
            </div>
          ) : (
            <table className="q-admin-table">
              <thead>
                <tr>
                  <th style={{ width: '17%' }}>访客 / 时间</th>
                  <th>留言内容 / 页面</th>
                  <th style={{ width: '9%' }}>审核</th>
                  <th style={{ width: '9%' }}>回复</th>
                  <th style={{ width: '18%' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const open = openId === it.id;
                  const jr = judged[it.id];
                  return (
                    <Fragment key={it.id}>
                      <tr>
                        <td className="q-admin-who-cell">
                          <b>{it.author}</b>
                          <span>
                            #{it.id} · {fmt(it.ts)}
                          </span>
                        </td>
                        <td className="q-admin-body-cell">
                          <p>{it.body}</p>
                          <em>{it.path}</em>
                        </td>
                        <td>
                          <span className={STATUS_CLASS[it.status] || STATUS_CLASS.deleted}>
                            {STATUS_LABEL[it.status] || it.status}
                          </span>
                        </td>
                        <td>
                          {it.replies > 0 ? (
                            <span className="q-admin-tag q-admin-tag--ok">{it.replies} 条</span>
                          ) : (
                            <span className="q-admin-tag q-admin-tag--muted">未回复</span>
                          )}
                        </td>
                        <td>
                          <div className="q-admin-row-actions">
                            <button
                              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                              type="button"
                              onClick={() => void toggle(it.id)}
                            >
                              {open ? '收起' : '回复 / 查看'}
                            </button>
                            {it.status !== 'visible' ? (
                              <button
                                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                type="button"
                                onClick={() => void setStatus(it.id, 'visible')}
                              >
                                通过
                              </button>
                            ) : (
                              <button
                                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                type="button"
                                onClick={() => void setStatus(it.id, 'pending')}
                              >
                                转待审
                              </button>
                            )}
                            {it.status !== 'spam' ? (
                              <button
                                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                type="button"
                                onClick={() => void setStatus(it.id, 'spam')}
                              >
                                标垃圾
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>

                      {open ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 0 }}>
                            <div className="q-admin-thread">
                              {threadLoading ? (
                                <div className="q-admin-loading">读取对话…</div>
                              ) : (
                                <>
                                  {jr ? (
                                    <div className={`q-admin-judge q-admin-judge--${jr.verdict}`}>
                                      <div className="q-admin-judge__head">
                                        <b>{JUDGE_LABEL[jr.verdict]}</b>
                                        <span className="q-admin-judge__score">{jr.score}</span>
                                        <span className="q-admin-judge__meta">
                                          {jr.ms}ms · {jr.model}
                                        </span>
                                      </div>
                                      {jr.note ? <p>{jr.note}</p> : null}
                                      {jr.reasons.length ? <em>{jr.reasons.join(' · ')}</em> : null}
                                    </div>
                                  ) : null}
                                  <h4>对话记录</h4>
                                  <div className="q-admin-bubble">
                                    <b>{it.author}</b>
                                    {it.body}
                                  </div>
                                  {thread?.replies?.length ? (
                                    thread.replies.map((r) => (
                                      <div className="q-admin-bubble q-admin-bubble--mine" key={r.id}>
                                        <b>
                                          {r.author}
                                          {r.author === AI_PERSONA ? (
                                            <em className="q-admin-ai-tag">AI</em>
                                          ) : null}
                                          <span className="q-admin-bubble__ts"> · {fmt(r.ts)}</span>
                                        </b>
                                        {r.body}
                                      </div>
                                    ))
                                  ) : (
                                    <p className="q-admin-saved">还没有回复。</p>
                                  )}

                                  <div className="q-admin-reply">
                                    {ai && (ai.writer.on || ai.judge.on) ? (
                                      <div className="q-admin-ai">
                                        {ai.writer.on ? (
                                          <>
                                            <button
                                              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                              type="button"
                                              disabled={!!aiBusy}
                                              onClick={() => void runAi('draft')}
                                            >
                                              {aiBusy === 'draft' ? '生成中…' : 'AI 起草'}
                                            </button>
                                            <button
                                              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                              type="button"
                                              disabled={!!aiBusy || !draft.trim()}
                                              onClick={() => void runAi('polish')}
                                            >
                                              {aiBusy === 'polish' ? '润色中…' : '润色'}
                                            </button>
                                          </>
                                        ) : null}
                                        {ai.judge.on ? (
                                          <button
                                            className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                            type="button"
                                            disabled={!!aiBusy}
                                            onClick={() => void runJudge()}
                                          >
                                            {aiBusy === 'judge' ? '判断中…' : 'AI 体检'}
                                          </button>
                                        ) : null}
                                        <span className="q-admin-ai__note">
                                          {aiBusy
                                            ? '模型正在想…'
                                            : `今天已用 ${(ai.writer.used ?? 0) + (ai.judge.used ?? 0)} / ${ai.quota} 次`}
                                        </span>
                                      </div>
                                    ) : null}

                                    {aiSug ? (
                                      <div className="q-admin-ai__sug">
                                        <span>你刚才自己改过草稿，AI 的版本先没覆盖：</span>
                                        <i>{aiSug}</i>
                                        <div>
                                          <button
                                            className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                            type="button"
                                            onClick={adoptSug}
                                          >
                                            用它替换
                                          </button>
                                          <button
                                            className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                                            type="button"
                                            onClick={() => setAiSug('')}
                                          >
                                            丢掉
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}

                                    {aiErr ? <p className="q-admin-error">{aiErr}</p> : null}

                                    <textarea
                                      placeholder={`${AI_PERSONA}要说什么？AI 起草的稿子会落进这个框，发之前随便改`}
                                      value={draft}
                                      onChange={(e) => onDraft(it.id, e.target.value)}
                                      maxLength={500}
                                    />
                                    <div className="q-admin-reply-bar">
                                      <button
                                        className="q-admin-btn q-admin-btn--primary"
                                        type="button"
                                        style={{ width: 'auto', height: 34, fontSize: 12.5 }}
                                        disabled={sending || !draft.trim()}
                                        onClick={() => void sendReply()}
                                      >
                                        {sending ? '发送中…' : `以${AI_PERSONA}发布`}
                                      </button>
                                      <span className="q-admin-saved">草稿已保存在本浏览器</span>
                                      <span className="count">
                                        {draft.length} / 500
                                      </span>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {pages > 1 ? (
            <div className="q-admin-pager">
              <button
                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span>
                {page} / {pages}
              </span>
              <button
                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                type="button"
                disabled={page >= pages || loading}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}
