import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MorphIcon } from 'morphicons/react';
import {
  CircleAlert,
  CircleCheck,
  KeyRound,
  LoaderCircle,
  Mail,
  X,
} from '../../lib/icons';
import GithubMark from './GithubMark';
import {
  githubLoginUrl,
  startEmailLogin,
  verifyEmailLogin,
  type AuthConfig,
  type SessionAccount,
} from '../../lib/auth';

/**
 * 登录弹层 —— 邮箱验证码为主，GitHub 为辅。
 *
 * 为什么是弹层而不是一个页面：登录只为了「不用再填那三个框」，
 * 跳走一次就丢了正在写的字。这里关掉即回原处，草稿还在。
 *
 * 6 位码做成 6 个格子（不是一个大输入框），因为：
 *   · 手机上数字键盘逐格跳，比在一个框里数位数快；
 *   · 粘贴整串（邮件里双击复制）要能自动铺开 —— 见 onPaste。
 */

type Step = 'email' | 'code';

export default function LoginDialog({
  open,
  config,
  onClose,
  onDone,
}: {
  open: boolean;
  config: AuthConfig;
  onClose: () => void;
  onDone: (account: SessionAccount, created?: boolean) => void;
}) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  /** 重发冷却（秒）。服务端 60 秒，这里跟着走一遍，省得让人点了才被拒 */
  const [cool, setCool] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    setStep('email');
    setDigits(['', '', '', '', '', '']);
    setError('');
    setHint('');
    setBusy(false);
    setCool(0);
    // 打开后把焦点放到邮箱上（移动端别自动弹键盘，交给用户点）
    const t = window.setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (cool <= 0) return;
    const t = window.setTimeout(() => setCool((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cool]);

  if (!open) return null;

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  async function sendCode() {
    if (busy) return;
    // 不靠 disabled 挡 —— 灰掉的按钮说不清「为什么不让我点」
    if (!emailOk) {
      setError('邮箱格式看起来不对，检查一下？');
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    const r = await startEmailLogin(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      if (r.retryAfter) setCool(Math.min(r.retryAfter, 120));
      return;
    }
    setStep('code');
    setCool(60);
    if (r.devCode) {
      // 本机预览（AUTH_DEV_CODE=1）：没有发信中继，码直接塞进格子里
      setDigits(r.devCode.split(''));
      setHint('本地预览：验证码已自动填好（线上会发到邮箱）');
    } else {
      setHint('验证码 5 分钟内有效');
    }
    window.setTimeout(() => codeRefs.current[0]?.focus(), 80);
  }

  async function submit(next?: string[]) {
    const code = (next ?? digits).join('');
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    const r = await verifyEmailLogin(email, code);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setDigits(['', '', '', '', '', '']);
      codeRefs.current[0]?.focus();
      return;
    }
    onDone(r.account, r.created);
  }

  /**
   * 聚焦某一格并全选。
   *
   * 两个为什么：
   * 1) `select()` —— 格子里已有数字时，用户再输入会「替换」而不是追加。
   *    不选中的话，`maxLength` 放宽到 6 之后，同一格会攒成 "12" 这种两位。
   * 2) 放进 rAF —— 受控 input 在同一个 tick 里 `focus()`，会被随后的重渲染打断，
   *    手机上表现为「键盘收起就再也不弹」，也就是「输入一位不会跳到下一格」。
   */
  function focusAt(idx: number) {
    requestAnimationFrame(() => {
      const el = codeRefs.current[idx];
      if (!el) return;
      el.focus();
      el.select();
    });
  }

  function putDigit(i: number, raw: string) {
    // 只留数字，最多 6 位 —— 粘贴来的常带空格、换行、> 引用符
    const v = raw.replace(/\D/g, '').slice(0, 6);

    /**
     * 一次进来多位 = 粘贴 / 系统自动填充 / 输入法一次上屏。
     *
     * 从**第 0 格**铺，而不是从光标所在格：整串验证码是完整的一个码，
     * 从中间开始铺会错位。`maxLength` 也得允许 6 位（见下面 input 的注释），
     * 否则 iOS 的「从邮件填充」和安卓的粘贴菜单在进 onChange 之前就被截成 1 位。
     */
    if (v.length > 1) {
      const next = Array.from({ length: 6 }, (_, k) => v[k] ?? '');
      setDigits(next);
      if (v.length >= 6) void submit(next);
      else focusAt(v.length);
      return;
    }

    const next = [...digits];
    next[i] = v; // 空串 = 用户把这一位删了
    setDigits(next);
    if (next.every((d) => d)) {
      void submit(next);
    } else if (v) {
      focusAt(Math.min(5, i + 1)); // 输完一位自动进下一格
    }
  }

  /** 粘贴的兜底：某些移动端浏览器 paste 事件里读不到 clipboardData */
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) putDigit(0, text);
    } catch {
      /* 没授权 / 不支持：什么都不做，用户手输 */
    }
  }

  // ⚠️ 必须挂到 body：评论区外层有 transform（滚动进场动画），
  //    祖先一旦带 transform，`position: fixed` 就相对它定位 —— 弹层会从卡片顶部开始，不在视口中央。
  const dialog = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      {/* 遮罩：点一下关闭；颜色用墨色低透明度，和站内的暖白不打架 */}
      <button
        type="button"
        aria-label="关闭登录"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="q-login-title"
        className="relative w-full max-w-[27rem] rounded-t-[var(--radius-card)] border border-rose/25 bg-[#fffdfb] p-6 shadow-[0_-8px_40px_rgba(60,30,40,0.16)] sm:rounded-[var(--radius-card)] sm:shadow-[0_18px_60px_rgba(60,30,40,0.18)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-subtle transition-colors hover:bg-rose/12 hover:text-crimson"
        >
          <MorphIcon icon={X} size={15} color="currentColor" />
        </button>

        <h2 id="q-login-title" className="font-display text-[1.25rem] leading-6 text-ink">
          {step === 'email' ? '登录后留言' : '收个验证码'}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {step === 'email'
            ? '用邮箱收一条 6 位验证码就行，不用设密码。登录之后名字和站点会记住，回访不用再填。'
            : `验证码发到 ${email.trim() || '你的邮箱'}，5 分钟内有效。`}
        </p>

        {step === 'email' ? (
          <>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-[11px] text-subtle">邮箱</span>
              <span className="flex items-center gap-2 rounded-xl border border-rose/30 bg-white px-3 py-2.5 transition-colors focus-within:border-crimson/60">
                <span className="shrink-0 text-rose">
                  <MorphIcon icon={Mail} size={14} color="currentColor" />
                </span>
                <input
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  maxLength={254}
                  onChange={(ev) => {
                    setEmail(ev.target.value);
                    if (error) setError('');
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') void sendCode();
                  }}
                  placeholder="you@example.com"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle/70"
                />
              </span>
            </label>

            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-crimson text-sm font-medium text-white transition-[transform,background-color] duration-300 hover:scale-[1.01] disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted disabled:hover:scale-100"
            >
              {busy ? (
                <>
                  <span className="animate-spin">
                    <MorphIcon icon={LoaderCircle} size={14} color="#fff" />
                  </span>
                  发送中…
                </>
              ) : (
                <>
                  <MorphIcon icon={KeyRound} size={14} color="currentColor" />
                  发验证码
                </>
              )}
            </button>

            {config.github && (
              <>
                <div className="my-4 flex items-center gap-3 text-[11px] text-subtle">
                  <span className="h-px flex-1 bg-rose/20" />
                  或者
                  <span className="h-px flex-1 bg-rose/20" />
                </div>
                <a
                  href={githubLoginUrl()}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose/30 bg-white text-sm text-ink transition-colors hover:border-crimson/45 hover:text-crimson"
                >
                  <GithubMark size={15} />
                  用 GitHub 登录
                </a>
                <p className="mt-2 text-center text-[10.5px] leading-relaxed text-subtle">
                  GitHub 上要有一个已验证的邮箱，会并到同一个账号里
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <div className="mt-5 flex justify-between gap-2">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    codeRefs.current[i] = el;
                  }}
                  value={d}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  /* 允许整串进来：粘贴 / 系统 OTP 填充 / 输入法一次上屏都会给多个字符，
                     设成 1 的话它们在进 onChange 之前就被浏览器截断了 ——
                     这正是「粘不进去」「邮件里的验证码点一下填不上」的原因。
                     铺开与截断由 putDigit 负责，格子里永远只显示一位。 */
                  maxLength={6}
                  enterKeyHint={i === 5 ? 'done' : 'next'}
                  aria-label={`第 ${i + 1} 位`}
                  onFocus={(ev) => ev.currentTarget.select()}
                  onChange={(ev) => putDigit(i, ev.target.value)}
                  onPaste={(ev) => {
                    ev.preventDefault();
                    const text = ev.clipboardData.getData('text');
                    if (text.replace(/\D/g, '')) putDigit(0, text);
                    else void pasteFromClipboard();
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Backspace' && !digits[i] && i > 0) {
                      ev.preventDefault();
                      const next = [...digits];
                      next[i - 1] = '';
                      setDigits(next);
                      codeRefs.current[i - 1]?.focus();
                    }
                    if (ev.key === 'ArrowLeft' && i > 0) codeRefs.current[i - 1]?.focus();
                    if (ev.key === 'ArrowRight' && i < 5) codeRefs.current[i + 1]?.focus();
                    if (ev.key === 'Enter') void submit();
                  }}
                  className="h-12 w-full min-w-0 rounded-xl border border-rose/30 bg-white text-center text-lg tabular-nums text-ink outline-none transition-colors focus:border-crimson/60"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={digits.some((d) => !d) || busy}
              className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-crimson text-sm font-medium text-white transition-[transform,background-color] duration-300 hover:scale-[1.01] disabled:cursor-not-allowed disabled:bg-rose/30 disabled:text-muted disabled:hover:scale-100"
            >
              {busy ? (
                <>
                  <span className="animate-spin">
                    <MorphIcon icon={LoaderCircle} size={14} color="#fff" />
                  </span>
                  验证中…
                </>
              ) : (
                '登录'
              )}
            </button>

            <div className="mt-3 flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError('');
                }}
                className="text-subtle underline underline-offset-2 transition-colors hover:text-crimson"
              >
                换个邮箱
              </button>
              <button
                type="button"
                disabled={cool > 0 || busy}
                onClick={() => void sendCode()}
                className="text-subtle transition-colors hover:text-crimson disabled:cursor-not-allowed disabled:text-subtle/60"
              >
                {cool > 0 ? `${cool} 秒后可重发` : '重新发送'}
              </button>
            </div>
            {hint && !error && <p className="mt-2 text-[11px] text-subtle">{hint}</p>}
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-crimson">
            <span className="mt-px shrink-0">
              <MorphIcon icon={CircleAlert} size={12} color="currentColor" />
            </span>
            {error}
          </p>
        )}

        {step === 'email' && (
          <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-subtle">
            <span className="mt-px shrink-0 text-rose/80">
              <MorphIcon icon={CircleCheck} size={11} color="currentColor" />
            </span>
            邮箱只用来收验证码和回复通知，不会出现在公开列表里。
          </p>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body);
}
