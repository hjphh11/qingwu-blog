// 清吾 · 后台可调设置
//
// 一张 key-value 表（`0018_admin_settings.sql`），一个读入口、一个写入口。
// 之所以不做「一个设置一行」的宽表：这里全是稀疏的开关与小数值，
// 宽表每加一项就要写一次迁移，而 key-value 加新键只是代码里多一行默认值。
//
// —— 三条规矩 ——
// 1) **库里有的值才算数，库里没有就回落到 env / 代码默认**。老部署不跑迁移也不会坏。
// 2) **写只走 `saveSettings`**，白名单 + 逐项校验在下面收口。前端送什么进来都不算数。
// 3) **读不做缓存**。一次 `SELECT key, value` 几十微秒，比不上缓存失效带来的麻烦。
//    （`autoReplyTo` 在 waitUntil 里跑，每次多这一条完全无感。）

import type { Env } from '../types';
import { json } from '../util';
import type { Admin } from './auth';

/**
 * judge 能识别、也能被单独关掉的五类判定。`ok` 不是类别，是「没命中」。
 *
 * 口径按法律用语排的，不是按「看着烦」排的：
 * 违法信息与不良信息的划分参照《网络信息内容生态治理规定》，
 * 垃圾广告不属于违法内容，单独留一类 —— 它是最常见的一类，不该和违法混在一起判。
 */
export const VERDICTS = ['illegal', 'porn', 'abuse', 'privacy', 'spam'] as const;
export type VerdictKey = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<VerdictKey | 'ok', string> = {
  ok: '正常',
  illegal: '违法违规',
  porn: '色情低俗',
  abuse: '侮辱攻击',
  privacy: '隐私侵权',
  spam: '垃圾广告',
};

/**
 * 每一类的判定口径。**系统提示词、Jev 的 criteria、后台页面上的说明共用这一份。**
 * 三处各写一遍，改规则时必然有一处忘改，线上判定和页面描述就会对不上。
 */
export const VERDICT_DESC: Record<VerdictKey | 'ok', string> = {
  ok: '正常交流、提问、合理批评、调侃。批评不等于辱骂',
  illegal: '涉政有害、暴恐、赌博、毒品、诈骗传销、教唆违法犯罪',
  porn: '色情、软色情、低俗引流、涉未成年人的不当内容',
  abuse: '侮辱谩骂、人身攻击、地域或性别歧视、威胁恐吓、诽谤',
  privacy: '他人真实姓名、住址、电话、证件号、私聊记录等人肉与隐私泄露',
  spam: '广告、引流、纯链接、SEO 灌水、与本站无关的推广',
};

/** 一条通道的接口三件套。base 末尾的斜杠在解析时就去掉，免得拼出 `//chat/completions`。 */
export interface AiEndpoint {
  /** 空 = 用 env；再空 = 用代码里的默认地址 */
  base: string;
  /** 空 = 用 env 的 key。非空即覆盖（库里是明文，只在服务端读） */
  key: string;
  /** 空 = 用 env 的模型名 */
  model: string;
}

