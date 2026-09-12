import { useMemo, useState } from 'react';
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
} from '../lib/icons';
import { SITE } from '../config';

// 友链申请页(后台方案 · 阶段 A)：
//   本期只做「页面外观与交互」——完整的前端校验 + 提交交互 + 结果提示，
//   但**提交通道尚未接通**(阶段 B 才接 Vercel 函数 + Upstash + Turnstile)。
//   所以校验通过后不假装成功，而是如实告知「通道建设中」，并给出邮件兜底，
//   让这一页在真实线上是**可用**的，而不是骗访客。

type FieldKey = 'name' | 'url' | 'avatar' | 'intro' | 'email';

type FieldDef = {
  key: FieldKey;
  label: string;
  icon: unknown;
  placeholder: string;
  hint: string;
  maxLength?: number;
};

const FIELDS: FieldDef[] = [
  {
    key: 'name',
    label: '站点名称',
    icon: Globe,
    placeholder: '清吾',
    hint: '你站点的名字',
  },
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
    hint: '最多 60 字，会显示在友链卡片上',
    maxLength: 60,
  },
  {
    key: 'email',
    label: '联系邮箱',
    icon: Mail,
    placeholder: 'you@example.com',
    hint: '只用来联系你，不会公开',
  },
];

const EMPTY: Record<FieldKey, string> = {
  name: '',
  url: '',
  avatar: '',
  intro: '',
  email: '',
};

const URL_RE = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 补全协议头：用户填 example.com 也能用 */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function validate(v: Record<FieldKey, string>): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};

  if (!v.name.trim()) e.name = '请填写站点名称';
  else if (v.name.trim().length > 30) e.name = '站点名称请控制在 30 字以内';

  const url = normalizeUrl(v.url);
  if (!url) e.url = '请填写站点网址';
  else if (!URL_RE.test(url)) e.url = '网址看起来不太对，例如 https://example.com';

  const avatar = normalizeUrl(v.avatar);
  if (!avatar) e.avatar = '请填写头像链接';
  else if (!URL_RE.test(avatar)) e.avatar = '头像链接看起来不太对，需要是一个图片直链';

  if (!v.intro.trim()) e.intro = '请写一句介绍';
  else if (v.intro.trim().length > 60) e.intro = '介绍请控制在 60 字以内';

  if (!v.email.trim()) e.email = '请填写联系邮箱';
  else if (!EMAIL_RE.test(v.email.trim())) e.email = '邮箱格式看起来不太对';

  return e;
}

/** 本站在别人站上应有的信息，方便对方回加（取自 SITE，单一来源） */
const MY_INFO = [
  { label: '站点名称', value: SITE.title },
  { label: '站点描述', value: SITE.description },
  { label: '站点链接', value: SITE.url },
  { label: '头像链接', value: `${SITE.url}/images/avatar.jpg` },
  { label: 'RSS 地址', value: `${SITE.url}/rss.xml` },
];

