-- 清吾 · 长亭：补 chat_messages.image_id
--
-- ⚠️ 又是同一类失误：方案文档的表结构里写了 `image_id`，写 0026 时漏掉了
--    （那时图片消息还没做，字段只是「将来要用」）。等真做的时候才发现列不存在。
--    和 0027 补 chat_reactions 是一回事 —— **迁移文件写完必须对一遍文档里的字段清单**。
--
-- 指向 chat_media.id。kind 列 0026 里已经有了（text / image / video），不用补。
ALTER TABLE chat_messages ADD COLUMN image_id INTEGER;
