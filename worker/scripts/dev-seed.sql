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
DELETE FROM moderation_log;
DELETE FROM applications;
DELETE FROM friend_status;
DELETE FROM backlink_checks;
DELETE FROM ai_usage;
DELETE FROM hits;
DELETE FROM mail_outbox;
DELETE FROM friend_publish_log;

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

-- ———————————————————————— 被审核拦下的留言 ————————————————————————
-- 三条覆盖三种类别，其中一条已经被人工放行 —— 审核页的「拦截记录」要能同时
-- 显示「还拦着」和「已放行」两种样子，否则状态那一栏的对错看不出来。
INSERT INTO comments (id, post_slug, parent_id, author, email, email_hash, author_url, avatar, body, status, ts, ip_hash, notify)
VALUES
  (8, 'friends', NULL, '代运营小李', NULL, NULL, NULL, NULL,
   '专业代运营，涨粉引流一条龙，加微信 cw8899，月费只要 199，无效退款。',
   'spam', (strftime('%s','now') - 26*3600)*1000, 'seed-e', 0),
  (9, 'friends', NULL, '匿名', NULL, NULL, NULL, NULL,
   '楼主就是个不懂装懂的货，写这种东西也好意思发出来，建议赶紧删号。',
   'spam', (strftime('%s','now') - 2*86400)*1000, 'seed-f', 0),
  (10, 'friends', NULL, '爆料君', NULL, NULL, NULL, NULL,
   '顺便问一下，你们那边那个谁的电话是不是 138xxxx，我听说是住在 xx 路。（测试用：判为隐私泄露，之后手动放行）',
   'pending', (strftime('%s','now') - 4*86400)*1000, 'seed-g', 0);

-- 判定依据。score / threshold 是当时的原值，改阈值之后这些记录不该跟着变。
INSERT INTO moderation_log (comment_id, verdict, score, threshold, reasons, note, model, ms, day, ts)
VALUES
  (8, 'spam', 94, 70,
   '["加微信引流","明码标价代运营","与本站内容无关"]',
   '典型的推广留言，含联系方式和报价', 'jev-1', 186,
   date('now','-1 days'), (strftime('%s','now') - 26*3600)*1000),
  (9, 'abuse', 88, 70,
   '["人身攻击","侮辱性称呼","攻击作者"]',
   '针对作者本人的辱骂，不是对内容的批评', 'jev-1', 203,
   date('now','-2 days'), (strftime('%s','now') - 2*86400)*1000),
  (10, 'privacy', 81, 70,
   '["疑似手机号","疑似住址"]',
   '正文里出现可定位到个人的信息', 'jev-1', 174,
   date('now','-4 days'), (strftime('%s','now') - 4*86400)*1000);

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

-- 再按天铺一层：统计页「小爱回过多少」那张图需要连续十几天的形状。
-- comment_id 用 9100+ 的假号 —— 列表里作者显示「（留言已删）」，正好也是要看的样子。
INSERT INTO auto_reply_log (comment_id, guest_hash, day, action, verdict, note, model, tokens, ms, ts)
SELECT 9100 + k, 'seed-loop', date('now','-'||k||' days'), 'replied', 'ok', NULL, 'deepseek-chat',
       380 + (k * 23) % 260, 1500 + (k * 90) % 1200, (strftime('%s','now') - k*86400 + 3600)*1000
FROM (WITH RECURSIVE k0(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k0 WHERE k < 13) SELECT k FROM k0)
WHERE k % 2 = 0;

INSERT INTO auto_reply_log (comment_id, guest_hash, day, action, verdict, note, model, tokens, ms, ts)
SELECT 9200 + k, 'seed-loop2', date('now','-'||k||' days'), 'skipped', 'ok',
       CASE k % 3 WHEN 0 THEN 'quiet_hours' WHEN 1 THEN 'per_guest:1' ELSE 'keyword:抽奖' END,
       NULL, NULL, NULL, (strftime('%s','now') - k*86400 + 5400)*1000
FROM (WITH RECURSIVE k0(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k0 WHERE k < 13) SELECT k FROM k0)
WHERE k % 3 = 0;

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
-- 顺带把近 14 天铺开 —— 统计页的 AI 那张图只有两根柱子的话，看不出柱形对不对。
INSERT INTO ai_usage (day, channel, n, tokens_in, tokens_out)
SELECT day, 'writer', n, n * 640, n * 250 FROM (
  SELECT date('now','-'||k||' days') AS day, 4 + (k * 7) % 16 AS n
  FROM (WITH RECURSIVE k0(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k0 WHERE k < 13) SELECT k FROM k0)
);

