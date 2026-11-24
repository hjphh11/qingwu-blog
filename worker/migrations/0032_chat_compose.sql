-- 长亭 · 补四项能力（2026-11-24）
--
-- ⚠️ 教训：这个文件的每一项都要和 docs §22.4 的清单对上。
--    之前 0027（chat_reactions）和 0030（image_id）都是「文档写了、SQL 漏了」，
--    漏掉不会报错，等第一次用到才炸。

-- ① 编辑已发：记下最后一次编辑时间。有值 = 显示「已编辑」
ALTER TABLE chat_messages ADD COLUMN edited_at INTEGER;

-- ② 举报：一个人对一条消息只能报一次（同一条被多报才算「多个来源」）
CREATE TABLE IF NOT EXISTS chat_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL,
  account_id  INTEGER NOT NULL,
  reason      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'open',
  ts          INTEGER NOT NULL,
  UNIQUE (message_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reports_open ON chat_reports (status, ts DESC);

-- ③ 置顶：一间房只有一个置顶位（主键钉死成 'main'）
CREATE TABLE IF NOT EXISTS chat_pins (
  room        TEXT    PRIMARY KEY,
  message_id  INTEGER NOT NULL,
  account_id  INTEGER NOT NULL,
  ts          INTEGER NOT NULL
);

-- ④ 任意文件：留原始文件名，下载时按它命名
ALTER TABLE chat_media ADD COLUMN filename TEXT;