export default function LinkApply() {
  const reduce = useReducedMotion();
  const [values, setValues] = useState<Record<FieldKey, string>>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState('');

  const norm = useMemo(
    () => ({
      name: values.name.trim(),
      url: normalizeUrl(values.url),
      avatar: normalizeUrl(values.avatar),
      intro: values.intro.trim(),
      email: values.email.trim(),
    }),
    [values],
  );

  const mailto = useMemo(() => {
    const body = [
      `站点名称：${norm.name}`,
      `站点网址：${norm.url}`,
      `头像链接：${norm.avatar}`,
      `一句介绍：${norm.intro}`,
      `联系邮箱：${norm.email}`,
    ].join('\n');
    return `mailto:${SITE.email}?subject=${encodeURIComponent(
      `友链申请 · ${norm.name || '新朋友'}`,
    )}&body=${encodeURIComponent(body)}`;
  }, [norm]);

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

  const setField = (key: FieldKey, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const blurField = (key: FieldKey) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setErrors(validate(values));
  };

  const handleSubmit = () => {
    setSubmitted(true);
    const next = validate(values);
    setErrors(next);
    const firstBad = FIELDS.find((f) => next[f.key]);
    if (firstBad) {
      document.getElementById(`apply-${firstBad.key}`)?.focus();
      return;
    }
    setDone(true);
  };

  const showError = (key: FieldKey) =>
    (submitted || touched[key]) && errors[key] ? errors[key] : undefined;

  const inputCls = (bad: boolean) =>
    `w-full rounded-full border bg-white/60 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink/35 focus:ring-2 focus:ring-rose/20 ${
      bad ? 'border-crimson/60 focus:border-crimson' : 'border-rose/25 focus:border-rose/60'
    }`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ——— 左：申请表单 / 结果面板 ——— */}
      <div className="min-w-0">
        {done ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="glass-card p-7 text-center"
          >
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose/25 text-crimson">
              <MorphIcon icon={CircleCheck} size={26} color="currentColor" />
            </span>
            <h2 className="mt-4 font-display text-2xl text-ink">信息检查完毕</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/70">
              表单校验全部通过，看起来没什么问题 ~
            </p>

            {/* 如实告知：通道还没接上（阶段 B 才接） */}
            <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber/40 bg-amber/15 p-4 text-left text-sm text-ink/80">
              <span className="mt-0.5 shrink-0 text-amber">
                <MorphIcon icon={Info} size={17} color="currentColor" />
              </span>
              <p className="leading-relaxed">
                <span className="font-medium">在线提交通道还在建设中</span>
                —— 表单本身已经做好，正式接收申请的功能下一阶段上线。
                现在请先用下面的按钮把信息发给我，我一定看得到。
              </p>
            </div>

            {/* 提交内容回显 */}
            <dl className="mt-5 space-y-2 rounded-[var(--radius-card)] border border-rose/20 bg-white/40 p-4 text-left text-sm">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex gap-3">
                  <dt className="w-20 shrink-0 text-ink/50">{f.label}</dt>
                  <dd className="min-w-0 flex-1 break-all text-ink">{norm[f.key]}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a
                href={mailto}
                className="btn-ripple inline-flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_rgba(224,82,107,0.35)] transition-transform hover:scale-105 active:scale-95"
              >
                <MorphIcon icon={Mail} size={16} color="#fff" />
                用邮件发给我
              </a>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    FIELDS.map((f) => `${f.label}：${norm[f.key]}`).join('\n'),
                    'apply',
                  )
                }
                className="btn-ripple inline-flex items-center gap-2 rounded-full border border-rose/30 bg-white/60 px-5 py-2.5 text-sm text-ink transition-colors hover:border-rose/60 hover:text-crimson"
              >
                {copied === 'apply' ? '已复制 ✓' : '复制申请信息'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDone(false);
                  setSubmitted(false);
                  setTouched({});
                  setErrors({});
                }}
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
              handleSubmit();
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

            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button
                type="submit"
                className="btn-ripple inline-flex items-center gap-2 rounded-full bg-crimson px-6 py-2.5 text-sm font-medium text-white shadow-[0_6px_18px_rgba(224,82,107,0.35)] transition-transform hover:scale-105 active:scale-95"
              >
                <MorphIcon icon={Send} size={16} color="#fff" />
                提交申请
              </button>
              <p className="text-xs leading-relaxed text-ink/50">
                我会尽快看，通过了就加进
                <a
                  href="/links"
                  className="mx-1 text-crimson underline-offset-2 hover:underline"
                >
                  友链页
                </a>
                ~
              </p>
            </div>
          </form>
        )}
      </div>

      {/* ——— 右：预览卡 + 我的站点信息 ——— */}
      <aside className="reveal flex flex-col gap-6">
        {/* 实时预览：你的卡片会长这样 */}
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

        {/* 也把我加进你的友链吧（取自 SITE，单一来源） */}
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
      </aside>
    </div>
  );
}
