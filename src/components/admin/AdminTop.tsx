/*
 * 后台顶栏 —— 两个模块共用。
 *
 * 原本导航写死在 AdminInbox 里、其余三项 disabled；加友链页时如果各写一份，
 * 「当前页」状态就会在两处各判一次。抽出来之后 active 只传一个值。
 *
 * 会话信息（谁登着）也由这里取：后台每个页面进来先打一次 /session 本来就是
 * 登录态校验（401 直接踢回 /admin），顶栏顺带显示用户名，不必再传一遍。
 */
import { useEffect, useState } from 'react';

const NAV = [
  { key: 'comments', label: '评论收件箱', href: '/admin/console' },
  { key: 'friends', label: '友链审核', href: '/admin/friends' },
  { key: 'status', label: '运行与设置', href: '/admin/status' },
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
      <div className="q-admin-who">
        <img src="/images/emis/avatar.png" alt="" />
        <b>{who || '管理员'}</b>
      </div>

      <nav className="q-admin-tabs" aria-label="后台模块">
        {NAV.map((n) => (
          <a
            key={n.key}
            className="q-admin-tab"
            href={n.href}
            aria-current={active === n.key ? 'page' : undefined}
          >
            {n.label}
          </a>
        ))}
      </nav>

      <button
        className="q-admin-btn q-admin-btn--ghost q-admin-btn--sm"
        type="button"
        onClick={() => void logout()}
      >
        退出登录
      </button>
    </header>
  );
}
