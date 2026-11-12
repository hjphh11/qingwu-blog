import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Pencil,
  Trash2,
  UserRound,
  X,
} from '../../lib/icons';
import GithubMark from './GithubMark';
import {
  fetchMyComments,
  saveProfile,
  unbindIdentity,
  type MyComment,
  type SessionAccount,
} from '../../lib/auth';
import { deleteEntry } from '../../lib/friendsBoard';
import { renderRich } from '../../lib/richText';

/**
 * 留言框顶部的「我是谁」那一条。
 *
 * 只做三件事：**认人**（头像 + 名字）、**改档案**（署名 / 站点 / 头像）、**管留言**。
 * 不做「个人主页」—— 这个站只有一个留言板，多一个页面就是多一处要维护的空壳。
 */
export default function AccountStrip({
  account,
  github,
  onAccountChange,
  onLogout,
  onDeleted,
}: {
  account: SessionAccount;
  github: boolean;
  onAccountChange: (next: SessionAccount | null) => void;
  onLogout: () => void;
  /** 在「我的留言」里删掉一条之后，让列表刷新 */
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [site, setSite] = useState(account.site);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  /** 外站头像可能被 Referer 防盗链或接口 400 拦掉 —— 失败了就退回图标 */
  const [avatarBroken, setAvatarBroken] = useState(false);

  // 账号换了（比如刚登录）就把草稿对齐，别让人看到上一个账号的旧值
  useEffect(() => {
    setName(account.name);
    setSite(account.site);
  }, [account.id, account.name, account.site]);

  async function save() {
    setBusy(true);
    const r = await saveProfile({ display_name: name.trim(), site_url: site.trim() });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    if (r.account) onAccountChange(r.account);
    setMsg({ kind: 'ok', text: '记住了，之后的留言都用这个署名。' });
    setEditing(false);
  }

  async function unbind() {
    setBusy(true);
    const r = await unbindIdentity('github');
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    if (r.account) onAccountChange(r.account);
    setMsg({ kind: 'ok', text: 'GitHub 解绑了，以后用邮箱登录。' });
  }

  const githubBound = account.identities.some((i) => i.provider === 'github');

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-rose/15 ring-1 ring-rose/25">
          {account.avatar && !avatarBroken ? (
            <img
              src={account.avatar}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-crimson">
              <MorphIcon icon={UserRound} size={14} color="currentColor" />
            </span>
          )}
        </span>

        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{account.name}</span>
        <span className="truncate text-[11px] text-subtle">{account.email}</span>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
          >
            <MorphIcon icon={Pencil} size={11} color="currentColor" />
            改署名
          </button>
          <button
            type="button"
            onClick={() => setMineOpen(true)}
            className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
          >
            <MorphIcon icon={MessageCircle} size={11} color="currentColor" />
            我的留言
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
          >
            <MorphIcon icon={LogOut} size={11} color="currentColor" />
            退出
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-2.5 rounded-xl border border-rose/25 bg-white/70 p-3">
          <div className="grid gap-2 sm:max-w-xl sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-subtle">署名</span>
              <input
                value={name}
                maxLength={30}
                onChange={(ev) => setName(ev.target.value)}
                className="w-full rounded-lg border border-rose/25 bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:border-crimson/50"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-subtle">站点网址（可不填）</span>
              <input
                value={site}
                maxLength={300}
                inputMode="url"
                onChange={(ev) => setSite(ev.target.value)}
                placeholder="example.com"
                className="w-full rounded-lg border border-rose/25 bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:border-crimson/50"
              />
            </label>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !name.trim()}
              className="inline-flex min-h-7 items-center gap-1 rounded-lg bg-crimson px-3 text-[11px] font-medium text-white transition-colors disabled:bg-rose/30 disabled:text-muted"
            >
              {busy ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-[11px] text-subtle underline underline-offset-2 hover:text-crimson"
            >
              取消
            </button>

            {/* 绑定状态：GitHub 是可选项，邮箱永远是主身份 */}
            <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-subtle">
              <GithubMark size={11} />
              {githubBound ? '已绑定' : github ? '未绑定' : '未开启'}
            </span>
            {githubBound && (
              <button
                type="button"
                onClick={() => void unbind()}
                disabled={busy}
                className="text-[10.5px] text-subtle underline underline-offset-2 hover:text-crimson disabled:opacity-60"
              >
                解绑
              </button>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p
          role={msg.kind === 'ok' ? 'status' : 'alert'}
          className={`mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed ${
            msg.kind === 'ok' ? 'text-muted' : 'text-crimson'
          }`}
        >
          <span className="mt-px shrink-0">
            <MorphIcon
              icon={msg.kind === 'ok' ? CircleCheck : CircleAlert}
              size={11}
              color="currentColor"
            />
          </span>
          {msg.text}
        </p>
      )}

      <MyCommentsDrawer
        open={mineOpen}
        onClose={() => setMineOpen(false)}
        onDeleted={(id) => {
          onDeleted(id);
          setMsg({ kind: 'ok', text: '这条删掉了。' });
        }}
      />
    </div>
  );
}

