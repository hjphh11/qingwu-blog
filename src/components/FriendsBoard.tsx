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
} from '../lib/icons';
import {
  COMMENT_TEMPLATE,
  FRIENDS_BOARD_DEMO,
  hostOf,
  loadFriendEntries,
  normalizeUrl,
  submitFriendEntry,
  timeAgo,
  type FriendEntry,
} from '../lib/friendsBoard';
import { APPLY_LIMITS } from '../lib/applyValidation';

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

/** 超过这个长度就折起来（4 行左右），免得一条长留言把整面列表撑开 */
const CLAMP_OVER = 96;

const EMPTY = { name: '', email: '', url: '', intro: '' };

type SortKey = 'new' | 'old';
type FilterKey = 'all' | 'approved' | 'pending';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'approved', label: '已是友链' },
  { key: 'pending', label: '等我看看' },
];

export default function FriendsBoard() {
  const uid = useId();
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const [sort, setSort] = useState<SortKey>('new');
  const [filter, setFilter] = useState<FilterKey>('all');
  /** 刚提交成功的那条 —— 高亮一会儿，并从任何筛选里都可见 */
  const [freshId, setFreshId] = useState('');

  // 相对时间要等客户端算：SSR 与客户端各算一次会水合不匹配（见 timeAgo 注释）
  useEffect(() => setNow(Date.now()), []);

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
  /** 只报第一条错：三个字段挤在一行，每条都堆一行红字会把表单撑散 */
  const firstError = useMemo(() => Object.values(errors).find(Boolean) ?? '', [errors]);

  /** 每个筛选下有几条 —— 数字直接写在胶囊上，比「点进去发现是空的」好 */
  const counts = useMemo(
    () => ({
      all: entries.length,
      approved: entries.filter((e) => e.status === 'approved').length,
      pending: entries.filter((e) => e.status === 'pending').length,
    }),
    [entries],
  );

  const visible = useMemo(() => {
    // entries 入库时已经是「新的在前」，所以 old 只是就地翻过来
    const list = filter === 'all' ? entries : entries.filter((e) => e.status === filter);
    return sort === 'new' ? list : [...list].reverse();
  }, [entries, filter, sort]);

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
    setValues(EMPTY);
    // 新发的是 pending：如果正停在「已是友链」筛选下，会看不见自己刚发的 —— 切回全部
    setFilter('all');
    setSort('new');
    setFreshId(res.entry.id);
    window.setTimeout(() => setFreshId(''), 3600);
    setNotice({
      kind: 'ok',
      // 预览阶段必须说清楚：没有真的发出去
      text: FRIENDS_BOARD_DEMO
        ? '已经加进下面这一页了 —— 预览模式，这条没有真的发出去。'
        : '收到啦，等我看到就会回你 ~',
    });
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
              ：下面几条是演示数据，提交只会加在你自己这一页，不会真的发出去。
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
          {/* 三字段一行。参考站是「昵称 / 邮箱 / 网址」，我们第一格用站点名 */}
          <div className="grid divide-y divide-dashed divide-rose/25 border-b border-dashed border-rose/25 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <label className="flex min-w-0 items-center gap-2 px-4 py-3">
              <span className="text-rose">
                <MorphIcon icon={Globe} size={14} color="currentColor" />
              </span>
              <span className="sr-only">站点名称</span>
              <input
                id={`${uid}-name`}
                name="name"
                value={values.name}
                maxLength={APPLY_LIMITS.name}
                placeholder="站点名称"
                autoComplete="off"
                onChange={(ev) => setField('name', ev.target.value)}
                aria-invalid={errors.name ? true : undefined}
                className={inputCls(Boolean(errors.name))}
              />
            </label>

            <label className="flex min-w-0 items-center gap-2 px-4 py-3">
              <span className="text-rose">
                <MorphIcon icon={Mail} size={14} color="currentColor" />
              </span>
              <span className="sr-only">联系邮箱（不公开）</span>
              <input
                id={`${uid}-email`}
                name="email"
                type="email"
                inputMode="email"
                value={values.email}
                maxLength={APPLY_LIMITS.email}
                placeholder="邮箱（不公开）"
                autoComplete="email"
                onChange={(ev) => setField('email', ev.target.value)}
                aria-invalid={errors.email ? true : undefined}
                className={inputCls(Boolean(errors.email))}
              />
            </label>

            <label className="flex min-w-0 items-center gap-2 px-4 py-3">
              <span className="text-rose">
                <MorphIcon icon={Link2} size={14} color="currentColor" />
              </span>
              <span className="sr-only">站点网址</span>
              <input
                id={`${uid}-url`}
                name="url"
                value={values.url}
                maxLength={APPLY_LIMITS.url}
                placeholder="网址"
                inputMode="url"
                autoComplete="url"
                onChange={(ev) => setField('url', ev.target.value)}
                aria-invalid={errors.url ? true : undefined}
                className={inputCls(Boolean(errors.url))}
              />
            </label>
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
              rows={6}
              placeholder="写一句介绍，或者只是说句你好 ~ 也可以点左下角「插入模板」。"
              onChange={(ev) => setField('intro', ev.target.value)}
              // 写完顺手 Ctrl/⌘ + Enter 就发，不用挪到按钮上
              onKeyDown={(ev) => {
                if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
                  ev.preventDefault();
                  void handleSubmit();
                }
              }}
              aria-invalid={errors.intro ? true : undefined}
              className="block w-full resize-none bg-transparent text-sm leading-relaxed text-ink outline-none placeholder:text-subtle/85"
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
                className="btn-ripple inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-crimson px-4 text-sm font-medium text-white shadow-[0_6px_18px_rgba(194,58,85,0.3)] transition-[transform,background-color,color] duration-300 hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted disabled:shadow-none disabled:hover:scale-100"
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

        {/* ——— 列表工具条：筛选 + 排序 ———
            参照 Waline 的「只看某类 / 按正序倒序」。数字写在胶囊上，
            点之前就知道这个筛选下有几条。 */}
        {!loading && count > 0 && (
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-rose/15 pb-2.5">
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const n = counts[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    aria-pressed={active}
                    className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs transition-colors ${
                      active
                        ? 'bg-crimson/10 font-medium text-crimson'
                        : 'text-subtle hover:bg-white/50 hover:text-ink'
                    }`}
                  >
                    {f.label}
                    <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>

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
            : visible.map((e) => (
                <EntryRow key={e.id} entry={e} now={now} fresh={e.id === freshId} />
              ))}

          {!loading && count === 0 && (
            <li className="py-10 text-center">
              <p className="font-hand text-xl text-muted">还没有人说话</p>
              <p className="mt-1.5 text-xs text-subtle">第一条留言就留给你了 ~</p>
            </li>
          )}

          {!loading && count > 0 && visible.length === 0 && (
            <li className="py-8 text-center text-xs text-subtle">
              这个筛选下还没有人，换一个看看？
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

/* —————————————————————————— 单条留言 —————————————————————————— */

function EntryRow({ entry, now, fresh }: { entry: FriendEntry; now: number; fresh?: boolean }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const approved = entry.status === 'approved';
  const host = hostOf(entry.url);
  const initial = (entry.name || '·').trim().slice(0, 1);
  /** 长留言（或贴了模板那种多行）先折起来，别一条把整面列表撑开 */
  const lines = entry.intro.split('\n');
  const clampable = lines.length > 4 || entry.intro.length > CLAMP_OVER;

  /**
   * 折叠预览用「裁文本」而不是 CSS `line-clamp`。
   *
   * 试过 line-clamp-4：气泡是 `whitespace-pre-wrap`，硬换行 + 行高算下来
   * 第 5 行会露出小半截、也没有省略号（实测截图上就是一条被切掉的「主页截图」）。
   * 模板类留言本来就是按行写的，按行裁最自然；单行长文再按字数兜一下。
   */
  const preview = (() => {
    if (!clampable) return entry.intro;
    if (lines.length > 4) {
      // 省略号接在第 4 行末尾，别单独占一行
      const head = lines.slice(0, 4);
      head[3] = `${head[3]} …`;
      return head.join('\n');
    }
    return `${entry.intro.slice(0, CLAMP_OVER)}…`;
  })();

  return (
    /* 整行给一层 hover 底色：列表长起来之后，鼠标在哪一条上要看得出来。
       刚发出去的那条用浅绯红底 + 细描边标一会儿，方便一眼找到自己写的 */
    <li
      className={`-mx-1 flex gap-3 rounded-[calc(var(--radius-card)-8px)] px-3 py-3.5 transition-colors duration-500 ${
        fresh ? 'bg-crimson/6 ring-1 ring-crimson/20' : 'hover:bg-white/45'
      }`}
    >
      <span className="mt-px h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-rose/35 to-amber/25 ring-2 ring-white/70">
        {entry.avatar && !broken ? (
          <img
            src={entry.avatar}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            // 外站头像同样会被 Referer 防盗链拦掉，和友链墙一个道理
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
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
        <p className="mt-1.5 w-fit max-w-[94%] whitespace-pre-wrap rounded-xl rounded-tl-[5px] bg-rose/12 px-3 py-2 text-[13.5px] leading-relaxed text-muted">
          {open ? entry.intro : preview}
        </p>

        {clampable && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-1 inline-flex min-h-6 items-center text-[11px] text-crimson transition-colors hover:underline"
          >
            {open ? '收起' : '展开全文'}
          </button>
        )}
      </div>
    </li>
  );
}

/* —————————————————————————— 小零件 —————————————————————————— */

function inputCls(bad: boolean) {
  return [
    'w-full min-w-0 bg-transparent text-sm text-ink outline-none',
    bad ? 'placeholder:text-crimson/80' : 'placeholder:text-subtle/85',
  ].join(' ');
}
