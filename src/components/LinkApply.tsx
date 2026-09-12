import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import {
  Globe,
  Link2,
  ImageIcon,
  MessageSquareText,
  Mail,
  Send,
  CircleCheck,
  CircleAlert,
  Info,
  ArrowLeft,
  Sparkles,
  LoaderCircle,
} from '../lib/icons';
import { SITE } from '../config';
import {
  APPLY_EMPTY,
  APPLY_FIELD_KEYS,
  APPLY_LIMITS,
  normalizeValues,
  validateApply,
  type ApplyFieldKey,
  type ApplyErrors,
  type ApplyValues,
} from '../lib/applyValidation';

// 友链申请页(后台方案 · 阶段 A 外观/交互 + 阶段 B 真提交)
//
// 提交行为是「能力驱动」的：
//   · 服务端 GET /api/links/apply 返回 { enabled }
//   · enabled=true  → 真提交(校验 → Turnstile → 私有仓库 → 邮件)
//   · enabled=false → 回退到「通道建设中 + 邮件兜底」，**不假装成功**
// 这样在密钥还没配好时，线上访客也不会遇到看不懂的提交失败。

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

type FieldDef = {
  key: ApplyFieldKey;
  label: string;
  icon: unknown;
  placeholder: string;
  hint: string;
  maxLength?: number;
};

const FIELDS: FieldDef[] = [
  { key: 'name', label: '站点名称', icon: Globe, placeholder: '清吾', hint: '你站点的名字' },
  {
    key: 'url',
    label: '站点网址',
    icon: Link2,
    placeholder: 'https://example.com',
    hint: '不写 https:// 也可以，我会自动补全',
  },
  {
    key: 'avatar',
    label: '头像链接',
    icon: ImageIcon,
    placeholder: 'https://example.com/avatar.png',
    hint: '一张方形头像的图片直链',
  },
  {
    key: 'intro',
    label: '一句介绍',
    icon: MessageSquareText,
    placeholder: '写技术、记生活的一个温馨小屋',
    hint: `最多 ${APPLY_LIMITS.intro} 字，会显示在友链卡片上`,
    maxLength: APPLY_LIMITS.intro,
  },
  {
    key: 'email',
    label: '联系邮箱',
    icon: Mail,
    placeholder: 'you@example.com',
    hint: '只用来联系你，不会公开',
  },
];

/** 本站在别人站上应有的信息，方便对方回加（取自 SITE，单一来源） */
const MY_INFO = [
  { label: '站点名称', value: SITE.title },
  { label: '站点描述', value: SITE.description },
  { label: '站点链接', value: SITE.url },
  { label: '头像链接', value: `${SITE.url}/images/avatar.jpg` },
  { label: 'RSS 地址', value: `${SITE.url}/rss.xml` },
];

// 'fallback' 只用于「这次没能存进去」；'duplicate' 是「已经收到过了」——
// 两者文案完全相反，必须分开。早期把 409 也塞进 fallback，结果弹出
// 「通道还在建设中，请邮件发我」，和「已收到你的申请」自相矛盾。
type Status = 'editing' | 'submitting' | 'sent' | 'duplicate' | 'fallback';

/** fallback 的两种语气：通道本来就没开 vs 这一次操作失败了 */
type FallbackKind = 'building' | 'error';

