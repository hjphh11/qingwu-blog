import { useEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  ImageUp,
  LoaderCircle,
  LogOut,
  Mail,
  RotateCcw,
  UserRound,
} from '../../lib/icons';
import GithubMark from './GithubMark';
import LoginDialog from './LoginDialog';
import MyCommentList from './MyCommentList';
import {
  DEFAULT_CONFIG,
  clearAvatar,
  fetchMe,
  fetchMyComments,
  githubBindUrl,
  githubLoginUrl,
  logout,
  saveProfile,
  unbindIdentity,
  uploadAvatar,
  type AuthConfig,
  type MyComment,
  type SessionAccount,
} from '../../lib/auth';
import { deleteEntry } from '../../lib/friendsBoard';
import { avatarFromHash } from '../../lib/avatar';
import { fileToAvatar } from '../../lib/avatarUpload';

/**
 * `/account` —— 账号的全部信息，一页看完。
 *
 * 为什么单独一页而不是又一个大弹窗：
 *   留言板顶部那条（AccountStrip）只够放「我是谁 + 三个按钮」，
 *   而「加入时间、登录方式、留言统计、全部留言」挤进去就成了仪表盘。
 *   这些东西是「偶尔看一次」的，值得一个自己的地址 —— 也方便收藏/分享给自己。
 *
 * 视觉：居中一张卡（42rem），和站内其它内页一个版心；不进 `.page-head`，
 * 因为这一页没有「列表」，只有一个主体。
 */
