-- 友链各站的最新文章 —— 「友文」页面的数据源。
--
-- 为什么单独一张表而不是塞进 link_feeds：一个站有多篇文章，是一对多。
-- link_feeds 那行存的是「这个站最近一次更新是哪天」，这里存的是「具体哪几篇」。
--
-- 抓取和 link_feeds 同一趟（同一次 fetch 里顺手解析），不额外增加出站请求。
-- 每个站只留 feed 里最新的几条（见 links-refresh.ts 的 ITEMS_PER_SITE）。
CREATE TABLE IF NOT EXISTS link_posts (
  -- 文章链接当主键：同一条文章不管抓几次都只有一行
  url        TEXT PRIMARY KEY,
  host       TEXT NOT NULL,          -- 归一化后的站名（去 www），前端靠它对上友链卡片
  title      TEXT NOT NULL,
  published  TEXT,                   -- 'YYYY-MM-DD'，解析不出来就 NULL（列表里排最后）
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_posts_pub  ON link_posts(published DESC);
CREATE INDEX IF NOT EXISTS idx_link_posts_host ON link_posts(host);