export default function LinkApply({ siteKey = '' }: { siteKey?: string }) {
  const reduce = useReducedMotion();
  const [values, setValues] = useState<ApplyValues>(APPLY_EMPTY);
  const [errors, setErrors] = useState<ApplyErrors>({});
  const [touched, setTouched] = useState<Partial<Record<ApplyFieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<Status>('editing');
  const [copied, setCopied] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [turnstileMsg, setTurnstileMsg] = useState('');
  const [serverMessage, setServerMessage] = useState('');
  const [fallbackKind, setFallbackKind] = useState<FallbackKind>('building');

  const turnstileBox = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const norm = useMemo(() => normalizeValues(values), [values]);

  const mailto = useMemo(() => {
    const body = FIELDS.map((f) => `${f.label}：${norm[f.key]}`).join('\n');
    return `mailto:${SITE.email}?subject=${encodeURIComponent(
      `友链申请 · ${norm.name || '新朋友'}`,
    )}&body=${encodeURIComponent(body)}`;
  }, [norm]);

  // ——— 能力探测：服务端能不能真收 ———
  useEffect(() => {
    let cancelled = false;
    fetch('/api/links/apply', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => {
        if (!cancelled) setEnabled(d?.enabled === true);
      })
      .catch(() => {
        // 探测失败就当作「还不能收」，走诚实兜底而不是让访客提交后失败
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ——— Turnstile 人机验证控件 ———
  useEffect(() => {
    if (!siteKey || enabled !== true) return;
    let cancelled = false;

    const renderWidget = () => {
      if (cancelled || widgetId.current) return;
      if (!turnstileBox.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(turnstileBox.current, {
        sitekey: siteKey,
        language: 'zh-cn',
        theme: 'light',
        callback: (t: string) => {
          setToken(t);
          setTurnstileMsg('');
        },
        'expired-callback': () => setToken(''),
        'error-callback': () => {
          setToken('');
          setTurnstileMsg('验证组件出错了，可以刷新页面重试，或直接用邮件发给我');
        },
      });
    };

    if (window.turnstile) {
      renderWidget();
      return () => {
        cancelled = true;
      };
    }

    const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const existing = document.querySelector<HTMLScriptElement>('script[data-qw-turnstile]');
    if (existing) {
      existing.addEventListener('load', renderWidget);
      return () => {
        cancelled = true;
        existing.removeEventListener('load', renderWidget);
      };
    }

    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.dataset.qwTurnstile = '1';
    s.addEventListener('load', renderWidget);
    s.addEventListener('error', () =>
      setTurnstileMsg('人机验证组件加载失败，可以先用邮件发给我'),
    );
    document.head.appendChild(s);

    return () => {
      cancelled = true;
    };
  }, [siteKey, enabled]);

  const copyText = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setCopied(tag);
    window.setTimeout(() => setCopied(''), 1500);
  };

  const setField = (key: ApplyFieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const blurField = (key: ApplyFieldKey) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setErrors(validateApply(normalizeValues(values)));
  };

  const resetToEditing = () => {
    setStatus('editing');
    setSubmitted(false);
    setTouched({});
    setErrors({});
    setServerMessage('');
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    const next = validateApply(norm);
    setErrors(next);
    const firstBad = APPLY_FIELD_KEYS.find((k) => next[k]);
    if (firstBad) {
      document.getElementById(`apply-${firstBad}`)?.focus();
      return;
    }

    // 服务端还没能力收 → 走诚实兜底，不假装提交成功
    if (enabled !== true) {
      setServerMessage('');
      setFallbackKind('building');
      setStatus('fallback');
      return;
    }
    if (siteKey && !token) {
      setTurnstileMsg('请先完成上面的人机验证 ~');
      return;
    }

    setStatus('submitting');
    try {
      const res = await fetch('/api/links/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ ...norm, turnstileToken: token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        fields?: ApplyErrors;
      };

      if (res.ok && data.ok) {
        setStatus('sent');
        return;
      }

      // 服务端字段校验(前端被绕过时的兜底)
      if (data.error === 'validation' && data.fields) {
        setErrors(data.fields);
        setStatus('editing');
        const bad = APPLY_FIELD_KEYS.find((k) => data.fields?.[k]);
        if (bad) document.getElementById(`apply-${bad}`)?.focus();
        return;
      }

      // 人机验证没过 → 重置控件让访客重试
      if (data.error === 'turnstile') {
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
        setToken('');
        setTurnstileMsg(data.message || '人机验证没通过，请重试');
        setStatus('editing');
        return;
      }

      // 已经收到过这份申请(同邮箱/同站点/24h 内重复)——这是**好消息**，不是失败。
      // 绝对不能弹「通道还在建设中，请邮件发我」：东西早就收到了。
      if (data.error === 'duplicate') {
        setServerMessage(data.message || '');
        setStatus('duplicate');
        return;
      }

      // 通道压根没开(503)—— 只有这种才可以说「还在建设中」
      if (data.error === 'unavailable') {
        setServerMessage(data.message || '');
        setFallbackKind('building');
        setStatus('fallback');
        return;
      }

      // 存储失败(502)/其它 —— 这一次确实没存进去，用「没能提交」的语气
      setServerMessage(data.message || '');
      setFallbackKind('error');
      setStatus('fallback');
    } catch {
      setServerMessage('网络好像出了点问题');
      setFallbackKind('error');
      setStatus('fallback');
    }
  };

  const showError = (key: ApplyFieldKey) =>
    (submitted || touched[key]) && errors[key] ? errors[key] : undefined;

  const inputCls = (bad: boolean) =>
    `w-full rounded-full border bg-white/60 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink/35 focus:ring-2 focus:ring-rose/20 ${
      bad ? 'border-crimson/60 focus:border-crimson' : 'border-rose/25 focus:border-rose/60'
    }`;

  const primaryBtn =
    'btn-ripple inline-flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_rgba(224,82,107,0.35)] transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100';

  const savedBody = FIELDS.map((f) => `${f.label}：${norm[f.key]}`).join('\n');

  return (
    <div className="flex flex-col gap-8">
      {/* 事先说清楚：还不能在线收（能力探测为 false 时才出现，别让访客白填） */}
      {enabled === false && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={reduce ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber/40 bg-amber/15 p-4 text-sm text-ink/80"
        >
          <span className="mt-0.5 shrink-0 text-amber">
            <MorphIcon icon={Info} size={17} color="currentColor" />
          </span>
          <p className="leading-relaxed">
            <span className="font-medium">在线提交通道还在建设中</span>
            ：表单已经能填、能校验，但正式接收申请的功能还没开放。
            现在填好后可以用「用邮件发给我」把整理好的信息一次发过来，我会收到。
          </p>
        </motion.div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ——— 左：申请表单 / 结果面板 ——— */}
        <div className="min-w-0">
          {status === 'sent' ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card p-7 text-center"
            >
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose/25 text-crimson">
                <MorphIcon icon={CircleCheck} size={26} color="currentColor" />
              </span>
              <h2 className="mt-4 font-display text-2xl text-ink">申请已提交</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">
                收到啦，谢谢你来敲门 ~ 我会尽快查看，
                通过了就加进
                <a href="/links" className="mx-1 text-crimson underline-offset-2 hover:underline">
                  友链页
                </a>
                。
              </p>
              <dl className="mt-5 space-y-2 rounded-[var(--radius-card)] border border-rose/20 bg-white/40 p-4 text-left text-sm">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex gap-3">
                    <dt className="w-20 shrink-0 text-ink/50">{f.label}</dt>
                    <dd className="min-w-0 flex-1 break-all text-ink">{norm[f.key]}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href="/links" className={primaryBtn}>
                  <MorphIcon icon={Link2} size={16} color="#fff" />
                  回到友链页
                </a>
                <button
                  type="button"
                  onClick={() => copyText(savedBody, 'sent')}
                  className="btn-ripple inline-flex items-center gap-2 rounded-full border border-rose/30 bg-white/60 px-5 py-2.5 text-sm text-ink transition-colors hover:border-rose/60 hover:text-crimson"
                >
                  {copied === 'sent' ? '已复制 ✓' : '复制申请信息'}
                </button>
              </div>
              <p className="mt-4 text-xs text-ink/50">
                想补充或修改？直接回一封邮件给我也行：{SITE.email}
              </p>
            </motion.div>
          ) : status === 'duplicate' ? (
            /* 已经收到过这份申请 —— 这不是失败，别推邮件、别提「建设中」 */
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card p-7 text-center"
            >
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose/25 text-crimson">
                <MorphIcon icon={CircleCheck} size={26} color="currentColor" />
              </span>
              <h2 className="mt-4 font-display text-2xl text-ink">已经收到过你的申请啦</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">
                {serverMessage || '这份申请已经在列表里了 ~'}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-ink/50">
                不用重复提交 —— 我会尽快看，通过了就加进
                <a href="/links" className="mx-1 text-crimson underline-offset-2 hover:underline">
                  友链页
                </a>
                。
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href="/links" className={primaryBtn}>
                  <MorphIcon icon={Link2} size={16} color="#fff" />
                  回到友链页
                </a>
                <button
                  type="button"
                  onClick={resetToEditing}
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm text-ink/60 transition-colors hover:text-crimson"
                >
                  <MorphIcon icon={ArrowLeft} size={15} color="currentColor" />
                  换一个站点提交
                </button>
              </div>
            </motion.div>
          ) : status === 'fallback' ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="glass-card p-7 text-center"
            >
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose/25 text-crimson">
                <MorphIcon icon={CircleCheck} size={26} color="currentColor" />
              </span>
              <h2 className="mt-4 font-display text-2xl text-ink">
                {fallbackKind === 'building' ? '信息检查完毕' : '这次没能提交成功'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">
                {serverMessage ||
                  (fallbackKind === 'building'
                    ? '表单校验全部通过，看起来没什么问题 ~'
                    : '不好意思，刚才没能把你的申请收进来。')}
              </p>

              <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber/40 bg-amber/15 p-4 text-left text-sm text-ink/80">
                <span className="mt-0.5 shrink-0 text-amber">
                  <MorphIcon icon={Info} size={17} color="currentColor" />
                </span>
                <p className="leading-relaxed">
                  {fallbackKind === 'building' ? (
                    <>
                      <span className="font-medium">在线提交通道还在建设中</span>
                      —— 现在请先用下面的按钮把信息发给我，我一定看得到。
                    </>
                  ) : (
                    <>
                      <span className="font-medium">可以稍后再试一次</span>
                      ，或者直接用下面的按钮把信息发给我 —— 我一定会看到。
                    </>
                  )}
                </p>
              </div>

              <dl className="mt-5 space-y-2 rounded-[var(--radius-card)] border border-rose/20 bg-white/40 p-4 text-left text-sm">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex gap-3">
                    <dt className="w-20 shrink-0 text-ink/50">{f.label}</dt>
                    <dd className="min-w-0 flex-1 break-all text-ink">{norm[f.key]}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href={mailto} className={primaryBtn}>
                  <MorphIcon icon={Mail} size={16} color="#fff" />
                  用邮件发给我
                </a>
                <button
                  type="button"
                  onClick={() => copyText(savedBody, 'apply')}
                  className="btn-ripple inline-flex items-center gap-2 rounded-full border border-rose/30 bg-white/60 px-5 py-2.5 text-sm text-ink transition-colors hover:border-rose/60 hover:text-crimson"
                >
                  {copied === 'apply' ? '已复制 ✓' : '复制申请信息'}
                </button>
                <button
                  type="button"
                  onClick={resetToEditing}
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm text-ink/60 transition-colors hover:text-crimson"
                >
                  <MorphIcon icon={ArrowLeft} size={15} color="currentColor" />
                  返回修改
                </button>
              </div>
            </motion.div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
              noValidate
              className="glass-card p-7"
            >
              <h2 className="flex items-center gap-2 font-display text-xl text-ink">
                <span className="text-rose">
                  <MorphIcon icon={Sparkles} size={18} color="currentColor" />
                </span>
                填写你的站点信息
              </h2>
              <p className="mt-1.5 text-sm text-ink/60">带 * 的是必填，其余都可以慢慢来 ~</p>

              <div className="mt-6 flex flex-col gap-5">
                {FIELDS.map((f) => {
                  const bad = showError(f.key);
                  const errId = `apply-${f.key}-err`;
                  return (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`apply-${f.key}`}
                        className="flex items-center gap-2 text-sm font-medium text-ink/80"
                      >
                        <span className="text-rose">
                          <MorphIcon icon={f.icon as never} size={16} color="currentColor" />
                        </span>
                        {f.label}
                        <span className="text-crimson">*</span>
                        {f.maxLength && (
                          <span className="ml-auto text-xs font-normal text-ink/40 tabular-nums">
                            {values[f.key].length} / {f.maxLength}
                          </span>
                        )}
                      </label>

                      <input
                        id={`apply-${f.key}`}
                        name={f.key}
                        type={f.key === 'email' ? 'email' : 'text'}
                        inputMode={f.key === 'email' ? 'email' : 'text'}
                        autoComplete={
                          f.key === 'email'
                            ? 'email'
                            : f.key === 'url' || f.key === 'avatar'
                              ? 'url'
                              : 'off'
                        }
                        maxLength={f.maxLength}
                        placeholder={f.placeholder}
                        value={values[f.key]}
                        onChange={(e) => setField(f.key, e.target.value)}
                        onBlur={() => blurField(f.key)}
                        aria-invalid={bad ? true : undefined}
                        aria-describedby={bad ? errId : undefined}
                        className={inputCls(Boolean(bad))}
                      />

                      {bad ? (
                        <p
                          id={errId}
                          role="alert"
                          className="flex items-center gap-1.5 pl-1 text-xs text-crimson"
                        >
                          <MorphIcon icon={CircleAlert} size={13} color="currentColor" />
                          {bad}
                        </p>
                      ) : (
                        <p className="pl-1 text-xs text-ink/40">{f.hint}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 人机验证(仅在服务端具备接收能力、且配了站点密钥时出现) */}
              {enabled === true && siteKey && (
                <div className="mt-6 flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink/80">人机验证</span>
                  <div ref={turnstileBox} />
                  {turnstileMsg && (
                    <p role="alert" className="flex items-center gap-1.5 text-xs text-crimson">
                      <MorphIcon icon={CircleAlert} size={13} color="currentColor" />
                      {turnstileMsg}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-7 flex flex-wrap items-center gap-4">
                <button type="submit" disabled={status === 'submitting'} className={primaryBtn}>
                  {status === 'submitting' ? (
                    <>
                      <span className="animate-spin">
                        <MorphIcon icon={LoaderCircle} size={16} color="#fff" />
                      </span>
                      提交中…
                    </>
                  ) : (
                    <>
                      <MorphIcon icon={Send} size={16} color="#fff" />
                      提交申请
                    </>
                  )}
                </button>
                <p className="text-xs leading-relaxed text-ink/50">
                  我会尽快看，通过了就加进
                  <a href="/links" className="mx-1 text-crimson underline-offset-2 hover:underline">
                    友链页
                  </a>
                  ~
                </p>
              </div>
            </form>
          )}
        </div>

        {/* ——— 右：预览卡 + 我的站点信息 ———
            注意：这里**不能**用全局的 `.reveal` 类。`.reveal` 由页面里的
            IntersectionObserver 脚本**直接改 DOM 的 class**(加 is-visible)，
            而这个 <aside> 是 React 渲染的 —— 脚本先加上 class、React 再水合，
            会报 hydration 不匹配，并且之后的重渲染会把 class 抹掉、
            让整栏变回 opacity:0 而「消失」。所以改用 motion 的 whileInView
            自己实现同款「上浮 + 淡入」(参数对齐 global.css 的 .reveal)。 */}
        <motion.aside
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={reduce ? {} : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.08 }}
          transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
          className="flex flex-col gap-6"
        >
          <div className="glass-card p-5">
            <p className="text-sm font-medium text-ink/70">你的卡片会长这样</p>
            <div className="mt-4 flex flex-col items-center gap-3 text-center">
              <img
                src={norm.avatar || '/images/default-avatar.svg'}
                alt=""
                width={72}
                height={72}
                className="h-[72px] w-[72px] rounded-full object-cover ring-2 ring-white/70"
                onError={(e) => {
                  // 头像链接填错时回落到默认头像，方便一眼看出问题
                  (e.currentTarget as HTMLImageElement).src = '/images/default-avatar.svg';
                }}
              />
              <p className="font-display text-lg text-ink">{norm.name || '你的站点名称'}</p>
              <p className="text-sm text-ink/60">
                {norm.intro || '一句话介绍会显示在这里'}
              </p>
              <span className="text-xs text-rose">
                {norm.url ? norm.url.replace(/^https?:\/\//i, '') : 'example.com'}
              </span>
            </div>
          </div>

          <div className="glass-card p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink/70">
              <MorphIcon icon={Link2} size={16} color="currentColor" />
              也把我加进你的友链吧
            </p>
            <dl className="mt-3 space-y-1.5 text-xs">
              {MY_INFO.map((it) => (
                <div key={it.label} className="flex gap-2">
                  <dt className="w-16 shrink-0 text-ink/45">{it.label}</dt>
                  <dd className="min-w-0 flex-1 break-all text-ink/80">{it.value}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={() =>
                copyText(MY_INFO.map((it) => `${it.label}：${it.value}`).join('\n'), 'info')
              }
              className="btn-ripple mt-4 w-full rounded-full border border-rose/30 bg-white/60 px-4 py-2 text-sm text-ink transition-colors hover:border-rose/60 hover:text-crimson"
            >
              {copied === 'info' ? '已复制 ✓' : '一键复制这些信息'}
            </button>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
