-- 发信待发队列 —— 发信失败不再「一行 warn 就没了」。
--
-- 背景：`mail.ts` 原来失败只写 console.warn，而那台机器的日志平时没人看。
-- 触发点只有「友链评论区有人留言 / 有人回复你」，一旦撞上 QQ 的频率限制或
-- 授权码失效，信就静默丢掉了 —— 而这恰恰是唯一必须送达的两类通知。
--
-- 设计取舍：
--   · payload 存整封信的 JSON（to/subject/text），补发时不用回表拼正文。
--   · 只存**没发出去的**信，发成就删行 —— 这张表的常态是空的。
--   · next_try_at 做退避（5min 起，翻倍，封顶 6h），tries 封顶 6 次，
--     created_at 超 24h 直接丢：一周前的「有人给你留言了」发出去只会莫名其妙。
--   · **表不存在也不影响主流程**：mail.ts 的入队/补发都包了 try/catch，
--     线上 CF 的 D1 没跑这条迁移时，行为退化成「只记日志」。
CREATE TABLE IF NOT EXISTS mail_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,             -- 首次入队时间（秒）
  next_try_at INTEGER NOT NULL,             -- 下次允许补发的时间（秒），带退避
  tries       INTEGER NOT NULL DEFAULT 0,   -- 已补发次数
  last_error  TEXT,                         -- 最后一次失败原因（只存码，不存地址）
  payload     TEXT NOT NULL                 -- JSON: { to, subject, text }
);

-- 补发只按「到期时间」扫，索引就建在这
CREATE INDEX IF NOT EXISTS idx_mail_outbox_next ON mail_outbox(next_try_at);