/** 「我的留言」抽屉：右侧滑出（手机上是从底部升起的一张纸） */
function MyCommentsDrawer({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [items, setItems] = useState<MyComment[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError('');
    let alive = true;
    void fetchMyComments().then((list) => {
      if (alive) setItems(list);
    });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function remove(id: string) {
    setBusyId(id);
    // 登录后删除凭账号，不再需要本机那串 token
    const r = await deleteEntry(id, '');
    setBusyId('');
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setItems((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    onDeleted(id);
  }

  // 同 LoginDialog：外层有 transform，fixed 会相对卡片定位，必须挂到 body
  const drawer = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-stretch sm:justify-end">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="我的留言"
        className="relative flex max-h-[80vh] w-full flex-col rounded-t-[var(--radius-card)] border border-rose/25 bg-[#fffdfb] sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <div className="flex items-center gap-2 border-b border-rose/20 px-4 py-3">
          <h3 className="font-display text-base text-ink">我的留言</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto grid h-7 w-7 place-items-center rounded-full text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
          >
            <MorphIcon icon={X} size={13} color="currentColor" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items === null && (
            <p className="flex items-center gap-2 py-6 text-xs text-subtle">
              <span className="animate-spin">
                <MorphIcon icon={LoaderCircle} size={13} color="currentColor" />
              </span>
              正在找…
            </p>
          )}

          {items?.length === 0 && (
            <p className="py-8 text-center text-xs leading-relaxed text-subtle">
              还没有用这个邮箱留过言。
              <br />
              下面写一句试试 ~
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {(items ?? []).map((c) => (
              <li key={c.id} className="rounded-xl border border-rose/20 bg-white/70 p-3">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${
                      c.status === 'approved'
                        ? 'bg-crimson/10 text-crimson'
                        : 'border border-amber/45 bg-amber/10 text-brown'
                    }`}
                  >
                    {c.status === 'approved' ? '已是友链' : '等我看看'}
                  </span>
                  <span className="text-[10.5px] tabular-nums text-subtle">
                    {c.at.slice(0, 10)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(c.id)}
                    disabled={busyId === c.id}
                    className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-subtle transition-colors hover:text-crimson disabled:opacity-60"
                  >
                    <MorphIcon icon={Trash2} size={10} color="currentColor" />
                    {busyId === c.id ? '删除中' : '删除'}
                  </button>
                </div>
                <div
                  className="q-rich mt-1.5 line-clamp-3 text-[12px] text-muted"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: renderRich(c.intro) }}
                />
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="mt-3 text-[11px] text-crimson">
              {error}
            </p>
          )}
        </div>

        <p className="border-t border-rose/20 px-4 py-2.5 text-[10.5px] leading-relaxed text-subtle">
          换设备也能看到这里 —— 留言是按账号记的，不再依赖本机缓存。
        </p>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(drawer, document.body);
}
