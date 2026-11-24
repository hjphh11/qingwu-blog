-- 清吾 · 长亭：「正在输入」状态
--
-- 直接加在 chat_presence 上，不另开表：
--   · 它和「在线」是同一件事的两个刻度（一个 5 分钟窗口，一个 6 秒窗口）
--   · 已经在 JOIN accounts 了，多一列零成本
--
-- 语义：typing_at 是「最后一次报告正在打字」的时间（毫秒）。
-- 前端每 3 秒最多报一次，后端用 6 秒窗口判定「还在打」——
-- 留一倍余量，免得网络抖一下字就消失了。
ALTER TABLE chat_presence ADD COLUMN typing_at INTEGER;
