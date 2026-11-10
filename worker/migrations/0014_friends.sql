-- 后台 P2/P3：友链回链检查 + 展示状态
--
-- 为什么这两件事放 D1 而不是写进 links.json：
--   links.json 描述的是「这个友链是谁、长什么样、排第几」，属于**内容**，
--   必须留在仓库里（前台构建期静态导入，改完要重新构建才生效）。
--   而「他昨天把回链下了没有」「这个站失联还剩几天」是**随时间变化的观察值**，
--   一天一条地往仓库里提交毫无意义，也会把 git 历史弄脏。
--   所以：内容归仓库，状态归 D1。两边用 url 对齐（normalize 过，见 admin/friends.ts）。

-- ————————————— ① 回链检查结果 —————————————
-- 每个友链一行（url 作主键，只留最新一次结果），历史不保留 ——
-- 要的是「现在谁把我下了」，不是考古。
CREATE TABLE IF NOT EXISTS backlink_checks (
  url        TEXT PRIMARY KEY,
  name       TEXT,
  ok         INTEGER NOT NULL DEFAULT 0,   -- 1 = 在对方页面里找到了本站域名
  status     INTEGER,                      -- 最后一次抓取的 HTTP 状态码
  matched    TEXT,                         -- 找到回链的那个页面地址（可能在 /links 而不是首页）
  error      TEXT,                         -- 抓取失败原因（超时 / 证书 / 5xx）
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backlink_checked ON backlink_checks(checked_at DESC);

-- ————————————— ② 友链展示状态 —————————————
-- 借鉴朝朝听雨的三态设计，但**不存进 links.json**：
--   normal    正常
--   unstable  短暂失联，给 30 天缓冲（对方域名掉了、备案抽查、机房迁移都算）
--   violation 违规整改，7 天
-- 到期后前台不再展示（前台读 /link-status 接口，按 until 判断，过期即隐藏）。
CREATE TABLE IF NOT EXISTS friend_status (
  url        TEXT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'normal',
  note       TEXT,                          -- 给访客看的说明，比如「原站迁移中」
  until      INTEGER,                       -- 到期时间 ms；state=normal 时为 NULL
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_status_until ON friend_status(until);
