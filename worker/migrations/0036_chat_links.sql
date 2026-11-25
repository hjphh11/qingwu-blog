-- 长亭 · 链接预览
--
-- 两件事分开存，理由不同：
--   · `chat_messages.link_url` —— 这条消息里**第一个链接**是什么。发送时算好存下来，
--     不在读取时反复跑正则（poll 每 2.5 秒一次，每条消息都要解析一遍太浪费）。
--   · `chat_link_previews` —— 按 **URL** 缓存抓到的 OG 信息。同一条链接在一屏里出现五次，
--     只抓一次；退一步说，同一个人刷同一个链接也不该刷五次网络。
--
-- `ok = 0` 也要留一行：抓失败的站点（超时 / 403 / 不是 HTML）下次别再试，
-- 否则一条坏链在聊天记录里反复出现，每次首屏都要白等 4 秒超时。
-- 这条记录 24 小时后过期重试（`ts` 判断），因为站点可能只是当时挂了。

ALTER TABLE chat_messages ADD COLUMN link_url TEXT;

CREATE TABLE IF NOT EXISTS chat_link_previews (
  url         TEXT PRIMARY KEY,
  -- 1 = 抓到了可用的预览；0 = 试过了，什么都没有（别再试，等过期）
  ok          INTEGER NOT NULL DEFAULT 1,
  title       TEXT,
  description TEXT,
  -- 缩略图地址（已转成绝对路径；可能为空）
  image       TEXT,
  -- 站点名（og:site_name，缺省取域名）
  site        TEXT,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_links_ts ON chat_link_previews (ts DESC);
