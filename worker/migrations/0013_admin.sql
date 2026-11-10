-- 后台管理（2026-11-10）
--
-- 设计与取舍见 docs/方案-后台-admin.md 第五节。
-- 一句话：两级登录（密码 → 邮箱验证码）+ 30 天会话，全部存 D1。
--
-- ⚠️ 不改 comments 表：后台直接读写信里那张表（post_slug / status / parent_id 都是现成的），
--    所以「后台回复」= 往 comments 插一条 parent_id 指向被回复的留言，和前台楼中楼同构。

-- ————————————— ① 管理员 —————————————
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL,             -- 验证码发这里；只在后台露前 3 位 + 域名
  pass_hash     TEXT    NOT NULL,             -- PBKDF2-SHA256 的 hex
  salt          TEXT    NOT NULL,             -- 每条独立随机盐
  iterations    INTEGER NOT NULL DEFAULT 150000,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- ————————————— ② 会话 —————————————
-- 只存 token 的 SHA-256：库被读走也拿不到能用的 cookie。
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_hash    TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_exp ON admin_sessions(expires_at);

-- ————————————— ③ 邮箱验证码 —————————————
-- 同样只存哈希。used=1 之后不能再验；tries 用来封死暴力猜 6 位数。
CREATE TABLE IF NOT EXISTS admin_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  code_hash  TEXT    NOT NULL,
  sent_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_codes_user ON admin_codes(user_id, sent_at DESC);

-- ————————————— ④ 登录尝试（限流） —————————————
-- 只记 ip 哈希和成败，15 分钟窗口内失败 15 次就锁。
CREATE TABLE IF NOT EXISTS admin_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  ok      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_attempts ON admin_attempts(ip_hash, ts DESC);
