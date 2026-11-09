// 清吾 · 发信
//
// 为什么用 Resend 而不是 Cloudflare 的 send_email binding：
//   那个 binding 需要验证域名并走 Workers 的邮件路由，配置面更大；
//   Resend 就是一个 HTTPS 请求，跟项目里其它 outbound 调用一个套路。
//
// 自建中继（可选）：配了 `MAIL_ENDPOINT` 就把同一个请求打给自己的中继服务
//   （`.deploy/mail-relay/relay.py`，协议与 Resend 的 `/emails` 同构），
//   没配则原样打 Resend —— 线上行为一字不变。
//   之所以需要中继：本机出站 25 端口被服务商丢包，直连投递不可行，
//   只能起一个本机进程把信交给上游 SMTP 的 587 端口代投。
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
  // 自建中继优先；两者请求体同构，上层无感
  const endpoint = (env.MAIL_ENDPOINT || RESEND_ENDPOINT).trim();
  try {
    const res = await fetch(endpoint, {
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
      console.warn('[mail] 发信非 2xx:', res.status);
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
