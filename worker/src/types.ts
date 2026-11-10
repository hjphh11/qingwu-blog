// 清吾 · Worker 环境与共享类型

/** 环境变量（wrangler.toml 的 [vars] + secret + D1 绑定） */
export interface Env {
  /** D1 数据库（wrangler.toml: [[d1_databases]] binding = "DB"） */
  DB: D1Database;

  /** 访客匿名化用的盐。**必填**：没配就只探测不采集（和旧代码缺 SALT 时的行为一致）。 */
  HIT_IP_SALT?: string;
  /** 后台读 /stats 的口令（Bearer）。建议配；不配时 /stats 只认 ADMIN_STATS_ENDPOINT 的空口令（等于公开，见 README） */
  ADMIN_STATS_TOKEN?: string;

  /**
   * 后台读写**友链申请**的口令（Bearer）。与 ADMIN_STATS_TOKEN **刻意分开**：
   * 统计口令泄漏最多暴露访问量，申请口令泄漏会暴露访客邮箱 —— 分开配、分开轮换。
   * 不配时 GET/PATCH /apply 一律 401（前台 POST /apply 不受影响）。
   */
  ADMIN_APPLY_TOKEN?: string;

  /** Turnstile 的 secret（`wrangler secret put TURNSTILE_SECRET`）。没配 = 提交入口关闭 */
  TURNSTILE_SECRET?: string;

  /**
   * **仅本地 `wrangler dev` 使用**：设为 `"1"` 时跳过 Turnstile 的**网络校验**，
   * 任何非空 token 都视为人机验证通过。
   *
   * 为什么需要它：workerd 的网络栈在 Windows 上访问不到 `challenges.cloudflare.com`，
   * 本地联调时提交必然被判 403，整条链路测不了。
   *
   * **它只写在 `worker/.dev.vars`（已 gitignore），线上绝对不要配** ——
   * 线上没有这个变量，`postApply` 走的仍是完整的 `verifyTurnstile`。
   * 想复核这一点：`grep DEV_SKIP_TURNSTILE worker/wrangler.toml` 应无结果。
   */
  DEV_SKIP_TURNSTILE?: string;

  /**
   * **仅本地 `wrangler dev` 使用**：设成任意口令，`GET /admin/dev-login?token=<口令>`
   * 就能换一个真会话（照常写 `admin_sessions`、照常发 cookie）。
   *
   * 为什么要它：后台正常登录是「密码 → 邮件验证码」，本地没有发信中继，
   * 每改一版样式都要去 D1 里捞验证码。这个口子只省掉那一步，鉴权本身没变。
   *
   * **只写在 `worker/.dev.vars`（已 gitignore），线上绝对不要配**。没配时
   * 这条路由直接 404；即使误配，非本机回环 host 也一律 404。
   * 想复核这一点：`grep ADMIN_DEV_LOGIN worker/wrangler.toml` 应无结果。
   */
  ADMIN_DEV_LOGIN?: string;

  /** 允许跨源调用 /hit 的站点，逗号分隔；`*` = 不限制 */
  ALLOWED_ORIGINS?: string;

  /**
   * **归档只读开关**：设为 `"1"` / `"true"` 时，除 GET/HEAD 外的请求一律 `410 Gone`，
   * cron 也直接跳过。
   *
   * 为什么需要：2026-11-10 起唯一主库是香港机本地 SQLite，
   * Cloudflare 上这份 D1 已冻结为归档（见 `docs/决策-数据主从.md`）。
   * 但 `api.qingwu.ink` 这个 Custom Domain 仍然活着 —— 旧缓存页面、外部脚本、
   * 甚至写错的一条 curl 都能往死库里写，分叉了还看不出来。
   *
   * **只在 Cloudflare 那份配**（`wrangler secret put READONLY`），
   * 本地 `.dev.vars` 千万不要配，否则本地写入全变 410。
   */
  READONLY?: string;

  /**
   * Resend 发信密钥（`wrangler secret put RESEND_KEY`）。
   * **没配就不发信**，接口照常成功 —— 邮件是锦上添花，不能卡住留言。
   */
  RESEND_KEY?: string;
  /**
   * 自建发信中继地址（可选）。配了就把请求打给它，不配走 Resend。
   * 请求体与 Resend 的 `POST /emails` 同构；`RESEND_KEY` 同时充当它的 Bearer 令牌。
   * 见 `.deploy/mail-relay/relay.py`。
   */
  MAIL_ENDPOINT?: string;
  /** 发件人，例如 `清吾 <noreply@qingwu.ink>`；域名需在 Resend 验证过 */
  MAIL_FROM?: string;
  /** 有人留言时通知谁（站长邮箱）。没配 = 不通知站长 */
  MAIL_TO?: string;
  /** GitHub 细粒度 PAT：只授权 qingwu-blog 仓库的 contents:write，后台提交 links.json 用 */
  GITHUB_TOKEN?: string;
  /** 形如 owner/repo，缺省 hjphh11/qingwu-blog */
  GITHUB_REPO?: string;

