-- 第 2 步（友链申请搬 D1）需要的补充列。
--
-- ⚠️ 不要改 0001_init.sql —— 它已经在远端 D1 执行过（`d1_migrations` 里有记录），
-- 改它不会重跑，只会让「新建库」和「已有库」的 schema 分叉。增量迁移才是对的做法。
--
-- ip_key：访客 IP 的 HMAC 短标识（不存明文），只用于两条查询：
--   ① 频率限制：同一 ip_key 在 10 分钟内最多提交 RATE_MAX 次；
--   ② 排障：看某次提交是不是同一来源。
-- 用与统计相同的盐（HIT_IP_SALT），换盐即全部失效。

ALTER TABLE applications ADD COLUMN ip_key TEXT;

-- legacy_id：从旧私有仓库 applications.json 导入时保留的原始 id（形如 app-mvw5c5ce-a4llo）。
-- 用途：① 导入脚本按它判重，可重跑；② 后台操作日志里记的还是旧 id，靠它把两边对上。
-- 新提交的申请这一列是 NULL。
ALTER TABLE applications ADD COLUMN legacy_id TEXT;

-- 频率限制按 (ip_key, created_at) 计数，走这个索引
CREATE INDEX IF NOT EXISTS idx_app_ip ON applications(ip_key, created_at DESC);

-- 去重要按 url / email 小写比较；UNIQUE(url) 是大小写敏感的，这里补一个规范化查询用的索引
CREATE INDEX IF NOT EXISTS idx_app_email ON applications(email);

-- 导入判重与追溯用
CREATE INDEX IF NOT EXISTS idx_app_legacy ON applications(legacy_id);
