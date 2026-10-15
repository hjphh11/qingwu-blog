// 清吾 · Worker 环境与共享类型

/** 环境变量（wrangler.toml 的 [vars] + secret + D1 绑定） */
export interface Env {
  /** D1 数据库（wrangler.toml: [[d1_databases]] binding = "DB"） */
  DB: D1Database;

  /** 访客匿名化用的盐。**必填**：没配就只探测不采集（和旧代码缺 SALT 时的行为一致）。 */
  HIT_IP_SALT?: string;
  /** 后台读 /stats 的口令（Bearer）。建议配；不配时 /stats 只认 ADMIN_STATS_ENDPOINT 的空口令（等于公开，见 README） */
  ADMIN_STATS_TOKEN?: string;

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
