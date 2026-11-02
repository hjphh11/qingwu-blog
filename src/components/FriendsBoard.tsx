import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import {
  MessageCircle,
  Send,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  Link2,
  Globe,
  ImageIcon,
  MessageSquareText,
  ChevronDown,
  Sparkles,
} from '../lib/icons';
import {
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
 * 形态对齐的是「留言板」而不是「表单页」：
 *   · 已收到的申请直接铺在公开列表里（头像 / 站点名 / 时间 / 一句话）
 *   · 写的那一头默认只露出一行，点了才展开成表单 —— 一行的时候门槛最低
 *   · 详细字段仍然走 /links/apply（那个页面有照片、邮箱、人机验证）
 *
 * 数据现在是演示的（见 `src/lib/friendsBoard.ts` 的 FRIENDS_BOARD_DEMO）。
 * ⚠️ 预览阶段提交只插在本地、不落库，界面上会明说，不能假装成功。
 */

type Status = 'idle' | 'submitting';

const EMPTY = { name: '', url: '', avatar: '', intro: '' };

export default function FriendsBoard() {
  const reduce = useReducedMotion();
  const uid = useId();
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);

  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(true);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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
        if (alive) setNotice({ kind: 'warn', text: '申请列表没加载出来，不过下面照样可以写 ~' });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 展开后把焦点送进第一个输入框；收起时归还焦点给那一行
  useEffect(() => {
    if (open) nameRef.current?.focus({ preventScroll: true });
  }, [open]);

  const count = entries.length;
  const canSubmit = useMemo(
    () => values.name.trim() !== '' && values.url.trim() !== '' && values.intro.trim() !== '',
    [values],
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
    if (!name) e.name = '还没写站点名字';
    else if (name.length > APPLY_LIMITS.name) e.name = `名字请控制在 ${APPLY_LIMITS.name} 字以内`;
    if (!values.url.trim()) e.url = '还没填网址';
    else if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)) e.url = '网址看起来不太对，例如 example.com';
    if (!intro) e.intro = '写一句介绍吧，哪怕只有几个字';
    else if (intro.length > APPLY_LIMITS.intro) e.intro = `最多 ${APPLY_LIMITS.intro} 个字`;
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
    setOpen(false);
    setNotice({
      kind: 'ok',
      // 预览阶段必须说清楚：没有真的发出去
      text: FRIENDS_BOARD_DEMO
        ? '已经加进下面这一页了 —— 预览模式，这条没有真的发出去。'
        : '收到啦，等我看到就会回你 ~',
    });
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
          <p className="relative mt-5 flex items-start gap-2 rounded-[calc(var(--radius-card)-6px)] border border-dashed border-amber/50 bg-amber/12 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            <span className="mt-0.5 shrink-0 text-amber">
              <MorphIcon icon={Sparkles} size={14} color="currentColor" />
            </span>
            <span>
              <strong className="font-medium text-ink">预览版</strong>
              ：下面几条是演示数据，提交只会加在你自己这一页，不会真的发出去。
            </span>
          </p>
        )}

        {/* ——— 公开列表 ——— */}
        <ol className="relative mt-2">
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

        {/* ——— 写的那一头 ——— */}
        <div className="relative mt-6">
          {!open ? (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setOpen(true);
                setClipped(true);
              }}
              className="group flex w-full items-center gap-3 rounded-full border border-rose/25 bg-white/55 px-3 py-2.5 text-left transition-colors hover:border-rose/45 hover:bg-white/75"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose/25 text-crimson">
                <MorphIcon icon={MessageCircle} size={17} color="currentColor" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-subtle">
                写一句，交个朋友…
              </span>
              <span className="btn-ripple inline-flex min-h-9 shrink-0 items-center rounded-full bg-crimson px-4 text-xs font-medium text-white transition-transform duration-300 group-hover:scale-[1.04]">
                写一条
              </span>
            </button>
          ) : (
            <motion.div
              initial={reduce ? false : { height: 0, opacity: 0 }}
              animate={reduce ? {} : { height: 'auto', opacity: 1 }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              onAnimationComplete={() => setClipped(false)}
              style={clipped ? { overflow: 'hidden' } : undefined}
            >
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void handleSubmit();
                }}
                noValidate
                className="rounded-[var(--radius-card)] border border-rose/25 bg-white/55 p-4 sm:p-5"
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-rose/25 text-crimson">
                    <MorphIcon icon={MessageCircle} size={15} color="currentColor" />
                  </span>
                  <p className="text-sm font-medium text-ink">说点什么</p>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setErrors({});
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-subtle transition-colors hover:text-crimson"
                  >
                    <MorphIcon icon={ChevronDown} size={13} color="currentColor" />
                    收起
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field
                    id={`${uid}-name`}
                    label="站点名称"
                    icon={<MorphIcon icon={Globe} size={14} color="currentColor" />}
                    error={errors.name}
                    required
                  >
                    <input
                      ref={nameRef}
                      id={`${uid}-name`}
                      name="name"
                      value={values.name}
                      maxLength={APPLY_LIMITS.name}
                      placeholder="你的站点名"
                      autoComplete="off"
                      onChange={(ev) => setField('name', ev.target.value)}
                      aria-invalid={errors.name ? true : undefined}
                      className={inputCls(Boolean(errors.name))}
                    />
                  </Field>

                  <Field
                    id={`${uid}-url`}
                    label="站点网址"
                    icon={<MorphIcon icon={Link2} size={14} color="currentColor" />}
                    error={errors.url}
                    required
                  >
                    <input
                      id={`${uid}-url`}
                      name="url"
                      value={values.url}
                      maxLength={APPLY_LIMITS.url}
                      placeholder="example.com"
                      inputMode="url"
                      autoComplete="url"
                      onChange={(ev) => setField('url', ev.target.value)}
                      aria-invalid={errors.url ? true : undefined}
                      className={inputCls(Boolean(errors.url))}
                    />
                  </Field>

                  <Field
                    id={`${uid}-avatar`}
                    label="头像链接"
                    hint="选填"
                    icon={<MorphIcon icon={ImageIcon} size={14} color="currentColor" />}
                    error={errors.avatar}
                  >
                    <input
                      id={`${uid}-avatar`}
                      name="avatar"
                      value={values.avatar}
                      maxLength={APPLY_LIMITS.avatar}
                      placeholder="https://…/avatar.png"
                      inputMode="url"
                      autoComplete="off"
                      onChange={(ev) => setField('avatar', ev.target.value)}
                      className={inputCls(Boolean(errors.avatar))}
                    />
                  </Field>

                  <Field
                    id={`${uid}-intro`}
                    label="一句介绍"
                    icon={<MorphIcon icon={MessageSquareText} size={14} color="currentColor" />}
                    error={errors.intro}
                    required
                    counter={`${values.intro.length}/${APPLY_LIMITS.intro}`}
                  >
                    <textarea
                      id={`${uid}-intro`}
                      name="intro"
                      value={values.intro}
                      maxLength={APPLY_LIMITS.intro}
                      rows={2}
                      placeholder="写技术、记生活的一个小站；或者只是说句你好 ~"
                      onChange={(ev) => setField('intro', ev.target.value)}
                      aria-invalid={errors.intro ? true : undefined}
                      className={`${inputCls(Boolean(errors.intro))} resize-none leading-relaxed`}
                    />
                  </Field>
                </div>

                {notice?.kind === 'warn' && (
                  <p
                    role="alert"
                    className="mt-3 flex items-start gap-1.5 rounded-xl bg-crimson/8 px-3 py-2 text-xs leading-relaxed text-crimson"
                  >
                    <span className="mt-0.5 shrink-0">
                      <MorphIcon icon={CircleAlert} size={13} color="currentColor" />
                    </span>
                    {notice.text}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={status === 'submitting' || !canSubmit}
                    className="btn-ripple inline-flex min-h-10 items-center gap-2 rounded-full bg-crimson px-4 text-sm font-medium text-white shadow-[0_6px_18px_rgba(194,58,85,0.3)] transition-[transform,background-color,color] duration-300 hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted disabled:shadow-none disabled:hover:scale-100"
                  >
                    {status === 'submitting' ? (
                      <>
                        <span className="animate-spin">
                          <MorphIcon icon={LoaderCircle} size={15} color="#fff" />
                        </span>
                        发送中…
                      </>
                    ) : (
                      <>
                        <MorphIcon icon={Send} size={15} color="currentColor" />
                        发送
                      </>
                    )}
                  </button>

                  <p className="text-xs leading-relaxed text-subtle">
                    我会尽快看，通过了就加进上面的友链墙 ~
                  </p>
                </div>

                {/* 公开可见 + 隐私边界：写在提交按钮旁边，比写在标题下更容易被看到 */}
                <p className="mt-3 text-[11px] leading-relaxed text-subtle">
                  发送后会公开显示在上面。站点照片、邮箱这类不公开的信息，走
                  <a
                    href="/links/apply"
                    className="mx-0.5 text-crimson underline-offset-2 hover:underline"
                  >
                    完整申请表
                  </a>
                  填。
                </p>
              </form>
            </motion.div>
          )}

          {notice?.kind === 'ok' && (
            <p
              role="status"
              className="mt-3 flex items-start gap-1.5 rounded-xl border border-rose/25 bg-rose/12 px-3 py-2.5 text-xs leading-relaxed text-muted"
            >
              <span className="mt-0.5 shrink-0 text-crimson">
                <MorphIcon icon={CircleCheck} size={13} color="currentColor" />
              </span>
              {notice.text}
            </p>
          )}
        </div>
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
        <p className="mt-2 w-fit max-w-full rounded-xl rounded-tl-[6px] bg-rose/12 px-3.5 py-2.5 text-sm leading-relaxed text-muted">
          {entry.intro}
        </p>
      </div>
    </li>
  );
}

/* —————————————————————————— 小零件 —————————————————————————— */

function inputCls(bad: boolean) {
  return [
    'w-full rounded-xl border bg-white/70 px-3 py-2 text-sm text-ink outline-none transition-colors',
    'placeholder:text-subtle/70',
    bad
      ? 'border-crimson/60 focus:border-crimson'
      : 'border-rose/25 focus:border-rose/60 focus:bg-white/90',
  ].join(' ');
}

function Field({
  id,
  label,
  icon,
  hint,
  error,
  counter,
  required,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  error?: string;
  counter?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className="text-rose">{icon}</span>
        {label}
        {required ? (
          <span className="text-crimson">*</span>
        ) : (
          hint && <span className="font-normal text-subtle">· {hint}</span>
        )}
        {counter && (
          <span className="ml-auto font-normal tabular-nums text-subtle">{counter}</span>
        )}
      </label>
      {children}
      {error && (
        <p role="alert" className="flex items-center gap-1 pl-1 text-[11px] text-crimson">
          <MorphIcon icon={CircleAlert} size={11} color="currentColor" />
          {error}
        </p>
      )}
    </div>
  );
}
