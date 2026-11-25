-- 自动处置的流水
--
-- 两个用途合成一张表，因为它们问的是同一件事：「这件事是什么时候发生的」。
--   · auto_remove —— AI 判定了、自己把消息收起来了。事后要能查：
--     哪天收了谁的什么话，是不是误判（误判了站长会点恢复，那时也记一行）；
--   · review_mail —— 拿不准的时候给站长发了信。用它做限流：
--     半小时内最多一封，否则一个人刷十条举报就能把站长邮箱塞满。
--
-- 不拿 admin_settings 当计数器：那张表是「设置」，混进时间戳会让人以为是个开关。

CREATE TABLE IF NOT EXISTS chat_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 'auto_remove' | 'restore' | 'review_mail'
  kind        TEXT    NOT NULL,
  report_id   INTEGER,
  message_id  INTEGER,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_alerts_kind_ts ON chat_alerts (kind, ts DESC);
