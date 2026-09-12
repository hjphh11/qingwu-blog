// 后台服务端入口。
//
// 阶段 E 起后台**能写文件**了（文章管理），阶段 F 又加了分类管理；
// 写范围仍受 articles.js / categories.js 里的白名单限制。
// 只监听 127.0.0.1；对外访问由 `tailscale serve` 转发（不开任何公网端口）。
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from './config.js';
import articlesRoutes from './routes/articles.js';
import authRoutes from './routes/auth.js';
import categoriesRoutes from './routes/categories.js';
import dataRoutes from './routes/data.js';

assertConfig();

const app = express();
app.disable('x-powered-by');

// 只在本地/私网内跑，body 不必很大（Markdown 正文留足余量）
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// 顺手加几个安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// 状态变更请求要求同源。
// cookie 是 SameSite=Lax，本来就能挡住跨站 POST；这里再加一道 Origin 校验，
// 免得以后有人改了 cookie 设置就把写接口暴露出去。
// （不带 Origin 的请求放行 —— 那是 curl/脚本，它们本来也得先登录拿到 cookie。）
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {
    /* Origin 不合法，落到下面拒绝 */
  }
  res.status(403).json({ error: 'bad_origin', message: '跨站请求被拒绝' });
});

// 健康检查（不需要登录；用来确认服务活着）
app.get('/api/health', (req, res) => {
  res.json({ ok: true, repoPath: config.repoPath, prod: config.isProd });
});

app.use('/api/auth', authRoutes);
app.use('/api', articlesRoutes);
app.use('/api', categoriesRoutes);
app.use('/api', dataRoutes);

// 单端口模式：如果前端已经构建过（web/dist 存在），就一并托管
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

// 统一错误处理：5xx 才打堆栈（4xx 是客户端问题，回一句人话就够了）
app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[admin] 请求出错:', err);
  res.status(status).json({
    error: err.code ?? 'internal',
    message: err.expose ? err.message : '服务器内部出错，请看后台日志',
  });
});

app.listen(config.port, config.host, () => {
  console.log(`[admin] 已启动: http://${config.host}:${config.port}`);
  console.log(`[admin] 博客仓库: ${config.repoPath}`);
  console.log(`[admin] 模式: ${config.isProd ? 'production' : 'development'}`);
  if (!fs.existsSync(config.webDist)) {
    console.log('[admin] 前端未构建（web/dist 不存在）—— 开发时请用 `npm run dev`');
  }
});
