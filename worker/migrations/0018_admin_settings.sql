-- 清吾 · 后台可调设置 + 友链发布记录
--
-- 为什么要有这张表：此前所有「运行参数」都来自环境变量（AUTO_REPLY_DAILY、
-- AI_MODEL…），改一个数就得登服务器改 .dev.vars / wrangler secret 再重启 Worker。
-- 后台既然叫「运行与设置」，这些就该在页面上改得动。
--
-- 优先级：**库里有的值覆盖环境变量，库里没有的才回落到 env / 代码默认**。
-- 这样老部署不跑迁移也不会坏（表不存在 = 全部走 env），新部署跑完就有了面板。

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  -- 统一按字符串存：布尔用 'on'/'off'，数字用十进制，列表用逗号分隔。
  -- 不做类型列 —— 只有一个读入口，类型在 settings.ts 里收口，多一列反而没人维护。
  value TEXT NOT NULL,
  ts INTEGER NOT NULL,
  by_name TEXT
);

-- 友链发布记录：每次真的写到仓库（或降级成「手动粘贴」）都留一条。
-- 之前提交完只有一句 toast，过两天想不起「我到底改过哪条」，只能翻 git log。
CREATE TABLE IF NOT EXISTS friend_publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  by_name TEXT,
  -- 成功时有值；manual / failed 为空
  commit_sha TEXT,
  message TEXT,
  -- [{ name, field, from, to }]，前端直接渲染成「字段：旧 → 新」
  changes TEXT NOT NULL DEFAULT '[]',
  -- ok（已提交）/ manual（没配 token，降级成人肉粘贴）/ failed（上游报错）
  status TEXT NOT NULL DEFAULT 'ok',
  detail TEXT,
  -- 仓库里 links.json 当时的 sha，出问题时能对上版本
  base_sha TEXT
);

CREATE INDEX IF NOT EXISTS idx_friend_publish_ts ON friend_publish_log(ts DESC);
