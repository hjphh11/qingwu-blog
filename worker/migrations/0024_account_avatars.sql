-- 0024 · 账号头像（上传的那张）
--
-- 为什么单独一张表，而不是往 accounts.avatar_url 里塞 data:base64：
--   留言列表会把账号头像快照进 comments.avatar。要是那里存的是十几 KB 的
--   data URL，300 条留言的列表响应就要几 MB —— 每写一条评论还复制一份。
-- 所以：图存这张表，accounts.avatar_url 只存一个短地址
--   /api/auth/avatar/<id>?v=<ts>
-- 那个 v 是缓存钥匙：换头像 → ts 变 → 地址变 → 浏览器才会来取新图。
--
-- data 存 base64 文本而不是 BLOB：体积差 33%（十几 KB 的图无所谓），
-- 换来的是任何 sqlite 客户端都能直接看、能 `readfile` 备份，不用管二进制绑定。
CREATE TABLE IF NOT EXISTS account_avatars (
  account_id INTEGER PRIMARY KEY,
  mime       TEXT    NOT NULL,
  data       TEXT    NOT NULL,   -- base64（**不含** data: 前缀）
  bytes      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
