// 友链申请的限流 + 邮件排队(后台方案 · 阶段 B.1)
//
// 计数用 **Upstash Redis**(HTTP REST,适配 Serverless):INCR 原子、TTL 自动过期,
// 并发下计数绝对精确,也不需要写裁剪逻辑。
//
// 设计要点:
//  · **fail-open**:Upstash 不可用/未配置时**放行**并记日志。对友链申请页来说,
//    「偶尔少一层限流」远比「真人提交不了」可接受(Turnstile 与去重仍在)。
//  · 只对**通过 Turnstile 的真实提交**计数:填错字段、没解人机验证的请求不占用额度,
//    所以要刷额度必须先真解一次 Turnstile —— 这本身就限制了刷的频率。
//  · IP 不落明文:只存 HMAC-SHA256(ip, APPLY_IP_SALT) 的前 16 位,且 24 小时后随窗口过期。
//  · 邮件额度是**稀缺资源**(Resend 免费 100 封/天),所以超限**不丢**:进队列,
//    下一个小时有额度时(由下一次提交触发)自动补发。

import { createHmac } from 'node:crypto';
import { env } from './serverEnv';

export interface UpstashConfig {
  url: string;
  token: string;
  /** 便于本地联调指向 mock;默认用 url 本身 */
  apiBase?: string;
}

export interface LimitDecision {
  allowed: boolean;
  scope?: 'ip-interval' | 'ip-hour' | 'ip-day' | 'global-hour' | 'global-day';
  retryAfterSec?: number;
  message?: string;
  /** true = Upstash 不可用,本次是放行通过的 */
  degraded?: boolean;
}

