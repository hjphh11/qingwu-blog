import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import {
  CircleAlert,
  CircleCheck,
  ImageUp,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Pencil,
  RotateCcw,
  UserRound,
  X,
} from '../../lib/icons';
import GithubMark from './GithubMark';
import MyCommentList from './MyCommentList';
import {
  clearAvatar,
  fetchMyComments,
  saveProfile,
  unbindIdentity,
  uploadAvatar,
  type MyComment,
  type SessionAccount,
} from '../../lib/auth';
import { deleteEntry } from '../../lib/friendsBoard';
import { avatarFromHash } from '../../lib/avatar';
import { fileToAvatar } from '../../lib/avatarUpload';

/**
 * 留言框顶部的「我是谁」那一条。
 *
 * 只做四件事：**认人**（头像 + 名字）、**换头像**、**改档案**（署名 / 站点）、
 * **管留言**。想看全部信息（加入时间、登录方式、统计）就去 `/account` ——
 * 那是单独的一页，点名字/头像旁边那块就过去。
 *
 * 头像点击即上传：这个位置大家默认会去点，比藏进「改署名」里顺手。
 */
export default function AccountStrip({
  account,
  github,
  onAccountChange,
  onLogout,
  onDeleted,
  onLocate,
}: {
  account: SessionAccount;
  github: boolean;
  onAccountChange: (next: SessionAccount | null) => void;
  onLogout: () => void;
  /** 在「我的留言」里删掉一条之后，让列表刷新 */
  onDeleted: (id: string) => void;
  /** 在抽屉里点「定位」：把这页滚到那条留言并高亮 */
  onLocate: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [site, setSite] = useState(account.site);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * 头像的三档兜底：0 = 当前地址，1 = 邮箱哈希的 Cravatar，
   * 2 = 放弃（画个图标）。QQ 头像接口（q.qlogo.cn）在部分网络下会 400，这是实测过的。
   */
  const [avatarStage, setAvatarStage] = useState(0);
  const [avatarSrc, setAvatarSrc] = useState(account.avatar);

  // 账号换了（比如刚登录/刚保存）就把草稿对齐，别让人看到上一个账号的旧值
  useEffect(() => {
    setName(account.name);
    setSite(account.site);
    setAvatarSrc(account.avatar);
    setAvatarStage(0);
  }, [account.id, account.name, account.site, account.avatar]);

  /** 现在该显示哪张头像 */
  const shownAvatar =
    avatarStage === 0 ? avatarSrc : avatarStage === 1 ? avatarFromHash(account.emailHash) : '';

  function failAvatar() {
    // 第一档挂了就退到哈希头像（Gravatar/Cravatar 那条），再挂才放弃
    if (avatarStage === 0 && avatarFromHash(account.emailHash)) setAvatarStage(1);
    else setAvatarStage(2);
  }

  async function save() {
    setBusy(true);
    // 只提交署名和站点 —— 头像有自己的接口，别在这里顺带覆盖
    const r = await saveProfile({ display_name: name.trim(), site_url: site.trim() });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    if (r.account) onAccountChange(r.account);
    setMsg({ kind: 'ok', text: '记住了，之后的留言都用这份档案。' });
    setEditing(false);
  }

  /** 选图 → 浏览器里裁成 192 小方图 → 直接上传（不用再点保存，换头像本来就是一个动作） */
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
    if (r.account) onAccountChange(r.account);
    setMsg({ kind: 'ok', text: '头像换好了，留言列表里也会跟着变。' });
  }

  async function useDefaultAvatar() {
    setMsg(null);
    setAvatarBusy(true);
    const r = await clearAvatar();
    setAvatarBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'warn', text: r.message });
      return;
    }
    if (r.account) onAccountChange(r.account);
    setMsg({ kind: 'ok', text: '换回按邮箱算的那张了。' });
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
        {/* 头像：点一下就能换。相机图标只在 hover/聚焦时浮出来，平时不抢视线 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="换头像"
          title="换头像"
          className="group relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-rose/15 ring-1 ring-rose/25 transition-shadow hover:ring-crimson/45"
        >
          {shownAvatar && avatarStage < 2 ? (
            <img
              key={shownAvatar}
              src={shownAvatar}
              alt=""
              width={36}
              height={36}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={failAvatar}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-crimson">
              <MorphIcon icon={UserRound} size={15} color="currentColor" />
            </span>
          )}
          <span
            className={`absolute inset-0 grid place-items-center bg-ink/45 text-white transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${
              avatarBusy ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {avatarBusy ? (
              <span className="animate-spin">
                <MorphIcon icon={LoaderCircle} size={13} color="currentColor" />
              </span>
            ) : (
              <MorphIcon icon={ImageUp} size={13} color="currentColor" />
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
            // 清空 value：同一张图连选两次也要能触发 change
            ev.target.value = '';
            if (f) void pickAvatar(f);
          }}
        />

        {/* 名字 + 邮箱整体是入口：想去「我的账号」看全部信息，点这里 */}
        <a
          href="/account"
          className="group/me flex min-w-0 items-baseline gap-2 rounded-md transition-colors"
          title="查看我的账号"
        >
          <span className="min-w-0 truncate text-[13px] font-medium text-ink group-hover/me:text-crimson">
            {account.name}
          </span>
          <span className="truncate text-[11px] text-subtle group-hover/me:text-crimson/80">
            {account.email}
          </span>
        </a>

        <div className="ml-auto flex items-center gap-0.5">
          {editing ? null : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
            >
              <MorphIcon icon={Pencil} size={11} color="currentColor" />
              改署名
            </button>
          )}
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

      {/* 展开/收起用 grid-rows 做高度动画 —— 不用猜 max-height，内容多高就多高 */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-[var(--dur-state)] ease-out motion-reduce:transition-none ${
          editing ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
        aria-hidden={!editing}
      >
        <div className="overflow-hidden">
          <div
            className={`mt-2.5 rounded-xl border border-rose/25 bg-white/70 p-3 ${
              editing ? '' : 'pointer-events-none'
            }`}
          >
            <div className="grid gap-2 sm:max-w-xl sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10.5px] text-subtle">署名</span>
                <input
                  value={name}
                  maxLength={30}
                  tabIndex={editing ? 0 : -1}
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
                  tabIndex={editing ? 0 : -1}
                  onChange={(ev) => setSite(ev.target.value)}
                  placeholder="example.com"
                  className="w-full rounded-lg border border-rose/25 bg-white px-2.5 py-1.5 text-xs text-ink outline-none focus:border-crimson/50"
                />
              </label>

              {/* 头像上传：不再是「填网址」—— 那个框没人愿意粘，还得自己找图床 */}
              <div className="sm:col-span-2">
                <span className="mb-1 block text-[10.5px] text-subtle">头像</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-rose/15 ring-1 ring-rose/25">
                    {shownAvatar && avatarStage < 2 ? (
                      <img
                        key={`edit-${shownAvatar}`}
                        src={shownAvatar}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={failAvatar}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-crimson">
                        <MorphIcon icon={UserRound} size={15} color="currentColor" />
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={avatarBusy}
                    tabIndex={editing ? 0 : -1}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rose/30 bg-white px-2.5 text-[11px] text-muted transition-colors hover:border-crimson/45 hover:text-crimson disabled:opacity-60"
                  >
                    <MorphIcon icon={ImageUp} size={12} color="currentColor" />
                    上传图片
                  </button>
                  {account.avatarCustom && (
                    <button
                      type="button"
                      onClick={() => void useDefaultAvatar()}
                      disabled={avatarBusy}
                      tabIndex={editing ? 0 : -1}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] text-subtle transition-colors hover:text-crimson disabled:opacity-60"
                    >
                      <MorphIcon icon={RotateCcw} size={11} color="currentColor" />
                      恢复默认
                    </button>
                  )}
                  <span className="text-[10.5px] leading-relaxed text-subtle">
                    选图后自动裁成方形，不用自己压
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !name.trim()}
                tabIndex={editing ? 0 : -1}
                className="inline-flex min-h-7 items-center gap-1 rounded-lg bg-crimson px-3 text-[11px] font-medium text-white transition-colors disabled:bg-rose/30 disabled:text-muted"
              >
                {busy ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                tabIndex={editing ? 0 : -1}
                className="text-[11px] text-subtle underline underline-offset-2 hover:text-crimson"
              >
                收起
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
                  tabIndex={editing ? 0 : -1}
                  className="text-[10.5px] text-subtle underline underline-offset-2 hover:text-crimson disabled:opacity-60"
                >
                  解绑
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
        onLocate={(id) => {
          setMineOpen(false);
          onLocate(id);
        }}
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
  onLocate,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onLocate: (id: string) => void;
}) {
  const [items, setItems] = useState<MyComment[] | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  /**
   * 进出都要动画 —— 所以不能 `open ? render : null`：
   * 关闭时先停在 DOM 里让动画跑完，再摘掉（260ms ≈ 过渡时长）。
   */
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      // 下一帧再加 shown，否则「插入 DOM + 已有终态类名」在同一个样式计算里，动画不会跑
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = window.setTimeout(() => setRendered(false), 260);
    return () => window.clearTimeout(timer);
  }, [open]);

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

  if (!rendered) return null;

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
        className={`absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="我的留言"
        className={`relative flex max-h-[80vh] w-full flex-col rounded-t-[var(--radius-card)] border border-rose/25 bg-[#fffdfb] transition-transform duration-300 ease-out motion-reduce:transition-none sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-y-0 sm:border-r-0 ${
          shown ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-rose/20 px-4 py-3">
          <h3 className="font-display text-base text-ink">我的留言</h3>
          <a
            href="/account"
            className="ml-1 text-[10.5px] text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
          >
            全部信息
          </a>
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
          <MyCommentList items={items} busyId={busyId} onDelete={(id) => void remove(id)} onLocate={onLocate} />

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
