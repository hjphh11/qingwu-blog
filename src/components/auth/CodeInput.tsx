import { useEffect, useRef, useState } from 'react';

export default function CodeInput({
  initial,
  onComplete,
}: {
  initial?: string;
  onComplete: (code: string) => void;
}) {
  const [digits, setDigits] = useState(Array.from({ length: 6 }, (_, i) => initial?.[i] || ''));
  const codeRefs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => {
    codeRefs.current[0]?.focus();
  }, []);
  function submit(next = digits) {
    if (next.join('').length === 6) onComplete(next.join(''));
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

  return (
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
  );
}
