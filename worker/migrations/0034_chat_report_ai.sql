-- 举报的 AI 复核结果
--
-- 站长按「交给 DeepSeek 看」之后，结论落在这里。**必须落库**，理由有三个：
--   ① 判定要花钱，翻页/刷新回来不该再判一次；
--   ② 结论是「处理依据」，事后要能对账（谁在什么时候、用哪个模型判的）；
--   ③ 忽略掉的举报也留着结论 —— 下一波同类内容进来时，看得出这台机器一贯怎么判。
--
-- ai_reasons 存 JSON 数组（最多 3 条），不另起一张表：它只跟着这一行读。

ALTER TABLE chat_reports ADD COLUMN ai_verdict TEXT;
ALTER TABLE chat_reports ADD COLUMN ai_score INTEGER;
ALTER TABLE chat_reports ADD COLUMN ai_note TEXT;
ALTER TABLE chat_reports ADD COLUMN ai_reasons TEXT;
ALTER TABLE chat_reports ADD COLUMN ai_model TEXT;
ALTER TABLE chat_reports ADD COLUMN ai_at INTEGER;
