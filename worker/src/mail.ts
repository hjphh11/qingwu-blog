// 清吾 · 发信（Resend）
//
// 为什么用 Resend 而不是 Cloudflare 的 send_email binding：
//   那个 binding 需要验证域名并走 Workers 的邮件路由，配置面更大；
//   Resend 就是一个 HTTPS 请求，跟项目里其它 outbound 调用一个套路。
//
// ⚠️ 三条纪律：
//   1. **没配密钥就静默跳过**，返回 false —— 邮件是锦上添花，
//      绝不能因为它把访客的留言/申请卡在 502 上。
//   2. 收件人地址只在服务端流动，**永远不要**写进日志。
//   3. 发信失败不影响主流程：调用方一律 `ctx.waitUntil(...)`，不等结果。

import type { Env } from './types';

interface MailInput {
  to: string;
  subject: string;
  text: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** 发一封纯文本信。没配 RESEND_KEY / 没给收件人 → 直接 false，不打网络 */
export async function sendMail(env: Env, input: MailInput): Promise<boolean> {
  const key = env.RESEND_KEY;
  const to = (input.to || '').trim();
  if (!key || !to) return false;

  const from = env.MAIL_FROM || '清吾 <noreply@qingwu.ink>';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject.slice(0, 120),
        text: input.text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // 只记状态码，不记地址
      console.warn('[mail] resend 非 2xx:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[mail] 发信失败:', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

/** 评论区统一的邮件正文 —— 别把 HTML 拼进来，纯文本最不容易进垃圾箱 */
export function boardMailText(lines: {
  kind: 'comment' | 'reply';
  from: string;
  site?: string;
  body: string;
  toName?: string;
}): string {
  const head =
    lines.kind === 'reply'
      ? `${lines.from} 回复了 ${lines.toName || '你的留言'}：`
      : `${lines.from} 在友链评论区留了言：`;
  return [
    head,
    '',
    lines.body,
    '',
    lines.site ? `站点：${lines.site}` : '',
    '—— 清吾 · 友链评论区',
    'https://www.qingwu.ink/links/#friends-comments',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