INSERT INTO ai_usage (day, channel, n, tokens_in, tokens_out)
SELECT day, 'judge', n, n * 150, 0 FROM (
  SELECT date('now','-'||k||' days') AS day, 12 + (k * 11) % 30 AS n
  FROM (WITH RECURSIVE k0(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k0 WHERE k < 13) SELECT k FROM k0)
);

-- ——————————————————————————— 访问打点 ———————————————————————————
-- 近 14 天，每天 60~320 PV。只给今天一天的话，统计页的趋势图是一根柱子 ——
-- 折线、面积、x 轴抽稀这些全都没得验。每天 visitor 取模 88，所以 UV 也在 88 上下。
INSERT INTO hits (ts, day, path, referrer, country, device, visitor)
SELECT
  CAST(strftime('%s', d.day || ' 00:00:00') AS INTEGER) + (s.n * 157) % 86400,
  d.day,
  CASE s.n % 5 WHEN 0 THEN '/' WHEN 1 THEN '/blog/' WHEN 2 THEN '/blog/astro-d1' WHEN 3 THEN '/links/' ELSE '/about/' END,
  CASE s.n % 4 WHEN 0 THEN 'google.com' WHEN 1 THEN 'rainzt.cn' WHEN 2 THEN '(direct)' ELSE NULL END,
  CASE s.n % 9 WHEN 0 THEN 'US' WHEN 1 THEN 'JP' WHEN 2 THEN 'HK' WHEN 3 THEN 'SG' WHEN 4 THEN 'DE' ELSE 'CN' END,
  CASE s.n % 7 WHEN 0 THEN 'mobile' WHEN 1 THEN 'tablet' ELSE 'desktop' END,
  'v' || (s.n % 88)
FROM (
  SELECT date('now','-'||k||' days') AS day, 60 + (k * 37) % 260 AS pv
  FROM (WITH RECURSIVE k0(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM k0 WHERE k < 13) SELECT k FROM k0)
) d
JOIN (WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 400) SELECT n FROM seq) s
  ON s.n < d.pv;

-- ——————————————————————————— 发信积压 ———————————————————————————
-- 一封在退避重试、一封已经放弃（tries 到顶）。后台那一格因此不是 0。
INSERT INTO mail_outbox (created_at, next_try_at, tries, last_error, payload)
VALUES
  (strftime('%s','now') - 5400, strftime('%s','now') + 900, 2, 'smtp_421',
   '{"to":"1454109769@qq.com","subject":"有人回复了你的留言","text":"演示数据"}'),
  (strftime('%s','now') - 90000, strftime('%s','now') - 3600, 6, 'smtp_550',
   '{"to":"1454109769@qq.com","subject":"友链留言板有新留言","text":"演示数据"}');

-- ——————————————————————————— 友链发布记录 ———————————————————————————
-- 「最近发布」那块要有东西可看：一次真提交（带字段明细），一次降级成手动粘贴。
-- changes 是 JSON 数组，字段名与后端 publish.ts 的 FieldChange 对齐。
INSERT INTO friend_publish_log (ts, by_name, commit_sha, message, changes, status, detail, base_sha)
VALUES
  (strftime('%s','now') - 86400,
   'qingwu',
   'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
   'chore(links): 新增「昭鸾笺」，改一条简介',
   '[{"url":"https://blog.mibase.top","name":"昭鸾笺","field":"+","from":"","to":"昭鸾笺 · https://blog.mibase.top"},{"url":"http://rainzt.cn","name":"朝朝听雨","field":"intro","from":"物物而不物于物","to":"物物而不物于物，念念而不念于念"}]',
   'ok', '共 15 条友链', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
  (strftime('%s','now') - 172800,
   'qingwu', NULL,
   'chore(links): 后台更新友链（qingwu）',
   '[{"url":"https://hty.rest","name":"吴彦祖论坛","field":"visible","from":"展示中","to":"已隐藏"}]',
   'manual', '没配 GITHUB_TOKEN，降级为手动粘贴', NULL);
