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

const EMPTY = { name: '', email: '', url: '', intro: '' };

export default function FriendsBoard() {
  const uid = useId();
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

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
              {loading ? '正在看看有谁来过…' : count > 0 ? `已经有 ${count} 位朋友留过言` : '还没有人留言'}
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

        {/* ——— 公开列表 ——— */}
        <ol className="relative mt-3">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex gap-3.5 py-3.5 first:pt-3">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-rose/15" />
                  <div className="flex-1 space-y-2 py-1">
                    <span className="block h-3 w-28 animate-pulse rounded bg-rose/15" />
                    <span className="block h-3 w-3/4 animate-pulse rounded bg-rose/10" />
                  </div>
                </li>
              ))
            : entries.map((e) => <EntryRow key={e.id} entry={e} now={now} />)}

          {!loading && count === 0 && (
            <li className="py-8 text-center text-sm text-subtle">
              还没有人留言，第一条就留给你了 ~
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

/* —————————————————————————— 单条留言 —————————————————————————— */

function EntryRow({ entry, now }: { entry: FriendEntry; now: number }) {
  const [broken, setBroken] = useState(false);
  const approved = entry.status === 'approved';
  const host = hostOf(entry.url);

  return (
    <li className="flex gap-3.5 py-3.5 first:pt-3">
      <span className="mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-full bg-rose/20 ring-2 ring-white/80">
        {entry.avatar && !broken ? (
          <img
            src={entry.avatar}
            alt=""
            width={44}
            height={44}
            loading="lazy"
            decoding="async"
            // 外站头像同样会被 Referer 防盗链拦掉，和友链墙一个道理
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center font-display text-base text-crimson">
            {(entry.name || '·').slice(0, 1)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* 名字 + 状态 + 域名 + 时间挤在一行：徽章跟着名字走（参考站也是这样），
            时间用 ml-auto 顶到右边，每条的时间就对齐成一列。 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-ink">{entry.name}</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-4 ${
              approved
                ? 'bg-crimson/10 text-crimson'
                : 'border border-amber/45 bg-amber/12 text-brown'
            }`}
          >
            {approved ? (
              <MorphIcon icon={CircleCheck} size={10} color="currentColor" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" />
            )}
            {approved ? '已是友链' : '等我看看'}
          </span>
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 max-w-[9rem] truncate text-xs text-subtle transition-colors hover:text-crimson"
          >
            {host}
          </a>
          <time
            dateTime={entry.at}
            className="shrink-0 pl-1 text-xs tabular-nums text-subtle"
          >
            {now ? timeAgo(entry.at, now) : '\u00A0'}
          </time>
        </div>

        {/* 内容包成气泡：参考站就是这么区分的 —— 头像 + 一块浅底文本，
            比「一条条横线」更像在说话，也更省分隔线。上左圆角收小一点，
            让气泡看起来是从头像那一侧发出来的。 */}
        <p className="mt-2 w-fit max-w-full whitespace-pre-wrap rounded-xl rounded-tl-[6px] bg-rose/12 px-3.5 py-2.5 text-sm leading-relaxed text-muted">
          {entry.intro}
        </p>
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
