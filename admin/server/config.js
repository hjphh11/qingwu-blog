// 后台配置：全部来自环境变量。
// 本地跑：admin/.env（已被 gitignore）
// 服务器上：/opt/qingwu/.env（权限 600，绝不进仓库）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, '..');

const env = (key, fallback = '') => process.env[key] ?? fallback;

export const config = {
  adminRoot,
  /** 后台程序目录（web/dist 相对它定位） */
  webDist: path.join(adminRoot, 'web', 'dist'),

  /** 博客仓库路径：后台只读写这个目录下的**白名单**内容文件 */
  repoPath: path.resolve(env('ADMIN_REPO_PATH', path.resolve(adminRoot, '..'))),

  /** 只监听本地；对外由 tailscale serve 转发（不开公网端口） */
  host: env('ADMIN_HOST', '127.0.0.1'),
  port: Number(env('ADMIN_PORT', '3000')),

  /** 单用户密码：argon2 哈希。**只接受哈希，不存明文** */
  passwordHash: env('ADMIN_PASSWORD_HASH'),
  /** 会话 cookie 的签名密钥 */
  sessionSecret: env('ADMIN_SESSION_SECRET'),
  /** 会话有效期（天） */
  sessionDays: Number(env('ADMIN_SESSION_DAYS', '7')),

  isProd: env('NODE_ENV') === 'production',
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
