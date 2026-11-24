// 长亭 · 本地审核清单（发送时的第一道筛）
//
// 分工（见 docs/审核清单-聊天室.md）：
//   **清单只判「不需要理解语义就能判」的，语义归异步的 AI。**
//
// 为什么不能靠关键词一刀切：中文里「赌博」「色情」单独出现都不是违规
// （「这游戏机制像赌博」），单词就拦会把一半正常对话吃掉。
// 所以这里只有两类判据：几何特征（长度/链接数/重复/频率）和组合特征（黑话 + 联系方式同现）。
//
// 四条纪律：
//   · 纯函数：不查库、不发网络、不 async。查库的东西由调用方一次查好塞进 ctx
//   · 常数时间：一条消息的判定 <1ms，因为它在发送路径上
//   · 命中不丢信息：返回 hits 数组，调用方据此累加 chat_rule_stats
//   · 处置分四档：block（不落库）/ hold（只有自己可见）/ flag（正常显示+优先审）/ pass

import { BLACK_HOSTS, FUNNEL, PROFANITY, RISKY, TRUSTED_HOSTS } from './words';

export type Action = 'block' | 'hold' | 'flag' | 'pass';

export interface ScreenCtx {
  /** 'admin' | 'visitor' */
  role: string;
  /** 该账号最近 5 条正文（调用方查库给） */
  recentBodies: string[];
  /** 上一条消息的时间戳（毫秒）；0 = 没有历史 */
  lastTs: number;
  /** 60 秒内的条数（含本条之前的） */
  minuteCount: number;
  /** 账号注册了多久（小时） */
  accountAgeHours: number;
  /** 累计发言条数 */
  totalMessages: number;
  /** 现在（毫秒）。传进来而不是 Date.now()，纯函数才好测 */
  now: number;
  /** 友链域名（调用方从 links.json 现算，缓存住），小写、不含 www */
  trustedHosts?: Set<string>;
}

export interface ScreenResult {
  action: Action;
  /** 命中的规则 id，如 ['L0-3','L1-5'] */
  hits: string[];
  /** 完全跳过 AI —— 只有站长 */
  skipJudge: boolean;
  /** 熔断要写的临时禁言分钟数（只有 L0-6 会给） */
  banMinutes?: number;
  /** block 时给前端的一句话（中性，不解释违反了哪条） */
  reason?: string;
}

const MAX_BODY = 500;
const MIN_GAP_MS = 1_200;
const MINUTE_MAX = 15;

/** URL 提取。前后不吃标点 —— 中文里的「，）】」不该算进链接 */
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'）】，。；！？]+/gi;

