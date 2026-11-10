-- 小爱自动回复的流水账。
--
-- 三件事都靠它，所以单独一张表，而不是塞进 ai_usage：
--   1. **幂等**：comment_id 唯一。同一条留言只会被自动回一次，
--      哪怕两个请求同时触发（waitUntil 重试、用户狂点提交）也只会成功一次。
--   2. **限流**：按 day 数总量、按 day + guest_hash 数单个访客，
--      防止一个人刷出一屏自问自答，也防止 key 被刷爆。
--   3. **审计**：谁知道小爱回过谁、跳过谁、为什么跳过。
--      出了「她怎么理都不理我」这种疑问，看这张表就有答案。
--
-- action 取值：replied / skipped / blocked / failed
--   replied  —— 已发出回复
--   skipped  —— 本来能回，但被闸门挡了（daily_limit / per_guest / already_replied）
--   blocked  —— judge 判定不该回（spam / abuse / privacy）
--   failed   —— 生成或写入失败
CREATE TABLE IF NOT EXISTS auto_reply_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL UNIQUE,
  guest_hash  TEXT,
  day         TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  verdict     TEXT,
  note        TEXT,
  model       TEXT,
  tokens      INTEGER,
  ms          INTEGER,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_day   ON auto_reply_log (day, action);
CREATE INDEX IF NOT EXISTS idx_auto_reply_guest ON auto_reply_log (day, guest_hash, action);
