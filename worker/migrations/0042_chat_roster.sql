-- 长亭 · 互联站点名册缓存（2026-11-28）
--
-- 侧栏「互联站点」原来是「从远端消息反推 + 抓对方首页 title」，问题是：
--   · 只显示"说过话的站"，安静几天就消失；
--   · 抓 title 慢，还得防 SSRF；
--   · 名字靠猜（chat.gbk.ink → Somoe Chat 之类要手工别名）。
--
-- 现在改成吃联邦名单 https://github.com/Jarvis0227/federated-chat 的 members.json：
-- 站名、图标、站点地址都是人家自己填的。这里只放一份缓存，避免每次 who 都去 GitHub。
--
-- 只有一行（id=1），整份 JSON 塞进 body：名册是「整体替换」语义，不需要按行改。
CREATE TABLE IF NOT EXISTS chat_roster (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  body       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);
