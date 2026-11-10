/*
 * 后台 · 友链与回链
 *
 * 三个 tab 覆盖两件事：
 *   apply     申请审核 —— 改的是 D1 的 applications
 *   links     已收录   —— 改的是仓库里的 src/data/links.json
 *   backlink  回链检查 —— 改的是 D1 的 backlink_checks
 *
 * ⚠️ 两个 tab 的「生效」含义完全不同，界面必须让人看出来：
 *   apply 点一下就生效（D1 立刻变）
 *   links 要点「提交」→ 写 GitHub → 服务器 pull+build 才生效（约 40 秒）
 * 所以 links 走「草稿 + 一次提交」，和申请审核的即时操作在视觉上分开。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminTop from './AdminTop';

const API = '/api/admin';

interface AppItem {
  id: number;
  name: string;
  url: string;
  avatar: string;
  intro: string;
  shot: string;
  email: string;
  status: string;
  reason: string | null;
  submittedAt: number;
  reviewedAt: number | null;
}

interface Friend {
  name: string;
  avatar: string;
  intro: string;
  url: string;
  visible?: boolean;
  addedAt?: string;
  shot?: string;
}

interface Check {
  ok: boolean;
  status: number | null;
  matched: string | null;
  error: string | null;
  checked_at: number;
}

interface FriendFlag {
  state: string;
  note: string | null;
  until: number | null;
  updated_at: number;
}

/** 展示状态的中文名。天数是后端定的（失联 30 / 整改 7），这里只负责怎么读。 */
const STATUS_LABEL: Record<string, string> = {
  normal: '正常',
  unstable: '短暂失联',
  violation: '违规整改',
};

/** AI 起草的回信草稿 —— 只是草稿，站长点「发送邮件」才真的出去 */
interface Letter {
  id: number;
  intent: 'found' | 'missing' | 'unreachable';
  evidence: string;
  hasEmail: boolean;
  subject: string;
  body: string;
}

const INTENT_LABEL: Record<Letter['intent'], string> = {
  found: '对方已经加了本站',
  missing: '没找到本站友链',
  unreachable: '对方站点打不开',
};

interface Overview {
  ok: boolean;
  applications: AppItem[];
  counts: { pending: number; approved: number; rejected: number; total: number };
  links: Friend[];
  sha: string | null;
  linksError: string | null;
  writable: boolean;
  checks: Record<string, Check>;
  statuses: Record<string, FriendFlag>;
}

