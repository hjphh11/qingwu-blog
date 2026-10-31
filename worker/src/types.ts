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

  /** 允许跨源调用 /hit 的站点，逗号分隔；`*` = 不限制 */
  ALLOWED_ORIGINS?: string;
  /** /stats 响应里回显的数据来源（纯展示）。默认 cloudflare-d1 / hits */
  STATS_SOURCE_REPO?: string;
  STATS_SOURCE_PATH?: string;
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