export default function AccountCenter() {
  const [phase, setPhase] = useState<'loading' | 'guest' | 'ready'>('loading');
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [config, setConfig] = useState<AuthConfig>(DEFAULT_CONFIG);
  const [items, setItems] = useState<MyComment[] | null>(null);

  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  /** 头像三档兜底：0 当前地址 → 1 邮箱哈希 → 2 图标（QQ 头像接口会 400） */
  const [avatarStage, setAvatarStage] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchMe().then((r) => {
      if (!alive) return;
      setConfig(r.config);
      setAccount(r.account);
      setPhase(r.account ? 'ready' : 'guest');
      if (r.account) {
        setName(r.account.name);
        setSite(r.account.site);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 有账号才去拉留言列表
  useEffect(() => {
    if (!account) return;
    let alive = true;
    setItems(null);
    void fetchMyComments().then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, [account?.id]);

  /** 账号变了就把草稿对齐（保存后服务端回来的那份才算数） */
  function adopt(next: SessionAccount | null) {
    setAccount(next);
    setAvatarStage(0);
    if (next) {
      setName(next.name);
      setSite(next.site);
    }
  }

  const shownAvatar =
    avatarStage === 0
      ? account?.avatar || ''
      : avatarStage === 1
        ? avatarFromHash(account?.emailHash || '')
        : '';

  async function save() {
    setSaving(true);
    const r = await saveProfile({ display_name: name.trim(), site_url: site.trim() });
    setSaving(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    adopt(r.account);
    setMsg({ kind: 'ok', text: '存好了，之后的留言都用这份署名。' });
  }

  async function pickAvatar(file: File) {
    setMsg(null);
    setAvatarBusy(true);
    const shrunk = await fileToAvatar(file);
    if (!shrunk.ok) {
      setAvatarBusy(false);
      setMsg({ kind: 'warn', text: shrunk.message });
      return;
    }
    const r = await uploadAvatar(shrunk.dataUrl);
    setAvatarBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    adopt(r.account);
    setMsg({ kind: 'ok', text: '头像换好了，留言列表里也跟着变了。' });
  }

  async function useDefault() {
    setMsg(null);
    setAvatarBusy(true);
    const r = await clearAvatar();
    setAvatarBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    adopt(r.account);
    setMsg({ kind: 'ok', text: '换回按邮箱算的那张了。' });
  }

  async function removeComment(id: string) {
    setBusyId(id);
    const r = await deleteEntry(id, '');
    setBusyId('');
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    setItems((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));
    setMsg({ kind: 'ok', text: '这条删掉了。' });
  }

  async function unbindGithub() {
    const r = await unbindIdentity('github');
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    adopt(r.account);
    setMsg({ kind: 'ok', text: 'GitHub 解绑了，以后用邮箱登录。' });
  }

  async function doLogout() {
    await logout();
    setAccount(null);
    setItems(null);
    setPhase('guest');
    setMsg(null);
  }

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-[44rem] py-16 text-center text-sm text-subtle">
        <span className="inline-flex animate-spin">
          <MorphIcon icon={LoaderCircle} size={16} color="currentColor" />
        </span>
      </div>
    );
  }

  if (phase === 'guest') {
    return (
      <>
        <PageTitle />
        <div className="mx-auto max-w-[44rem] rounded-[var(--radius-card)] border border-rose/25 bg-white/60 px-6 py-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose/15 text-crimson">
            <MorphIcon icon={UserRound} size={24} color="currentColor" />
          </span>
          <h2 className="mt-4 font-display text-xl text-ink">还没登录</h2>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
            登录之后这里会显示你的署名、头像、留言数和登录方式 —— 留言也不再依赖这台设备。
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-crimson px-4 text-xs font-medium text-white transition-transform hover:scale-[1.02]"
            >
              <MorphIcon icon={Mail} size={13} color="currentColor" />
              用邮箱登录
            </button>
            {config.github && (
              <a
                href={githubLoginUrl()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose/30 bg-white px-4 text-xs text-muted transition-colors hover:border-crimson/45 hover:text-crimson"
              >
                <GithubMark size={13} />
                GitHub
              </a>
            )}
            <a
              href="/links/#friends-comments"
              className="text-[11px] text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
            >
              回留言板
            </a>
          </div>
        </div>
        <LoginDialog
          open={loginOpen}
          config={config}
          onClose={() => setLoginOpen(false)}
          onDone={(next) => {
            setLoginOpen(false);
            adopt(next);
            setPhase('ready');
            setMsg({ kind: 'ok', text: '登录好了。' });
          }}
        />
      </>
    );
  }

  if (!account) return null;

  const githubBound = account.identities.some((i) => i.provider === 'github');
  const total = items?.length ?? 0;
  const approved = items?.filter((c) => c.status === 'approved').length ?? 0;

  return (
    <div className="mx-auto max-w-[44rem]">
      <PageTitle />
      {/* ── 头部：头像 + 名字 + 一句话身份 ── */}
      <div className="rounded-[var(--radius-card)] border border-rose/25 bg-white/60 p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="换头像"
            className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-rose/35 to-amber/25 ring-2 ring-white/80 transition-shadow hover:ring-crimson/40"
          >
            {shownAvatar && avatarStage < 2 ? (
              <img
                key={shownAvatar}
                src={shownAvatar}
                alt=""
                width={80}
                height={80}
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() =>
                  setAvatarStage(avatarFromHash(account.emailHash) && avatarStage === 0 ? 1 : 2)
                }
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-display text-2xl text-crimson">
                {(account.name || '·').trim().slice(0, 1)}
              </span>
            )}
            <span
              className={`absolute inset-0 grid place-items-center bg-ink/45 text-white transition-opacity ${
                avatarBusy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {avatarBusy ? (
                <span className="animate-spin">
                  <MorphIcon icon={LoaderCircle} size={18} color="currentColor" />
                </span>
              ) : (
                <MorphIcon icon={ImageUp} size={18} color="currentColor" />
              )}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = '';
              if (f) void pickAvatar(f);
            }}
          />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="truncate font-display text-xl text-ink">{account.name}</h2>
            <p className="mt-0.5 truncate text-xs text-subtle">{account.email}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-subtle sm:justify-start">
              {account.site ? (
                <a
                  href={account.site}
                  target="_blank"
                  rel="noopener noreferrer me"
                  className="truncate underline underline-offset-2 transition-colors hover:text-crimson"
                >
                  {account.site.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              ) : (
                <span>还没填站点</span>
              )}
              <span className="tabular-nums">{new Date(account.since).toISOString().slice(0, 10)} 加入</span>
              {account.role === 'admin' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-crimson/10 px-1.5 py-px text-crimson">
                  <MorphIcon icon={BadgeCheck} size={10} color="currentColor" />
                  站长
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 三格统计 —— 就三个数，做成列表反而更清楚 */}
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-rose/15 pt-4 text-center">
          {[
            { k: '留言', v: total },
            { k: '已是友链', v: approved },
            { k: '登录方式', v: account.identities.length },
          ].map((s) => (
            <div key={s.k}>
              <dd className="font-display text-xl text-ink">{s.v}</dd>
              <dt className="mt-0.5 text-[10.5px] text-subtle">{s.k}</dt>
            </div>
          ))}
        </dl>
      </div>

      {/* ── 档案 ── */}
      <section className="mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/60 p-6">
        <h3 className="font-display text-base text-ink">资料</h3>
        <p className="mt-0.5 text-[11px] text-subtle">改完之后，之前发过的留言也会跟着变。</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10.5px] text-subtle">署名</span>
            <input
              value={name}
              maxLength={30}
              onChange={(ev) => setName(ev.target.value)}
              className="w-full rounded-lg border border-rose/25 bg-white px-2.5 py-2 text-xs text-ink outline-none focus:border-crimson/50"
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
              className="w-full rounded-lg border border-rose/25 bg-white px-2.5 py-2 text-xs text-ink outline-none focus:border-crimson/50"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="inline-flex min-h-8 items-center rounded-lg bg-crimson px-3.5 text-[11px] font-medium text-white transition-colors disabled:bg-rose/30 disabled:text-muted"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rose/30 bg-white px-2.5 text-[11px] text-muted transition-colors hover:border-crimson/45 hover:text-crimson disabled:opacity-60"
          >
            <MorphIcon icon={ImageUp} size={12} color="currentColor" />
            换头像
          </button>
          {account.avatarCustom && (
            <button
              type="button"
              onClick={() => void useDefault()}
              disabled={avatarBusy}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] text-subtle transition-colors hover:text-crimson disabled:opacity-60"
            >
              <MorphIcon icon={RotateCcw} size={11} color="currentColor" />
              恢复默认
            </button>
          )}
        </div>
      </section>

      {/* ── 登录方式 ── */}
      <section className="mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/60 p-6">
        <h3 className="font-display text-base text-ink">登录方式</h3>
        <p className="mt-0.5 text-[11px] text-subtle">邮箱是主身份，GitHub 只是方便 —— 少了哪个都能用另一个进。</p>

        <ul className="mt-3 flex flex-col gap-2">
          <li className="flex items-center gap-2.5 rounded-xl border border-rose/20 bg-white/70 px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose/15 text-crimson">
              <MorphIcon icon={Mail} size={14} color="currentColor" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">{account.email}</span>
              <span className="block text-[10.5px] text-subtle">邮箱验证码 · 主身份，不能解绑</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[10.5px] text-crimson">
              <MorphIcon icon={CircleCheck} size={11} color="currentColor" />
              已验证
            </span>
          </li>

          <li className="flex items-center gap-2.5 rounded-xl border border-rose/20 bg-white/70 px-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/6 text-ink">
              <GithubMark size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">
                {githubBound ? 'GitHub 已绑定' : 'GitHub 未绑定'}
              </span>
              <span className="block text-[10.5px] text-subtle">
                {config.github
                  ? githubBound
                    ? '可以用它一键登录这个账号'
                    : '绑上之后换设备也能一键回来'
                  : '站点还没开 GitHub 登录'}
              </span>
            </span>
            {githubBound ? (
              <button
                type="button"
                onClick={() => void unbindGithub()}
                className="text-[10.5px] text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
              >
                解绑
              </button>
            ) : config.github ? (
              <a
                href={githubBindUrl()}
                className="text-[10.5px] text-crimson underline underline-offset-2"
              >
                去绑定
              </a>
            ) : null}
          </li>
        </ul>
      </section>

      {/* ── 我的留言 ── */}
      <section className="mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/60 p-6">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display text-base text-ink">我的留言</h3>
          <span className="text-[10.5px] text-subtle">
            「定位」会跳回留言板并把它标亮
          </span>
        </div>
        <div className="mt-3">
          <MyCommentList items={items} busyId={busyId} onDelete={(id) => void removeComment(id)} />
        </div>
      </section>

      {msg && (
        <p
          role={msg.kind === 'ok' ? 'status' : 'alert'}
          className={`mt-3 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed ${
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

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 pb-4">
        <a
          href="/links/#friends-comments"
          className="text-[11px] text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
        >
          回留言板
        </a>
        <button
          type="button"
          onClick={() => void doLogout()}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-rose/25 px-3 text-[11px] text-subtle transition-colors hover:border-crimson/40 hover:text-crimson"
        >
          <MorphIcon icon={LogOut} size={11} color="currentColor" />
          退出登录
        </button>
      </div>
    </div>
  );
}

/** 页头：这一页没有列表，一个居中的小标题就够，别用 .page-head 那套大留白 */
function PageTitle() {
  return (
    <header className="mb-5 text-center">
      <h1 className="font-display text-2xl text-ink">我的账号</h1>
      <p className="mt-1 text-xs text-subtle">署名、头像、登录方式和我的留言，都在这一页</p>
    </header>
  );
}

/** 给外面用的默认值（避免每个调用点自己写一遍） */
export const ACCOUNT_DEFAULTS = DEFAULT_CONFIG;
