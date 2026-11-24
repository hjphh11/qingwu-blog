-- 清吾 · 长亭：补建 chat_reactions（表情回应）
--
-- ⚠️ 0026 里**漏了这张表**：方案文档写了「一条消息 + 一个人 + 一个表情 = 一行」，
--    写 SQL 时却只落了消息 / 游标 / 在线 / 封禁 / 规则统计那一串。
--    0026 已经在远端执行过（d1_migrations 有记录），改它不会重跑 ——
--    只能增量补一张。教训：迁移文件写完要对一遍文档里的表清单。
--
-- 主键 (message_id, account_id, emoji) 同时承担两件事：
--   ① 同一个人对同一个表情只能有一行（toggle 的「取消」就是删这行）
--   ② 按 message_id 查天然走主键最左前缀，不必再建索引
CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  emoji      TEXT    NOT NULL,   -- 表情 key，如 'clap'（就是 :[key] 里那个 key）
  ts         INTEGER NOT NULL,
  PRIMARY KEY (message_id, account_id, emoji)
);
