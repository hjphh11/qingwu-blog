import { useEffect, useId, useMemo, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  Send,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  Mail,
  Link2,
  Globe,
  ClipboardList,
  Sparkles,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Heart,
  MessageCircle,
  ChevronDown,
  ChevronUp,
  X,
} from '../lib/icons';
import {
  COMMENT_TEMPLATE,
  FRIENDS_BOARD_DEMO,
  hostOf,
  loadFriendEntries,
  normalizeUrl,
  deleteEntry,
  dropToken,
  readLiked,
  readTokens,
  saveToken,
  submitFriendEntry,
  submitReply as submitReplyApi,
  toggleLike as toggleLikeApi,
  timeAgo,
  writeLiked,
  type FriendEntry,
  type FriendReply,
} from '../lib/friendsBoard';
import { APPLY_LIMITS } from '../lib/applyValidation';
import { avatarFromEmail, avatarFromHash, emailHash as emailHashOf } from '../lib/avatar';

/**
 * 友链页底部 · 申请友链的评论区
 *
 * 形态对齐参考站（Waline）：**评论框常驻在列表上方**，不是「点开才展开」。
 *   · 上面一行三个字段：站点名称 / 邮箱（不公开）/ 网址
 *   · 下面一个大文本框写介绍或留言，左下角能一键插入模板
 *   · 提交后新条目插进列表最前，提示就贴在表单下面
 *
 * 数据现在是演示的（见 `src/lib/friendsBoard.ts` 的 FRIENDS_BOARD_DEMO）。
 * ⚠️ 预览阶段提交只插在本地、不落库，界面上会明说，不能假装成功。
 */

type Status = 'idle' | 'submitting';

/** 留言比「一句介绍」长得多 —— 贴完整模板也放得下 */
const CONTENT_MAX = 300;

/**
 * 「本站 AI」的署名。
 *
 * 站长会用爱弥斯的身份回话，这类发言要能一眼和真人访客区分开，
 * 所以名字旁边挂一个 AI 小标。判据取「署名」**或**「爱弥斯头像」——
 * 只看名字的话，改了昵称就漏标；只看头像的话，头像加载失败也不该丢标。
 */
const AI_AUTHOR = '爱弥斯';

function isAiAuthor(name: string, avatar?: string): boolean {
  return (name || '').trim() === AI_AUTHOR || /images\/emis\/avatar/i.test(avatar || '');
}

/** 名字旁边那枚 AI 小胶囊，配色跟「已是友链」同一套，只是更小一号 */
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

const EMPTY = { name: '', email: '', url: '', intro: '' };

type SortKey = 'new' | 'old';

