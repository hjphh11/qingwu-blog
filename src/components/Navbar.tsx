import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Menu, X } from '../lib/icons';
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
  useMotionValue,
  useSpring,
  useVelocity,
  useTransform,
} from 'motion/react';

type NavItem = { label: string; href: string };

const NAV_ITEMS: NavItem[] = [
  { label: '首页', href: '/' },
  { label: '文章', href: '/blog' },
  { label: '音乐', href: '/music' },
  { label: '友链', href: '/links' },
  { label: '分享', href: '/share' },
  { label: '关于', href: '/about' },
];

interface Props {
  pathname?: string;
}

// 液态玻璃导航 · 左右分栏(品牌左 / 菜单右):
//  ① 首页顶部(未滚动):透明,品牌+菜单浮在 Hero 上(无玻璃背景)
//  ② 首页滚动过阈值:玻璃背景淡入浮现
//  ③ 其他页面:常驻玻璃背景
// 桌面导航项用「gooey 融合导航」(借鉴 MotionVault gooey-nav,MIT,暖色重写):
//   激活项 = 玫瑰→绯红渐变实心块,黏糊糊滑动,移动时被速度拉伸、拖一条可融合的小尾巴,激活文字反白。
export default function Navbar({ pathname = '/' }: Props) {
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 80);
  });

  const isHome = pathname === '/';
  // 内页常驻玻璃;首页则滚动后才浮现玻璃
  const glass = !isHome || scrolled;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);
  const activeIdx = Math.max(0, NAV_ITEMS.findIndex((it) => isActive(it.href)));

  const dur = reduce ? 0 : 0.32;

  // —— gooey 融合导航(桌面):测量激活项位置,指示块用弹簧滑动 + 速度拉伸 + 拖尾 ——
  const springCfg = reduce ? { stiffness: 900, damping: 80 } : { stiffness: 300, damping: 24 };
  const lazyCfg = reduce ? { stiffness: 600, damping: 70 } : { stiffness: 90, damping: 14 };
  const targetX = useMotionValue(0);
  const targetW = useMotionValue(0);
  const x = useSpring(targetX, springCfg);
  const w = useSpring(targetW, springCfg);
  const tailX = useSpring(targetX, lazyCfg);
  const vx = useVelocity(x);
  const scaleX = useTransform(vx, (v) => 1 + Math.min(Math.abs(v) / 900, 0.55));
  const tailScaleY = useTransform(vx, (v) => Math.max(0.35, 1 - Math.abs(v) / 2200));

  const measure = useCallback(() => {
    const el = itemRefs.current[activeIdx];
    if (!el) return;
    targetX.set(el.offsetLeft);
    targetW.set(el.offsetWidth);
  }, [activeIdx, targetX, targetW]);

  useLayoutEffect(() => {
    measure();
    // 不吸附:让指示块在挂载时从左 gooey 滑到激活项;激活项变化(同会话内)同样走弹簧滑动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);

  // 指示块滑入到位后,再把激活文字反白,避免入场时白字悬在奶油底上
  useEffect(() => {
    setSettled(false);
    if (reduce) {
      setSettled(true);
      return;
    }
    const t = window.setTimeout(() => setSettled(true), 650);
    return () => window.clearTimeout(t);
  }, [activeIdx, reduce]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  return (
    <motion.header
      initial={false}
      animate={{ y: glass ? 0 : -4 }}
      transition={{ duration: dur, ease: 'easeOut' }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
    >
      <div className="relative flex w-full max-w-4xl items-center justify-between gap-4 py-2 pl-4 pr-3">
        {/* 液态玻璃背景层:透明 → 玻璃的淡入 */}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: glass ? 1 : 0 }}
          transition={{ duration: dur, ease: 'easeOut' }}
          className="absolute inset-0 rounded-[var(--radius-pill)]"
          style={{
            background: 'rgba(255, 248, 238, 0.55)',
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
            border: '1px solid rgba(255, 255, 255, 0.65)',
            boxShadow:
              'inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 10px 36px rgba(246, 165, 184, 0.2)',
          }}
        />

        {/* 品牌(头像 + 名字)→ 左侧,始终显示 */}
        <a className="relative z-10 flex items-center gap-2 text-ink" href="/">
          <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full ring-2 ring-white/70">
            <img
              src="/images/avatar.jpg"
              alt="清吾头像"
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          </span>
          <span className="font-hand text-2xl font-bold leading-none">清吾</span>
        </a>

        {/* 导航项 → 右侧(桌面) · gooey 融合导航 */}
        <nav className="relative z-10 hidden items-center gap-1 md:flex">
          {/* SVG gooey 滤镜定义 */}
          <svg className="absolute h-0 w-0 overflow-hidden" aria-hidden="true">
            <defs>
              <filter id="gooeyNav">
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
                <feColorMatrix
                  in="blur"
                  mode="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
                  result="gooey"
                />
                <feComposite in="SourceGraphic" in2="gooey" operator="atop" />
              </filter>
            </defs>
          </svg>

          {/* gooey 指示层(叠在菜单项之后) */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="h-full w-full" style={{ filter: 'url(#gooeyNav)' }}>
              {/* 主指示块:弹簧滑动 + 速度拉伸 */}
              <motion.div
                className="absolute top-0 h-full rounded-full bg-gradient-to-r from-rose to-crimson"
                style={{ left: x, width: w, scaleX }}
              />
              {/* 拖尾小球:滞后融合,速度越高越扁 */}
              <motion.div
                className="absolute top-0 h-full rounded-full bg-gradient-to-r from-rose to-crimson"
                style={{ left: tailX, width: 22, scaleY: tailScaleY }}
              />
            </div>
          </div>

          {/* 菜单项 */}
          {NAV_ITEMS.map((item, i) => {
            const active = isActive(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`relative z-10 block rounded-full px-3.5 py-1.5 text-base font-medium transition-colors duration-200 active:scale-95 ${
                  active
                    ? settled
                      ? 'text-white'
                      : 'text-crimson'
                    : 'text-ink/70 hover:text-crimson'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* 移动端折叠按钮 → 右侧(移动) */}
        <button
          type="button"
          aria-label="打开菜单"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative z-10 grid h-9 w-9 place-items-center rounded-full text-ink transition-colors hover:bg-rose/15 md:hidden"
        >
          <MorphIcon icon={open ? X : Menu} size={20} color="currentColor" />
        </button>
      </div>

      {/* 移动端展开菜单 */}
      <AnimatePresence>
        {open && (
          <motion.nav
            key="mobile-menu"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: dur, ease: 'easeOut' }}
            className="absolute inset-x-4 top-[64px] flex flex-col gap-1 rounded-[var(--radius-card)] p-2 md:hidden"
            style={{
              background: 'rgba(255, 248, 238, 0.9)',
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              border: '1px solid rgba(255, 255, 255, 0.65)',
              boxShadow: '0 16px 40px rgba(246, 165, 184, 0.22)',
            }}
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`rounded-xl px-4 py-2.5 text-base font-medium transition active:scale-95 ${
                  isActive(item.href)
                    ? 'bg-rose/25 text-crimson'
                    : 'text-ink/80 hover:bg-rose/15'
                }`}
              >
                {item.label}
              </a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
