/*
 * 后台顶栏 —— 三个模块共用。
 *
 * 原本导航写死在 AdminInbox 里、其余三项 disabled；加友链页时如果各写一份，
 * 「当前页」状态就会在两处各判一次。抽出来之后 active 只传一个值。
 *
 * 会话信息（谁登着）也由这里取：后台每个页面进来先打一次 /session 本来就是
 * 登录态校验（401 直接踢回 /admin），顶栏顺带显示用户名，不必再传一遍。
 *
 * 布局照朝朝听雨（rainzt.cn）现在这一版：**一整条居中胶囊**装品牌 + 导航，
 * 「退出登录」在右边缘做纯文字。导航项是「图标 + 文字」，选中项淡灰底反显。
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
  const [who, setWho] = useState('');

  useEffect(() => {
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { username?: string } | null) => setWho(d?.username || ''))
      .catch(() => {});
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
    <header className="q-admin-top">
      {/* 品牌和导航同住一格胶囊：「清吾」四个字是他那边「小爱」的位置 */}
      <div className="q-admin-bar">
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
      </div>

      {/* 右边缘那一行：登着谁 + 退出。绝对定位，中间那颗胶囊才是真居中 */}
      <div className="q-admin-acts">
        {who ? <span className="q-admin-acts__who">{who}</span> : null}
        <button className="q-admin-act" type="button" onClick={() => void logout()}>
          退出登录
        </button>
      </div>
    </header>
  );
}