const int = (key: string, fallback: number) => {
  const v = Number.parseInt(env(key), 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** 限额(可用环境变量覆盖,不配就用默认值) */
export const LIMITS = {
  ipIntervalSec: int('APPLY_RL_IP_INTERVAL_SEC', 10),
  ipHour: int('APPLY_RL_IP_HOUR', 3),
  ipDay: int('APPLY_RL_IP_DAY', 5),
  allHour: int('APPLY_RL_ALL_HOUR', 10),
  allDay: int('APPLY_RL_ALL_DAY', 40),
  mailHour: int('APPLY_MAIL_HOUR', 20),
  mailDay: int('APPLY_MAIL_DAY', 60),
};

/** 队列最多攒这么多条通知;超过就丢最旧的(申请数据本身还在私有仓库里,不会丢) */
const QUEUE_MAX = int('APPLY_MAIL_QUEUE_MAX', 500);
/** 队列里超过这个天数的直接丢弃(太旧的补发也没意义) */
const QUEUE_TTL_DAYS = 7;

const P = 'qw';

/** IP → 不可逆短标识。换盐即全部失效,不存明文 IP。 */
export function hashIp(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip || 'unknown').digest('hex').slice(0, 16);
}

export function rateLimitConfig(): UpstashConfig | null {
  const url = env('UPSTASH_REDIS_REST_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return null;
  const apiBase = env('UPSTASH_API_BASE') || undefined;
  return { url, token, apiBase };
}

type Command = (string | number)[];

/**
 * 跑一批命令(Upstash pipeline:一次 HTTP 往返)。失败抛错,由调用方决定 fail-open。
 */
export async function pipeline(
  cfg: UpstashConfig,
  commands: Command[],
): Promise<(unknown | null)[]> {
  const base = (cfg.apiBase || cfg.url).replace(/\/$/, '');
  const res = await fetch(`${base}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  if (!Array.isArray(data)) throw new Error('Upstash 返回格式异常');
  return data.map((d) => {
    if (d && typeof d === 'object' && 'error' in d && d.error) throw new Error(`Upstash: ${d.error}`);
    return (d?.result ?? null) as unknown | null;
  });
}

const hourBucket = (now: number) => Math.floor(now / 3_600_000);
const dayBucket = (now: number) => Math.floor(now / 86_400_000);
const secToNextHour = (now: number) => 3600 - Math.floor((now % 3_600_000) / 1000);
const secToNextDay = (now: number) => 86_400 - Math.floor((now % 86_400_000) / 1000);

/**
 * 检查并计数一次提交。
 *
 * 分两段走：
 *  ① **最小间隔**(`SET NX`)—— 原子「占坑」。没占上就说明刚提交过，直接拒，
 *     **且不消耗下面的窗口额度**(手抖双击不该吃掉一次机会)。
 *  ② 各窗口 `INCR` —— 一旦进到这里就计数，**被窗口拒的尝试也计数**，
 *     这正是「一个人不能一直提交」想要的语义。
 */
export async function checkAndBump(
  cfg: UpstashConfig,
  ipHash: string,
  now = Date.now(),
): Promise<LimitDecision> {
  const hb = hourBucket(now);
  const db = dayBucket(now);
  const lastKey = `${P}:rl:last:${ipHash}`;
  const ipH = `${P}:rl:ip:${ipHash}:h:${hb}`;
  const ipD = `${P}:rl:ip:${ipHash}:d:${db}`;
  const allH = `${P}:rl:all:h:${hb}`;
  const allD = `${P}:rl:all:d:${db}`;

  try {
    // ——① 最小间隔 ——
    const first = await pipeline(cfg, [
      ['SET', lastKey, String(now), 'NX', 'EX', LIMITS.ipIntervalSec],
      ['TTL', lastKey],
    ]);
    if (first[0] === null) {
      const ttl = Number(first[1] ?? 0);
      return {
        allowed: false,
        scope: 'ip-interval',
        retryAfterSec: ttl > 0 ? ttl : LIMITS.ipIntervalSec,
        message: '刚刚已经提交过一次了，请稍等十几秒再试 ~',
      };
    }

    // ——② 各窗口计数 ——
    const r = await pipeline(cfg, [
      ['INCR', ipH],
      ['EXPIRE', ipH, 3600],
      ['INCR', ipD],
      ['EXPIRE', ipD, 86_400],
      ['INCR', allH],
      ['EXPIRE', allH, 3600],
      ['INCR', allD],
      ['EXPIRE', allD, 86_400],
    ]);

    const ipHourN = Number(r[0] ?? 0);
    const ipDayN = Number(r[2] ?? 0);
    const allHourN = Number(r[4] ?? 0);
    const allDayN = Number(r[6] ?? 0);

    if (ipHourN > LIMITS.ipHour) {
      return {
        allowed: false,
        scope: 'ip-hour',
        retryAfterSec: secToNextHour(now),
        message: '同一个人一小时最多申请几次，先歇一会儿再来吧 ~',
      };
    }
    if (ipDayN > LIMITS.ipDay) {
      return {
        allowed: false,
        scope: 'ip-day',
        retryAfterSec: secToNextDay(now),
        message: '今天提交的次数有点多啦，明天再来试试 ~',
      };
    }
    if (allHourN > LIMITS.allHour || allDayN > LIMITS.allDay) {
      return {
        allowed: false,
        scope: 'global-hour',
        retryAfterSec: allHourN > LIMITS.allHour ? secToNextHour(now) : secToNextDay(now),
        message: '现在来申请的人有点多，暂时先停一停，请稍后再来 ~',
      };
    }
    return { allowed: true };
  } catch (err) {
    // fail-open:宁可少一层限流,也不要挡住真人
    console.error('[apply] 限流不可用，本次放行(fail-open):', err);
    return { allowed: true, degraded: true };
  }
}

// ————————————————————————————————————————————————
// 邮件额度与排队
// ————————————————————————————————————————————————

export interface MailQueueItem {
  /** 排队时间(ms) */
  at: number;
  payload: Record<string, unknown>;
}

function mailKeys(now: number) {
  return {
    hour: `${P}:mail:h:${hourBucket(now)}`,
    day: `${P}:mail:d:${dayBucket(now)}`,
    queue: `${P}:mail:pending`,
  };
}

/** 读当前小时/今天还剩多少封邮件额度 */
export async function mailBudget(
  cfg: UpstashConfig,
  now = Date.now(),
): Promise<{ hourLeft: number; dayLeft: number }> {
  const k = mailKeys(now);
  const r = await pipeline(cfg, [
    ['GET', k.hour],
    ['GET', k.day],
  ]);
  const usedHour = Number(r[0] ?? 0);
  const usedDay = Number(r[1] ?? 0);
  return {
    hourLeft: Math.max(0, LIMITS.mailHour - usedHour),
    dayLeft: Math.max(0, LIMITS.mailDay - usedDay),
  };
}

async function bumpMailCounters(cfg: UpstashConfig, now: number) {
  const k = mailKeys(now);
  await pipeline(cfg, [
    ['INCR', k.hour],
    ['EXPIRE', k.hour, 3600],
    ['INCR', k.day],
    ['EXPIRE', k.day, 86_400],
  ]);
}

export async function queueLength(cfg: UpstashConfig, now = Date.now()): Promise<number> {
  const k = mailKeys(now);
  const r = await pipeline(cfg, [['LLEN', k.queue]]);
  return Number(r[0] ?? 0);
}

export async function pushQueue(cfg: UpstashConfig, item: MailQueueItem, now = Date.now()) {
  const k = mailKeys(now);
  await pipeline(cfg, [
    ['RPUSH', k.queue, JSON.stringify(item)],
    // 超出上限就留最新的 QUEUE_MAX 条
    ['LTRIM', k.queue, -QUEUE_MAX, -1],
  ]);
}

/**
 * Redis 不可用/未配置时的**进程内兜底**计数。
 * Serverless 下每个实例各算各的,不是精确限流,只为把「故障期/未配置期」的发信量兜住,
 * 免得这时候被无限刷信把 Resend 额度烧光。申请数据本身照样落私有仓库,不会丢。
 */
const localSends: number[] = [];
function localAllow(maxPerHour: number): boolean {
  const now = Date.now();
  while (localSends.length && localSends[0] < now - 3_600_000) localSends.shift();
  if (localSends.length >= maxPerHour) return false;
  localSends.push(now);
  return true;
}

/**
 * 投递通知:先补发队列里的旧通知,再发本次的;额度用完则把本次排队。
 * 返回本次通知是否**已经发出**、以及是否**排进了待发队列**。
 *
 * cfg 为 null(没配 Upstash)时走进程内兜底,不发队列。
 */
export async function deliverNotifications(
  cfg: UpstashConfig | null,
  send: (payload: Record<string, unknown>) => Promise<boolean>,
  current: Record<string, unknown>,
  now = Date.now(),
): Promise<{ notified: boolean; queued: boolean }> {
  // —— 没配 Redis:进程内兜底,够了就发,超了就跳过(不排队,因为没地方排) ——
  if (!cfg) {
    if (!localAllow(LIMITS.mailHour)) {
      console.warn('[apply] 未配置 Upstash，进程内兜底额度已满，跳过本次通知');
      return { notified: false, queued: false };
    }
    return { notified: await send(current), queued: false };
  }

  const k = mailKeys(now);
  let budget = 0;
  try {
    const b = await mailBudget(cfg, now);
    budget = Math.min(b.hourLeft, b.dayLeft);
  } catch (err) {
    // 读不到额度 = Redis 出问题:用进程内兜底放一封,别把通知全压住
    console.error('[apply] 读邮件额度失败，改用进程内兜底:', err);
    budget = localAllow(LIMITS.mailHour) ? 1 : 0;
  }

  const staleBefore = now - QUEUE_TTL_DAYS * 86_400_000;
  let delivered = 0;

  if (budget > 0) {
    try {
      const r = await pipeline(cfg, [['LRANGE', k.queue, 0, -1]]);
      const raw = Array.isArray(r[0]) ? (r[0] as string[]) : [];
      for (const s of raw) {
        if (budget <= 0) break;
        let item: MailQueueItem | null = null;
        try {
          item = JSON.parse(s) as MailQueueItem;
        } catch {
          /* 坏数据:直接丢掉 */
        }
        // 队列头出队(顺序处理,与 LPOP 语义一致)
        await pipeline(cfg, [['LPOP', k.queue]]);
        if (!item || !item.at || item.at < staleBefore) continue;
        const ok = await send(item.payload);
        if (ok) {
          delivered++;
          budget--;
          await bumpMailCounters(cfg, now);
        } else {
          // 发失败 → 放回队尾,等下次
          await pushQueue(cfg, item, now);
        }
      }
    } catch (err) {
      console.error('[apply] 补发队列失败，跳过:', err);
    }
  }

  // 再处理本次这一条
  if (budget > 0) {
    const ok = await send(current);
    if (ok) {
      try {
        await bumpMailCounters(cfg, now);
      } catch {
        /* 计数失败不影响已经发出去的邮件 */
      }
      return { notified: true, queued: false };
    }
  }
  try {
    await pushQueue(cfg, { at: now, payload: current }, now);
    return { notified: false, queued: true };
  } catch (err) {
    console.error('[apply] 通知排队失败(该申请仍已存进仓库):', err);
    return { notified: false, queued: false };
  }
}
