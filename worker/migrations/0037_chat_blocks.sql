-- 长亭 · 屏蔽名单
--
-- 一条记录 = 「A 不想再看到 B 的消息」。
--   · 单向：B 那边完全不知道，B 仍能正常发言、也能看到 A；
--   · 只影响读取，不动消息本身 —— 消息一条都没删，取消屏蔽后立刻回来；
--   · 主键 (blocker_id, blocked_id) 让「重复屏蔽」变成幂等写入，
--     不用先查再插（那中间有一个并发窗口）。
CREATE TABLE IF NOT EXISTS chat_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- 反查「谁屏蔽了我」用不上（我们从不告诉被屏蔽的人），
-- 但按 blocked_id 清理（注销账号时）会用到，先建着。
CREATE INDEX IF NOT EXISTS idx_chat_blocks_blocked ON chat_blocks (blocked_id);