  /** /stats 响应里回显的数据来源（纯展示）。默认 cloudflare-d1 / hits */
  STATS_SOURCE_REPO?: string;
  STATS_SOURCE_PATH?: string;

  // ————————————————————————————————————————————————
  // AI（双通道：writer 写作 / judge 判断）
  //
  // 协议一律 OpenAI 兼容（POST {base}/chat/completions），所以 DeepSeek /
  // 通义 / 智谱 / Kimi 换哪家都只改环境变量。细节见 admin/ai.ts 顶部注释。
  //
  // **没配 key = 该通道关闭**，前端自动隐藏按钮，接口返回 503 ai_unconfigured。
  // ————————————————————————————————————————————————
  /** writer 通道密钥。缺省走 DeepSeek */
  AI_API_KEY?: string;
  /** 形如 `https://api.deepseek.com`（可带 /v1）。缺省同上 */
  AI_BASE_URL?: string;
  /** writer 模型名，缺省 deepseek-chat */
  AI_MODEL?: string;

  /** judge 通道密钥。**不配则回落 AI_API_KEY**（此时 judge 走 OpenAI 兼容的 JSON 模式） */
  AI_JUDGE_KEY?: string;
  /**
   * **仅 Jev 用**：决策模型地址，缺省 `https://api.typesafe.ai`。别填聊天模型的地址。
   *
   * ⚠️ `jevmodel.io` 是仿站：它的文档要求 `sk-` 前缀的 key，而 console.typesafe.ai
   * 发的是 `apikey_…`，打过去永远 401 Invalid API key（看起来像 key 坏了）。
   */
  AI_JUDGE_BASE_URL?: string;
  /** 模型名。缺省 `jev-latest`（Jev 分支）或 `AI_MODEL`（OpenAI 分支） */
  AI_JUDGE_MODEL?: string;

  /**
   * judge 走哪套协议：`openai`（默认）或 `jev`。
   *
   * Jev 是 TypeSafe AI 的**决策模型**，不是聊天模型 —— 它不生成文字，只回答
   * 你定义好的 typed questions，返回 label + confidence。协议也完全不同：
   * `POST https://api.typesafe.ai/v1/systemone`，体是 `{ model, state, questions }`，
   * 回 `{ answers }`。快（200~350ms 实测）且**输出不计费**，所以特别适合「每条评论都过一遍」。
   *
   * 配成 `jev` 时要求同时有 `AI_JUDGE_KEY`（console.typesafe.ai 领的 `apikey_…`），
   * 缺 key 会直接回落 openai 那条路，不会把判断功能整挂。
   */
  AI_JUDGE_PROVIDER?: string;

  /** 每通道每日调用上限，缺省 300。防手抖连点与 key 被盗刷 */
  AI_DAILY_LIMIT?: string;

  /**
   * 后台「以 AI 身份回复」时用的署名与头像。缺省「爱弥斯」+ 站内头像。
   *
   * 前台 `FriendsBoard` 判 AI 发言的规则是「署名等于爱弥斯」**或**「头像路径带
   * images/emis/avatar」—— 改名字要把三处一起改，否则前台不再挂 AI 小标。
   */
  AI_PERSONA_NAME?: string;
  AI_PERSONA_AVATAR?: string;

  /** 站点根地址，AI 回复署名的 author_url 用。缺省 https://www.qingwu.ink */
  SITE_URL?: string;

  // ——— 访客留言后小爱自动回复（见 admin/ai.ts 的 autoReplyTo）———
  /**
   * 总开关。`off` / `0` / `false` / `no` 任意一个即关闭，其余（含不填）都算开。
   *
   * 开着才叫「小爱在场」，关掉她就不自动说话，只剩后台手动起草。
   */
  AUTO_REPLY?: string;
  /** 每天最多自动回几条，缺省 20。防有人刷屏把额度烧光 */
  AUTO_REPLY_DAILY?: string;
  /** 同一访客（ip_hash）每天最多被自动回几次，缺省 1。0 = 不限 */
  AUTO_REPLY_PER_GUEST?: string;
}

/** `/hit` 请求体 —— **必须与旧 `src/pages/api/hit.ts` 一致**（前端只发这两个字段） */
export interface HitBody {
  path?: unknown;
  referrer?: unknown;
}

/** 各路由统一的处理结果 */
export interface Handler {
  (request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

/** D1 里一行每日汇总（hits 聚合出来的） */
export interface DayRow {
  day: string;
  pv: number;
  uv: number;
}
