-- 清吾 · 统一身份（登录 / 绑定 / 会话）
--
-- 设计见 docs/方案-统一身份-登录与绑定.md。一句话：
--   **邮箱是唯一锚点**，登录方式（邮箱验证码 / GitHub）只是挂在账号上的 identity，
--   留言通过 `comments.account_id` 归属。
--
-- 这套表同时服务前台留言板与 /admin：管理员只是 `accounts.role = 'admin'` 的那一行，
-- 不再有第二套会话表（旧的 admin_users / admin_sessions / admin_codes 在过渡期只读保留，
-- 见 admin/auth.ts 的双读逻辑）。
--
-- 应用：
--   wrangler d1 migrations apply qingwu --local   # 本机
--   wrangler d1 migrations apply qingwu --remote  # Cloudflare 那份（已归档只读，仅供回查）
-- ⚠️ 生产主库是香港机本地 SQLite，迁移由部署脚本在实体机上跑（见 NOTEBOOK）。
-- ALTER 重复执行会报 duplicate column，靠 migrations 的版本记录保证只跑一次，别手动重跑。

-- ————————————— ① 账号 —————————————
-- email 存 lower(trim(x))，UNIQUE 保证「一个邮箱一个人」。
-- email_hash 是 md5(lower(trim(email)))，与 src/lib/avatar.ts 同源：
--   前台靠它取 Gravatar/QQ 头像，迁移靠它把历史留言归并到账号。
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  email_hash    TEXT    NOT NULL,
  display_name  TEXT,
  site_url      TEXT,
  avatar_url    TEXT,
  role          TEXT    NOT NULL DEFAULT 'visitor',   -- visitor | admin
  pass_hash     TEXT,                                 -- 只有管理员有；访客恒 NULL
  salt          TEXT,
  iterations    INTEGER NOT NULL DEFAULT 150000,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER,
  status        TEXT    NOT NULL DEFAULT 'active'     -- active | muted | banned
);
CREATE INDEX IF NOT EXISTS idx_accounts_email_hash ON accounts(email_hash);

-- ————————————— ② 登录方式 —————————————
-- 一个账号可挂多条：email（自己就是锚点）+ github。
-- UNIQUE(provider, uid) 是绑定语义的地基 —— 一个 GitHub 只能属于一个账号。
CREATE TABLE IF NOT EXISTS account_identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL,
  provider     TEXT    NOT NULL,   -- email | github
  uid          TEXT    NOT NULL,   -- 邮箱地址 / GitHub 数字 id
  meta         TEXT,               -- JSON：login / avatar_url / html_url
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE(provider, uid)
);
CREATE INDEX IF NOT EXISTS idx_account_identities_acc ON account_identities(account_id);

-- ————————————— ③ 会话 —————————————
-- 只存 token 的 SHA-256：库被读走也拿不到能用的 cookie。
-- kind 用来区分「前台访客」与「后台管理员」—— 管理员会话才过得了 requireAdmin。
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id INTEGER NOT NULL,
  kind       TEXT    NOT NULL,     -- visitor | admin
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_hash    TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_acc ON auth_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp ON auth_sessions(expires_at);

-- ————————————— ④ 邮箱验证码 —————————————
-- 首次登录即注册：此刻账号可能还不存在，所以用 email 定位，account_id 可空。
-- 只存 sha256(code|salt)；6 位数字没有限流等于没有，tries + 冷却 + IP 限次都要有。
CREATE TABLE IF NOT EXISTS auth_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  account_id INTEGER,
  code_hash  TEXT    NOT NULL,     -- sha256(code|salt)
  salt       TEXT    NOT NULL DEFAULT '',  -- 每个码独立随机盐，库被读走也推不回 6 位数
  purpose    TEXT    NOT NULL,     -- login | bind | change_email
  ip_hash    TEXT,                 -- 发信来源（同 IP 每小时上限靠它）
  sent_at    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email, sent_at DESC);

-- ————————————— ⑤ 尝试记录（按 IP 限流） —————————————
CREATE TABLE IF NOT EXISTS auth_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  ok      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts(ip_hash, ts DESC);

-- ————————————— ⑥ 留言归属 —————————————
-- 可空：迁移之前的老留言、以及没有邮箱的匿名留言，account_id 为 NULL。
-- 那些留言仍然靠 delete_token 自删（一次性迁移刻意保留这个活口）。
ALTER TABLE comments ADD COLUMN account_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_comments_account ON comments(account_id);

-- 点赞：登录后按账号去重，未登录仍按 visitor（IP|UA 哈希）
ALTER TABLE friend_likes ADD COLUMN account_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_friend_likes_acc ON friend_likes(account_id);
