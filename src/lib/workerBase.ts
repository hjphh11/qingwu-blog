/**
 * Worker 的地址（全站唯一一处）。
 *
 * 线上构建把 `PUBLIC_HIT_WORKER_URL` 覆写成 `/api`，走 nginx 的 `location /api/` 同源转发。
 * **dev 恒走 `/api`** —— `astro.config.mjs` 里有一条代理转到 127.0.0.1:8799，
 * 这样本地和线上一个形状：会话 cookie 是 HttpOnly + SameSite=Lax，跨源就带不上，
 * 「本地能登录线上不能」这种最难查的 bug 就不会出现。
 *
 * `.env` 里那条 `PUBLIC_HIT_WORKER_URL=https://api.qingwu.ink` 是历史遗留，
 * dev 下不读它（本地没有那个接口）。
 *
 * ⚠️ 别用 `PUBLIC_HIT_WORKER_URL=/api npx astro dev` 传值：Git Bash 的 MSYS 会把 `/api`
 * 当成路径转成 `D:/…/PortableGit/api`，请求会飞到 `file://` 去。
 * 本地想连别的 Worker，改 `astro.config.mjs` 的 `QINGWU_WORKER_DEV`（代理目标）。
 *
 * 注意：内联 `<script>` 里没法 import 这个模块（那是另一个构建上下文），
 * 那两处（`links/index.astro` 的友链统计）照抄同一个三元表达式。
 */
export const WORKER_BASE = (
  import.meta.env.DEV
    ? '/api'
    : import.meta.env.PUBLIC_HIT_WORKER_URL || 'https://api.qingwu.ink'
).replace(/\/$/, '');
