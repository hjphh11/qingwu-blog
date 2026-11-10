-- 清吾 · 0021 去掉自动回复的两项限流
--
-- 背景（2026-11-10 晚，站长定）：
--   ① 「每天最多」去掉 —— 原话「这个不用限制」。小爱回多少条不再按天卡；
--   ② 「安静时段」去掉 —— 原话「这个也不要」。不再按时间闭嘴。
--
-- 影响面：设置页少两行、ai.ts 的 autoReplyTo 少两道闸。**没有表结构变更**。
--
-- 花费保护仍然在：ai.ts 的 quotaGate 按 `AI_DAILY_LIMIT`（默认 300 次/通道/天）
-- 卡上游调用。那是防 key 被刷的底线，与本节的运营口径无关，不要一起删。
--
-- 单访客额度（autoReply.perGuest）保留 —— 那是防同一个人反复触发，
-- 和「总量限制」不是一回事。

DELETE FROM admin_settings
 WHERE key IN ('autoReply.daily', 'autoReply.quietFrom', 'autoReply.quietTo');
