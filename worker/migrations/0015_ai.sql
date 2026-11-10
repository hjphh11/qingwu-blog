-- 清吾 · AI 用量与配额（2026-11-10）
--
-- 只做两件事：① 每天每通道的调用次数（配额闸门，防手抖连点 / token 被刷）；
-- ② 累计 token，用于后台显示「今天用了多少」。
--
-- **不存提示词、不存生成结果**：留言正文已经在 comments 表里，
-- 把全文再抄一份进 AI 日志等于多一处会被导出/泄漏的副本。
--
-- 切天口径与 hits 一致：`dayKey()`，北京时间（见 src/util.ts）。

CREATE TABLE IF NOT EXISTS ai_usage (
  day        TEXT    NOT NULL,           -- YYYY-MM-DD（北京时间）
  channel    TEXT    NOT NULL,           -- 'writer' | 'judge'
  n          INTEGER NOT NULL DEFAULT 0, -- 调用次数
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel)
);
