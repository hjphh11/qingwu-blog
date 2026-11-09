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
//   2. 收件人地址只在服务端流动（日志只记结果类别，**永不写地址**）。
//   3. 发信失败不影响主流程：调用方一律 `ctx.waitUntil(...)`，不等结果。
//
// ——— 重试与待发队列（2026-11-10 补）————————————————————————
// 以前失败只有一行 console.warn，信就没了。现在分三段：
//   ① **同一次请求内**最多试 3 次（0.8s / 2.4s 退避），覆盖网络抖动、上游 5xx。
//   ② 试完仍失败 → 落 `mail_outbox`（D1），等下一次机会补发。
//   ③ 补发机会 = 每天 cron + 有人留言/回复时（机会式），过 24h 未发掉的直接丢弃
//      —— 一周前的「有人给你留言了」发出去只会莫名其妙。
//
// ⚠️ **哪些错该重试是精心分过的，别改成「一律重试」**：
//   QQ 邮箱对超频/异常的惩罚是**递进**的（分钟级封 → 小时级封 → 当日禁发），
//   已经报错还连着重试会把封禁时间越拖越长。所以 `smtp_authfailed`、
//   收件人被拒这类**永久错一律当场放弃**（auth 类进队列等授权码修好再发，不进重试）。
//   中继（relay.py）把 SMTP 异常统一映射成 502 + `{"error":"smtp_xxx"}`，
//   所以「有没有 `error` 字段」就是区分永久/瞬时的关键。

import type { Env } from './types';

export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** 同一次请求内的重试退避（毫秒）。数组长度 = 额外重试次数，总尝试 3 次。 */
const RETRY_DELAYS_MS = [800, 2400];
/** 待发队列里一封信最多补发几轮，超过就放弃（避免死信永远占着队列） */
const OUTBOX_MAX_TRIES = 6;
/** 入队后多久还没发出去就丢弃（秒）。24h：再晚通知就没意义了。 */
const OUTBOX_TTL_SECONDS = 24 * 3600;
/** 补发退避上限：5 分钟起，翻倍，最多 6 小时一次 */
const OUTBOX_BACKOFF_BASE = 300;
const OUTBOX_BACKOFF_MAX = 6 * 3600;

/** 失因分类 —— 决定「要不要再试」和「要不要入队」 */
type Failure =
  | 'transient' // 网络抖动 / 上游 5xx / 限流：值得重试，值得入队
  | 'config' // 认证、配置问题：重试没用，但改好配置后入队的信还能补发
  | 'rejected'; // 参数被拒（收件人非法等）：重试和补发都没意义

interface AttemptResult {
  ok: boolean;
  /** 只在 ok=false 时有意义 */
  failure?: Failure;
  /** 失败原因（只含状态码与错误码，不含任何地址） */
  reason?: string;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 打一次发信接口。**不重试、不入队**，只如实回答「成没成、值不值得再试」。
 * 抽出来是为了让 `sendMail`（新信）和 `flushOutbox`（补发）用同一套判定。
 */
async function attemptOnce(env: Env, msg: MailInput): Promise<AttemptResult> {
  const key = env.RESEND_KEY;
  if (!key) return { ok: false, failure: 'config', reason: 'no_key' };

  const from = env.MAIL_FROM || '清吾 <noreply@qingwu.ink>';
  // 自建中继优先；两者请求体同构，上层无感
  const endpoint = (env.MAIL_ENDPOINT || RESEND_ENDPOINT).trim();

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject.slice(0, 120),
        text: msg.text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    // 连不上 / 超时 / DNS —— 统统当瞬时
    return { ok: false, failure: 'transient', reason: `net_${err instanceof Error ? err.name : 'unknown'}` };
  }

  if (res.ok) return { ok: true };

  // 读错误码（只取错误标识，别把响应体整段写进日志 —— 里面可能带收件人）
  let code = '';
  try {
    const body = (await res.json()) as { error?: unknown; name?: unknown };
    code = String(body.error || body.name || '').trim();
  } catch {
    /* 响应不是 JSON（例如 nginx 的 502 页面）→ code 留空，按状态码判 */
  }
  const reason = `http_${res.status}${code ? `_${code.slice(0, 40)}` : ''}`;

  // ① 中继/上游给了 SMTP 错误码：除「连接类」外都算永久。
  //    smtp_authfailed / smtp_smtpauthenticationerror = 授权码或服务未开
  //    smtp_smtpsenderrefused / smtp_smtprecipientsrefused = 发件人未验证 / 收件人被拒 / 超频
  //    这些再试只会加重 QQ 的阶梯限频 → 一律不当瞬时错。
  if (code.startsWith('smtp_')) {
    const transient = /disconnect|timeout|temporar|tryagain|421|450|451|452/i.test(code);
    return {
      ok: false,
      failure: transient ? 'transient' : /auth/i.test(code) ? 'config' : 'rejected',
      reason,
    };
  }

  // ② 配置类：没配置好 / 令牌无效 —— 重试无意义
  if (/not_configured|unauthor|forbidden|unauthorized/i.test(code)) {
    return { ok: false, failure: 'config', reason };
  }

