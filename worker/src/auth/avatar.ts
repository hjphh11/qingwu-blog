// 邮箱头像 —— 与 `src/lib/avatar.ts` 的 `avatarFromEmail` 同一条规则
//
// 为什么服务端也要算：登录后留言不再存明文邮箱，但列表仍要显示头像，
// 所以写入时就把头像 URL 定下来（QQ 邮箱走 qlogo，其余走 Cravatar）。
// ⚠️ QQ 规则必须留在这里 —— 只凭 MD5 认不出「这是不是 QQ 邮箱」，
//    QQ 用户就会看到 Cravatar 的剪影。

import { emailHashOf } from './md5';

const QQ_MAIL = /^(\d{5,11})@qq\.com$/i;

export function avatarFromEmail(email: string, size = 96): string {
  const e = (email || '').trim().toLowerCase();
  if (!e) return '';
  const qq = e.match(QQ_MAIL);
  if (qq) return `https://q.qlogo.cn/headimg_dl?dst_uin=${qq[1]}&spec=${size}`;
  return `https://cravatar.cn/avatar/${emailHashOf(e)}?d=mp&s=${size}`;
}