export interface Settings {
  autoReply: {
    on: boolean;
    perGuest: number;
    /** top = 只回顶层；all = 楼中楼也回 */
    scope: 'top' | 'all';
    /** 允许自动回复的路径（空 = 不限）；逗号分隔，前缀匹配 */
    allowPaths: string[];
    /** 一律不回自动回复的路径，优先级高于 allowPaths */
    blockPaths: string[];
    /** 正文命中的关键词，命中就跳过（逗号分隔，不区分大小写） */
    skipKeywords: string[];
    // 2026-11-10 晚删掉两项：`daily`（每日总上限）与 `quietFrom/quietTo`（安静时段）。
    // 站长原话「这个不用限制」「这个也不要」—— 小爱该不该说话由单访客额度与 judge 判，
    // 不再按天卡总量、也不再按时段闭嘴。花费的硬闸在 ai.ts 的每日配额（AI_DAILY_LIMIT），
    // 那道闸跟运营口径无关，不能一起删。
  };
  /**
   * 两条 AI 通道的接口配置。**空串一律表示「跟随环境变量」**，不是「清空」——
   * 这样没配过的人升级上来，行为和以前完全一样；配过的人只在库里多几行。
   *
   * 2026-11-10 深夜加的：站长要求「可以修改模型的 api，保存生效」。
   * key 允许落库（自己的服务器、自己的 key），但**页面永远不回显明文**，
   * 只给尾号与「已配置」—— 见 `getSettings` 里的 maskKeys。
   */
  ai: {
    writer: AiEndpoint;
    judge: AiEndpoint & {
      /** '' = 跟随 env.AI_JUDGE_PROVIDER；jev = 决策协议；openai = 聊天模型输出 JSON */
      provider: '' | 'jev' | 'openai';
    };
  };
  writer: {
    temperature: number;
    maxTokens: number;
  };
  judge: {
    /** 启用哪几类拦截。关掉的类别不进提示词 —— 模型压根没机会选它。 */
    categories: VerdictKey[];
    /** 判定为「应拦截」的把握达到这个分数才动手（0~100） */
    threshold: number;
  };
}

export const DEFAULTS: Settings = {
  autoReply: {
    on: true,
    perGuest: 1,
    scope: 'top',
    allowPaths: [],
    blockPaths: [],
    skipKeywords: [],
  },
  ai: {
    writer: { base: '', key: '', model: '' },
    judge: { provider: '', base: '', key: '', model: '' },
  },
  writer: { temperature: 0.8, maxTokens: 400 },
  judge: { categories: [...VERDICTS], threshold: 60 },
};

// ——————————————————————————————————————————————————————————
// 解析
// ——————————————————————————————————————————————————————————
function str(v: unknown): string {
  return String(v ?? '').trim();
}

function boolOf(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase();
  if (s === 'off' || s === '0' || s === 'false' || s === 'no') return false;
  if (s === 'on' || s === '1' || s === 'true' || s === 'yes') return true;
  return fallback;
}

