/*
 * 后台顶栏 —— 三个模块共用。
 *
 * 原本导航写死在 AdminInbox 里、其余三项 disabled；加友链页时如果各写一份，
 * 「当前页」状态就会在两处各判一次。抽出来之后 active 只传一个值。
 *
 * 布局（2026-11-10 晚，按站长要求改）：
 *   品牌（头像 + 清吾）贴页面左缘，导航是居中的那格白胶囊，「退出登录」纯文字靠右。
 *   之前品牌和导航同住一格居中胶囊 —— 头像离左缘太远，站长要它到最左边。
 *   顺带删掉了右边缘「登着谁」那行小字（他说不用）。
 *
 * 滚动行为照主站 Navbar：固定 + 未滚动时透明 + 向下滚收起。
 * 只借行为，不搬形态 —— 前台那套玻璃和暖色一个都没带过来。
 * 样式在 admin.css 的「顶栏」段。
 */
import { useEffect, useState } from 'react';

/* 图标：24 格描边，尺寸与颜色全交给 CSS（currentColor + width/height）。
 * 没有引图标库 —— 后台一共就四个图标，为它们装一套依赖不值。 */
const ICONS = {
  comments: (
    <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  ),
  friends: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  status: (
    <>
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const NAV = [
  { key: 'comments', label: '评论收件箱', href: '/admin/console', icon: 'comments' },
  { key: 'friends', label: '友链审核', href: '/admin/friends', icon: 'friends' },
  { key: 'status', label: '运行与设置', href: '/admin/status', icon: 'status' },
] as const;

type Active = (typeof NAV)[number]['key'];

export default function AdminTop({ active }: { active: Active }) {
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  /**
   * 固定 / 透明 / 收起 —— 算法整段照 Navbar.tsx 搬过来，删掉「菜单或下拉开着」那段
   * （后台没有会自己滚动的锚点跳转），阈值也照抄：80px 成形、240px 才允许收。
   *
   * ⚠️ 别改成「比较这次 y 和上次 y」：触摸板/平滑滚动每帧只走 1~3px，单帧增量
   *    永远到不了阈值。所以用「方向锁 + 累计位移」：连续同向走过 MIN_DELTA 才认账，
   *    方向一变先重置基准、这次只记方向 —— 否则来回一抖就收一下，看着像抽搐。
   */
  useEffect(() => {
    const GLASS_AT = 80; // 滚过这里才给底色
    const REVEAL_AT = 240; // 240px 以内绝不收：首屏还在标题上
    const MIN_DELTA = 6;

    let baseY = window.scrollY;
    let dir = 0;
    let ticking = false;

    const read = () => {
      ticking = false;
      const y = window.scrollY;
      setScrolled(y > GLASS_AT);

      if (y <= REVEAL_AT) {
        setCollapsed(false);
        dir = 0;
        baseY = y;
        return;
      }

      const d = y - baseY;
      const nd = d > 0 ? 1 : d < 0 ? -1 : 0;
      // 阈值之内的抖动直接忽略，不动状态也不动基准
      if (nd === 0 || Math.abs(d) < MIN_DELTA) return;

      baseY = y;
      if (nd !== dir) {
        dir = nd;
        return;
      }
      setCollapsed(nd === 1);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(read);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function logout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* 网络挂了也照跳，本地会话早晚过期 */
    }
    window.location.replace('/admin/');
  }

  return (
    <header
      className="q-admin-top"
      data-scrolled={scrolled ? '1' : '0'}
      data-collapsed={collapsed ? '1' : '0'}
      /* 键盘 Tab 进来时先请回来，否则焦点会落在屏幕外 */
      onFocusCapture={() => setCollapsed(false)}
    >
      <a className="q-admin-brand-pill" href="/admin/console">
        <img src="/images/emis/avatar.png" alt="" />
        <b>清吾</b>
      </a>

      <nav className="q-admin-nav" aria-label="后台模块">
        {NAV.map((n) => (
          <a
            key={n.key}
            className="q-admin-nav__item"
            href={n.href}
            aria-current={active === n.key ? 'page' : undefined}
          >
            <Icon name={n.icon} />
            {n.label}
          </a>
        ))}
      </nav>

      <div className="q-admin-acts">
        <button className="q-admin-act" type="button" onClick={() => void logout()}>
          退出登录
        </button>
      </div>
    </header>
  );
}
