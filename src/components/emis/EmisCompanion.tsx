/**
 * 爱弥斯 · 内容页小陪伴（v6 §5.1 第三行：极弱，不抢注意力）。
 *
 * 三种形态，**每次进入文章页随机掷一个**：
 *   corner —— 蹲在左下角，一直在（最弱）
 *   peek   —— 滚动时才探头，停下 1.1s 就缩回去
 *   end    —— 只在读到底部（滚动 ≥90%）才出现
 *
 * ── 为什么三种形态共用一个 fixed 元素 ──────────────────────────
 * 「只在文末出现」如果做成文档流里的元素，水合时插入会导致内容位移（CLS），
 * 而且随机形态意味着服务端没法预留高度。所以三条路径都收敛成
 * 「同一个固定定位的立绘 + 不同的显隐时机」—— 布局零影响，也不用给每种形态写一套结构。
 *
 * ── 其它约定 ────────────────────────────────────────────────
 * · 放**左下角**：右下角是迷你播放器（bottom-6 right-6），两个会叠在一起。
 * · 窄屏（<768px）直接不显示：手机上一块固定的图很容易压住正文，
 *   「不抢注意力」在手机上等于「别出现」。
 * · `pointer-events: none`：它只是装饰，绝不能挡住底下的链接。
 * · 减动效下不做位移过渡，直接显隐。
 */

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

type Mode = 'corner' | 'peek' | 'end';

const MODES: Mode[] = ['corner', 'peek', 'end'];

/** peek 停下多久后缩回去 */
const PEEK_HOLD_MS = 1100;
/** end 形态的触发阈值：读到 90% 就算「到底了」 */
const END_RATIO = 0.9;

export default function EmisCompanion() {
  /* 形态在客户端掷，不在模块顶层掷 —— 顶层掷会让每次构建的结果固定下来，
     而且如果将来改成 SSR 还会产生 hydration mismatch。 */
  const [mode, setMode] = useState<Mode | null>(null);
  const [shown, setShown] = useState(false);
  const reduce = useReducedMotion();
  const rafRef = useRef(0);

  useEffect(() => {
    setMode(MODES[Math.floor(Math.random() * MODES.length)]);
  }, []);

  useEffect(() => {
    if (!mode) return;

    // corner：一直在，不需要任何监听
    if (mode === 'corner') {
      setShown(true);
      return;
    }

    if (mode === 'end') {
      const read = () => {
        rafRef.current = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setShown(max > 0 && window.scrollY / max >= END_RATIO);
      };
      /* 用 rAF 收口：scrollHeight 是会触发重排的读取，直接绑在 scroll 上
         每帧都读一次会把滚动拖涩。 */
      const onScroll = () => {
        if (!rafRef.current) rafRef.current = requestAnimationFrame(read);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      read();
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    // peek：滚动就探头，停下就缩回去
    let holdTimer = 0;
    const onScroll = () => {
      setShown(true);
      clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => setShown(false), PEEK_HOLD_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(holdTimer);
    };
  }, [mode]);

  if (!mode) return null;

  return (
    <div
      className={`q-companion q-companion--${mode}${shown ? ' is-on' : ''}${reduce ? ' is-static' : ''}`}
      aria-hidden="true"
    >
      {/* 直接用 webp：portrait.png 有 783KB，为了一张角落小图让它当兜底不值得 */}
      <img src="/images/emis/portrait.webp" alt="" width={360} height={497} decoding="async" loading="lazy" />
    </div>
  );
}
