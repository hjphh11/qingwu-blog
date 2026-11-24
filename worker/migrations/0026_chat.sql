-- 清吾 · 长亭（聊天室）
--
-- 设计见 docs/方案-聊天室.md / docs/审核清单-聊天室.md。
-- 一句话：**本地 SQLite 是唯一事实来源**，Matrix 只是「另一个出口」（v2 才接）。
--
-- 和评论（comments 表）刻意分开，不共表：
--   · 评论是「楼」（parent_id 两层 + 点赞 + 待审收录），聊天是「流」（游标增量 + 在线 + 撤回）
--   · 评论按 post_slug 分区，聊天单一大厅
--   · 共用一张表的话，每次查聊天都要 `WHERE post_slug = 'chat'`，索引和语义两头不讨好
--
-- 应用：
--   wrangler d1 migrations apply qingwu --local
-- ⚠️ 生产主库是香港机本地 SQLite，迁移由部署脚本在实体机上跑（见 NOTEBOOK）。

-- ————————————— ① 消息 —————————————
-- 单一大厅，不设房间。status 五态：
--   visible  正常
--   pending  被审核清单 hold，**只有发送者自己看得见**（AI 判完转 visible 或 spam）
--   spam     判定违规，前台不展示（后台能复核）
--   recalled 自己撤回，留一行「某某撤回了一条消息」
--   deleted  站长删的，整条不渲染
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER,                            -- 本地消息才有；远程（v2）为 NULL
  body          TEXT    NOT NULL,                   -- 原文（Markdown 子集 + 表情 token）
  kind          TEXT    NOT NULL DEFAULT 'text',    -- text | image（v3）
  reply_to_id   INTEGER,                            -- 引用回复（单层，不嵌套）
  mentions      TEXT,                               -- JSON 数组：[3,7] = 本地账号 id
  status        TEXT    NOT NULL DEFAULT 'visible',
  ts            INTEGER NOT NULL,
  -- 状态最后变更时间。poll 靠它补发「pending 转 visible」的消息 ——
  -- 光靠 id > 游标会永久错过（id 早涨过去了），这是方案里点明的坑 #4。
  updated_at    INTEGER NOT NULL DEFAULT 0,
  ip_hash       TEXT,
  -- v2 互联用；本地消息这几列恒为 NULL
  origin        TEXT    NOT NULL DEFAULT 'local',   -- local | remote
  remote_sender TEXT,                               -- 完整 Matrix 用户 ID
  remote_nick   TEXT,
  remote_avatar TEXT,
  remote_site   TEXT,                               -- 「冷汐的杂货铺」，前端挂「来自 XX」
  matrix_event_id TEXT,
  matrix_txn_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_id ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_acc ON chat_messages(account_id, ts DESC);
-- 增量拉取的另一个方向：pending 转 visible 之后要能被别人补拉到（见 docs 的坑 #4）
CREATE INDEX IF NOT EXISTS idx_chat_status ON chat_messages(status, ts DESC);
-- 重连补拉时挡重复导入。NULL 不参与唯一约束，所以本地消息不受影响
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_evt
  ON chat_messages(matrix_event_id) WHERE matrix_event_id IS NOT NULL;

-- ————————————— ② 阅读游标 —————————————
-- 跟着账号走：换设备接着读（和草稿不同，草稿只留在本机 localStorage）
CREATE TABLE IF NOT EXISTS chat_reads (
  account_id   INTEGER PRIMARY KEY,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- ————————————— ③ 在线状态 —————————————
-- poll 顺手写（节流：>20 秒才写一次，否则 2.5 秒一轮会把库写热）
CREATE TABLE IF NOT EXISTS chat_presence (
  account_id INTEGER PRIMARY KEY,
  last_seen  INTEGER NOT NULL
);

-- ————————————— ④ 封禁 —————————————
-- 账号和 IP 都能封；until 为 NULL = 永久。
-- 注意：频率熔断也写这张表（5 分钟临时禁言），所以它不只是「站长封人」。
CREATE TABLE IF NOT EXISTS chat_bans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  ip_hash    TEXT,
  until      INTEGER,
  reason     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_bans_acc ON chat_bans(account_id, until);

-- ————————————— ⑤ 审核规则命中统计 —————————————
-- 没有这张表，清单就只是一份「当初觉得有道理」的静态文件：
-- 半年后没人知道哪条规则在起作用、哪条在误伤，也就没人敢动它。
CREATE TABLE IF NOT EXISTS chat_rule_stats (
  rule_id    TEXT PRIMARY KEY,        -- 'L0-4'
  hits       INTEGER NOT NULL DEFAULT 0,
  hurt       INTEGER NOT NULL DEFAULT 0,   -- 站长在后台点「这条没问题」的次数
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- 以下属于 v2（互联）。现在建好是为了省得到时候再迁移 schema —— 代码里还没有写入。
-- ============================================================================

-- ————————————— ⑥ 出站队列 —————————————
-- 本地原创消息先落这里，桥接按 FIFO 发。txn_id 是幂等键，重试必须沿用同一个，
-- 否则「发送超时但对方已收到」的情况下会重复发一条。
CREATE TABLE IF NOT EXISTS chat_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  op         TEXT    NOT NULL DEFAULT 'send',     -- send | redact
  txn_id     TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'queued',   -- queued | sending | done | failed
  tries      INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_outbox_due ON chat_outbox(status, next_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_outbox_txn ON chat_outbox(txn_id);

-- ————————————— ⑦ 入站游标 —————————————
-- 单行表（id 恒为 1）。lock_until 防并发同步。
-- ⚠️ since 只能在**入库成功之后**推进，先推游标会永久丢消息。
CREATE TABLE IF NOT EXISTS chat_sync (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  room_id    TEXT,
  since      TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ————————————— ⑧ 已收红删 —————————————
-- 这张表看着多余，其实是文档里特意点出的坑：
-- 先收到撤回、后收到原文（断线重连补拉）时，没有它消息就会复活。
CREATE TABLE IF NOT EXISTS chat_redactions (
  event_id TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL
);

-- ————————————— ⑨ 桥接日志 —————————————
-- 排障用，只留 7 天（清理在桥接脚本里做）。
CREATE TABLE IF NOT EXISTS chat_bridge_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,
  level TEXT,
  msg   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_bridge_ts ON chat_bridge_log(ts DESC);
