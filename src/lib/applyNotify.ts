// 新友链申请的邮件通知(Resend)。
//
// 设计要点：
//  · **失败不影响访客**：邮件只是提醒，申请数据已经落进私有仓库了；发信失败只记日志、不报错。
//  · **必须转义**：邮件内容里全是访客可控的字符串，直接拼进 HTML 会有注入风险。

export interface NotifyConfig {
  apiKey: string;
  from: string;
  to: string;
  /** 便于本地用 mock 服务验证；默认 Resend 官方 API */
  apiBase?: string;
}

export interface NotifyPayload {
  id: string;
  name: string;
  url: string;
  avatar: string;
  intro: string;
  email: string;
  submittedAt: string;
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function buildText(p: NotifyPayload): string {
  return [
    '收到一条新的友链申请 ~',
    '',
    `站点名称：${p.name}`,
    `站点网址：${p.url}`,
    `头像链接：${p.avatar}`,
    `一句介绍：${p.intro}`,
    `联系邮箱：${p.email}`,
    '',
    `时间：${p.submittedAt}`,
    `编号：${p.id}`,
    '',
    '去后台审批(阶段 J 上线后)，或先直接回复这封邮件联系对方。',
  ].join('\n');
}

function buildHtml(p: NotifyPayload): string {
  const row = (label: string, value: string, href?: string) => `
      <tr>
        <td style="padding:6px 14px 6px 0;color:#8a7360;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td>
        <td style="padding:6px 0;color:#4a3728;font-size:14px;word-break:break-all">${
          href
            ? `<a href="${esc(href)}" style="color:#e0526b">${esc(value)}</a>`
            : esc(value)
        }</td>
      </tr>`;

  return `<div style="background:#fdf6f0;padding:26px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fffdfb;border:1px solid #f0dcd2;border-radius:18px;padding:26px">
    <p style="margin:0;font-size:19px;color:#e0526b">收到一条新的友链申请 ~</p>
    <table style="width:100%;border-collapse:collapse;margin-top:18px">
      ${row('站点名称', p.name)}
      ${row('站点网址', p.url, p.url)}
      ${row('头像链接', p.avatar, p.avatar)}
      ${row('一句介绍', p.intro)}
      ${row('联系邮箱', p.email, `mailto:${p.email}`)}
      ${row('提交时间', p.submittedAt)}
      ${row('编号', p.id)}
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#8a7360;line-height:1.7">
      直接回复这封邮件即可联系对方。<br />
      数据已存进私有仓库，后台审批功能(阶段 J)上线后可在这里一键通过。
    </p>
  </div>
</div>`;
}

/** 发通知。返回 ok=false 时调用方只记日志，不要让访客看到失败。 */
export async function notifyNewApplication(
  cfg: NotifyConfig,
  p: NotifyPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = (cfg.apiBase || 'https://api.resend.com').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [cfg.to],
        reply_to: p.email, // 站主可以直接回复申请人
        subject: `【友链申请】${p.name}`,
        text: buildText(p),
        html: buildHtml(p),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status} ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
