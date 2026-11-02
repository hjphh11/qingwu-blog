-- 友链点击统计。
--
-- 为什么按「域名 + 天」而不是一行一次：
--   友链一共十来个，点一次插一行的写法在个人站上纯属浪费 —— 按天聚合成一行，
--   查总数 SUM、查趋势按 day 分组，两种都能答。
--
-- url 这一列存的是**归一化之后的主机名**（去掉 www.、去协议、去路径），
-- 因为 http/https、尾斜杠、深链接在业务上是同一个站，存原 URL 会把一个站拆成好几条。
CREATE TABLE IF NOT EXISTS link_clicks (
  url    TEXT NOT NULL,
  day    TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (url, day)
);

CREATE INDEX IF NOT EXISTS idx_link_clicks_url ON link_clicks(url);
CREATE INDEX IF NOT EXISTS idx_link_clicks_day ON link_clicks(day);
