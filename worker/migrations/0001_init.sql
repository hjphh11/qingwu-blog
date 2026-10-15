-- 清吾 · D1 建表（第 1 步：访问统计）
--
-- 对应 docs/后台迁移-Cloudflare方案.md §2 的数据模型。
-- 本文件里的表**一次性全建好**（后面几步不用再改 schema），但**只有 hits / daily_stats
-- 在第 1 步会被写入**；applications / comments / likes / audit 属于第 2~5 步，先空着。
--
-- 应用方式：
--   本地：wrangler d1 migrations apply qingwu --local
--   线上：wrangler d1 migrations apply qingwu --remote
-- 可重复执行：都带 IF NOT EXISTS。

-- ————————————— ① 访问统计：一条记录 = 一次访问 —————————————
-- 口径与旧的 src/lib/stats.ts 完全对齐：
--   · day  = 按 **Asia/Shanghai（北京时间）** 切天（旧代码 dayKey() 就是 +8 小时）
--   · path = 规范化后的站内路径（normPath，异常/超长一律 /(other)）
--   · referrer = 只留主机名（refHost，空 = (direct)）
--   · country  = request.cf.country（拿不到就是 XX）
--   · device   = UA 粗分 desktop / mobile / tablet
--   · visitor  = HMAC-SHA256(IP|UA, 盐) 的前 12 位，**绝不存明文 IP**
CREATE TABLE IF NOT EXISTS hits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,          -- unix 秒
  day        TEXT    NOT NULL,          -- 'YYYY-MM-DD'（按 Asia/Shanghai 切天）
  path       TEXT    NOT NULL,
  referrer   TEXT,
  country    TEXT,                      -- 来自 request.cf.country
  device     TEXT,                      -- 由 UA 粗分 desktop/mobile/tablet
  visitor    TEXT                       -- 匿名访客标识（IP+UA 哈希后截断，不存明文 IP）
);
CREATE INDEX IF NOT EXISTS idx_hits_day     ON hits(day);
CREATE INDEX IF NOT EXISTS idx_hits_path    ON hits(path, day);
-- 去重（同一访客同一页 30 分钟内只计一次）和 UV（按天去重访客）都靠这个索引
CREATE INDEX IF NOT EXISTS idx_hits_visitor ON hits(visitor, path, ts);

-- ————————————— ①b 历史汇总（迁移旧 stats.json 用）—————————————
-- 旧 stats.json 只有「每日 PV/UV + 各维度累计」，没有逐条访问记录。
-- 硬造 hits 行等于**编造**访客标识与路径分布（数字会假），所以历史数据单独放这张
-- 只读的汇总表：按天保留 PV/UV，各维度累计存成 JSON。
-- /stats 会把 hits（新）与 daily_stats（旧）**相加**，旧表的日期永远早于旧数据截止日，
-- 因此不会和新数据重复计数（详见 migrations/README 与 worker/README.md）。
CREATE TABLE IF NOT EXISTS daily_stats (
  day        TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'（Asia/Shanghai）
  pv         INTEGER NOT NULL DEFAULT 0,
  uv         INTEGER NOT NULL DEFAULT 0,
  pages      TEXT,                      -- JSON: [{"p":"/","pv":123}, ...]
  referrers  TEXT,                      -- JSON: [{"r":"google.com","pv":10}, ...]
  countries  TEXT,                      -- JSON: [{"c":"CN","pv":100}, ...]
  devices    TEXT,                      -- JSON: [{"v":"desktop","pv":80}, ...]
  source     TEXT,                      -- 数据来源标记，例如 'stats.json@2026-10-13'
  imported_at INTEGER
);

-- ============================================================================
-- 以下属于后续步骤（第 1 步不写、代码里也没有对应路由）。建好是为了省得到时候再迁移 schema。
-- ============================================================================

-- ————————————— ② 友链申请（第 2 步）—————————————
CREATE TABLE IF NOT EXISTS applications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  avatar     TEXT,
  intro      TEXT,
  email      TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reason     TEXT,                              -- 拒绝理由
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  UNIQUE(url)
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, created_at DESC);

-- ————————————— ③ 评论（第 5 步）—————————————
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_slug  TEXT NOT NULL,
  parent_id  INTEGER,                   -- 楼中楼
  author     TEXT NOT NULL,
  email_hash TEXT,                      -- 只存哈希，用于 Gravatar 与去重
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'visible',  -- visible | pending | spam | deleted
  ts         INTEGER NOT NULL,
  ip_hash    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmt_post ON comments(post_slug, ts DESC);

-- ————————————— ④ 点赞（第 5 步）—————————————
CREATE TABLE IF NOT EXISTS likes (
  post_slug  TEXT NOT NULL,
  visitor    TEXT NOT NULL,             -- 匿名访客标识
  ts         INTEGER NOT NULL,
  PRIMARY KEY (post_slug, visitor)      -- 同一访客对同一篇只算一次
);

-- ————————————— ⑤ 后台操作审计（第 3 步起）—————————————
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  actor  TEXT,                          -- Access 身份
  action TEXT NOT NULL,                 -- publish | rollback | approve | edit ...
  target TEXT,
  detail TEXT                           -- JSON
);
