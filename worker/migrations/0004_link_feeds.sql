-- 友链「最近更新」探测结果。
--
-- 一行一个主机名，由 cron 或机会式刷新写入。
-- last_updated 是从对方站 RSS / sitemap 里取到的**最大日期**（YYYY-MM-DD）；
-- ok=0 表示这一轮什么都没抓到（没有 feed、站点挂了、或者全是静态页），
-- 前端遇到 ok=0 就不显示，免得把「抓不到」当成「建于 1970 年」。
CREATE TABLE IF NOT EXISTS link_feeds (
  url          TEXT PRIMARY KEY,
  last_updated TEXT,
  source       TEXT,
  checked_at   INTEGER NOT NULL,
  ok           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_link_feeds_checked ON link_feeds(checked_at);
