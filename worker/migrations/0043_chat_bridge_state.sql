-- 长亭 · 互联暂停开关（2026-11-28）
--
-- 互联要求里有一条硬性的：「提供临时断联接口，维护者可先暂停、确认后再恢复，
-- 暂停期间产生的消息不得在恢复后自动补发」。
--
-- 这里只存一个开关（单行）。暂停的语义是**双向**：
--   · 出站：queueBridge 不再入队，flushBridge 直接返回；
--   · 入站：pullBridge 仍然推进 /sync 游标，但**丢弃**这段时间的事件
--     —— 不推进游标就会在恢复后一次性补进来，那正是要求里禁止的「补发」。
-- 进暂停时还会把队列里没发出去的 `queued` 行删掉，避免恢复后涌出一批旧话。
CREATE TABLE IF NOT EXISTS chat_bridge_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  paused    INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER,
  paused_by TEXT,
  reason    TEXT
);