const TABS = [
  { key: 'apply', label: '申请审核' },
  { key: 'links', label: '已收录' },
  { key: 'backlink', label: '回链检查' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const APP_TAG: Record<string, string> = {
  pending: 'q-admin-tag q-admin-tag--warn',
  approved: 'q-admin-tag q-admin-tag--ok',
  rejected: 'q-admin-tag q-admin-tag--danger',
};
const APP_LABEL: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function today(): string {
  return fmtDate(Date.now());
}
function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
/**
 * 回链「发现于」显示路径而不是域名 —— 同一站点的域名栏已经写过了，
 * 站长真正想知道的是「他把我挂在哪个页面」，比如 /links/ 还是 /about/。
 */
function matchedLabel(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, '');
    return p === '' ? '首页' : p;
  } catch {
    return url;
  }
}
/** 与后端 normUrl 逐字对齐：补协议、去尾斜杠、小写主机名、协议统一成 https。回链结果按这个 key 索引。 */
function normUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    u.hash = '';
    u.search = '';
    return `https://${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
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
  const d = (await r.json().catch(() => ({}))) as T & { message?: string; reason?: string };
  if (!r.ok && r.status !== 409) throw new Error(d?.message || `HTTP ${r.status}`);
  return d;
}

export default function AdminFriends() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<TabKey>('apply');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  // —— links.json 的编辑副本 ——
  const [draft, setDraft] = useState<Friend[]>([]);
  const [sha, setSha] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualText, setManualText] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  // —— 申请详情 ——
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // —— 友链申请：探测 + AI 起草回信 ——
  // aiWriter 只决定按钮显不显示（没配 key 时接口 503，先把入口藏掉）。
  const [aiWriter, setAiWriter] = useState(false);
  const [letterBusy, setLetterBusy] = useState<number | null>(null);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [mailSending, setMailSending] = useState(false);

  // —— 回链 ——
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // —— 展示状态（短暂失联 / 违规整改）——
  // 菜单的键用 normUrl(URL) 而不是下标：列表能拖拽改序，用下标会错行。
  const [statusMenu, setStatusMenu] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const original = useMemo(() => JSON.stringify(data?.links ?? []), [data]);
  const dirty = useMemo(() => JSON.stringify(draft) !== original, [draft, original]);

  useEffect(() => {
    (async () => {
      try {
        await api<{ username: string }>('/session');
        setReady(true);
        void api<{ writer: { on: boolean } }>('/ai/status')
          .then((s) => setAiWriter(Boolean(s?.writer?.on)))
          .catch(() => setAiWriter(false));
      } catch {
        /* api() 已跳转 */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const d = await api<Overview>('/friends');
      setData(d);
      setDraft(d.links ?? []);
      setSha(d.sha);
      if (d.linksError) setErr(`读 links.json 失败：${d.linksError}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // ———————————————— 申请审核 ————————————————
  const pending = useMemo(() => (data?.applications ?? []).filter((a) => a.status === 'pending'), [data]);
  const handled = useMemo(() => (data?.applications ?? []).filter((a) => a.status !== 'pending'), [data]);

  const patchApp = useCallback(
    async (id: number, status: string, reason?: string) => {
      setErr('');
      try {
        await api(`/friends/apply/${id}`, { method: 'POST', body: JSON.stringify({ status, reason }) });
        setData((prev) =>
          prev
            ? {
                ...prev,
                applications: prev.applications.map((a) =>
                  a.id === id
                    ? { ...a, status, reason: status === 'rejected' ? reason ?? null : null, reviewedAt: Date.now() }
                    : a,
                ),
                counts: prev.counts,
              }
            : prev,
        );
        setNotice(`申请 #${id} 已改为「${APP_LABEL[status] ?? status}」`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : '操作失败');
      }
    },
    [],
  );

  /**
   * 设「展示状态」：正常 / 短暂失联 / 违规整改。
   *
   * 这个状态**不进 links.json**，写 D1 的 `friend_status`（见 0014_friends.sql）：
   * 内容归仓库，随时间变的观察值归库。前台友链墙靠 `GET /link-status` 读它，
   * 到 `until` 那一刻自动把那张卡从墙上摘掉。
   *
   * 天数（30 / 7）由后端定，这里不传 —— 传了就变成两处各写一份规则。
   * `note` 带回去只是别覆盖站长之前写的那句说明（接口空着会当清空处理）。
   */
  const setFlag = useCallback(
    async (url: string, state: 'normal' | 'unstable' | 'violation', keepNote?: string | null) => {
      setErr('');
      setStatusBusy(true);
      try {
        const r = await api<{ ok: boolean; state: string; until: number | null }>('/friends/status', {
          method: 'POST',
          body: JSON.stringify({ url, state, note: keepNote ?? undefined }),
        });
        const key = normUrl(url);
        setData((prev) =>
          prev
            ? {
                ...prev,
                statuses: {
                  ...prev.statuses,
                  [key]: {
                    state: r.state,
                    note: state === 'normal' ? null : (keepNote ?? null),
                    until: r.until,
                    updated_at: Date.now(),
                  },
                },
              }
            : prev,
        );
        setStatusMenu(null);
        setNotice(
          state === 'normal'
            ? '已恢复为「正常」，前台照常展示'
            : `已标记「${STATUS_LABEL[state]}」，到期后前台自动下架`,
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : '设置失败');
      } finally {
        setStatusBusy(false);
      }
    },
    [],
  );

  /** 探测对方站点 + 让 AI 起草回信。**不会自己发出去**，正文仍要人看一眼。 */
  const draftLetter = useCallback(async (app: AppItem) => {
    setErr('');
    setLetterBusy(app.id);
    setLetter(null);
    try {
      const d = await api<{
        intent: Letter['intent'];
        evidence: string;
        hasEmail: boolean;
        subject: string;
        body: string;
      }>('/ai/friend-reply', { method: 'POST', body: JSON.stringify({ id: app.id }) });
      setLetter({
        id: app.id,
        intent: d.intent,
        evidence: d.evidence,
        hasEmail: d.hasEmail,
        subject: d.subject,
        body: d.body,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '探测失败');
    } finally {
      setLetterBusy(null);
    }
  }, []);

  const sendLetter = useCallback(async () => {
    if (!letter || mailSending) return;
    setErr('');
    setMailSending(true);
    try {
      const d = await api<{ sent: boolean }>(`/friends/applications/${letter.id}/mail`, {
        method: 'POST',
        body: JSON.stringify({ subject: letter.subject, text: letter.body }),
      });
      setNotice(d.sent ? `回信已发到申请人邮箱` : '没直接发出去，已进待发队列，稍后自动补发');
      setLetter(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发送失败');
    } finally {
      setMailSending(false);
    }
  }, [letter, mailSending]);

  /** 通过 + 顺手放进待提交的友链草稿（两步合一，但仍要点「提交」才进仓库） */
  const adopt = useCallback(
    async (app: AppItem) => {
      if (!draft.some((f) => normUrl(f.url) === normUrl(app.url))) {
        const next: Friend = {
          name: app.name,
          avatar: app.avatar,
          intro: app.intro,
          url: app.url,
          visible: true,
          addedAt: today(),
        };
        if (app.shot) next.shot = app.shot;
        setDraft((d) => [...d, next]);
      }
      await patchApp(app.id, 'approved');
      setTab('links');
      setNotice(`已把「${app.name}」加入草稿，确认资料后点右上「提交」才会写进仓库`);
    },
    [draft, patchApp],
  );

  // ———————————————— links.json 编辑 ————————————————
  const setField = useCallback((i: number, key: keyof Friend, value: string | boolean) => {
    setDraft((d) => d.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  }, []);

  const move = useCallback((from: number, to: number) => {
    setDraft((d) => {
      if (from === to || from < 0 || to < 0 || from >= d.length || to >= d.length) return d;
      const next = d.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const removeAt = useCallback((i: number) => {
    setDraft((d) => d.filter((_, idx) => idx !== i));
    setEditIdx(null);
  }, []);

  const submitLinks = useCallback(async () => {
    setSaving(true);
    setErr('');
    setManualText('');
    try {
      const r = await api<{
        ok: boolean;
        reason?: string;
        message?: string;
        commit?: string;
        text?: string;
        friends?: Friend[];
      }>('/friends/links', {
        method: 'POST',
        body: JSON.stringify({ friends: draft, sha }),
      });
      if (r.ok) {
        setNotice(r.message || '已提交');
        setTab('links');
        await load();
      } else if (r.reason === 'manual') {
        setManualText(r.text || JSON.stringify({ friends: draft }, null, 2));
        setErr(r.message || '需要手动更新');
      } else {
        setErr(r.message || '提交失败');
        if (r.reason === 'conflict') await load();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSaving(false);
    }
  }, [draft, sha, load]);

  // ———————————————— 回链 ————————————————
  /**
   * 单个链接单发一次请求，前端控 3 路并发。
   * 为什么不一次把 14 个站全发给后端：最坏情况单站要抓 3 个页面 × 6s ≈ 18s，
   * 14 个串行会超过 nginx 的 60s 读超时，前端只会看到一个 502。
   */
  const recheck = useCallback(
    async (urls: string[]) => {
      if (urls.length === 0) return;
      setChecking(true);
      setProgress({ done: 0, total: urls.length });
      setErr('');
      const CONCURRENCY = 3;
      let cursor = 0;
      let done = 0;

      async function worker() {
        while (cursor < urls.length) {
          const u = urls[cursor++];
          try {
            await api('/friends/backlinks', { method: 'POST', body: JSON.stringify({ urls: [u] }) });
          } catch {
            /* 单个站点失败不该中断整批；后端已把失败原因写进 backlink_checks */
          }
          done++;
          setProgress({ done, total: urls.length });
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
      setChecking(false);
      setProgress(null);
      await load();
      setNotice(`回链检查完成，共 ${urls.length} 个站`);
    },
    [load],
  );

  const links = draft;
  const checkOf = useCallback(
    (url: string): Check | undefined => data?.checks?.[normUrl(url)] ?? data?.checks?.[url],
    [data],
  );

  if (!ready) {
    return (
      <>
        <AdminTop active="friends" />
        <main className="q-admin-main">
          <div className="q-admin-loading">正在校验会话…</div>
        </main>
      </>
    );
  }

  const badChecks = (data?.links ?? []).filter((f) => {
    const c = data?.checks?.[normUrl(f.url)];
    return c && !c.ok;
  }).length;

  return (
    <>
      <AdminTop active="friends" />

      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>友链与回链</h1>
            <p>
              待审 {data?.counts.pending ?? 0} 条 · 已收录 {data?.links.length ?? 0} 个 ·{' '}
              {badChecks > 0 ? `${badChecks} 个回链有问题` : '回链暂未发现问题'}
            </p>
          </div>
          {dirty ? (
            <div className="q-admin-savebar">
              <span>有未提交的改动</span>
              <button
                className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                type="button"
                onClick={() => setDraft(data?.links ?? [])}
                disabled={saving}
              >
                撤销
              </button>
              <button
                className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                type="button"
                onClick={() => void submitLinks()}
                disabled={saving}
              >
                {saving ? '提交中…' : '提交到仓库'}
              </button>
            </div>
          ) : null}
        </div>

        {notice ? (
          <p className="q-admin-saved" onClick={() => setNotice('')}>
            {notice}
          </p>
        ) : null}
        {err ? <p className="q-admin-error">{err}</p> : null}

        <div className="q-admin-tabs q-admin-tabs--page" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              className="q-admin-tab"
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'apply' && data?.counts.pending ? (
                <span className="n">{data.counts.pending}</span>
              ) : null}
              {t.key === 'links' ? <span className="n">{links.length}</span> : null}
              {t.key === 'backlink' && badChecks > 0 ? <span className="n">{badChecks}</span> : null}
            </button>
          ))}
        </div>

        {loading && !data ? <div className="q-admin-loading">加载中…</div> : null}

        {/* ———————————— 申请审核 ———————————— */}
        {tab === 'apply' && data ? (
          <section className="q-admin-panel">
            <div className="q-admin-filters">
              <b style={{ fontSize: 13 }}>
                待处理 {pending.length} 条
                <span className="q-admin-hint" style={{ marginLeft: 8 }}>
                  通过只代表「同意收录」，要不要真加进友链还得在「已收录」里提交
                </span>
              </b>
            </div>

            {pending.length === 0 ? (
              <div className="q-admin-empty">
                <b>没有待审的申请</b>
                有新的会出现在这里。
              </div>
            ) : (
              <div className="q-admin-cards">
                {pending.map((a) => (
                  <article key={a.id} className="q-admin-card">
                    <header>
                      <img className="q-admin-avatar" src={a.avatar || '/images/emis/avatar.png'} alt="" />
                      <div>
                        <b>{a.name}</b>
                        <a href={a.url} target="_blank" rel="noreferrer noopener">
                          {hostOf(a.url)}
                        </a>
                      </div>
                    </header>
                    <p>{a.intro || <em className="q-admin-hint">没填简介</em>}</p>
                    <dl>
                      <div>
                        <dt>申请</dt>
                        <dd>{fmtTime(a.submittedAt)}</dd>
                      </div>
                      <div>
                        <dt>邮箱</dt>
                        <dd>{a.email || '—'}</dd>
                      </div>
                    </dl>
                    {a.shot ? (
                      <a className="q-admin-shot" href={a.shot} target="_blank" rel="noreferrer noopener">
                        看对方站点截图
                      </a>
                    ) : null}
                    <footer>
                      {aiWriter ? (
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          disabled={letterBusy === a.id}
                          onClick={() => void draftLetter(a)}
                        >
                          {letterBusy === a.id ? '正在探测…' : '探测并起草回信'}
                        </button>
                      ) : null}
                      <button
                        className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                        type="button"
                        onClick={() => void adopt(a)}
                      >
                        通过并收录
                      </button>
                      <button
                        className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                        type="button"
                        onClick={() => {
                          setRejecting(a.id);
                          setRejectReason('');
                        }}
                      >
                        拒绝
                      </button>
                    </footer>
                    {rejecting === a.id ? (
                      <div className="q-admin-reject">
                        <input
                          className="q-admin-search"
                          placeholder="拒绝理由（会记录，不超过 200 字）"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          autoFocus
                        />
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => setRejecting(null)}
                        >
                          取消
                        </button>
                        <button
                          className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                          type="button"
                          onClick={() => {
                            void patchApp(a.id, 'rejected', rejectReason);
                            setRejecting(null);
                          }}
                        >
                          确认拒绝
                        </button>
                      </div>
                    ) : null}

                    {letter?.id === a.id ? (
                      <div className="q-admin-letter">
                        <div className="q-admin-letter__head">
                          <b className={`q-admin-letter__tag q-admin-letter__tag--${letter.intent}`}>
                            {INTENT_LABEL[letter.intent]}
                          </b>
                          <em title={letter.evidence}>{letter.evidence}</em>
                        </div>
                        <input
                          className="q-admin-search"
                          placeholder="邮件标题"
                          value={letter.subject}
                          onChange={(e) => setLetter({ ...letter, subject: e.target.value })}
                        />
                        <textarea
                          placeholder="回信正文（AI 起草，改完再发）"
                          value={letter.body}
                          onChange={(e) => setLetter({ ...letter, body: e.target.value })}
                        />
                        <div className="q-admin-letter__bar">
                          <button
                            className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                            type="button"
                            disabled={mailSending || !letter.hasEmail || !letter.subject.trim() || !letter.body.trim()}
                            onClick={() => void sendLetter()}
                          >
                            {mailSending ? '发送中…' : '发送邮件'}
                          </button>
                          <button
                            className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                            type="button"
                            onClick={() => setLetter(null)}
                          >
                            收起
                          </button>
                          <span className="q-admin-saved">
                            {letter.hasEmail ? `发到 ${a.email}` : '这条申请没留邮箱，只能看不能发'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}

            {handled.length > 0 ? (
              <details className="q-admin-handled">
                <summary>已处理 {handled.length} 条</summary>
                <table className="q-admin-table">
                  <tbody>
                    {handled.map((a) => (
                      <tr key={a.id}>
                        <td className="q-admin-who-cell">
                          <b>{a.name}</b>
                          <span>{hostOf(a.url)}</span>
                        </td>
                        <td>
                          <span className={APP_TAG[a.status] || 'q-admin-tag'}>
                            {APP_LABEL[a.status] || a.status}
                          </span>
                        </td>
                        <td className="q-admin-body-cell">
                          <em>
                            {a.reviewedAt ? fmtTime(a.reviewedAt) : '—'}
                            {a.reason ? ` · ${a.reason}` : ''}
                          </em>
                        </td>
                        <td>
                          <div className="q-admin-row-actions">
                            <button
                              className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                              type="button"
                              onClick={() => void patchApp(a.id, 'pending')}
                            >
                              退回待审
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </section>
        ) : null}

        {/* ———————————— 已收录（改 links.json 草稿） ———————————— */}
        {tab === 'links' ? (
          <section className="q-admin-panel">
            <div className="q-admin-filters">
              <b style={{ fontSize: 13 }}>
                {links.length} 个友链
                <span className="q-admin-hint" style={{ marginLeft: 8 }}>
                  拖动左侧把手排序 · 改完点右上「提交到仓库」才会生效
                </span>
              </b>
              {data?.writable ? (
                <span className="q-admin-tag q-admin-tag--ok q-admin-push">已接入 GitHub 直写</span>
              ) : (
                <span className="q-admin-tag q-admin-tag--warn q-admin-push">
                  未配置 GITHUB_TOKEN · 提交会给一份 JSON 手动更新
                </span>
              )}
            </div>

            {links.length === 0 ? (
              <div className="q-admin-empty">
                <b>还没有友链</b>
                去「申请审核」里通过一条试试。
              </div>
            ) : (
              <ul className="q-admin-linklist">
                {links.map((f, i) => {
                  const c = checkOf(f.url);
                  const urlKey = normUrl(f.url);
                  const flag = data?.statuses?.[urlKey];
                  const expired = flag?.until ? flag.until < Date.now() : false;
                  return (
                    <li
                      key={`${urlKey}-${i}`}
                      className={f.visible === false ? 'is-hidden' : undefined}
                      draggable
                      onDragStart={() => {
                        dragFrom.current = i;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragFrom.current;
                        dragFrom.current = null;
                        if (from !== null) move(from, i);
                      }}
                    >
                      <span className="q-admin-grip" aria-hidden="true">
                        ⠿
                      </span>
                      <img className="q-admin-avatar" src={f.avatar || '/images/emis/avatar.png'} alt="" />
                      <div className="q-admin-linkmeta">
                        <b>{f.name}</b>
                        <a href={f.url} target="_blank" rel="noreferrer noopener">
                          {hostOf(f.url)}
                        </a>
                        <em>{f.intro}</em>
                      </div>
                      <div className="q-admin-linkflags">
                        {c ? (
                          c.ok ? (
                            <span className="q-admin-tag q-admin-tag--ok">回链正常</span>
                          ) : (
                            <span className="q-admin-tag q-admin-tag--danger" title={c.error || ''}>
                              {c.status && c.status >= 400 ? `HTTP ${c.status}` : '无回链'}
                            </span>
                          )
                        ) : (
                          <span className="q-admin-tag q-admin-tag--muted">未检查</span>
                        )}
                        {flag && flag.state !== 'normal' ? (
                          <span className={`q-admin-tag ${expired ? 'q-admin-tag--muted' : 'q-admin-tag--warn'}`}>
                            {flag.state === 'violation' ? '违规整改' : '短暂失联'}
                            {flag.until ? ` · ${expired ? '已到期' : `${fmtDate(flag.until)} 到期`}` : ''}
                          </span>
                        ) : null}
                      </div>
                      <div className="q-admin-row-actions">
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => setField(i, 'visible', f.visible === false)}
                          title="只影响草稿，提交后才生效"
                        >
                          {f.visible === false ? '隐藏中' : '展示中'}
                        </button>
                        {/* 展示状态是**即时生效**的（写 D1），和上面那个「展示中」不是一回事：
                            那个改的是 links.json 草稿、要提交+构建；这个点完前台就到。
                            两个按钮排在一起容易被当成同一件事，所以 title 里把差别写明。 */}
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => setStatusMenu(statusMenu === urlKey ? null : urlKey)}
                          title="失联缓冲 / 违规整改 —— 立即生效，前台会挂标记，到期自动下架"
                        >
                          {statusMenu === urlKey ? '收起' : '状态'}
                        </button>
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => setEditIdx(editIdx === i ? null : i)}
                        >
                          {editIdx === i ? '收起' : '编辑'}
                        </button>
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          onClick={() => removeAt(i)}
                        >
                          移除
                        </button>
                      </div>

                      {statusMenu === urlKey ? (
                        <div className="q-admin-statusrow">
                          <span>展示状态</span>
                          <button
                            type="button"
                            disabled={statusBusy}
                            onClick={() => void setFlag(f.url, 'normal', flag?.note)}
                          >
                            正常
                          </button>
                          <button
                            type="button"
                            disabled={statusBusy}
                            onClick={() => void setFlag(f.url, 'unstable', flag?.note)}
                          >
                            短暂失联 · 30 天缓冲
                          </button>
                          <button
                            type="button"
                            disabled={statusBusy}
                            onClick={() => void setFlag(f.url, 'violation', flag?.note)}
                          >
                            违规整改 · 7 天
                          </button>
                          <em>
                            立即生效 · 前台挂标记 · 到期自动从友链墙下架
                            {flag?.state && flag.state !== 'normal' ? ` · 当前「${STATUS_LABEL[flag.state] ?? flag.state}」` : ''}
                          </em>
                        </div>
                      ) : null}

                      {editIdx === i ? (
                        <div className="q-admin-editrow">
                          <label>
                            名称
                            <input value={f.name} onChange={(e) => setField(i, 'name', e.target.value)} />
                          </label>
                          <label>
                            网址
                            <input value={f.url} onChange={(e) => setField(i, 'url', e.target.value)} />
                          </label>
                          <label>
                            头像
                            <input value={f.avatar} onChange={(e) => setField(i, 'avatar', e.target.value)} />
                          </label>
                          <label>
                            简介
                            <input value={f.intro} onChange={(e) => setField(i, 'intro', e.target.value)} />
                          </label>
                          <label>
                            截图
                            <input
                              value={f.shot ?? ''}
                              placeholder="选填"
                              onChange={(e) => setField(i, 'shot', e.target.value)}
                            />
                          </label>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {manualText ? (
              <div className="q-admin-manual">
                <p>手动更新步骤：打开仓库的 <code>src/data/links.json</code>，整份替换成下面的内容，提交后等服务器构建。</p>
                <textarea readOnly value={manualText} rows={10} />
                <button
                  className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(manualText);
                    setNotice('已复制到剪贴板');
                  }}
                >
                  复制
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ———————————— 回链检查 ———————————— */}
        {tab === 'backlink' && data ? (
          <section className="q-admin-panel">
            <div className="q-admin-filters">
              <b style={{ fontSize: 13 }}>
                规则很宽：对方任意页面出现 <code>qingwu.ink</code> 即视为有回链
              </b>
              <div className="q-admin-row-actions q-admin-push">
                {progress ? (
                  <span className="q-admin-hint">
                    {progress.done}/{progress.total}
                  </span>
                ) : null}
                <button
                  className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                  type="button"
                  disabled={checking}
                  onClick={() => void recheck(data.links.map((f) => f.url))}
                >
                  {checking ? '检查中…' : '全部重检'}
                </button>
              </div>
            </div>

            {data.links.length === 0 ? (
              <div className="q-admin-empty">
                <b>没有可检查的友链</b>
                先去「已收录」加几个。
              </div>
            ) : (
              <div className="q-admin-checkgrid">
                {data.links.map((f) => {
                  const c = checkOf(f.url);
                  const bad = c && !c.ok;
                  return (
                    <article key={normUrl(f.url)} className={bad ? 'q-admin-card is-bad' : 'q-admin-card'}>
                      <header>
                        <img className="q-admin-avatar" src={f.avatar || '/images/emis/avatar.png'} alt="" />
                        <div>
                          <b>{f.name}</b>
                          <a href={f.url} target="_blank" rel="noreferrer noopener">
                            {hostOf(f.url)}
                          </a>
                        </div>
                      </header>
                      <p>
                        {!c ? (
                          <em className="q-admin-hint">还没检查过</em>
                        ) : c.ok ? (
                          <span className="q-admin-tag q-admin-tag--ok">有回链</span>
                        ) : (
                          <span className="q-admin-tag q-admin-tag--danger">{c.error || '未找到回链'}</span>
                        )}
                      </p>
                      <dl>
                        <div>
                          <dt>检查于</dt>
                          <dd>{c ? fmtTime(c.checked_at) : '—'}</dd>
                        </div>
                        {c?.matched ? (
                          <div>
                            <dt>发现于</dt>
                            <dd>
                              <a href={c.matched} target="_blank" rel="noreferrer noopener">
                                {matchedLabel(c.matched)}
                              </a>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <footer>
                        <button
                          className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
                          type="button"
                          disabled={checking}
                          onClick={() => void recheck([f.url])}
                        >
                          重检
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
