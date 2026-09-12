// 登录相关接口
import { Router } from 'express';
import { config } from '../config.js';
import {
  COOKIE_NAME,
  checkPassword,
  clearLoginFailures,
  cookieOptions,
  createSession,
  loginRateLimited,
  recordLoginFailure,
  verifySession,
} from '../auth.js';

const router = Router();

/** 当前登录状态（前端启动时先问一次） */
router.get('/me', (req, res) => {
  res.json({
    authed: verifySession(req.cookies?.[COOKIE_NAME]),
    passwordConfigured: Boolean(config.passwordHash),
  });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const limited = loginRateLimited(ip);
  if (limited.limited) {
    return res.status(429).json({
      error: 'rate_limited',
      message: `密码试错太多次，请 ${Math.ceil(limited.retryAfterSec / 60)} 分钟后再来`,
      retryAfterSec: limited.retryAfterSec,
    });
  }

  const password = req.body?.password;
  let ok = false;
  try {
    ok = await checkPassword(password);
  } catch (err) {
    console.error('[admin] 密码校验失败:', err);
    return res.status(500).json({ error: 'internal', message: '服务器内部出错，请看后台日志' });
  }

  if (!ok) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: 'bad_password', message: '密码不对' });
  }

  clearLoginFailures(ip);
  res.cookie(COOKIE_NAME, createSession(), cookieOptions());
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const opts = cookieOptions();
  delete opts.maxAge;
  res.clearCookie(COOKIE_NAME, opts);
  res.json({ ok: true });
});

export default router;
