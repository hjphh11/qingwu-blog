import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Menu, X, ChevronDown } from '../lib/icons';
import ContrastToggle from './ContrastToggle';
import {
  motion,
  AnimatePresence,
  animate,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
  useMotionValue,
} from 'motion/react';

type NavChild = { label: string; href: string };
type NavItem = {
  label: string;
  href: string;
  /**
   * 有 children 的项带下拉（桌面端）。**父项仍然是链接**：
   * 点它直接进 href（「文章」= 默认去看文章），要分享再从下拉里选。
   * 移动端不用下拉 —— 折叠菜单里直接把 children 平铺成两行，少一层手势。
   */
  children?: NavChild[];
};

const NAV_ITEMS: NavItem[] = [
  { label: '首页', href: '/' },
  {
    label: '文章',
    href: '/blog',
    children: [
      { label: '文章列表', href: '/blog' },
      { label: '分享', href: '/share' },
    ],
  },
  { label: '音乐', href: '/music' },
  {
    // 父项仍然是链接：点「友链」直接进友链墙，要去看朋友们写了什么再从下拉里选。
    // 与「文章」「关于」同一套写法。
    label: '友链',
    href: '/links',
    children: [
      { label: '友链墙', href: '/links' },
      { label: '友文', href: '/links/posts' },
    ],
  },
  { label: '项目', href: '/projects' },
  {
    // 父项仍然是链接：点「关于」直接进关于页，更新日志从下拉里选。
    // 与「文章」同一套写法，别在这里另起一套。
    label: '关于',
    href: '/about',
    children: [
      { label: '关于我', href: '/about' },
      { label: '更新日志', href: '/changelog' },
    ],
  },
];

interface Props {
  pathname?: string;
}

// 模块级:记住上次激活导航项索引,跨客户端路由重挂载仍有效,用于「从上一个滑到下一个」。
let lastActiveIdx = -1;