const PHONE_RE = /(?:^|[^\d])(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const WECHAT_RE = /(?:微信|vx|v信|威信|weixin)\s*[:：]?\s*[a-z0-9_-]{4,}/i;

/** 纯表情：只由 `:[key]` token 组成，最多 6 个 */
const EMOJI_ONLY_RE = /^(?:\s*:\[[a-z0-9_]{1,32}\]){1,6}\s*$/;

/** 规范化：重复刷屏判定不能因为多打两个空格就绕过 */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/** 从 URL 字符串里取小写主机名（去 www）；解析不了返回空串 */
function hostOf(raw: string): string {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 去掉所有 URL 和空白后还剩几个字符 */
function visibleLenWithoutUrls(text: string): number {
  return text
    .replace(URL_RE, '')
    .replace(/[\s，。、；：！？,.;:!?~…—\-·]/g, '')
    .length;
}

function anyWord(text: string, list: string[]): boolean {
  const lower = text.toLowerCase();
  return list.some((w) => lower.includes(w.toLowerCase()));
}

function trustedHost(host: string, ctx: ScreenCtx): boolean {
  if (!host) return true; // 解析不出来就别当成外链判死
  if (TRUSTED_HOSTS.includes(host)) return true;
  return Boolean(ctx.trustedHosts?.has(host));
}

/**
 * 过一遍清单。
 *
 * 返回最严的那一档：block > hold > flag > pass；命中的所有规则都记在 hits 里
 * （统计要看到「这条同时踩了三条」，而不是只看到结论）。
 */
export function screen(text: string, ctx: ScreenCtx): ScreenResult {
  const body = String(text ?? '');
  const normed = norm(body);
  const urls = body.match(URL_RE) ?? [];
  const hits: string[] = [];

  // —— 站长：连 AI 都不判 ——
  // 自己人不需要审自己；这条也是唯一 skipJudge 的分支。
  if (ctx.role === 'admin') return { action: 'pass', hits: ['L2-1'], skipJudge: true };

  // ————————— L0 硬拦 —————————

  let block = false;
  let banMinutes: number | undefined;

  // L0-1 超长
  if (body.length > MAX_BODY) {
    hits.push('L0-1');
    block = true;
  }

  // L0-2 纯链接：只有一条链接，剩下几乎没有字
  if (urls.length === 1 && visibleLenWithoutUrls(body) < 4) {
    hits.push('L0-2');
    block = true;
  }

  // L0-3 链接堆叠
  if (urls.length >= 3) {
    hits.push('L0-3');
    block = true;
  }

  // L0-4 重复刷屏：和最近 5 条中任一条完全相同
  if (normed && ctx.recentBodies.some((b) => norm(b) === normed)) {
    hits.push('L0-4');
    block = true;
  }

  // L0-5 连发间隔：距上一条 <1.2 秒，且已经连了 5 次
  // 抓的是「脚本连发」（节奏太整齐）；人肉刷屏交给 L0-6
  if (ctx.lastTs > 0 && ctx.now - ctx.lastTs < MIN_GAP_MS && ctx.minuteCount >= 5) {
    hits.push('L0-5');
    block = true;
  }

  // L0-6 频率熔断：60 秒超过 15 条 → 临时禁言 5 分钟
  if (ctx.minuteCount >= MINUTE_MAX) {
    hits.push('L0-6');
    block = true;
    banMinutes = 5;
  }

  // L0-7 黑域名（名单起步为空，见 words.ts）
  for (const u of urls) {
    const h = hostOf(u);
    if (h && BLACK_HOSTS.some((b) => h === b || h.endsWith(`.${b}`))) {
      hits.push('L0-7');
      block = true;
      break;
    }
  }

  // L0-8 高危组合：黑产话术 **且** 同句有联系方式形态
  // 单出现「刷单」不拦（可能在讨论反诈），配着手机号/微信号一起才拦
  if (
    anyWord(body, RISKY) &&
    (PHONE_RE.test(body) || WECHAT_RE.test(body) || EMAIL_RE.test(body))
  ) {
    hits.push('L0-8');
    block = true;
  }

  if (block) {
    return {
      action: 'block',
      hits,
      skipJudge: false,
      banMinutes,
      // 不解释违反了哪条 —— 说了等于给出绕过说明书
      reason: '这条没发出去，换个说法试试',
    };
  }

  // ————————— L1 可疑 —————————

  let hold = false;

  // L1-1 手机号
  if (PHONE_RE.test(body)) {
    hits.push('L1-1');
    hold = true;
  }

  // L1-3 微信号
  if (WECHAT_RE.test(body)) {
    hits.push('L1-3');
    hold = true;
  }

  // L1-2 邮箱（比手机号常见，放宽一档）
  if (EMAIL_RE.test(body)) hits.push('L1-2');

  // L1-4 引流词
  if (anyWord(body, FUNNEL)) hits.push('L1-4');

  // L1-5 外链：有任何一条主机不在白名单
  if (urls.some((u) => !trustedHost(hostOf(u), ctx))) hits.push('L1-5');

  // L1-6 脏话（永不 block）
  if (anyWord(body, PROFANITY)) hits.push('L1-6');

  // L1-7 新账号：注册 < 24h 或发言 < 5 条
  if (ctx.accountAgeHours < 24 || ctx.totalMessages < 5) hits.push('L1-7');

  if (hold) return { action: 'hold', hits, skipJudge: false };
  if (hits.length > 0) return { action: 'flag', hits, skipJudge: false };

  // ————————— L2 免检 —————————
  // 纯表情 / 极短：跳过清单，但**仍然进 AI 队列**（清单本来就不判语义）

  if (EMOJI_ONLY_RE.test(body)) return { action: 'pass', hits: ['L2-2'], skipJudge: false };
  if (body.length <= 4) return { action: 'pass', hits: ['L2-3'], skipJudge: false };

  return { action: 'pass', hits: [], skipJudge: false };
}

/** 规则说明（后台 /admin/chat 的规则页要展示「这条为什么存在」） */
export const RULE_NOTES: Record<string, string> = {
  'L0-1': '正文超过 500 字 · 聊天不是发文的地方',
  'L0-2': '只有一条链接、几乎没有字 · 聊天室里没有正常用途',
  'L0-3': '单条 3 条以上链接 · 典型 SEO 灌水形态',
  'L0-4': '与最近 5 条完全相同 · 重复刷屏',
  'L0-5': '距上条不足 1.2 秒且已连发 5 次 · 脚本节奏',
  'L0-6': '60 秒超过 15 条 · 临时禁言 5 分钟',
  'L0-7': '主机命中黑名单',
  'L0-8': '黑产话术 + 联系方式同现 · 单词出现不拦',
  'L1-1': '手机号 · 只有自己可见，等 AI 放行',
  'L1-2': '邮箱 · 正常显示，优先审',
  'L1-3': '微信号 · 只有自己可见',
  'L1-4': '引流词 · 单词命中不 hold（「私聊」也可能是正常说法）',
  'L1-5': '外链主机不在白名单',
  'L1-6': '脏话 · 只 flag 不 block，交给 AI 判语境',
  'L1-7': '新账号（<24h 或 <5 条）· 不是嫌疑人，但值得先看一眼',
  'L2-1': '站长 · 跳过全部审核',
  'L2-2': '纯表情',
  'L2-3': '极短（≤4 字）',
};
