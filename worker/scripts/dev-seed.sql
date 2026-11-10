-- 清吾 · 本地预览用的演示数据
--
-- 用途：后台在本地跑起来时，列表、状态灯、近 7 天柱状图不再是空的，
-- 改样式能立刻看到「有内容时」和「长文案时」长什么样。
--
-- ⚠️ 只在 local D1 跑：
--     cd worker && npx wrangler d1 execute qingwu --local --file scripts/dev-seed.sql
--   它开头会 DELETE 这几张表 —— **绝不能加 --remote**。
--
-- 时间一律用 strftime('now') 现场算，所以哪天跑都对，不会出现「三年前的留言」。
-- 想重置就再跑一遍，幂等。

DELETE FROM comments WHERE post_slug = 'friends';
DELETE FROM auto_reply_log;
DELETE FROM applications;
DELETE FROM friend_status;
DELETE FROM backlink_checks;
DELETE FROM ai_usage;
DELETE FROM hits;
DELETE FROM mail_outbox;

-- ——————————————————————————————— 留言板 ———————————————————————————————
-- 4 条顶层：待回复 / 已回复 / 待审核 / 垃圾。后台列表的四种样子各来一个。
INSERT INTO comments (id, post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, notify)
VALUES
  (1, 'friends', NULL, '朝朝听雨', 'rain@rainzt.cn', NULL, 'https://www.rainzt.cn',
   'https://www.rainzt.cn/favicon.ico',
   '友链已经加上啦，导航也换成了你上次说的那种 —— 常来坐坐。',
   'visible', (strftime('%s','now') - 3*86400)*1000, 'seed-a', 0),
  (2, 'friends', NULL, '雨落微凉', 'yuluo@example.com', NULL, 'https://yuluo.example.com',
   NULL,
   '博客做得很舒服，特别是文章页的目录。想问问那个「爱弥斯」立绘是自己画的吗？',
   'visible', (strftime('%s','now') - 2*86400 - 3600)*1000, 'seed-b', 1),
  (3, 'friends', NULL, 'SEO 推广王', NULL, NULL, NULL, NULL,
   '【全网推广】SEO 优化、关键词排名、外链代发，7 天首页，联系 QQ 88888888',
   'pending', (strftime('%s','now') - 5*3600)*1000, 'seed-c', 0),
  (4, 'friends', NULL, '拾光', 'shiguang@example.com', NULL, 'https://shiguang.example.net',
   NULL,
   '第一次来，从友链点过来的。想问下你用的字体是哪一套？中文字重看着很克制。',
   'visible', (strftime('%s','now') - 40*60)*1000, 'seed-d', 1);

-- 楼中楼：小爱回过（id 5、7），访客又接了一句（id 6）
INSERT INTO comments (id, post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, notify)
VALUES
  (5, 'friends', 1, '爱弥斯', NULL, NULL, NULL,
   'https://www.qingwu.ink/images/emis/avatar.png',
   '欢迎回来～导航那事我记着呢。最近在给后台做改版，等弄好了也让你看看。',
   'visible', (strftime('%s','now') - 3*86400 + 7200)*1000, NULL, 0),
  (6, 'friends', 1, '朝朝听雨', 'rain@rainzt.cn', NULL, 'https://www.rainzt.cn',
   'https://www.rainzt.cn/favicon.ico',
   '好啊，到时候记得喊我。',
   'visible', (strftime('%s','now') - 3*86400 + 9000)*1000, 'seed-a', 0),
  (7, 'friends', 4, '爱弥斯', NULL, NULL, NULL,
   'https://www.qingwu.ink/images/emis/avatar.png',
   '正文用的是思源宋体子集，标题那套是马善政 —— 都是按需切好的，整站加起来不到 1MB。',
   'visible', (strftime('%s','now') - 38*60)*1000, NULL, 0);

-- ——————————————————————————— 自动回复流水 ———————————————————————————
-- 近 7 天各来一点：回过 / 被每日上限挡下 / judge 判成垃圾 / 生成失败。
INSERT INTO auto_reply_log (comment_id, guest_hash, day, action, verdict, note, model, tokens, ms, ts)
VALUES
  (5, 'seed-a', date('now','-3 days'), 'replied', 'ok', NULL, 'deepseek-chat', 486, 2140,
   (strftime('%s','now') - 3*86400 + 7200)*1000),
  (7, 'seed-d', date('now','-1 days'), 'replied', 'ok', NULL, 'deepseek-chat', 412, 1780,
   (strftime('%s','now') - 38*60)*1000),
  (9001, 'seed-x', date('now','-1 days'), 'blocked', 'spam', 'judge: 站外推广', NULL, NULL, 215,
   (strftime('%s','now') - 20*3600)*1000),
  (9002, 'seed-y', date('now','-2 days'), 'skipped', 'ok', 'per_guest:1', NULL, NULL, NULL,
   (strftime('%s','now') - 2*86400 - 7200)*1000),
  (9003, 'seed-z', date('now','-4 days'), 'failed', 'ok', 'upstream 429', 'deepseek-chat', NULL, 3000,
   (strftime('%s','now') - 4*86400)*1000);

