-- 清吾 · 友链申请的「回链探测」结果（2026-11-10）
--
-- 访客提交申请后，后台点「探测」会去对方站点抓一遍，看有没有已经把我们加进友链。
-- 结果落在这张表，方便过几天再看一眼「上次是什么时候查的、查到了什么」，
-- 不用每点一次都重新打对方服务器。
--
-- 「有没有回链」的判定主责是 friends.ts 的 checkOne（字符串包含 qingwu.ink，
-- 规则极宽），ai_verdict 只是**没找到时让 DeepSeek 复核一次**的结论：
-- 有些站会把链接写成中文「清吾」、或者放在 JS/图片里，纯字符串匹配会漏。

CREATE TABLE IF NOT EXISTS application_probes (
  app_id       INTEGER PRIMARY KEY,
  url          TEXT    NOT NULL,
  ok           INTEGER NOT NULL,           -- 1 = 找到回链 / 0 = 没找到
  status       INTEGER,                    -- 最后一次 HTTP 状态码
  matched      TEXT,                       -- 在哪个页面找到的
  error        TEXT,                       -- 没找到 / 抓取失败的原因
  ai_verdict   TEXT,                       -- DeepSeek 复核结论，JSON：{hasBacklink,why}
  checked_at   INTEGER NOT NULL,
  mailed_at    INTEGER                     -- 这封信发出去的时间（NULL = 还没回信）
);
