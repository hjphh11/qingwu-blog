-- 茶室互联 · 大厅发来的表情回应（2026-11-26）
--
-- 为什么不复用 `chat_reactions`：那张表的主键是 `(message_id, account_id, emoji)`，
-- 而大厅来的人没有我们的账号 id —— 全塞 `0` 会互相覆盖（甲点🔥也算乙点过）。
-- 单独一张表、用完整 Matrix 用户 ID 当身份，两边就互不干扰。
--
-- `emoji` 存的是 **Matrix 那边的原始 key**：可能是 Unicode（🔥），也可能是
-- 对方站的自定义 token（`:bb_doge:`）。读取时和本地的 key 合并计数；前端遇到
-- 不认识的 key 直接显示字符本身，不会出现破图。
CREATE TABLE IF NOT EXISTS chat_remote_reactions (
  message_id INTEGER NOT NULL,   -- 我们库里的消息 id（按 matrix_event_id 反查）
  sender     TEXT    NOT NULL,   -- 完整 Matrix 用户 ID
  emoji      TEXT    NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (message_id, sender, emoji)
);

CREATE INDEX IF NOT EXISTS idx_chat_remote_reacts_msg ON chat_remote_reactions(message_id);