-- ———————————————————————————— 友链申请 ————————————————————————————
INSERT INTO applications (name, url, avatar, intro, email, status, reason, created_at, handled_at)
VALUES
  ('纸飞机', 'https://paperplane.example.com', NULL,
   '一个写日常与技术笔记的小站，内容以前端和阅读为主。',
   'paper@example.com', 'pending', NULL, (strftime('%s','now') - 6*3600)*1000, NULL),
  ('Northern Light', 'https://nl.example.dev', NULL,
   '摄影 + 随笔，图片比较多，加载可能稍慢。',
   'hi@example.dev', 'approved', NULL, (strftime('%s','now') - 12*86400)*1000,
   (strftime('%s','now') - 11*86400)*1000),
  ('资源仓库', 'https://repo.example.org', NULL,
   '全网资源导航，收录优质站点。',
   'repo@example.org', 'rejected', '内容以转载聚合为主，和本站调性不太合',
   (strftime('%s','now') - 20*86400)*1000, (strftime('%s','now') - 19*86400)*1000);

-- ——————————————————————————— 友链状态 ———————————————————————————
-- 一条失联缓冲（琥珀徽章，带 note 与剩余天数），一条违规整改。
INSERT INTO friend_status (url, state, note, until, updated_at)
VALUES
  ('https://rainzt.cn', 'unstable', '机房迁移中，预计月底回来',
   (strftime('%s','now') + 20*86400)*1000, (strftime('%s','now') - 2*86400)*1000),
  ('https://seasir.top', 'violation', '页面长期无法访问', (strftime('%s','now') + 6*86400)*1000,
   (strftime('%s','now') - 86400)*1000);

-- ——————————————————————————— 回链巡检 ———————————————————————————
-- 14 个友链里 7 有 7 无，外加一条抓取失败 —— 和线上实测的比例一致。
INSERT INTO backlink_checks (url, name, ok, status, matched, error, checked_at)
VALUES
  ('https://rainzt.cn', '朝朝听雨', 1, 200, 'https://www.rainzt.cn/links/', NULL, strftime('%s','now') - 3600),
  ('https://hty.rest', 'hty', 1, 200, 'https://hty.rest/', NULL, strftime('%s','now') - 3500),
  ('https://lygalaxy.cn', 'LYGalaxy', 1, 200, 'https://lygalaxy.cn/friends/', NULL, strftime('%s','now') - 3400),
  ('https://blog.cuteleaf.cn', 'CuteLeaf', 1, 200, 'https://blog.cuteleaf.cn/links/', NULL, strftime('%s','now') - 3300),
  ('https://dreamcenter.top', 'DreamCenter', 1, 200, 'https://dreamcenter.top/', NULL, strftime('%s','now') - 3200),
  ('https://iamyukino.cn', '雪之下', 1, 200, 'https://iamyukino.cn/friends/', NULL, strftime('%s','now') - 3100),
  ('https://detached.online', 'Detached', 1, 200, 'https://detached.online/links/', NULL, strftime('%s','now') - 3000),
  ('https://daily.yybb.us', '日常', 0, 200, NULL, NULL, strftime('%s','now') - 2900),
  ('https://blog.moesam.com', 'MoeSam', 0, 200, NULL, NULL, strftime('%s','now') - 2800),
  ('https://ragnote.top', 'RagNote', 0, 404, NULL, NULL, strftime('%s','now') - 2700),
  ('https://seasir.top', 'Seasir', 0, 0, NULL, 'timeout after 8000ms', strftime('%s','now') - 2600),
  ('https://homulilly.com', 'Homulilly', 0, 200, NULL, NULL, strftime('%s','now') - 2500),
  ('https://n0v0r0land.xyz', 'N0v0r0land', 0, 200, NULL, NULL, strftime('%s','now') - 2400),
  ('https://muyudada.dpdns.org', '木鱼', 0, 0, NULL, 'ECONNRESET', strftime('%s','now') - 2300);

-- ——————————————————————————— AI 用量 ———————————————————————————
-- 通道卡上的用量条：writer 12/300、judge 34/300，今天还没用完。
INSERT INTO ai_usage (day, channel, n, tokens_in, tokens_out)
VALUES
  (date('now'), 'writer', 12, 8420, 3160),
  (date('now'), 'judge', 34, 5210, 0),
  (date('now','-1 days'), 'writer', 6, 3900, 1420),
  (date('now','-1 days'), 'judge', 21, 3180, 0);

-- ——————————————————————————— 访问打点 ———————————————————————————
-- 今天 320 PV / 96 UV，外加前两天的尾巴，让「今日 PV / UV」和最后一条打点都不为 0。
INSERT INTO hits (ts, day, path, referrer, country, device, visitor)
SELECT (strftime('%s','now') - 3600 - (n * 97)),
       date('now'),
       CASE n % 4 WHEN 0 THEN '/' WHEN 1 THEN '/blog/' WHEN 2 THEN '/links/' ELSE '/about/' END,
       CASE n % 3 WHEN 0 THEN 'google.com' WHEN 1 THEN NULL ELSE '(direct)' END,
       CASE n % 5 WHEN 0 THEN 'CN' WHEN 1 THEN 'JP' WHEN 2 THEN 'US' WHEN 3 THEN 'HK' ELSE 'DE' END,
       CASE n % 2 WHEN 0 THEN 'desktop' ELSE 'mobile' END,
       'v' || (n % 96)
  FROM (WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 319)
        SELECT n FROM seq);

-- ——————————————————————————— 发信积压 ———————————————————————————
-- 一封在退避重试、一封已经放弃（tries 到顶）。后台那一格因此不是 0。
INSERT INTO mail_outbox (created_at, next_try_at, tries, last_error, payload)
VALUES
  (strftime('%s','now') - 5400, strftime('%s','now') + 900, 2, 'smtp_421',
   '{"to":"1454109769@qq.com","subject":"有人回复了你的留言","text":"演示数据"}'),
  (strftime('%s','now') - 90000, strftime('%s','now') - 3600, 6, 'smtp_550',
   '{"to":"1454109769@qq.com","subject":"友链留言板有新留言","text":"演示数据"}');
