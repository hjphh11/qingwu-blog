/*
 * 后台 · 长亭（举报与封禁）
 *
 * 这一页是前台「举报」按钮的另一半。在这之前，举报只落 `chat_reports`，
 * **没有任何读取方** —— 前台说的是「交到站长那儿了」，实际上只有手写 SQL 才看得见。
 *
 * 三个动作，口径在 worker/src/admin/chat.ts：
 *   · 删消息 = 软删（status='deleted'），前台显示「这条被站长收走了」；
 *     它名下的 open 举报一起标成已处理。
 *   · 忽略 = 只把这条举报关掉，不碰消息（可能只是有人不喜欢听）。
 *   · 封人 = 写 chat_bans，发送时会查；同一账号只留一条。
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
    authorHash: string;
  } | null;
  reporter: { id: number; name: string };
}

interface ChatBan {
  accountId: number;
  name: string;
  until: number;
  reason: string;
  createdAt: number;
}

const REASON_LABEL: Record<string, string> = {
  illegal: '违法',
  porn: '色情',
  abuse: '辱骂',
  privacy: '隐私',
  spam: '广告',
  other: '其他',
};

/** 封禁时长三个常用档，别让人填分钟数 */
const BAN_OPTIONS = [
  { label: '1 小时', minutes: 60 },
  { label: '1 天', minutes: 60 * 24 },
  { label: '7 天', minutes: 60 * 24 * 7 },
];

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
  const [reports, setReports] = useState<ChatReport[] | null>(null);
  const [bans, setBans] = useState<ChatBan[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState<string>('');
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
        openCount?: number;
      };
      if (!data.ok) {
        setErr('读不到举报列表，刷新再试');
        return;
      }
      setReports(data.reports ?? []);
      setBans(data.bans ?? []);
      setOpenCount(data.openCount ?? 0);
      setErr('');
    } catch {
      setErr('网络好像不太顺');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <>
      <AdminTop active="chat" />
      <main className="q-admin-main">
        <div className="q-admin-head">
          <div>
            <h1>长亭</h1>
            <p>
              被举报的消息在这里处理。删掉的消息不会消失成空白 —— 前台会留一行「这条被站长收走了」。
            </p>
          </div>
          <div className="q-admin-stat-actions">
            <span className="q-chat-adm__count">{openCount} 条待处理</span>
          </div>
        </div>

        {err ? <p className="q-admin-error">{err}</p> : null}
        {toast ? <p className="q-admin-saved">{toast}</p> : null}
        {loading && !reports ? <div className="q-admin-loading">正在读举报…</div> : null}

        {reports && reports.length === 0 ? (
          <section className="q-admin-panel">
            <p className="q-admin-empty">还没有人举报过。这一页空着是好事。</p>
          </section>
        ) : null}

        {reports?.map((r) => (
          <section className={`q-admin-panel q-chat-adm${r.status === 'open' ? ' is-open' : ''}`} key={r.id}>
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

            <div className="q-chat-adm__acts">
              {r.message && r.message.status !== 'deleted' ? (
                <button
                  type="button"
                  className="q-admin-btn q-admin-btn--primary q-admin-btn--sm"
                  disabled={busy === `del:${r.message.id}`}
                  onClick={() => {
                    if (window.confirm('删掉这条？前台会显示「这条被站长收走了」。')) {
                      void removeMessage(r.message!.id);
                    }
                  }}
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
      </main>
    </>
  );
}
