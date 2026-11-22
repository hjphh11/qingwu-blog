import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Heart,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  MessageCircle,
  Send,
  Smile,
  Sparkles,
  UserRound,
  X,
} from '../lib/icons';
import GithubMark from './auth/GithubMark';
import EmojiPicker from './EmojiPicker';
import AccountStrip from './auth/AccountStrip';
import LoginDialog from './auth/LoginDialog';
import { renderRich } from '../lib/richText';
import { APPLY_LIMITS } from '../lib/applyValidation';
import { avatarFromEmail, avatarFromHash, emailHash as emailHashOf } from '../lib/avatar';
import { timeAgo, type FriendEntry, type FriendReply } from '../lib/friendsBoard';
import {
  deletePostComment,
  dropToken,
  loadPostComments,
  readTokens,
  saveToken,
  submitPostComment,
  submitPostReply,
  togglePostLike,
} from '../lib/postComments';
import {
  authFlagText,
  consumeAuthFlag,
  fetchMe,
  githubLoginUrl,
  logout as logoutApi,
  type AuthConfig,
  type SessionAccount,
} from '../lib/auth';

/**
 * 文章底部 · 评论
 *
 * 形态与友链留言板（`FriendsBoard.tsx`）保持一致：**评论框常驻在列表上方**，
 * 未登录时一行三格（名字 / 邮箱 / 网址），登录后换成「我是谁」那条账号带，
 * 三个格子收起来 —— 署名、邮箱、网址都来自账号档案，再摆一遍就会变成
 * 「两个地方都能填，到底哪个算」。
 *
 * 登录走的是**同一套统一身份**：`/api/auth/*` 的邮箱验证码 / GitHub，
 * 会话 cookie 也是同一个（`q_sess`）。所以在这里登录过，回 /links/ 也是登录态，
 * 反之亦然。服务端能不能匿名发言由 `REQUIRE_LOGIN` 一个开关说了算（与留言板共用）。
 *
 * 数据接口见 `src/lib/postComments.ts`，落到 `comments` 表里 `post_slug=/blog/<slug>`。
 */

type Status = 'idle' | 'submitting';

/** 服务端正文上限 1000（见 worker/src/comments.ts 的 BODY_MAX） */
const CONTENT_MAX = 1000;

/** 「本站 AI」的署名 —— 和留言板同一套识别，站长用小爱身份回复时挂标 */
const AI_AUTHOR = '爱弥斯';

function isAiAuthor(name: string, avatar?: string): boolean {
  return (name || '').trim() === AI_AUTHOR || /images\/emis\/avatar/i.test(avatar || '');
}

function AiBadge() {
  return (
    <span
      title="由爱弥斯（本站 AI）代笔"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-crimson/10 px-1.5 text-[10px] leading-[15px] text-crimson"
    >
      <MorphIcon icon={Sparkles} size={9} color="currentColor" />
      AI
    </span>
  );
}

function OwnerBadge() {
  return (
    <span
      title="站长本人"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-crimson px-1.5 text-[10px] leading-[15px] text-white"
    >
      <MorphIcon icon={BadgeCheck} size={9} color="currentColor" />
      站长
    </span>
  );
}

const EMPTY = { name: '', email: '', url: '', intro: '' };