function intOf(v: string | undefined, fallback: number, min: number, max: number): number {
  if (v == null || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function numOf(v: string | undefined, fallback: number, min: number, max: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** 逗号 / 换行 / 中文逗号都当分隔符：从文章里拷一行关键词进来不该被判成非法。 */
function listOf(v: string | undefined): string[] {
  return str(v)
    .split(/[,，\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/**
 * 接口地址。只收 http(s) 开头的，末尾斜杠去掉（`chat()` 里是 `${base}/chat/completions`）。
 *
 * 填错（少了协议、打成 `api.deepseek.com`）时**丢空回落到 env**，而不是存一个
 * 必然 404 的地址 —— 存进去之后线上表现就是「AI 全挂」，比改不动更难查。
 */
function urlOf(v: unknown): string {
  const s = str(v).replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? s.slice(0, 200) : '';
}

function providerOf(v: unknown): '' | 'jev' | 'openai' {
  const s = str(v).toLowerCase();
  return s === 'jev' || s === 'openai' ? s : '';
}

function categoriesOf(v: string | undefined, fallback: VerdictKey[]): VerdictKey[] {
  if (v == null) return fallback;
  const picked = listOf(v).filter((k): k is VerdictKey => (VERDICTS as readonly string[]).includes(k));
  // 一个都不选是没有意义的（等于关掉审核却又开着开关），回落到全选
  return picked.length ? picked : [...VERDICTS];
}

function autoReplyEnvOn(env: Env): boolean {
  const v = str(env.AUTO_REPLY);
  return boolOf(v, DEFAULTS.autoReply.on);
}

/** 把「库里读出来的扁平 map」+ env 合并成结构化设置。 */
export function parseSettings(rows: Record<string, string>, env: Env): Settings {
  const g = (k: string): string | undefined => rows[k];

  return {
    autoReply: {
      // 总开关的特例：库里没写过这一项时，仍然认 env 的老开关（AUTO_REPLY=off）
      on: g('autoReply.on') == null ? autoReplyEnvOn(env) : boolOf(g('autoReply.on'), DEFAULTS.autoReply.on),
      perGuest:
        g('autoReply.perGuest') == null
          ? intOf(str(env.AUTO_REPLY_PER_GUEST), DEFAULTS.autoReply.perGuest, 0, 50)
          : intOf(g('autoReply.perGuest'), DEFAULTS.autoReply.perGuest, 0, 50),
      scope: str(g('autoReply.scope')) === 'all' ? 'all' : 'top',
      allowPaths: listOf(g('autoReply.allowPaths')),
      blockPaths: listOf(g('autoReply.blockPaths')),
      skipKeywords: listOf(g('autoReply.skipKeywords')),
    },
    writer: {
      temperature: numOf(g('writer.temperature'), DEFAULTS.writer.temperature, 0, 2),
      maxTokens: intOf(g('writer.maxTokens'), DEFAULTS.writer.maxTokens, 80, 2000),
    },
    ai: {
      writer: {
        base: urlOf(g('ai.writer.base')),
        key: str(g('ai.writer.key')),
        model: str(g('ai.writer.model')),
      },
      judge: {
        provider: providerOf(g('ai.judge.provider')),
        base: urlOf(g('ai.judge.base')),
        key: str(g('ai.judge.key')),
        model: str(g('ai.judge.model')),
      },
    },
    judge: {
      categories: categoriesOf(g('judge.categories'), DEFAULTS.judge.categories),
      threshold: intOf(g('judge.threshold'), DEFAULTS.judge.threshold, 0, 100),
    },
  };
}

/**
 * 读全部设置。表不存在（迁移没跑）时退回纯 env 口径，**不抛错** ——
 * 后台只是少几个开关，不该因此整页 500。
 */
export async function loadSettings(env: Env): Promise<Settings> {
  try {
    const r = await env.DB.prepare('SELECT key, value FROM admin_settings').all<{ key: string; value: string }>();
    const m: Record<string, string> = {};
    for (const it of r.results ?? []) m[it.key] = it.value;
    return parseSettings(m, env);
  } catch {
    return parseSettings({}, env);
  }
}

// ——————————————————————————————————————————————————————————
// 保存
// ——————————————————————————————————————————————————————————

/** 扁平化：结构化设置 → 那一串 key。写库和「恢复默认」都走它，避免两处各写一份。 */
export function flatten(s: Settings): Record<string, string> {
  return {
    'autoReply.on': s.autoReply.on ? 'on' : 'off',
    'autoReply.perGuest': String(s.autoReply.perGuest),
    'autoReply.scope': s.autoReply.scope,
    'autoReply.allowPaths': s.autoReply.allowPaths.join(','),
    'autoReply.blockPaths': s.autoReply.blockPaths.join(','),
    'autoReply.skipKeywords': s.autoReply.skipKeywords.join(','),
    'writer.temperature': String(s.writer.temperature),
    'writer.maxTokens': String(s.writer.maxTokens),
    'ai.writer.base': s.ai.writer.base,
    'ai.writer.key': s.ai.writer.key,
    'ai.writer.model': s.ai.writer.model,
    'ai.judge.provider': s.ai.judge.provider,
    'ai.judge.base': s.ai.judge.base,
    'ai.judge.key': s.ai.judge.key,
    'ai.judge.model': s.ai.judge.model,
    'judge.categories': s.judge.categories.join(','),
    'judge.threshold': String(s.judge.threshold),
  };
}

/** 允许前端改的键。不在这张表里的键一律忽略（不是报错 —— 多送几个无害）。 */
const WRITABLE = new Set(Object.keys(flatten(DEFAULTS)));

/**
 * 合并式保存：只写传进来的键，其余保持原样。
 *
 * 传入的值先过一遍 `parseSettings` 的同一套解析 —— **校验和读取用同一份代码**，
 * 不另写一套，否则迟早出现「存进去 0.9、读出来 0.8」这种事。
 */
export async function saveSettings(
  env: Env,
  admin: Admin | null,
  patch: Record<string, unknown>,
): Promise<Settings> {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!WRITABLE.has(k)) continue;
    raw[k] = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v ?? '');
  }

  // 用「当前值 + 补丁」的完整结构过一遍校验，保证写进去的就是将来读出来的
  const cur = await loadSettings(env);
  const merged = flatten(cur);
  for (const [k, v] of Object.entries(raw)) merged[k] = v;
  const clean = flatten(parseSettings(merged, env));

  const ts = Date.now();
  const by = admin?.username ?? null;
  const stmts = [...WRITABLE]
    .filter((k) => k in raw)
    .map((k) =>
      env.DB.prepare(
        `INSERT INTO admin_settings (key, value, ts, by_name) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, ts = excluded.ts, by_name = excluded.by_name`,
      ).bind(k, clean[k], ts, by),
    );

  if (stmts.length) await env.DB.batch(stmts);
  return parseSettings(clean, env);
}

// ——————————————————————————————————————————————————————————
// 路径与关键词判定（纯函数，给 ai.ts 用）
//
// 这里原本还有 `bjMinutes` / `inQuietHours`（安静时段）。2026-11-10 晚随设置项一起删掉 ——
// 没有入口的开关留着就是一段永远不会生效、却要一直维护的代码。
// ——————————————————————————————————————————————————————————

/** 路径是否命中一条规则。以 `/` 结尾的按前缀比，其余按整段比，避免 `/friends` 误吃 `/friendship`。 */
function hitsPath(path: string, rule: string): boolean {
  const p = path || '/';
  const r = rule.startsWith('/') ? rule : `/${rule}`;
  return r.endsWith('/') ? p.startsWith(r) : p === r || p.startsWith(`${r}/`);
}

/** 自动回复的路径闸：blockPaths 优先，再看 allowPaths（空 = 不限）。 */
export function autoReplyPathAllowed(s: Settings, path: string): boolean {
  if (s.autoReply.blockPaths.some((r) => hitsPath(path, r))) return false;
  if (s.autoReply.allowPaths.length === 0) return true;
  return s.autoReply.allowPaths.some((r) => hitsPath(path, r));
}

/** 正文是否命中跳过关键词（不区分大小写）。返回命中的那一个，方便写进流水。 */
export function skipKeywordOf(s: Settings, body: string): string | null {
  const text = body.toLowerCase();
  for (const k of s.autoReply.skipKeywords) {
    if (text.includes(k.toLowerCase())) return k;
  }
  return null;
}

// ——————————————————————————————————————————————————————————
// HTTP —— GET /admin/settings、PATCH /admin/settings
//
// 就这两个动作。没有「新建」「删除」：键集合由代码里的 DEFAULTS 决定，
// 前端只能改值，不能凭空造一个谁都不认识的键出来。
// ——————————————————————————————————————————————————————————
/**
 * 密钥的对外形态：只留尾 4 位 + 来源。
 *
 * **明文永不出这个函数**。前端拿到的 key 恒为空串，想改就整条重填，
 * 想删就点「清除」（送空串，回落 env）。这样页面源码、浏览器缓存、截图里都不会有 key。
 */
function maskKey(dbKey: string, envKey: string): { set: boolean; tail: string; from: 'db' | 'env' | 'none' } {
  const k = str(dbKey) || str(envKey);
  if (!k) return { set: false, tail: '', from: 'none' };
  return { set: true, tail: k.length > 4 ? k.slice(-4) : '', from: str(dbKey) ? 'db' : 'env' };
}

/**
 * 对外的设置视图：**两个 key 字段恒为空**，另给一份 keyMeta（有没有配、尾号、来自哪儿）。
 *
 * GET 与 PATCH 共用这一份 —— 只脱敏一处的话，保存那一下响应里就会把明文原路吐回浏览器，
 * 等于白做。
 */
function publicView(env: Env, s: Settings) {
  return {
    settings: {
      ...s,
      ai: {
        writer: { ...s.ai.writer, key: '' },
        judge: { ...s.ai.judge, key: '' },
      },
    },
    keyMeta: {
      writer: maskKey(s.ai.writer.key, String(env.AI_API_KEY ?? '')),
      judge: maskKey(s.ai.judge.key, String(env.AI_JUDGE_KEY ?? env.AI_API_KEY ?? '')),
    },
  };
}

export async function getSettings(_request: Request, env: Env, _admin: Admin): Promise<Response> {
  const s = await loadSettings(env);
  return json({
    ok: true,
    ...publicView(env, s),
    // 前端要画选项，得知道合法值有哪些；这里一并给出，避免两边各写一份常量
    meta: {
      verdicts: VERDICTS,
      verdictLabel: VERDICT_LABEL,
      verdictDesc: VERDICT_DESC,
      // 环境变量里是否已经配好两条 AI 通道 —— 设置页据此提示「这条改不了 key」
      envHasWriter: Boolean(String(env.AI_API_KEY ?? '').trim()),
      envHasJudge: Boolean(String(env.AI_JUDGE_KEY ?? '').trim() || String(env.AI_API_KEY ?? '').trim()),
      envModel: String(env.AI_MODEL ?? '').trim(),
      envBase: String(env.AI_BASE_URL ?? '').trim(),
      // 输入框的 placeholder 用：留空时到底会打到哪儿、用哪个模型
      aiEnv: {
        writer: {
          base: String(env.AI_BASE_URL ?? '').trim() || 'https://api.deepseek.com',
          model: String(env.AI_MODEL ?? '').trim() || 'deepseek-chat',
        },
        judge: (() => {
          // 按**当前生效的协议**给兜底地址与模型：页面已经选了「Jev 决策」时，
          // 地址框里却提示 api.deepseek.com，会让人以为自己配错了。
          // 判断口径与 ai.ts 的 judgeTargetOf 一致：库里有 provider 就以库为准。
          const p = s.ai.judge.provider || (/^jev$/i.test(String(env.AI_JUDGE_PROVIDER ?? '').trim()) ? 'jev' : 'openai');
          return p === 'jev'
            ? {
                provider: 'jev' as const,
                base: String(env.AI_JUDGE_BASE_URL ?? '').trim() || 'https://api.typesafe.ai',
                model: String(env.AI_JUDGE_MODEL ?? '').trim() || 'jev-latest',
              }
            : {
                provider: 'openai' as const,
                base: String(env.AI_BASE_URL ?? '').trim() || 'https://api.deepseek.com',
                model:
                  String(env.AI_JUDGE_MODEL ?? '').trim() ||
                  String(env.AI_MODEL ?? '').trim() ||
                  'deepseek-chat',
              };
        })(),
      },
    },
  });
}

export async function patchSettings(request: Request, env: Env, admin: Admin): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const v = (await request.json()) as unknown;
    if (!v || typeof v !== 'object') throw new Error('not_object');
    body = v as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  // 前端可以把整份设置平铺回来（form 表单最自然的形状），也可以只送改动的几个键。
  // 两种都吃：saveSettings 本来就是合并式的。
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'settings' && v && typeof v === 'object') {
      const flat = flatten(v as unknown as Settings);
      Object.assign(patch, flat);
      continue;
    }
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return json({ ok: false, reason: 'empty' }, 400);

  try {
    const s = await saveSettings(env, admin, patch);
    console.log(`[admin] ${admin.username} 更新设置：${Object.keys(patch).slice(0, 8).join(', ')}`);
    // 保存后的响应也走脱敏视图：前端拿它回填表单，明文没必要再出一次门
    return json({ ok: true, ...publicView(env, s) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 迁移没跑是最常见的原因，直接把话说明白，别让站长猜
    if (/no such table/i.test(msg)) {
      return json(
        { ok: false, reason: 'no_table', message: 'admin_settings 表不存在，先跑 0018 迁移（本地：npx wrangler d1 migrations apply qingwu --local）' },
        503,
      );
    }
    // 异常原文只进服务端日志：里面可能带 SQL 片段、列名甚至绑定值
    console.error('[admin] 保存设置失败:', msg.slice(0, 300));
    return json({ ok: false, reason: 'db_error', message: '保存失败，看看服务端日志' }, 500);
  }
}