export default function FriendsBoard() {
  const uid = useId();
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const [values, setValues] = useState(EMPTY);
  /**
   * 正文框的高度：默认只占 3 行（68px），点进去或已经有内容才展开成 6 行（136px）。
   * 有内容也算展开态 —— 否则贴了模板后失焦会被裁成 3 行，看到的和发出的不一样。
   */
  const [introFocused, setIntroFocused] = useState(false);
  const introOpen = introFocused || values.intro.trim().length > 0;
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [sort, setSort] = useState<SortKey>('new');
  /**
   * 邮箱头像的加载阶梯：0 = QQ 头像（QQ 邮箱）/ Cravatar，1 = 强制 Cravatar，2 = 放弃。
   * 邮箱一改就回到 0 重试 —— QQ 头像接口在部分网络下会 400（本机实测过）。
   */
  const [mailStage, setMailStage] = useState(0);
  /** 本机点过赞的条目 id —— 演示阶段存 localStorage，接后端后由接口返回 */
  const [liked, setLiked] = useState<string[]>([]);
  /** 自己发过的留言 → 删除凭证。只有这里有的条目才显示「删除」 */
  const [owned, setOwned] = useState<Record<string, string>>({});
  /** 刚提交成功的那条 —— 高亮一会儿，并从任何筛选里都可见 */
  const [freshId, setFreshId] = useState('');

  // 相对时间要等客户端算：SSR 与客户端各算一次会水合不匹配（见 timeAgo 注释）
  useEffect(() => setNow(Date.now()), []);
  // 本机点过哪些赞：只能在客户端读（localStorage 在 SSR 里不存在）
  useEffect(() => setLiked(readLiked()), []);
  // 自己发过哪些留言（凭证）—— 决定哪些条目显示删除按钮
  useEffect(() => setOwned(readTokens()), []);
  // 换邮箱就回到第 0 级重试头像（上一张可能是 QQ 接口挂了）
  useEffect(() => setMailStage(0), [values.email]);

  useEffect(() => {
    let alive = true;
    loadFriendEntries()
      .then((list) => {
        if (!alive) return;
        // 新的在上，和评论区的阅读顺序一致
        setEntries([...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
      })
      .catch(() => {
        if (alive) setNotice({ kind: 'warn', text: '申请列表没加载出来，不过上面照样可以写 ~' });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const count = entries.length;
  /** 填了邮箱就按 Gravatar/QQ 规则算出预览头像 —— 和 Waline 一个路子 */
  const mailAvatar = useMemo(() => avatarFromEmail(values.email), [values.email]);
  const mailSrc =
    mailStage === 0 ? mailAvatar : mailStage === 1 ? avatarFromHash(emailHashOf(values.email)) : '';
  /** 只报第一条错：三个字段挤在一行，每条都堆一行红字会把表单撑散 */
  const firstError = useMemo(() => Object.values(errors).find(Boolean) ?? '', [errors]);

  const sorted = useMemo(
    // entries 入库时已经是「新的在前」，所以 old 只是就地翻过来
    () => (sort === 'new' ? entries : [...entries].reverse()),
    [entries, sort],
  );

  function setField(key: keyof typeof EMPTY, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const e: Partial<Record<keyof typeof EMPTY, string>> = {};
    const name = values.name.trim();
    const url = normalizeUrl(values.url);
    const intro = values.intro.trim();
    const email = values.email.trim();

    if (!name) e.name = '请填一下站点名称';
    else if (name.length > APPLY_LIMITS.name) e.name = `名称最多 ${APPLY_LIMITS.name} 个字`;
    if (!values.url.trim()) e.url = '请填一下站点网址';
    else if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) e.url = '网址看起来不太对，例如 example.com';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) e.email = '邮箱格式看起来不太对';
    if (!intro) e.intro = '写一句介绍吧，哪怕只有几个字';
    else if (intro.length > CONTENT_MAX) e.intro = `最多 ${CONTENT_MAX} 个字`;

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /**
   * 提交后把小爱的回复接进来。
   *
   * 她在服务端的 `waitUntil` 里回话（judge 判一次 + 起草一次，通常 2~4 秒），
   * 前端拿不到"她说完了"的信号，只能隔一会儿拉一次列表看。
   * 三次、每次 2 秒，总共 6 秒够用；拉不到就停 —— 这是锦上添花，
   * 不该因为它失败给访客弹个红字。
   *
   * 一旦看到她回了（或者这条已经不在了）就提前收手，别做无谓的轮询。
   */
  function pollReply(id: string, round = 0) {
    if (round >= 3) return;
    window.setTimeout(async () => {
      try {
        const list = await loadFriendEntries();
        const own = list.find((e) => e.id === id);
        setEntries([...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
        if (!own || (own.replies?.length ?? 0) > 0) return;
      } catch {
        /* 网络抖一下就等下一轮 */
      }
      pollReply(id, round + 1);
    }, 2000);
  }

  async function handleSubmit() {
    setNotice(null);
    if (!validate()) return;
    setStatus('submitting');
    const res = await submitFriendEntry(values);
    setStatus('idle');

    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    setEntries((prev) => [res.entry, ...prev]);
    // 把删除凭证记在本机，之后这条才删得掉
    saveToken(res.entry.id, res.deleteToken);
    setOwned((prev) => ({ ...prev, [res.entry.id]: res.deleteToken }));
    setValues(EMPTY);
    setSort('new');
    setFreshId(res.entry.id);
    window.setTimeout(() => setFreshId(''), 3600);
    setNotice({
      kind: 'ok',
      // 预览阶段必须说清楚：没有真的发出去
      text: FRIENDS_BOARD_DEMO
        ? '已经加进下面这一页了 —— 预览模式，这条没有真的发出去。'
        : '收到啦，小爱看完就会回你 ~',
    });
    if (!FRIENDS_BOARD_DEMO) pollReply(res.entry.id);
  }

  /**
   * 点赞 / 取消。
   *
   * 演示模式：只改本机状态（localStorage 记住点过哪些，避免刷新后重复点涨）。
   * 接上后端后走接口，票数以服务端返回为准 —— 所以两种模式下都把结果写回
   * `entry.likes`，条目里直接用这个数，不再另算。
   */
  async function toggleLike(id: string) {
    const isLiked = liked.includes(id);
    if (FRIENDS_BOARD_DEMO) {
      const next = isLiked ? liked.filter((x) => x !== id) : [...liked, id];
      setLiked(next);
      writeLiked(next);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, likes: Math.max(0, (e.likes ?? 0) + (isLiked ? -1 : 1)) } : e)),
      );
      return;
    }
    const res = await toggleLikeApi(id);
    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, likes: res.likes } : e)));
    setLiked((prev) => (res.liked ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id)));
  }

  /** 删掉自己发的那条（服务端软删，成功后从本地列表移除） */
  async function removeEntry(id: string) {
    const token = owned[id];
    if (!token) return;
    const res = await deleteEntry(id, token);
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

  /**
   * 回复：挂到对应条目下（只一层，不嵌套）。
   * 演示模式直接用前端造的那条；真实模式等接口返回再插，
   * 顺便让后端把邮件发给被回复的人（他留言时填了邮箱才会发）。
   */
  async function addReply(id: string, reply: FriendReply) {
    if (FRIENDS_BOARD_DEMO) {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, replies: [...(e.replies ?? []), reply] } : e)),
      );
      return;
    }
    const res = await submitReplyApi(id, {
      name: reply.name,
      email: reply.email,
      url: reply.url,
      avatar: reply.avatar,
      notify: reply.notify,
      intro: reply.intro,
    });
    if (!res.ok) {
      setNotice({ kind: 'warn', text: res.message });
      return;
    }
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, replies: [...(e.replies ?? []), { ...res.reply, to: reply.to }] }
          : e,
      ),
    );
  }

  function fillTemplate() {
    setValues((prev) => {
      const body = prev.intro.trim();
      // 有内容就追加，别把人家写了半天的东西盖掉
      return { ...prev, intro: body ? `${body}\n${COMMENT_TEMPLATE}` : COMMENT_TEMPLATE };
    });
    if (errors.intro) setErrors((prev) => ({ ...prev, intro: undefined }));
  }

  return (
    <section id="friends-comments" aria-labelledby="fc-title" className="mt-16 scroll-mt-24">
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
            <h2 id="fc-title" className="flex items-center gap-2.5 font-display text-[1.5rem] text-ink">
              <span className="h-5 w-1 rounded-full bg-crimson/80" aria-hidden="true" />
              门口说说话
            </h2>
            <p className="ml-auto text-xs text-subtle tabular-nums">
              {loading
                ? '正在看看有谁来过…'
                : count > 0
                  ? now
                    ? `最近一条 · ${timeAgo(entries[0].at, now)}`
                    : '\u00A0'
                  : '还没有人留言'}
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            想换友链，或者只是路过打个招呼 —— 都写在这儿吧 ~
          </p>
        </header>

        {FRIENDS_BOARD_DEMO && (
          <p className="relative mt-4 flex items-start gap-2 rounded-[calc(var(--radius-card)-6px)] border border-dashed border-amber/50 bg-amber/12 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            <span className="mt-0.5 shrink-0 text-amber">
              <MorphIcon icon={Sparkles} size={14} color="currentColor" />
            </span>
            <span>
              <strong className="font-medium text-ink">预览版</strong>
              ：下面几条是演示数据，留言、点赞、回复都只加在你自己这一页 ——
              不会真的存下来，也不会发通知邮件。
            </span>
          </p>
        )}

        {/* ——— 评论框：常驻在列表上方 ——— */}
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void handleSubmit();
          }}
          noValidate
          className="relative mt-4 rounded-[var(--radius-card)] border border-rose/25 bg-white/55 transition-colors focus-within:border-rose/45"
        >
          {/* 左边是邮箱头像预览（填了邮箱才会亮），右边三字段一行。
              移动端藏头像 —— 三格本来就堆叠，再挤个圆更窄 */}
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
            {/* 浮动标签：空且未聚焦时嵌在框内（和原来的占位符一样的位置），
                聚焦或有内容就缩到 11px 挪到框上方并常驻。
                靠 `placeholder=" "` + `:placeholder-shown` 判断有没有值 ——
                所以那**一个空格不能删**，删了整个状态就失效。 */}
            <label className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-4">
              <span className="shrink-0 self-center text-rose">
                <MorphIcon icon={Globe} size={14} color="currentColor" />
              </span>
              <span className="relative min-w-0 flex-1">
                <input
                  id={`${uid}-name`}
                  name="name"
                  value={values.name}
                  maxLength={APPLY_LIMITS.name}
                  placeholder=" "
                  autoComplete="off"
                  onChange={(ev) => setField('name', ev.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                  className={inputCls()}
                />
                <span
                  className={`pointer-events-none absolute left-0 top-0 text-sm leading-5 transition-all duration-200 ease-out peer-focus:-top-4 peer-focus:text-[11px] peer-focus:leading-4 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:leading-4 ${
                    errors.name ? 'text-crimson' : 'text-subtle/85'
                  }`}
                >
                  站点名称
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
                  网址
                </span>
              </span>
            </label>
            </div>
          </div>

          {/* 正文 */}
          <div className="px-4 pt-3.5">
            <label htmlFor={`${uid}-intro`} className="sr-only">
              介绍或留言
            </label>
            <textarea
              id={`${uid}-intro`}
              name="intro"
              value={values.intro}
              maxLength={CONTENT_MAX}
              rows={3}
              placeholder="写一句介绍，或者只是说句你好 ~ 也可以点左下角「插入模板」。"
              onChange={(ev) => setField('intro', ev.target.value)}
              // 点进去就长高（3 行 → 6 行），失焦且空着再收回去
              onFocus={() => setIntroFocused(true)}
              onBlur={() => setIntroFocused(false)}
              // 写完顺手 Ctrl/⌘ + Enter 就发，不用挪到按钮上
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
            <p
              role="alert"
              className="flex items-center gap-1.5 px-4 pb-1 text-xs text-crimson"
            >
              <MorphIcon icon={CircleAlert} size={12} color="currentColor" />
              {firstError}
            </p>
          )}

          {/* 工具条：左边模板/表单，右边字数/发送。
              分成两组是有原因的 —— 全塞进一个 flex 时，窄屏换行会把「发送」甩到第二行最左，
              ml-auto 只对同一行里的下一个元素生效。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={fillTemplate}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-rose/25 bg-white/60 px-3 text-xs text-muted transition-colors hover:border-rose/45 hover:bg-rose/10 hover:text-crimson"
              >
                <MorphIcon icon={ClipboardList} size={13} color="currentColor" />
                插入模板
              </button>

              <a
                href="/links/apply"
                title="要填站点照片、邮箱这些不公开的信息时用"
                className="inline-flex min-h-8 items-center rounded-full px-2 text-xs text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
              >
                完整申请表
              </a>
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

        {notice && (
          <p
            role={notice.kind === 'ok' ? 'status' : 'alert'}
            className={`relative mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
              notice.kind === 'ok'
                ? 'border border-rose/25 bg-rose/12 text-muted'
                : 'bg-crimson/8 text-crimson'
            }`}
          >
            <span
              className={`mt-0.5 shrink-0 ${notice.kind === 'ok' ? 'text-crimson' : ''}`}
            >
              <MorphIcon
                icon={notice.kind === 'ok' ? CircleCheck : CircleAlert}
                size={13}
                color="currentColor"
              />
            </span>
            {notice.text}
          </p>
        )}

        {/* ——— 列表上方：只留排序 ———
            筛选那排（全部 / 已是友链 / 等我看看）用户说没必要，去掉了；
            条数在标题右侧的「最近一条」和每条的状态徽章上已经能看出来。 */}
        {!loading && count > 0 && (
          <div className="relative mt-4 flex items-center justify-end border-b border-rose/15 pb-2.5">
            <button
              type="button"
              onClick={() => setSort(sort === 'new' ? 'old' : 'new')}
              aria-label={sort === 'new' ? '当前最新在前，点击改为最早在前' : '当前最早在前，点击改为最新在前'}
              className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-subtle transition-colors hover:text-crimson"
            >
              <MorphIcon
                icon={sort === 'new' ? ArrowDownWideNarrow : ArrowUpWideNarrow}
                size={13}
                color="currentColor"
              />
              {/* 窄屏用短文案，长的那版会把按钮挤到第二行 */}
              <span className="sm:hidden">{sort === 'new' ? '最新' : '最早'}</span>
              <span className="hidden sm:inline">{sort === 'new' ? '最新在前' : '最早在前'}</span>
            </button>
          </div>
        )}

        {/* ——— 公开列表 ——— */}
        <ol className="relative mt-2 divide-y divide-rose/15">
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
            : sorted.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  now={now}
                  fresh={e.id === freshId}
                  liked={liked.includes(e.id)}
                  onLike={() => toggleLike(e.id)}
                  onReply={(reply) => addReply(e.id, reply)}
                  canDelete={Boolean(owned[e.id])}
                  onDelete={() => removeEntry(e.id)}
                />
              ))}

          {!loading && count === 0 && (
            <li className="py-10 text-center">
              <p className="font-hand text-xl text-muted">还没有人说话</p>
              <p className="mt-1.5 text-xs text-subtle">第一条留言就留给你了 ~</p>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

/* —————————————————————————— 单条留言 —————————————————————————— */

function EntryRow({
  entry,
  now,
  fresh,
  liked,
  onLike,
  onReply,
  canDelete,
  onDelete,
}: {
  entry: FriendEntry;
  now: number;
  fresh?: boolean;
  liked: boolean;
  onLike: () => void;
  onReply: (reply: FriendReply) => void;
  /** 本机有这个条目的删除凭证 —— 说明是我自己发的 */
  canDelete: boolean;
  onDelete: () => void | Promise<void>;
}) {
  const [broken, setBroken] = useState(false);
  /** 回复默认折起来（参考站就是「展开回复」那个按钮），点一下才铺开 */
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [rName, setRName] = useState('');
  const [rEmail, setREmail] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rText, setRText] = useState('');
  /** 回复时默认 @ 主楼作者并发信；访客可以点掉这个开关 */
  const [notify, setNotify] = useState(true);
  /** 加载失败的回复头像 —— 回落到名字首字，别留一个空圆 */
  const [brokenReplyAvatar, setBrokenReplyAvatar] = useState<Record<string, boolean>>({});
  /** 删除要按两下：第一下变成「确认删除？」，3.5 秒没再点就复位 */
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const approved = entry.status === 'approved';
  const host = hostOf(entry.url);
  const initial = (entry.name || '·').trim().slice(0, 1);
  /**
   * 头像：提交时就把「没填头像但有邮箱」的地址算好了。
   * 但 QQ 头像接口会挂（本机实测 400），所以加载失败时先退 Cravatar，
   * 还不行才回落到名字首字 —— 三档兜底。
   */
  const [avatarSrc, setAvatarSrc] = useState(entry.avatar);
  const failAvatar = () => {
    const fallback = avatarFromHash(entry.emailHash || '');
    if (fallback && !avatarSrc.includes('cravatar.cn')) {
      setAvatarSrc(fallback);
      return;
    }
    setBroken(true);
  };
  const replies = entry.replies ?? [];
  /** 票数只认 entry.likes：演示模式在 toggleLike 里就改好了，真实模式是服务端返回的 */
  const likes = entry.likes ?? 0;

  function submitReply() {
    const text = rText.trim();
    if (!text) return;
    onReply({
      id: `r-${Date.now()}`,
      name: rName.trim() || '匿名朋友',
      email: rEmail.trim(),
      url: rUrl.trim(),
      // 自动 @ 被回复的人 —— 访客不用自己打，邮件通知也靠这个找到收件人。
      // 访客把 @ 点掉了就不给 to，服务端也就不发信。
      to: notify ? entry.name : '',
      notify,
      intro: text,
      at: new Date().toISOString(),
    });
    setRText('');
    setReplyOpen(false);
    setRepliesOpen(true);
  }

  return (
    /* 整行给一层 hover 底色：列表长起来之后，鼠标在哪一条上要看得出来。
       刚发出去的那条用浅绯红底 + 细描边标一会儿，方便一眼找到自己写的 */
    <li
      className={`-mx-1 flex gap-3 rounded-[calc(var(--radius-card)-8px)] px-3 py-3.5 transition-colors duration-500 ${
        fresh ? 'bg-crimson/6 ring-1 ring-crimson/20' : 'hover:bg-white/45'
      }`}
    >
      <span className="mt-px h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-rose/35 to-amber/25 ring-2 ring-white/70">
        {avatarSrc && !broken ? (
          <img
            src={avatarSrc}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            // 外站头像同样会被 Referer 防盗链拦掉，和友链墙一个道理
            referrerPolicy="no-referrer"
            onError={failAvatar}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center font-display text-[15px] text-crimson">
            {initial}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* 名字 / 徽章 / 域名 / 时间一行。
            必须允许换行：窄屏硬挤会把名字和域名都截成「AIOVT…」「exampl…」，
            挤不下就折到第二行，比截断好读。 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-[9rem] truncate text-[13.5px] font-medium leading-5 text-ink">
            {entry.name}
          </span>
          {isAiAuthor(entry.name, entry.avatar) && <AiBadge />}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] leading-[18px] ${
              approved
                ? 'bg-crimson/10 text-crimson'
                : 'border border-amber/45 bg-amber/10 text-brown'
            }`}
          >
            {approved ? (
              <MorphIcon icon={CircleCheck} size={9} color="currentColor" />
            ) : (
              <span className="h-1 w-1 rounded-full bg-amber" aria-hidden="true" />
            )}
            {approved ? '已是友链' : '等我看看'}
          </span>
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 max-w-[9rem] shrink truncate text-[11px] text-subtle transition-colors hover:text-crimson"
          >
            {host}
          </a>
          <time dateTime={entry.at} className="shrink-0 text-[11px] tabular-nums text-subtle">
            {now ? timeAgo(entry.at, now) : '\u00A0'}
          </time>
        </div>

        {/* 内容包成气泡：参考站就是这么区分的 —— 头像 + 一块浅底文本，
            比「一条条横线」更像在说话。上左圆角收小，气泡像是从头像那侧发出来的 */}
        {/* 正文完整显示 —— 用户要的是「评论不折，只折回复」：
            申请模板本来就是一段段写下来的，折起来反而看不全 */}
        <p className="mt-1.5 w-fit max-w-[94%] whitespace-pre-wrap rounded-xl rounded-tl-[5px] bg-rose/12 px-3 py-2 text-[13.5px] leading-relaxed text-muted">
          {entry.intro}
        </p>

        {/* ——— 点赞 / 回复 ——— */}
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
            onClick={() => setReplyOpen(!replyOpen)}
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
              <MorphIcon
                icon={repliesOpen ? ChevronUp : ChevronDown}
                size={12}
                color="currentColor"
              />
              {repliesOpen ? '收起回复' : `展开回复 ${replies.length}`}
            </button>
          )}

          {/* 自己的留言才有删除。两段确认，避免手滑 —— 评论区没有回收站 */}
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

        {/* 回复框：默认收起，点了「回复」才出现。
            抬头那个 @ 是个开关 —— 点掉就不 @ 对方，服务端也就不发通知邮件。 */}
        {replyOpen && (
          <div className="mt-2 rounded-xl border border-rose/25 bg-white/60 p-2.5">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
              <span className="text-subtle">回复</span>
              <button
                type="button"
                onClick={() => setNotify((v) => !v)}
                aria-pressed={notify}
                title={
                  notify ? '点一下取消 @，对方不会收到邮件' : '点一下恢复 @，发送时会邮件通知对方'
                }
                className={`inline-flex min-h-5 items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors ${
                  notify
                    ? 'border-crimson/30 bg-crimson/8 text-crimson hover:bg-crimson/15'
                    : 'border-rose/30 bg-white/70 text-subtle hover:text-ink'
                }`}
              >
                {notify ? (
                  <>
                    @{entry.name}
                    <MorphIcon icon={X} size={9} color="currentColor" />
                  </>
                ) : (
                  <>
                    不 @ 对方
                  </>
                )}
              </button>
              <span className="text-subtle/80">
                {notify ? '· 会邮件通知对方' : '· 不会发邮件打扰他'}
              </span>
            </div>

            {/* 三个字段，和主留言框对齐：名字 / 邮箱 / 网址。
                同样是浮动标签 —— 回复框更窄，字号比主框再小一档 */}
            <div className="mt-1.5 grid divide-y divide-dashed divide-rose/20 border-y border-dashed border-rose/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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
              <label className="relative block min-w-0 px-0.5 py-1 sm:px-2">
                <input
                  value={rUrl}
                  maxLength={APPLY_LIMITS.url}
                  onChange={(ev) => setRUrl(ev.target.value)}
                  placeholder=" "
                  autoComplete="off"
                  className="peer block w-full min-w-0 bg-transparent pt-3 pb-0.5 text-xs leading-4 text-ink outline-none placeholder:text-transparent"
                />
                <span className="pointer-events-none absolute left-0.5 top-[12px] text-xs text-subtle/85 transition-all duration-200 ease-out peer-focus:top-0 peer-focus:text-[10px] peer-focus:leading-3 peer-focus:text-crimson peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:leading-3 sm:left-2">
                  网址（可不填）
                </span>
              </label>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <input
                value={rText}
                maxLength={200}
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
                onClick={() => setReplyOpen(false)}
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

        {/* 楼中楼：只做一层，缩进 + 左侧竖线，和主楼区分开。默认折着，点「展开回复」才铺开 */}
        {replies.length > 0 && repliesOpen && (
          <ul className="mt-2 flex flex-col gap-2.5 border-l border-rose/20 pl-3">
            {replies.map((r) => (
              <li key={r.id} className="flex gap-2">
                {/* 站长用爱弥斯身份回复时自带头像；访客回复仍是名字首字 */}
                {r.avatar && !brokenReplyAvatar[r.id] ? (
                  <img
                    src={r.avatar}
                    onError={() => setBrokenReplyAvatar((prev) => ({ ...prev, [r.id]: true }))}
                    alt=""
                    width={24}
                    height={24}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-rose/15 object-cover"
                  />
                ) : (
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose/25 font-display text-[11px] leading-none text-crimson">
                    {(r.name || '·').trim().slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-ink">{r.name}</span>
                    {isAiAuthor(r.name, r.avatar) && <AiBadge />}
                    <time dateTime={r.at} className="text-[10.5px] tabular-nums text-subtle">
                      {now ? timeAgo(r.at, now) : '\u00A0'}
                    </time>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                    {r.to && (
                      <span className="mr-1 font-medium text-crimson">@{r.to}</span>
                    )}
                    {r.intro}
                  </p>
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