export default function PostComments({ path }: { path: string }) {
  const uid = useId();
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [now, setNow] = useState(0);

  const [values, setValues] = useState(EMPTY);
  /**
   * 正文框高度：默认 3 行，点进去或已经有内容才展开成 6 行 ——
   * 有内容也算展开态，否则写了半屏、一失焦就被裁掉，看到的和发出的不一样。
   */
  const [introFocused, setIntroFocused] = useState(false);
  const introOpen = introFocused || values.intro.trim().length > 0;
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  /** 邮箱头像的加载阶梯：0 = QQ/Cravatar，1 = 强制 Cravatar，2 = 放弃（显示图标） */
  const [mailStage, setMailStage] = useState(0);
  /** 本机点过赞的条目 id（未登录时服务端认不出人，只能记在本机） */
  const [liked, setLiked] = useState<string[]>([]);
  /** 自己发过的评论 → 删除凭证 */
  const [owned, setOwned] = useState<Record<string, string>>({});
  /** 刚发出去的那条，浅绯红底标一会儿 */
  const [freshId, setFreshId] = useState('');
  /** 从「我的留言」定位过来时临时标亮 */
  const [hlId, setHlId] = useState('');
  const hlTimer = useRef<number | null>(null);
  const hlClearTimer = useRef<number | null>(null);

  /* —— 统一身份 —— */
  const [me, setMe] = useState<SessionAccount | null>(null);
  const [config, setConfig] = useState<AuthConfig>({ requireLogin: true, github: false });
  /** 身份还没读回来时先别判「未登录」，否则会闪一下「请登录」 */
  const [authReady, setAuthReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const introRef = useRef<HTMLTextAreaElement | null>(null);

  // 登录后把档案填进表单（只在字段空着时填，别盖掉正在写的内容）
  useEffect(() => {
    if (!me) return;
    setValues((prev) => ({ ...prev, name: prev.name || me.name, url: prev.url || me.site }));
  }, [me]);

  // 相对时间必须等客户端算：SSR 与客户端各算一次会水合不匹配（见 timeAgo 注释）
  useEffect(() => setNow(Date.now()), []);
  // 自己发过哪些评论（删除凭证）—— 决定哪些条目显示删除按钮
  useEffect(() => setOwned(readTokens()), []);
  useEffect(() => setMailStage(0), [values.email]);

  /* —— 读列表 —— */
  useEffect(() => {
    let alive = true;
    loadPostComments(path)
      .then((page) => {
        if (!alive) return;
        setEntries([...page.items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
        setHasMore(page.hasMore);
        setCursor(page.nextBefore);
        // 服务端知道「这个账号点过哪些赞」—— 登录后换设备也一致
        const serverLiked = page.items.filter((e) => e.liked).map((e) => e.id);
        if (serverLiked.length) setLiked((prev) => Array.from(new Set([...prev, ...serverLiked])));
      })
      .catch(() => {
        if (alive) setNotice({ kind: 'warn', text: '评论没加载出来，不过上面照样可以写 ~' });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  /* —— 读身份 + 处理 GitHub 回调标记 —— */
  useEffect(() => {
    let alive = true;
    void fetchMe()
      .then((r) => {
        if (!alive) return;
        setMe(r.account);
        setConfig(r.config);
      })
      .finally(() => {
        if (alive) setAuthReady(true);
      });

    const flag = consumeAuthFlag();
    const text = flag ? authFlagText(flag) : null;
    if (text) setNotice(text);

    return () => {
      alive = false;
    };
  }, []);

  const count = entries.length;
  const mailAvatar = useMemo(() => avatarFromEmail(values.email), [values.email]);
  const mailSrc =
    mailStage === 0 ? mailAvatar : mailStage === 1 ? avatarFromHash(emailHashOf(values.email)) : '';
  /** 只报第一条错，三格挤一行时每条都堆红字会把表单撑散 */
  const firstError = useMemo(() => Object.values(errors).find(Boolean) ?? '', [errors]);

  /** 定位到某一条：滚过去 + 标亮三秒 */
  const locateEntry = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setHlId(id);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    if (hlClearTimer.current) window.clearTimeout(hlClearTimer.current);
    hlClearTimer.current = window.setTimeout(() => setHlId(''), 3200);
  }, []);

  /**
   * 从 /account 点「定位」回来时地址带 `#c-12`。
   *
   * 评论区是 `client:visible`，元素是水合后才有的 —— 页面里那段 inline 脚本
   * 会先把本区块滚进视口触发水合，这里等列表到位再精确滚到那一条。
   * 定位完把 hash 抹掉：刷新不该重复触发，链接也不该带着别人的定位状态。
   */
  useEffect(() => {
    if (loading) return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!/^c-\d+$/.test(raw)) return;

    hlTimer.current = window.setTimeout(() => {
      if (!document.getElementById(raw)) return;
      locateEntry(raw);
      try {
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
      } catch {
        /* 改不动地址栏就算了，定位照样生效 */
      }
    }, 220);

    return () => {
      if (hlTimer.current) window.clearTimeout(hlTimer.current);
    };
  }, [loading, locateEntry]);

  useEffect(
    () => () => {
      if (hlTimer.current) window.clearTimeout(hlTimer.current);
      if (hlClearTimer.current) window.clearTimeout(hlClearTimer.current);
    },
    [],
  );

  function setField(key: keyof typeof EMPTY, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const e: Partial<Record<keyof typeof EMPTY, string>> = {};
    const name = values.name.trim();
    const url = values.url.trim();
    const intro = values.intro.trim();
    const email = values.email.trim();

    // 登录后三格不显示，署名/邮箱/网址都来自档案，没有什么可校验的
    if (!me) {
      if (!name) e.name = '请填一下名字';
      else if (name.length > APPLY_LIMITS.name) e.name = `名字最多 ${APPLY_LIMITS.name} 个字`;
      // ⚠️ 文章评论里网址是**选填**的（留言板才必填），别照抄那边的规则
      if (url && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(/^https?:\/\//i.test(url) ? url : `https://${url}`)) {
        e.url = '网址看起来不太对，例如 example.com';
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) e.email = '邮箱格式看起来不太对';
    }
    if (!intro) e.intro = '写点什么吧，哪怕只有几个字';
    else if (intro.length > CONTENT_MAX) e.intro = `最多 ${CONTENT_MAX} 个字`;

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    setNotice(null);
    // 必须登录时，未登录点发送直接把登录打开 —— 别让人写完一大段才被拒
    if (config.requireLogin && !me) {
      setLoginOpen(true);
      return;
    }
    if (!validate()) return;
    setStatus('submitting');
    // 登录时署名/站点由档案决定 —— 显式传空串，免得输入框里的旧草稿把档案盖掉
    const res = await submitPostComment(path, me ? { ...values, name: '', email: '', url: '' } : values);
    setStatus('idle');

    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      // 会话过期（换设备 / 清 cookie）也会走到这里：把登录打开，草稿还在输入框里
      if (res.reason === 'login') setLoginOpen(true);
      return;
    }

    setEntries((prev) => [res.entry, ...prev]);
    saveToken(res.entry.id, res.deleteToken);
    setOwned((prev) => ({ ...prev, [res.entry.id]: res.deleteToken }));
    setValues(EMPTY);
    setFreshId(res.entry.id);
    window.setTimeout(() => setFreshId(''), 3600);
    setNotice({ kind: 'ok', text: '收到啦，谢谢你 ~' });
  }

  async function loadMore() {
    if (moreBusy || !hasMore) return;
    setMoreBusy(true);
    try {
      const page = await loadPostComments(path, { before: cursor });
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.items.filter((e) => !seen.has(e.id))];
      });
      setHasMore(page.hasMore);
      setCursor(page.nextBefore);
      const serverLiked = page.items.filter((e) => e.liked).map((e) => e.id);
      if (serverLiked.length) setLiked((prev) => Array.from(new Set([...prev, ...serverLiked])));
    } catch {
      setNotice({ kind: 'warn', text: '更早的评论没加载出来，稍后再点一次' });
    } finally {
      setMoreBusy(false);
    }
  }

  async function toggleLike(id: string) {
    const res = await togglePostLike(id);
    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, likes: res.likes } : e)));
    setLiked((prev) => (res.liked ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id)));
  }

  async function removeEntry(id: string) {
    // 登录后不需要 token —— 服务端按账号判；未登录只能靠本机那串凭证
    const token = owned[id] ?? '';
    if (!token && !me) return;
    const res = await deletePostComment(id, token);
    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    dropToken(id);
    setOwned((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setNotice({ kind: 'ok', text: '这条已经删掉了。' });
  }

  async function addReply(id: string, reply: FriendReply) {
    const res = await submitPostReply(id, {
      name: reply.name,
      email: reply.email,
      url: reply.url,
      avatar: reply.avatar,
      notify: reply.notify,
      replyTo: reply.replyToId,
      intro: reply.intro,
    });
    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, replies: [...(e.replies ?? []), { ...res.reply, to: reply.to }] } : e,
      ),
    );
  }

  /**
   * 在光标处插入 `:[key]`。
   *
   * 光标位置只能从 DOM 拿（React 状态里没有 selection），插完还要把光标挪到
   * token 之后 —— 否则连点三个表情，后两个会插到第一个前面。
   */
  function insertEmoji(key: string) {
    const token = `:[${key}]`;
    const el = introRef.current;
    if (!el) {
      setValues((prev) => ({ ...prev, intro: `${prev.intro}${token}`.slice(0, CONTENT_MAX) }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = `${el.value.slice(0, start)}${token}${el.value.slice(end)}`.slice(0, CONTENT_MAX);
    setValues((prev) => ({ ...prev, intro: next }));
    window.requestAnimationFrame(() => {
      const pos = Math.min(start + token.length, next.length);
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <section id="comments" aria-labelledby="pc-title" className="mt-16 scroll-mt-24">
      <div className="glass-card relative overflow-hidden p-5 sm:p-8">
        {/* 头图氛围：右上角一朵极淡的玫瑰圆环，纯装饰 */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full border border-rose/25 opacity-40"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full border border-rose/20 opacity-30"
        />

        <header className="relative">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="pc-title" className="flex items-center gap-2.5 font-display text-[1.5rem] text-ink">
              <span className="h-5 w-1 rounded-full bg-crimson/80" aria-hidden="true" />
              说两句
            </h2>
            <p className="ml-auto text-xs text-subtle tabular-nums">
              {loading
                ? '正在看看有谁说过话…'
                : count > 0
                  ? now
                    ? `${count} 条 · 最近 ${timeAgo(entries[0].at, now)}`
                    : `${count} 条`
                  : '还没有人说话'}
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            读完有什么想法，或者只是想说声在看 —— 都写在这儿吧 ~
          </p>
        </header>

        {/* 身份还没读回来：先占位，别让「三格表单 → 登录卡」闪一下 */}
        {!authReady ? (
          <div className="relative mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/55 px-5 py-8">
            <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
              <span className="h-9 w-9 rounded-full bg-rose/15 motion-reduce:animate-none" />
              <span className="block h-3 w-40 animate-pulse rounded bg-rose/15 motion-reduce:animate-none" />
              <span className="block h-3 w-56 animate-pulse rounded bg-rose/10 motion-reduce:animate-none" />
            </div>
          </div>
        ) : config.requireLogin && !me ? (
          <div className="relative mt-4 flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-rose/25 bg-white/55 px-5 py-7 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-rose/15 text-crimson">
              <MorphIcon icon={UserRound} size={18} color="currentColor" />
            </span>
            <div>
              <p className="text-sm font-medium text-ink">先说一声你是谁</p>
              <p className="mx-auto mt-1 max-w-[21rem] text-balance text-xs leading-relaxed text-muted">
                和友链留言板是同一个账号 —— 用邮箱收个验证码就行，不用设密码。
                登录一次，之后在站内哪儿说话都不用再填名字。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-crimson px-4 text-sm font-medium text-white shadow-[0_6px_18px_rgba(194,58,85,0.25)] transition-[transform,background-color] duration-300 hover:scale-[1.03] q-press"
              >
                <MorphIcon icon={KeyRound} size={14} color="currentColor" />
                登录 / 注册
              </button>
              {config.github && (
                <a
                  href={githubLoginUrl()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose/30 bg-white px-3.5 text-sm text-ink transition-colors hover:border-crimson/45 hover:text-crimson"
                >
                  <GithubMark size={14} />
                  GitHub
                </a>
              )}
            </div>
          </div>
        ) : (
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void handleSubmit();
            }}
            noValidate
            className="relative mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/55 transition-colors focus-within:border-rose/45"
          >
            {/* 不强制登录时，登录只是个「省事」的选项 —— 给一条不挡路的小入口 */}
            {authReady && !me && !config.requireLogin && (
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-dashed border-rose/25 px-4 py-2 text-[11px] text-subtle">
                <MorphIcon icon={UserRound} size={11} color="currentColor" />
                <span>以前说过话？</span>
                <button
                  type="button"
                  onClick={() => setLoginOpen(true)}
                  className="font-medium text-crimson underline underline-offset-2 transition-colors hover:text-crimson/80"
                >
                  登录
                </button>
                <span>一下，之后不用再填，也能管自己的评论</span>
                {config.github && (
                  <a
                    href={githubLoginUrl()}
                    className="ml-auto inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-crimson"
                  >
                    <GithubMark size={11} />
                    GitHub
                  </a>
                )}
              </div>
            )}

            {/* 登录之后上面挂一条「我是谁」；三格收起来 */}
            {me && (
              <div className="border-b border-dashed border-rose/25 px-4 py-3">
                <AccountStrip
                  account={me}
                  github={config.github}
                  onAccountChange={(next) => setMe(next)}
                  onLogout={() => {
                    void logoutApi();
                    setMe(null);
                    setNotice({ kind: 'warn', text: '退出了。下次评论还要重新登录 ~' });
                  }}
                  onDeleted={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                  onLocate={(id, where) => {
                    // 同一篇文章就地滚；别的页面就跳过去（评论区会读 hash 自己定位）
                    if (!where || where === path) locateEntry(id);
                    else window.location.href = `${where}#${id}`;
                  }}
                />
              </div>
            )}

            {/* 三格只在未登录时出现 */}
            {!me && (
              <div className="flex items-stretch border-b border-dashed border-rose/25">
                <span
                  aria-hidden="true"
                  className="ml-4 mr-1 hidden h-9 w-9 shrink-0 items-center justify-center self-center overflow-hidden rounded-full bg-rose/15 ring-1 ring-rose/25 sm:flex"
                >
                  {mailSrc ? (
                    <img
                      src={mailSrc}
                      alt=""
                      width={36}
                      height={36}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() => setMailStage((s) => s + 1)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-subtle">
                      <MorphIcon icon={Mail} size={15} color="currentColor" />
                    </span>
                  )}
                </span>

                <div className="grid min-w-0 flex-1 divide-y divide-dashed divide-rose/25 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  {/* 浮动标签：空且未聚焦时嵌在框内，聚焦或有内容就缩到 11px 挪到框上方。
                      靠 `placeholder=" "` + `:placeholder-shown` 判断有没有值 ——
                      所以那**一个空格不能删**。 */}
                  <label className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-4">
                    <span className="shrink-0 self-center text-rose">
                      <MorphIcon icon={UserRound} size={14} color="currentColor" />
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <input
                        id={`${uid}-name`}
                        name="name"
                        value={values.name}
                        maxLength={APPLY_LIMITS.name}
                        placeholder=" "
                        autoComplete="nickname"
                        onChange={(ev) => setField('name', ev.target.value)}
                        aria-invalid={errors.name ? true : undefined}
                        className={inputCls()}
                      />
                      <span
                        className={`pointer-events-none absolute left-0 top-0 text-sm leading-5 transition-all duration-200 ease-out peer-focus:-top-4 peer-focus:text-[11px] peer-focus:leading-4 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:leading-4 ${
                          errors.name ? 'text-crimson' : 'text-subtle/85'
                        }`}
                      >
                        你的名字
                      </span>
                    </span>
                  </label>

                  <label className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-4">
                    <span className="shrink-0 self-center text-rose">
                      <MorphIcon icon={Mail} size={14} color="currentColor" />
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <input
                        id={`${uid}-email`}
                        name="email"
                        type="email"
                        inputMode="email"
                        value={values.email}
                        maxLength={APPLY_LIMITS.email}
                        placeholder=" "
                        autoComplete="email"
                        onChange={(ev) => setField('email', ev.target.value)}
                        aria-invalid={errors.email ? true : undefined}
                        className={inputCls()}
                      />
                      <span
                        className={`pointer-events-none absolute left-0 top-0 text-sm leading-5 transition-all duration-200 ease-out peer-focus:-top-4 peer-focus:text-[11px] peer-focus:leading-4 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:leading-4 ${
                          errors.email ? 'text-crimson' : 'text-subtle/85'
                        }`}
                      >
                        邮箱（不公开）
                      </span>
                    </span>
                  </label>

                  <label className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-4">
                    <span className="shrink-0 self-center text-rose">
                      <MorphIcon icon={Link2} size={14} color="currentColor" />
                    </span>
                    <span className="relative min-w-0 flex-1">
                      <input
                        id={`${uid}-url`}
                        name="url"
                        value={values.url}
                        maxLength={APPLY_LIMITS.url}
                        placeholder=" "
                        inputMode="url"
                        autoComplete="url"
                        onChange={(ev) => setField('url', ev.target.value)}
                        aria-invalid={errors.url ? true : undefined}
                        className={inputCls()}
                      />
                      <span
                        className={`pointer-events-none absolute left-0 top-0 text-sm leading-5 transition-all duration-200 ease-out peer-focus:-top-4 peer-focus:text-[11px] peer-focus:leading-4 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:leading-4 ${
                          errors.url ? 'text-crimson' : 'text-subtle/85'
                        }`}
                      >
                        网址（可不填）
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* 正文 */}
            <div className="px-4 pt-3.5">
              <label htmlFor={`${uid}-intro`} className="sr-only">
                评论内容
              </label>
              <textarea
                id={`${uid}-intro`}
                name="intro"
                ref={introRef}
                value={values.intro}
                maxLength={CONTENT_MAX}
                rows={3}
                placeholder="写点什么吧，支持少量 Markdown（**粗体**、`代码`、列表、> 引用、链接）~"
                onChange={(ev) => setField('intro', ev.target.value)}
                onFocus={() => setIntroFocused(true)}
                onBlur={() => setIntroFocused(false)}
                onKeyDown={(ev) => {
                  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
                    ev.preventDefault();
                    void handleSubmit();
                  }
                }}
                aria-invalid={errors.intro ? true : undefined}
                className={`block w-full resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-ink outline-none transition-[height] duration-300 ease-out placeholder:text-subtle/85 motion-reduce:transition-none ${
                  introOpen ? 'h-[8.5rem]' : 'h-[4.25rem]'
                }`}
              />
            </div>

            {firstError && (
              <p role="alert" className="flex items-center gap-1.5 px-4 pb-1 text-xs text-crimson">
                <MorphIcon icon={CircleAlert} size={12} color="currentColor" />
                {firstError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-1.5">
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEmojiOpen((v) => !v)}
                    aria-expanded={emojiOpen}
                    aria-label="插入表情"
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
                      emojiOpen
                        ? 'border-crimson/40 bg-crimson/10 text-crimson'
                        : 'border-rose/25 bg-white/60 text-muted hover:border-rose/45 hover:bg-rose/10 hover:text-crimson'
                    }`}
                  >
                    <MorphIcon icon={Smile} size={13} color="currentColor" />
                    表情
                  </button>
                  <EmojiPicker
                    open={emojiOpen}
                    onPick={(key) => insertEmoji(key)}
                    onClose={() => setEmojiOpen(false)}
                  />
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2.5">
                <span className="hidden text-[11px] text-subtle sm:inline">Ctrl / ⌘ + Enter</span>
                <span className="text-[11px] tabular-nums text-subtle">
                  {values.intro.length} / {CONTENT_MAX}
                </span>

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="btn-ripple inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-crimson px-4 text-sm font-medium text-white shadow-[0_6px_18px_rgba(194,58,85,0.3)] transition-[transform,background-color,color] duration-300 hover:scale-[1.03] q-press disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted disabled:shadow-none disabled:hover:scale-100"
                >
                  {status === 'submitting' ? (
                    <>
                      <span className="animate-spin">
                        <MorphIcon icon={LoaderCircle} size={14} color="#fff" />
                      </span>
                      发送中…
                    </>
                  ) : (
                    <>
                      <MorphIcon icon={Send} size={14} color="currentColor" />
                      发送
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}

        {notice && (
          <p
            role={notice.kind === 'ok' ? 'status' : 'alert'}
            className={`relative mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
              notice.kind === 'ok' ? 'border border-rose/25 bg-rose/12 text-muted' : 'bg-crimson/8 text-crimson'
            }`}
          >
            <span className={`mt-0.5 shrink-0 ${notice.kind === 'ok' ? 'text-crimson' : ''}`}>
              <MorphIcon
                icon={notice.kind === 'ok' ? CircleCheck : CircleAlert}
                size={13}
                color="currentColor"
              />
            </span>
            {notice.text}
          </p>
        )}

        {/* ——— 列表 ——— */}
        <ol className="relative mt-3 divide-y divide-rose/15">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex gap-3 rounded-[calc(var(--radius-card)-8px)] px-2.5 py-3">
                  <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-rose/15" />
                  <div className="flex-1 space-y-2 py-1">
                    <span className="block h-3 w-28 animate-pulse rounded bg-rose/15" />
                    <span className="block h-3 w-3/4 animate-pulse rounded bg-rose/10" />
                  </div>
                </li>
              ))
            : entries.map((e) => (
                <CommentRow
                  key={e.id}
                  entry={e}
                  now={now}
                  fresh={e.id === freshId}
                  highlight={e.id === hlId}
                  liked={liked.includes(e.id)}
                  onLike={() => void toggleLike(e.id)}
                  onReply={(reply) => void addReply(e.id, reply)}
                  // 两种凭据都算「我的」：账号（换设备也能删）或本机 token
                  canDelete={Boolean(owned[e.id]) || Boolean(e.mine)}
                  onDelete={() => void removeEntry(e.id)}
                  account={me}
                  requireLogin={config.requireLogin}
                  onNeedLogin={() => setLoginOpen(true)}
                />
              ))}

          {!loading && count === 0 && (
            <li className="py-10 text-center">
              <p className="font-hand text-xl text-muted">还没有人说话</p>
              <p className="mt-1.5 text-xs text-subtle">这条评论就留给你了 ~</p>
            </li>
          )}
        </ol>

        {!loading && hasMore && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={moreBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose/30 bg-white/70 px-4 text-xs text-muted transition-colors hover:border-crimson/45 hover:text-crimson disabled:opacity-60"
            >
              {moreBusy ? (
                <span className="animate-spin">
                  <MorphIcon icon={LoaderCircle} size={12} color="currentColor" />
                </span>
              ) : (
                <MorphIcon icon={ChevronDown} size={12} color="currentColor" />
              )}
              {moreBusy ? '正在找更早的…' : '加载更早的评论'}
            </button>
          </div>
        )}
        {!loading && !hasMore && count > 0 && (
          <p className="mt-5 text-center text-[11px] text-subtle">到最早的一条了</p>
        )}
      </div>

      <LoginDialog
        open={loginOpen}
        config={config}
        onClose={() => setLoginOpen(false)}
        onDone={(account) => {
          setMe(account);
          setLoginOpen(false);
          setNotice({ kind: 'ok', text: '登录好了，写吧 ~' });
          // 身份变了，「我的」标记与点赞态都要重算 —— 重新拉一遍第一页
          void loadPostComments(path)
            .then((page) => {
              setEntries([...page.items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
              setHasMore(page.hasMore);
              setCursor(page.nextBefore);
            })
            .catch(() => undefined);
        }}
      />
    </section>
  );
}

/* —————————————————————————— 单条评论 —————————————————————————— */

function CommentRow({
  entry,
  now,
  fresh,
  highlight,
  liked,
  onLike,
  onReply,
  canDelete,
  onDelete,
  account,
  requireLogin,
  onNeedLogin,
}: {
  entry: FriendEntry;
  now: number;
  fresh?: boolean;
  highlight?: boolean;
  liked: boolean;
  onLike: () => void;
  onReply: (reply: FriendReply) => void;
  canDelete: boolean;
  onDelete: () => void | Promise<void>;
  account: SessionAccount | null;
  requireLogin: boolean;
  onNeedLogin: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<{ id: string; name: string } | null>(null);
  const [rName, setRName] = useState('');
  const [rEmail, setREmail] = useState('');
  const [rText, setRText] = useState('');
  /** 默认 @ 对方并发信；访客可以点掉 */
  const [notify, setNotify] = useState(true);
  const [brokenReplyAvatar, setBrokenReplyAvatar] = useState<Record<string, boolean>>({});
  const [replyAvatarSrc, setReplyAvatarSrc] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const initial = (entry.name || '·').trim().slice(0, 1);
  /**
   * 头像三档：服务端已经在 `avatar` 里给了「档案 → 存的 URL → 邮箱哈希」的结果，
   * 前端只管「这张图挂了怎么办」—— 先退 Cravatar，再退首字。
   */
  const [avatarSrc, setAvatarSrc] = useState(entry.avatar || avatarFromHash(entry.emailHash || ''));
  const failAvatar = () => {
    const fallback = avatarFromHash(entry.emailHash || '');
    if (fallback && !avatarSrc.includes('cravatar.cn')) {
      setAvatarSrc(fallback);
      return;
    }
    setBroken(true);
  };
  const replies = entry.replies ?? [];
  const replySrcOf = (r: FriendReply) =>
    replyAvatarSrc[r.id] ?? (r.avatar || avatarFromHash(r.emailHash || ''));

  function failReplyAvatar(r: FriendReply) {
    const current = replySrcOf(r);
    const fallback = avatarFromHash(r.emailHash || '');
    if (fallback && !current.includes('cravatar.cn')) {
      setReplyAvatarSrc((prev) => ({ ...prev, [r.id]: fallback }));
      return;
    }
    setBrokenReplyAvatar((prev) => ({ ...prev, [r.id]: true }));
  }

  const likes = entry.likes ?? 0;

  function openReplyForm(target: { id: string; name: string } | null) {
    // 要登录才能回：直接弹登录，别让人写完再被拒
    if (requireLogin && !account) {
      onNeedLogin();
      return;
    }
    if (account) setRName((v) => v || account.name);
    setReplyTarget(target);
    setReplyOpen(true);
  }

  function submitReply() {
    const text = rText.trim();
    if (!text) return;
    if (requireLogin && !account) {
      onNeedLogin();
      return;
    }
    const targetName = replyTarget?.name || entry.name;
    onReply({
      id: `r-${Date.now()}`,
      name: account ? account.name : rName.trim() || '匿名朋友',
      email: account ? '' : rEmail.trim(),
      url: '',
      to: notify ? targetName : '',
      notify,
      replyToId: replyTarget?.id || '',
      avatar: account ? account.avatar : '',
      emailHash: account ? account.emailHash : '',
      intro: text,
      at: new Date().toISOString(),
    });
    setRText('');
    setReplyOpen(false);
    setReplyTarget(null);
    setRepliesOpen(true);
  }

  return (
    <li
      id={entry.id}
      className={`-mx-1 flex scroll-mt-28 gap-3 rounded-[calc(var(--radius-card)-8px)] px-3 py-3.5 transition-colors duration-500 ${
        highlight
          ? 'bg-crimson/8 ring-2 ring-crimson/35'
          : fresh
            ? 'bg-crimson/6 ring-1 ring-crimson/20'
            : 'hover:bg-white/45'
      }`}
    >
      {/* 首字打底、图片盖上去：图还在加载 / 彻底挂了都不会是一个空圆 */}
      <span className="relative mt-px grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-rose/35 to-amber/25 ring-2 ring-white/70">
        <span aria-hidden="true" className="absolute font-display text-[15px] leading-none text-crimson">
          {initial}
        </span>
        {avatarSrc && !broken && (
          <img
            src={avatarSrc}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={failAvatar}
            className="relative h-full w-full object-cover"
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-[12rem] truncate text-[13.5px] font-medium leading-5 text-ink">
            {entry.name}
          </span>
          {isAiAuthor(entry.name, entry.avatar) && <AiBadge />}
          {entry.admin && <OwnerBadge />}
          <time dateTime={entry.at} className="shrink-0 text-[11px] tabular-nums text-subtle">
            {now ? timeAgo(entry.at, now) : '\u00A0'}
          </time>
        </div>

        {/* 正文完整显示；renderRich 先转义再加白名单标签，所以可以放心用 innerHTML */}
        <div
          className="q-rich mt-1.5 w-fit max-w-[94%] rounded-xl rounded-tl-[5px] bg-rose/12 px-3 py-2 text-[13.5px] text-muted"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderRich(entry.intro) }}
        />

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onLike}
            aria-pressed={liked}
            aria-label={liked ? `取消点赞，当前 ${likes} 个赞` : `点赞，当前 ${likes} 个赞`}
            className={`inline-flex min-h-7 items-center gap-1 rounded-full px-1.5 text-[11px] tabular-nums transition-colors ${
              liked ? 'bg-crimson/10 text-crimson' : 'text-subtle hover:bg-white/50 hover:text-crimson'
            }`}
          >
            <MorphIcon icon={Heart} size={12} color="currentColor" />
            {likes || '赞'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (replyOpen && !replyTarget) {
                setReplyOpen(false);
                return;
              }
              openReplyForm(null);
            }}
            aria-expanded={replyOpen}
            className={`inline-flex min-h-7 items-center gap-1 rounded-full px-1.5 text-[11px] transition-colors ${
              replyOpen ? 'bg-crimson/10 text-crimson' : 'text-subtle hover:bg-white/50 hover:text-crimson'
            }`}
          >
            <MorphIcon icon={MessageCircle} size={12} color="currentColor" />
            回复
          </button>

          {replies.length > 0 && (
            <button
              type="button"
              onClick={() => setRepliesOpen(!repliesOpen)}
              aria-expanded={repliesOpen}
              className="ml-1 inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-rose/25 bg-white/70 px-2.5 text-[11px] text-muted transition-colors hover:border-rose/45 hover:text-crimson"
            >
              <MorphIcon icon={repliesOpen ? ChevronUp : ChevronDown} size={12} color="currentColor" />
              {repliesOpen ? '收起回复' : `展开回复 ${replies.length}`}
            </button>
          )}

          {/* 自己的评论才有删除。两段确认，避免手滑 —— 评论区没有回收站 */}
          {canDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={async () => {
                if (!confirming) {
                  setConfirming(true);
                  window.setTimeout(() => setConfirming(false), 3500);
                  return;
                }
                setDeleting(true);
                await onDelete();
                setDeleting(false);
                setConfirming(false);
              }}
              className={`ml-auto inline-flex min-h-7 shrink-0 items-center rounded-full px-2 text-[11px] transition-colors disabled:opacity-60 ${
                confirming
                  ? 'bg-crimson/10 font-medium text-crimson'
                  : 'text-subtle hover:bg-crimson/10 hover:text-crimson'
              }`}
            >
              {deleting ? '删除中…' : confirming ? '确认删除？' : '删除'}
            </button>
          )}
        </div>

        {/* 回复框：默认收起。抬头那个 @ 是个开关 —— 点掉就不 @ 对方、也不发邮件 */}
        {replyOpen && (
          <div className="mt-2 rounded-xl border border-rose/25 bg-white/60 p-2.5">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
              <span className="text-subtle">回复</span>
              <button
                type="button"
                onClick={() => setNotify((v) => !v)}
                aria-pressed={notify}
                title={notify ? '点一下取消 @，对方不会收到邮件' : '点一下恢复 @，发送时会邮件通知对方'}
                className={`inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors ${
                  notify
                    ? 'border-crimson/30 bg-crimson/8 text-crimson hover:bg-crimson/15'
                    : 'border-rose/30 bg-white/70 text-subtle hover:text-ink'
                }`}
              >
                {notify ? (
                  <>
                    @{replyTarget?.name || entry.name}
                    <MorphIcon icon={X} size={9} color="currentColor" />
                  </>
                ) : (
                  <>不 @ 对方</>
                )}
              </button>
              <span className="text-subtle/80">{notify ? '· 会邮件通知对方' : '· 不会发邮件打扰他'}</span>
            </div>

            {/* 登录后名字/邮箱由账号补；未登录才给两个格子 */}
            {account ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-subtle">
                <MorphIcon icon={UserRound} size={10} color="currentColor" />
                以 {account.name} 的身份回复
              </p>
            ) : (
              <div className="mt-1.5 grid divide-y divide-dashed divide-rose/20 border-y border-dashed border-rose/20 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <label className="relative block min-w-0 px-0.5 py-1 sm:px-2">
                  <input
                    value={rName}
                    maxLength={APPLY_LIMITS.name}
                    onChange={(ev) => setRName(ev.target.value)}
                    placeholder=" "
                    autoComplete="off"
                    className="peer block w-full min-w-0 bg-transparent pt-3 pb-0.5 text-xs leading-4 text-ink outline-none placeholder:text-transparent"
                  />
                  <span className="pointer-events-none absolute left-0.5 top-[12px] text-xs text-subtle/85 transition-all duration-200 ease-out peer-focus:top-0 peer-focus:text-[10px] peer-focus:leading-3 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:leading-3 sm:left-2">
                    你的名字（可不填）
                  </span>
                </label>
                <label className="relative block min-w-0 px-0.5 py-1 sm:px-2">
                  <input
                    value={rEmail}
                    type="email"
                    maxLength={APPLY_LIMITS.email}
                    onChange={(ev) => setREmail(ev.target.value)}
                    placeholder=" "
                    autoComplete="off"
                    className="peer block w-full min-w-0 bg-transparent pt-3 pb-0.5 text-xs leading-4 text-ink outline-none placeholder:text-transparent"
                  />
                  <span className="pointer-events-none absolute left-0.5 top-[12px] text-xs text-subtle/85 transition-all duration-200 ease-out peer-focus:top-0 peer-focus:text-[10px] peer-focus:leading-3 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:leading-3 sm:left-2">
                    邮箱（不公开）
                  </span>
                </label>
              </div>
            )}

            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={rText}
                maxLength={500}
                onChange={(ev) => setRText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    submitReply();
                  }
                }}
                placeholder="回复这一条…"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle/85"
              />
              <button
                type="button"
                onClick={() => {
                  setReplyOpen(false);
                  setReplyTarget(null);
                }}
                className="shrink-0 rounded-full px-2 py-1 text-[11px] text-subtle transition-colors hover:text-ink"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitReply}
                disabled={!rText.trim()}
                className="shrink-0 rounded-lg bg-crimson px-3 py-1 text-[11px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted"
              >
                发送
              </button>
            </div>
          </div>
        )}

        {/* 楼中楼：只做一层，默认折着 */}
        {replies.length > 0 && repliesOpen && (
          <ul className="mt-2 flex flex-col gap-2.5 border-l border-rose/20 pl-3">
            {replies.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span className="relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-rose/25">
                  <span
                    aria-hidden="true"
                    className="absolute font-display text-[11px] leading-none text-crimson"
                  >
                    {(r.name || '·').trim().slice(0, 1)}
                  </span>
                  {replySrcOf(r) && !brokenReplyAvatar[r.id] && (
                    <img
                      src={replySrcOf(r)}
                      onError={() => failReplyAvatar(r)}
                      alt=""
                      width={24}
                      height={24}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="relative h-6 w-6 object-cover"
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-ink">{r.name}</span>
                    {isAiAuthor(r.name, r.avatar) && <AiBadge />}
                    {r.admin && <OwnerBadge />}
                    <time dateTime={r.at} className="text-[10.5px] tabular-nums text-subtle">
                      {now ? timeAgo(r.at, now) : '\u00A0'}
                    </time>
                    <button
                      type="button"
                      onClick={() => openReplyForm({ id: r.id, name: r.name })}
                      aria-label={`回复 ${r.name}`}
                      className="inline-flex min-h-5 items-center rounded-full px-1 text-[10.5px] text-subtle transition-colors hover:bg-white/60 hover:text-crimson"
                    >
                      回复
                    </button>
                  </div>
                  {/* @ 放在正文上方一行：正文可能是列表/代码块，塞进 <p> 里会变成非法嵌套 */}
                  {r.to && <span className="mr-1 text-[12px] font-medium text-crimson">@{r.to}</span>}
                  <div
                    className="q-rich mt-0.5 text-[12.5px] text-muted"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: renderRich(r.intro) }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/* —————————————————————————— 小零件 —————————————————————————— */

/** 单行输入框：`peer` 给浮动标签用，`placeholder=" "` 才能靠 :placeholder-shown 判断空值 */
function inputCls() {
  return 'peer block w-full min-w-0 bg-transparent py-0 text-sm leading-5 text-ink outline-none placeholder:text-transparent';
}
