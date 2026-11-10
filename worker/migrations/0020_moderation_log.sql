-- 清吾 · 拦截记录
--
-- 在此之前「为什么被拦」是留不住的：comments 只存了 status='spam'，
-- 到底命中哪一类、多少分、阈值多少、模型说了什么，全在日志里滚掉了。
-- 站长打开「评论审核」页想知道的就是这些 —— 收件箱只告诉他有这一条，
-- 拦得对不对要看判罚依据。
--
-- 一条留言最多一行（comment_id 唯一）：审核只发生一次（提交那一刻），
-- 后来放行也不会删掉这行 —— 「当时判成垃圾、后来人工放行」本身就是信息。
-- 放行与否看 comments.status 的现值，两张表各管一件事。
--
-- day 单独存一份：统计页要按天出柱状图，用 ts 现算时区迟早会算错一次。

CREATE TABLE IF NOT EXISTS moderation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL,
  verdict     TEXT    NOT NULL,           -- illegal | porn | abuse | privacy | spam
  score       INTEGER NOT NULL DEFAULT 0, -- 0~100，判定为「应当拦截」的把握
  threshold   INTEGER NOT NULL DEFAULT 0, -- 当时用的阈值，事后能复现判断
  reasons     TEXT,                       -- JSON 数组，最多 3 条
  note        TEXT,                       -- 模型给的一句中文说明
  model       TEXT,
  ms          INTEGER,
  day         TEXT    NOT NULL,           -- YYYY-MM-DD（北京时间）
  ts          INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_comment ON moderation_log (comment_id);
CREATE INDEX IF NOT EXISTS idx_moderation_day ON moderation_log (day);
CREATE INDEX IF NOT EXISTS idx_moderation_ts  ON moderation_log (ts);
