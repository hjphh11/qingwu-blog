import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminTop from './AdminTop';

const API = '/api/admin';
const DRAFT_KEY = (id: number) => `q:admin:draft:${id}`;

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

  // —— 会话 ——
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
    setSending(true);
    setErr('');
    try {
      await api(`/comments/${openId}/reply`, { method: 'POST', body: JSON.stringify({ body: text }) });
      window.localStorage.removeItem(DRAFT_KEY(openId));
      setDraft('');
      const d = await api<Thread>(`/comments/${openId}`);
      setThread(d);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [load, openId, sending]);

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
        <div className="q-admin-top">
          <div className="q-admin-who">
            <img src="/images/emis/avatar.png" alt="" />
            <b>清吾</b>
          </div>
        </div>
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
                                  <h4>对话记录</h4>
                                  <div className="q-admin-bubble">
                                    <b>{it.author}</b>
                                    {it.body}
                                  </div>
                                  {thread?.replies?.length ? (
                                    thread.replies.map((r) => (
                                      <div className="q-admin-bubble q-admin-bubble--mine" key={r.id}>
                                        <b>
                                          {r.author} · {fmt(r.ts)}
                                        </b>
                                        {r.body}
                                      </div>
                                    ))
                                  ) : (
                                    <p className="q-admin-saved">还没有回复。</p>
                                  )}

                                  <div className="q-admin-reply">
                                    <textarea
                                      placeholder="写回复，或先打在草稿框里（会自动保存在本浏览器）"
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
                                        {sending ? '发送中…' : '发布回复'}
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