// 液态玻璃导航 · 左右分栏(品牌左 / 菜单右):
//  ① 首页顶部(未滚动):透明,品牌+菜单浮在 Hero 上(无玻璃背景)
//  ② 首页滚动过阈值:玻璃背景淡入浮现
//  ③ 其他页面:常驻玻璃背景
// 桌面导航:激活项 = 「透明玻璃胶囊」,随弹簧滑动到当前页(借鉴 MotionVault 导航弹簧滑动思路,按爱弥斯暖色)。
export default function Navbar({ pathname = '/' }: Props) {
  const { scrollY } = useScroll();
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  /** 向下滚时把导航收起（读文章时省出顶部空间）；向上滚、点目录、开菜单时一定展开 */
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  /** 当前展开的下拉（存父项 href，同时只开一个） */
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  /** 量位置要以 nav 为原点，不能用 offsetLeft —— 原因见 measure() */
  const navRef = useRef<HTMLElement>(null);

  /**
   * 量某个导航项相对 nav 的左缘与宽度（= 指示胶囊该待的位置）。
   *
   * ⚠️ 这里**不能用 `el.offsetLeft`**。offsetLeft 是相对「最近的定位祖先」
   * 计算的，而为了让下拉面板有定位上下文，每个导航项外面都包了一层
   * `<div class="relative">` —— 于是每一项的 offsetLeft 都变成 0，
   * 胶囊就永远停在第一项上（切到「音乐」时文字红了、背景还留在「首页」）。
   * 宽度用 offsetWidth 时不受影响，所以只错位置、不错大小，很容易看漏。
   * 改成「两者 getBoundingClientRect 相减」：与定位上下文无关，也天然免疫滚动。
   */
  const measure = (el: HTMLAnchorElement | null) => {
    const nav = navRef.current;
    if (!el || !nav) return { left: 0, width: 0 };
    const er = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    return { left: er.left - nr.left, width: er.width };
  };

  /**
   * 滚动方向判定用的两个 ref。
   *
   * ⚠️ 不能直接比较「这次 y 和上次 y」：触摸板/平滑滚动每帧只走 1~3px，
   *    单帧增量永远到不了阈值，导航就永远不收。所以用「方向锁 + 累计位移」：
   *    连续同向走过 MIN_DELTA 才认账，方向一变先重置基准再等下一段。
   */
  const navDir = useRef(0);
  const navRefY = useRef(0);
  /** 目录跳转期间（主动向下滚）压制收起，时间窗过后再按真实方向判断 */
  const navSuppressUntil = useRef(0);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled(latest > 80);

    // 程序性滚动（目录跳转）：这一路都是"向下"，但不是用户在往下读
    if (performance.now() < navSuppressUntil.current) {
      setCollapsed(false);
      navDir.current = 0;
      navRefY.current = latest;
      return;
    }

    // 菜单 / 下拉开着时绝不收起：手指刚点开，导航自己跑掉是最糟的体验
    if (open || openGroup) {
      setCollapsed(false);
      navDir.current = 0;
      navRefY.current = latest;
      return;
    }

    const d = latest - navRefY.current;
    const nd = d > 0 ? 1 : d < 0 ? -1 : 0;
    // 阈值之内的抖动直接忽略，不动状态也不动基准
    if (nd === 0 || Math.abs(d) < 6) return;

    navRefY.current = latest;
    if (nd !== navDir.current) {
      // 刚转向：这次只记方向，别急着收 —— 否则一抖一收，看着像在抽搐
      navDir.current = nd;
      return;
    }
    // 240px 以内不收：首屏还在 Hero 上，导航本来就该在
    setCollapsed(nd === 1 && latest > 240);
  });

  /** 目录跳转会一路向下滚，落点上方还要留出导航高度，所以点目录时先把它请回来 */
  useEffect(() => {
    const reveal = () => {
      // 900ms ≈ 目录缓动滚动的上限（max 720ms）+ 一点余量
      navSuppressUntil.current = performance.now() + 900;
      setCollapsed(false);
    };
    window.addEventListener('q:reveal-nav', reveal);
    return () => window.removeEventListener('q:reveal-nav', reveal);
  }, []);

  const isHome = pathname === '/';
  // 内页常驻玻璃;首页则滚动后才浮现玻璃
  const glass = !isHome || scrolled;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);
  /** 带下拉的项：自己或任一子项命中当前路径都算激活 */
  const itemActive = (it: NavItem) =>
    isActive(it.href) || !!it.children?.some((c) => isActive(c.href));
  const activeIdx = Math.max(0, NAV_ITEMS.findIndex(itemActive));

  const dur = reduce ? 0 : 0.32;

  // —— 导航指示块:透明玻璃胶囊,从上一个导航项滑到当前项 ——
  const x = useMotionValue(0);
  const w = useMotionValue(0);
  const spring = reduce
    ? ({ type: 'tween', duration: 0.2 } as const)
    : ({ type: 'spring', stiffness: 300, damping: 24 } as const);

  useLayoutEffect(() => {
    const cur = measure(itemRefs.current[activeIdx]);
    // 上次挂载记录的激活项 = 上一个来源;有且和当前不同时,从它滑到当前;否则直接落到当前项
    const prev =
      lastActiveIdx >= 0 && lastActiveIdx !== activeIdx
        ? measure(itemRefs.current[lastActiveIdx])
        : null;
    if (reduce || !prev) {
      x.set(cur.left);
      w.set(cur.width);
    } else {
      x.set(prev.left);
      w.set(prev.width);
      animate(x, cur.left, spring);
      animate(w, cur.width, spring);
    }
    lastActiveIdx = activeIdx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, reduce]);

  useEffect(() => {
    const onResize = () => {
      const cur = measure(itemRefs.current[activeIdx]);
      x.set(cur.left);
      w.set(cur.width);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeIdx, x, w]);

  /* 下拉的关闭：Esc、点外面、路由变化。
     不监听 pointerleave 到 window —— 鼠标移出即关会让「想移到下拉项」变成走钢丝，
     所以只在离开**整个父项容器**时关（容器把下拉包在里面）。 */
  useEffect(() => {
    if (!openGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest('[data-nav-group]')) setOpenGroup(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [openGroup]);

  // 路由一变就收起（桌面下拉不该跨页残留）
  useEffect(() => {
    setOpenGroup(null);
    setOpen(false);
  }, [pathname]);

  return (
    <motion.header
      initial={false}
      animate={{ y: collapsed ? -112 : glass ? 0 : -4 }}
      transition={{ duration: dur, ease: 'easeOut' }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center pt-4"
      data-collapsed={collapsed ? '1' : '0'}
    >
      {/*
        横轴对齐：这里的三条规则必须一起看 ——
        ① 外层 w-full + max-w-[var(--shell-max)] + padding-inline[var(--shell-gutter)]
           = 与 .page-shell 完全同一套值（别再写 max-w-4xl，它比正文窄 184px）。
        ② 内层胶囊条本身有一圈内边距（pl-4 = 16px），品牌图标落在它内侧。
           所以用 -ml-4 把这 16px 抵消掉，图标左缘才真正压在内容左边线上。
        ③ -ml-4 与 pl-4 必须等值，改一个要改另一个。
        实测修正前品牌比页标题右移 68px(1440) / 48px(1024) / 12px(390)。
      */}
      <div className="flex w-full max-w-[var(--shell-max)] px-[var(--shell-gutter)]">
        <div className="relative -ml-4 flex w-full items-center justify-between gap-4 py-2 pl-4 pr-3">
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
            {/* 原来直接挂 avatar.jpg(734KB / 1259px)只显示 32px。
                webp 版 16KB,首屏省下约 700KB。 */}
            <picture>
              <source srcSet="/images/avatar.webp" type="image/webp" />
              <img
                src="/images/avatar.jpg"
                alt="清吾头像"
                width={32}
                height={32}
                decoding="async"
                className="h-full w-full object-cover"
              />
            </picture>
          </span>
          <span className="font-hand text-2xl font-bold leading-none">清吾</span>
        </a>

        {/* 导航项 → 右侧(桌面) · 透明玻璃胶囊滑动指示 */}
        <nav ref={navRef} className="relative z-10 hidden items-center gap-1 md:flex">
          {/* 指示层:透明玻璃胶囊(叠在菜单项之后),随弹簧滑动到当前页 */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <motion.div
              className="absolute top-0 h-full rounded-full border border-white/50 bg-rose/25 backdrop-blur-sm"
              style={{ left: x, width: w }}
            />
          </div>

          {/* 菜单项 */}
          {NAV_ITEMS.map((item, i) => {
            const active = itemActive(item);
            const openNow = openGroup === item.href;
            return (
              <div
                key={item.href}
                data-nav-group={item.children ? '' : undefined}
                className="relative"
                onPointerEnter={() => item.children && setOpenGroup(item.href)}
                onPointerLeave={() => item.children && setOpenGroup(null)}
              >
                <a
                  href={item.href}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  // 键盘用户：聚焦到父项就展开，Tab 能继续走进下拉项
                  onFocus={() => item.children && setOpenGroup(item.href)}
                  aria-haspopup={item.children ? 'true' : undefined}
                  aria-expanded={item.children ? openNow : undefined}
                  className={`relative z-10 flex items-center gap-0.5 rounded-full px-3.5 py-1.5 text-base font-medium transition-colors duration-200 q-press ${
                    active ? 'text-crimson' : 'text-muted hover:text-crimson'
                  }`}
                >
                  {item.label}
                  {item.children && (
                    <span
                      aria-hidden="true"
                      className={`transition-transform duration-200 ${openNow ? 'rotate-180' : ''}`}
                    >
                      <MorphIcon icon={ChevronDown} size={13} color="currentColor" />
                    </span>
                  )}
                </a>

                {/* 下拉：挂在父项正下方。
                    ⚠️ 居中必须放在**外层** div 上：内层由 motion 驱动 y 动画，
                    motion 会写内联 `transform: translateY(...)`，把 Tailwind 的
                    `-translate-x-1/2` 整个覆盖掉 —— 第一版就这么偏了 31px。
                    pt-1.5 是让面板和父项连成一片，鼠标横穿过去不会断。 */}
                <AnimatePresence>
                  {item.children && openNow && (
                    <div className="absolute left-1/2 top-full z-20 -translate-x-1/2 pt-1.5">
                      <motion.div
                        key="dd"
                        initial={reduce ? false : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: dur || 0.12, ease: 'easeOut' }}
                        role="menu"
                        aria-label={`${item.label}相关`}
                        className="min-w-[9.5rem] rounded-2xl p-1.5"
                        style={{
                          background: 'rgba(255, 252, 247, 0.96)',
                          backdropFilter: 'blur(20px) saturate(160%)',
                          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                          border: '1px solid rgba(246, 165, 184, 0.45)',
                          boxShadow: '0 16px 38px rgba(160, 100, 110, 0.18)',
                        }}
                      >
                        {item.children.map((c) => (
                          <a
                            key={c.href}
                            href={c.href}
                            role="menuitem"
                            onClick={() => setOpenGroup(null)}
                            className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                              isActive(c.href) && pathname === c.href
                                ? 'bg-rose/25 text-crimson'
                                : 'text-muted hover:bg-rose/15 hover:text-crimson'
                            }`}
                          >
                            {c.label}
                          </a>
                        ))}
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* 右侧动作区：高对比开关 + 移动端菜单。
            两个放一个容器里，免得 justify-between 把它们分到两端。 */}
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <ContrastToggle />

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
        </div>
      </div>

      {/* 移动端展开菜单 —— 下拉在这里**平铺成两行**，不做二级展开：
          手机上多点一层没有收益，反而多一次误触。 */}
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
            {NAV_ITEMS.flatMap((item) => item.children ?? [item]).map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`rounded-xl px-4 py-2.5 text-base font-medium transition q-press ${
                  isActive(item.href)
                    ? 'bg-rose/25 text-crimson'
                    : 'text-muted hover:bg-rose/15'
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