  // ③ 限流与上游临时故障：值得再试
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
    return { ok: false, failure: 'transient', reason };
  }

  // ④ 其余 4xx：请求本身有问题，重试和补发都没意义
  return { ok: false, failure: 'rejected', reason };
}

/**
 * 失败的信落进待发队列。**表不存在就静默跳过**（线上 CF 的 D1 没跑这条迁移时，
 * 行为退化成「只记日志」，不会因为入队失败反过来影响留言）。
 */
async function enqueue(env: Env, msg: MailInput, reason: string): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO mail_outbox (created_at, next_try_at, tries, last_error, payload)
       VALUES (?1, ?2, 0, ?3, ?4)`,
    )
      .bind(now, now + OUTBOX_BACKOFF_BASE, reason.slice(0, 120), JSON.stringify(msg))
      .run();
    console.warn('[mail] 已入待发队列:', reason);
  } catch (err) {
    console.warn('[mail] 入队失败:', err instanceof Error ? err.message : 'unknown');
  }
}

/** 发一封纯文本信。没配 RESEND_KEY / 没给收件人 → 直接 false，不打网络 */
export async function sendMail(env: Env, input: MailInput): Promise<boolean> {
  const to = (input.to || '').trim();
  if (!env.RESEND_KEY || !to) return false;

  const msg: MailInput = {
    to,
    subject: input.subject.slice(0, 120),
    text: input.text.slice(0, 8000),
  };

  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    const r = await attemptOnce(env, msg);
    if (r.ok) return true;

    if (r.failure === 'rejected') {
      // 永不成功的一类，连队列都不进
      console.warn('[mail] 发信被拒（不重试）:', r.reason);
      return false;
    }
    if (r.failure === 'config') {
      // 授权码/配置问题：当场不再试，但进队（改好配置后还能补发）
      console.warn('[mail] 发信配置异常（不重试）:', r.reason);
      await enqueue(env, msg, r.reason || 'config');
      return false;
    }

    // transient：还有额度就再试一次
    if (i < RETRY_DELAYS_MS.length) {
      console.warn(`[mail] 发信失败，${RETRY_DELAYS_MS[i]}ms 后重试（${i + 1}/${RETRY_DELAYS_MS.length}）:`, r.reason);
      await sleep(RETRY_DELAYS_MS[i]!);
      continue;
    }
    console.warn('[mail] 重试耗尽，入待发队列:', r.reason);
    await enqueue(env, msg, r.reason || 'transient');
    return false;
  }
  return false;
}

/**
 * 补发队列里的信。**只在 cron 与「有人留言」时调用**（机会式），不在访问路径上。
 * 每封信只试一次（试完按退避往后推），避免一条补发链路自己变成限频源。
 */
export async function flushOutbox(env: Env, limit = 5): Promise<{ sent: number; left: number }> {
  if (!env.RESEND_KEY) return { sent: 0, left: 0 };

  const now = Math.floor(Date.now() / 1000);
  let rows: Array<{ id: number; payload: string; tries: number; created_at: number }>;
  try {
    const res = await env.DB.prepare(
      `SELECT id, payload, tries, created_at FROM mail_outbox
        WHERE next_try_at <= ?1 ORDER BY id LIMIT ?2`,
    )
      .bind(now, limit)
      .all<{ id: number; payload: string; tries: number; created_at: number }>();
    rows = res.results ?? [];
  } catch {
    // 没有这张表 = 还没跑迁移 → 静默跳过（线上 CF 就属于这种）
    return { sent: 0, left: 0 };
  }
  if (!rows.length) return { sent: 0, left: 0 };

  let sent = 0;
  let left = 0;

  for (const row of rows) {
    const del = () => env.DB.prepare('DELETE FROM mail_outbox WHERE id = ?1').bind(row.id).run();

    // 过期 / 试太多次 → 丢弃，别让死信常年占着队列
    if (Number(row.created_at) < now - OUTBOX_TTL_SECONDS || Number(row.tries) >= OUTBOX_MAX_TRIES) {
      await del().catch(() => {});
      continue;
    }

    let msg: MailInput;
    try {
      msg = JSON.parse(row.payload) as MailInput;
    } catch {
      await del().catch(() => {}); // 坏数据，删掉
      continue;
    }

    const r = await attemptOnce(env, msg);
    if (r.ok) {
      await del().catch(() => {});
      sent++;
      continue;
    }
    if (r.failure === 'rejected') {
      await del().catch(() => {});
      continue;
    }

    const tries = Number(row.tries) + 1;
    if (tries >= OUTBOX_MAX_TRIES) {
      await del().catch(() => {});
      console.warn('[mail] 补发次数用尽，丢弃:', r.reason);
      continue;
    }
    const backoff = Math.min(OUTBOX_BACKOFF_MAX, OUTBOX_BACKOFF_BASE * 2 ** tries);
    await env.DB.prepare(
      'UPDATE mail_outbox SET tries = ?1, next_try_at = ?2, last_error = ?3 WHERE id = ?4',
    )
      .bind(tries, now + backoff, String(r.reason || '').slice(0, 120), row.id)
      .run()
      .catch(() => {});
    left++;
  }

  if (sent || left) console.log(`[mail] 补发队列：成功 ${sent} 封，未发成 ${left} 封`);
  return { sent, left };
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
