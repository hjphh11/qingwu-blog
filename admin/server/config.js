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
