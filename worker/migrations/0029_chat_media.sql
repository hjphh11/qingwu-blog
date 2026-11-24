-- 清吾 · 长亭：图片 / 视频消息
--
-- 为什么存进 SQLite 而不是磁盘：
--   worker 跑在 workerd 里，**没有文件系统**。拿不到 `/data/qingwu/chat-img/`
--   这种目录（头像也是同样原因存库，见 0024）。R2 在本项目没启用。
--   所以只能把二进制放 BLOB 里。
--
-- ⚠️ 行大小：Cloudflare 真正的 D1 有「单行 1MB」的限制，但**本项目生产用的是
--    香港机上的本地 SQLite（miniflare 模拟）**，没有这条限制。
--    图片卡在 1MB 以内、视频卡在 5MB 以内 —— 将来真要迁回 CF D1，
--    视频那档必须降下来（或者在迁移前把老视频转存到对象存储）。
--
-- ⚠️ data 列**实际存的是 base64 文本**，不是 BLOB。
--    原本按 BLOB 写，实测在这套「miniflare D1 + 本地 SQLite」里 bind 一个 Uint8Array
--    会被序列化成 `137,80,78,71,...` 这种十进制串，读回来是一段垃圾字节。
--    TEXT 存 base64 两边行为一致，体积 +33% 换个可靠，值得。详见 media.ts 的注释。
--    （SQLite 是动态类型，声明成 BLOB 也能存 TEXT，所以不用另开迁移。）
--
-- 为什么消息表不直接放二进制：一条图片消息在 poll 里每 2.5 秒会被重发一次，
--    几十 KB 的 base64 塞进 JSON 里，等于让轮询流量翻十倍。
--    所以消息只存 media_id，图片走独立 URL（带一年缓存）。
CREATE TABLE IF NOT EXISTS chat_media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,          -- image | video
  mime       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL,          -- 解码后的字节数（不是 base64 长度）
  data       BLOB    NOT NULL,
  width      INTEGER,
  height     INTEGER,
  duration   INTEGER,                   -- 视频秒数（图片为 NULL）
  account_id INTEGER NOT NULL,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_media_acc ON chat_media(account_id, ts DESC);
