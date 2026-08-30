import { useState } from 'react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
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
export default function Navbar({ pathname = '/' }: Props) {
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 80);
  });

  const isHome = pathname === '/';
  // 内页常驻玻璃;首页则滚动后才浮现玻璃
  const glass = !isHome || scrolled;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const dur = reduce ? 0 : 0.32;

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
              src="/images/emis/avatar.png"
              alt="爱弥斯头像"
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          </span>
          <span className="font-hand text-xl leading-none">清吾</span>
        </a>

        {/* 导航项 → 右侧(桌面) */}
        <nav className="relative z-10 hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className={`relative rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200 ${
                  active ? 'text-crimson' : 'text-ink/70 hover:text-crimson'
                }`}
              >
                {item.label}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-rose/25"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
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
          <span className="relative block h-3.5 w-5">
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded bg-current transition-transform duration-200 ${
                open ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'
              }`}
            />
            <span
              className={`absolute left-0 top-1/2 block h-0.5 w-5 -translate-y-1/2 rounded bg-current transition-opacity duration-200 ${
                open ? 'opacity-0' : 'opacity-100'
              }`}
            />
            <span
              className={`absolute left-0 block h-0.5 w-5 rounded bg-current transition-transform duration-200 ${
                open ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'
              }`}
            />
          </span>
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
                className={`rounded-xl px-4 py-2.5 text-sm transition-colors ${
                  isActive(item.href)
                    ? 'bg-rose/25 font-medium text-crimson'
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
