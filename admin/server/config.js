// 后台配置：全部来自环境变量。
// 本地跑：admin/.env（已被 gitignore）
// 服务器上：/opt/qingwu/.env（权限 600，绝不进仓库）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, '..');

const env = (key, fallback = '') => process.env[key] ?? fallback;

const isProd = env('NODE_ENV') === 'production';
const cookieSecureEnv = env('ADMIN_COOKIE_SECURE', '').trim();

export const config = {
  adminRoot,
  /** 后台程序目录（web/dist 相对它定位） */
  webDist: path.join(adminRoot, 'web', 'dist'),

  /** 博客仓库路径：后台只读写这个目录下的**白名单**内容文件 */
  repoPath: path.resolve(env('ADMIN_REPO_PATH', path.resolve(adminRoot, '..'))),

  /**
   * 回收站目录（软删除的内容存在这里，可恢复）。
   * 默认放仓库里的 `.admin-trash/`（已加进 .gitignore，**不会进公开仓库**）。
   * 删除的文章可能从没提交过，放进公开仓库等于泄露，所以必须忽略。
   */
  trashPath: path.resolve(
    env('ADMIN_TRASH_PATH', path.join(env('ADMIN_REPO_PATH', path.resolve(adminRoot, '..')), '.admin-trash')),
  ),

  /** 只监听本地；对外由 tailscale serve 转发（不开公网端口） */
  host: env('ADMIN_HOST', '127.0.0.1'),
  port: Number(env('ADMIN_PORT', '3000')),

  /** 单用户密码：argon2 哈希。**只接受哈希，不存明文** */
  passwordHash: env('ADMIN_PASSWORD_HASH'),
  /** 会话 cookie 的签名密钥 */
  sessionSecret: env('ADMIN_SESSION_SECRET'),
  /** 会话有效期（天） */
  sessionDays: Number(env('ADMIN_SESSION_DAYS', '7')),

  /**
   * 发布用的 GitHub PAT（细粒度、`Contents: Read and write`）。
   * 只在推送时注入子进程环境 —— **不落盘、不进命令行参数**（见 publish.js 的凭据助手）。
   * 没配它就只能「保存」不能「发布」。
   */
  gitToken: env('ADMIN_GIT_TOKEN'),

  /**
   * Vercel Deploy Hook URL（选填）。配了就在推送后**立刻**触发站点重建；
   * 不配也能用 —— Vercel 自己会检测到 push 然后重建，只是慢一点。
   */
  deployHook: env('ADMIN_DEPLOY_HOOK'),

  /** 操作日志（第 43 条）放仓库里的 `.admin-logs/`，已 gitignore；只在服务器上有意义 */
  logPath: path.resolve(
    env(
      'ADMIN_LOG_PATH',
      path.join(env('ADMIN_REPO_PATH', path.resolve(adminRoot, '..')), '.admin-logs'),
    ),
  ),

  /**
   * 友链申请审批（阶段 J / 方案 §4.5 + 第 35/36/49 条）。
   *
   * **第 2 步迁移后数据在 Cloudflare D1**（Worker 的 `applications` 表），
   * 后台走 Worker 的 HTTP 接口读写：`GET /apply` 列表、`PATCH /apply/:id` 改状态。
   * 原来那套「GitHub Contents API 读写私有仓库 applications.json」已经整条删除 ——
   * 拿 git 当数据库用没法索引、没法 UNIQUE 去重、并发还得重试。
   *
   * `ADMIN_APPLY_TOKEN` 现在存的是**与 Worker 上 `ADMIN_APPLY_TOKEN` secret 同值**的口令，
   * 不再是 GitHub PAT。它和 `ADMIN_STATS_TOKEN` 刻意分开：统计口令泄漏只暴露访问量，
   * 这个泄漏会暴露访客邮箱。
   *
   * 没配 token 时审批页只显示「没配」的说明，不影响其它功能。
   */
  applyApiToken: env('ADMIN_APPLY_TOKEN'),
  /** Worker 的 API 根地址（`/apply` 会拼在它后面） */
  applyApiBase: env('ADMIN_APPLY_API_BASE', env('ADMIN_STATS_ENDPOINT', '').replace(/\/stats\/?$/, '') || 'https://api.qingwu.ink'),
  /** 调友链接口的超时（毫秒）。跨境，别设太短 */
  applyTimeoutMs: Number(env('ADMIN_APPLY_TIMEOUT_MS', '15000')),
  /** 审批列表的服务端缓存（毫秒）。单用户后台，翻页来回切没必要每次都打跨境请求 */
  applyCacheMs: Number(env('ADMIN_APPLY_CACHE_MS', '45000')),

  /**
   * 访问统计：唯一线上来源是 Cloudflare Worker 的 `/stats`（数据在 D1）。
   * 原来还有一条「GitHub Action 每 6 小时汇总 → 私有仓库 stats.json → 后台读文件」的旧路，
   * 2026-10-31 已随旧链路一起删除（stats.json 自 10-18 起就没再更新过）。
   * 因此这里不再有 `statsPath` —— `ADMIN_APPLY_TOKEN` 只留给好友链申请用。
   */
  statsCacheMs: Number(env('ADMIN_STATS_CACHE_MS', '300000')),
  /**
   * 统计接口地址（线上必填）：例如 `https://api.qingwu.ink/stats`。
   * 详见 `admin/server/stats.js` 里的两档优先级（mock > endpoint）。
   */
  statsEndpoint: env('ADMIN_STATS_ENDPOINT', ''),
  /** 调统计接口用的口令，对应 Worker 的 `ADMIN_STATS_TOKEN` secret（`Authorization: Bearer`）*/
  statsToken: env('ADMIN_STATS_TOKEN', ''),
  /** 统计接口超时（毫秒）。Worker 在境外，中国大陆访问偶尔会慢，给宽一点 */
  statsTimeoutMs: Number(env('ADMIN_STATS_TIMEOUT_MS', '15000')),
  /** 本地开发预览用：设了这个路径就直接读本地 mock，不走 GitHub（见 scripts/fixtures/stats.mock.json）*/
  statsMockFile: env('ADMIN_STATS_MOCK_FILE', ''),

  isProd,

  /**
   * 会话 cookie 是否带 `Secure` 标志。默认与 isProd 一致（生产就带）。
   *
   * ⚠️ 本项目的服务器**签不下 HTTPS 证书**（它访问不了 Cloudflare，而 Tailscale
   * 的自动证书只能找 Let's Encrypt），对外走的是 `tailscale serve --http`。
   * 浏览器在 http 下**不会保存 `Secure` cookie**，登录会失效 ——
   * 所以这种部署把 `ADMIN_COOKIE_SECURE=0` 写进 .env。
   * 流量依然由 WireGuard 端到端加密、且只有 tailnet 内可达，因此可以接受。
   *
   * 将来若换成真正的 HTTPS 访问，**必须删掉这一项**（或设为 1）恢复 Secure。
   */
  cookieSecure: cookieSecureEnv === '' ? isProd : cookieSecureEnv !== '0',
};

/** 启动前自检：缺关键配置就直接拒绝启动，别带着半残配置跑 */
export function assertConfig() {
  const missing = [];
  if (!config.passwordHash) missing.push('ADMIN_PASSWORD_HASH');
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    missing.push('ADMIN_SESSION_SECRET（至少 16 位随机字符）');
  }
  if (missing.length > 0) {
    throw new Error(
      `后台缺少必需的环境变量：${missing.join('、')}\n` +
        `本地请复制 admin/.env.example 为 admin/.env 并填写；\n` +
        `生成密码哈希：cd admin && npm run hash-password -- 你的密码`,
    );
  }
}
