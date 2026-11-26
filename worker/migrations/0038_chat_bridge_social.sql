-- 茶室互联 · 社交信息的同步（2026-11-26）
--
-- 三件事各要一处落点：
--   1. 在线人数：大厅的成员数（joined_members）存进 chat_sync，who 接口带上它；
--   2. 已读同步：我们出站的消息在大厅被多少人读了（m.receipt），累到 remote_reads；
--   3. 头像与昵称：对方站的消息大多没带 `[ID:];[URL:]` 协议头，只能靠 Matrix 的
--      成员资料（m.room.member 的 displayname / avatar_url）补 —— 按 sender 缓存在这张表里，
--      免得每条消息都去打一次房间状态。

ALTER TABLE chat_sync ADD COLUMN remote_members INTEGER NOT NULL DEFAULT 0;

-- 出站消息在 Matrix 侧被读的人数（本地已读另算，两者相加才是前端看到的「已读 N」）
ALTER TABLE chat_messages ADD COLUMN remote_reads INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS chat_remote_profiles (
  sender     TEXT PRIMARY KEY,      -- 完整 Matrix 用户 ID（@lee:matrix.leenet.xyz）
  nick       TEXT,
  avatar     TEXT,                  -- 已转成可直连的 https 地址（mxc:// 由 worker 代理）
  mxc        TEXT,                  -- 原始 mxc:// 地址，换 token / 换端点时能重算
  fetched_at INTEGER NOT NULL
);
