import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

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

// 液态玻璃导航:内页常驻;首页顶部融入 Hero,下滑浮现玻璃条。
export default function Navbar({ pathname = '/' }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const isHome = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 内页一直显示;首页则在滚动后浮现
  const visible = !isHome || scrolled;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <motion.header
      initial={false}
      animate={{ y: visible ? 0 : -96, opacity: visible ? 1 : 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
    >
      {/* 玻璃条 */}
      <div
        className="flex w-full max-w-4xl items-center justify-between gap-4 rounded-[var(--radius-pill)] py-2 pl-3 pr-2"
        style={{
          background: 'rgba(253, 246, 240, 0.6)',
          backdropFilter: 'blur(18px) saturate(180%)',
          WebkitBackdropFilter: 'blur(18px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.65)',
          boxShadow:
            '0 8px 32px rgba(246, 165, 184, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.75)',
        }}
      >
        {/* 头像 + 名字 → 回首页 */}
        <a href="/" className="flex items-center gap-2.5 text-ink">
          <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full ring-2 ring-white/70">
            <img
              src="/images/emis/avatar.png"
              alt="爱弥斯头像"
              className="h-full w-full object-cover"
              width={32}
              height={32}
            />
          </span>
          <span className="font-hand text-xl leading-none">清吾</span>
        </a>

        {/* 桌面端导航 */}
        <nav className="hidden items-center gap-1 md:flex">
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

        {/* 移动端折叠按钮 */}
        <button
          type="button"
          aria-label="打开菜单"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-9 w-9 place-items-center rounded-full text-ink transition-colors hover:bg-rose/15 md:hidden"
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
            transition={{ duration: 0.2 }}
            className="absolute inset-x-4 top-[72px] flex flex-col gap-1 rounded-[var(--radius-card)] p-2 md:hidden"
            style={{
              background: 'rgba(253, 246, 240, 0.9)',
              backdropFilter: 'blur(18px) saturate(180%)',
              WebkitBackdropFilter: 'blur(18px) saturate(180%)',
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
