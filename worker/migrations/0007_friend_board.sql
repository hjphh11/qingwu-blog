-- 清吾 · 友链评论区（留言 / 回复 / 点赞）
--
-- 复用 0001 里已经建好的 `comments` 表（按 post_slug 分区），友链评论区就是
-- post_slug = 'friends' 这一片；楼中楼用已有的 parent_id。
--
-- 为什么要加列：0001 那版是给「文章评论」设计的，只有 email_hash（Gravatar 用），
-- **发不了通知邮件**；友链申请又要存站点地址和头像。所以补三列。
--
-- 点赞为什么不复用 0001 的 `likes`：那张表主键是 (post_slug, visitor)，
-- 一篇只记一次，是按「文章」设计的；评论区要按「楼层」去重，另开一张。
--
-- 应用：
--   wrangler d1 migrations apply qingwu --remote
-- 可重复执行：ALTER 在 D1 上重复跑会报 duplicate column，
-- 所以这里靠 migrations 的版本记录保证只跑一次（不要手动重跑）。

ALTER TABLE comments ADD COLUMN email      TEXT;   -- 发通知信用，**绝不返回给前端**
ALTER TABLE comments ADD COLUMN author_url TEXT;   -- 站点地址
ALTER TABLE comments ADD COLUMN avatar     TEXT;   -- 头像直链

CREATE TABLE IF NOT EXISTS friend_likes (
  comment_id INTEGER NOT NULL,
  visitor    TEXT    NOT NULL,   -- 匿名访客标识（IP|UA 哈希截断，不存明文）
  ts         INTEGER NOT NULL,
  PRIMARY KEY (comment_id, visitor)
);
CREATE INDEX IF NOT EXISTS idx_friend_likes_comment ON friend_likes(comment_id);
