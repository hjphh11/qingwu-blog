-- 清吾 · 让留言人删掉自己的留言
--
-- 评论区没有登录，靠什么认出「这条是他发的」？
--   提交时服务端生成一个随机 token（32 位 hex）存进这一列，**只回给提交者**，
--   列表接口不返回。前端把它存 localStorage，删除时带上来比对。
--
-- 为什么不用邮箱/哈希：`email_hash` 是公开的（列表里就有，头像要用），
-- 拿它当凭据等于谁都能删。token 是唯一的私有凭证。
--
-- 换设备/清缓存就删不了了 —— 没有账号体系时的固有代价，能接受。
--
-- 应用：
--   wrangler d1 migrations apply qingwu --remote

ALTER TABLE comments ADD COLUMN delete_token TEXT;
