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

/**
 * 只拿哈希拼头像 —— 匿名留言存的就是 32 位 hex，没有明文邮箱可反推。
 *
 * 用途：列表接口不再把 `emailHash` 原样回给所有人（那是「邮箱在不在本站」的
 * 枚举 oracle），改成服务端直接把头像 URL 算好放进 `avatar` 字段，
 * 前端不用再自己拼，展示效果和以前一模一样。
 */
export function avatarFromHash(hash: string, size = 96): string {
  return /^[a-f0-9]{32}$/i.test(hash || '') ? `https://cravatar.cn/avatar/${hash}?d=mp&s=${size}` : '';
}
