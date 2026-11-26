-- 互联站点的「名字」缓存
--
-- 侧栏「互联站点」只拿得到域名（`remote_site` 是出站方带过来的 URL），
-- 而人认的是「听雨茶室」「冷汐的杂货铺」这种名字。
-- 名字从对方首页的 <title> 抓一次就够，7 天过期 —— 站名改了能自己跟上，
-- 抓不到（403/超时/纯 JS 站）就留空，前端退回显示域名。

CREATE TABLE IF NOT EXISTS chat_peer_sites (
  host       TEXT PRIMARY KEY,   -- 归一化后的主机名（已剥 www./matrix.）
  name       TEXT,               -- 抓到的站名；空串表示「抓过但没抓到」
  fetched_at INTEGER NOT NULL
);
