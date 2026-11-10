-- 清吾 · 0022 模型接口可在后台改
--
-- 背景（2026-11-10 深夜，站长定）：
--   「可以修改模型的 api，保存生效」。
--   以前 base / key / model 只来自环境变量，改一个要登服务器改 .dev.vars 再重启 Worker。
--   现在落 admin_settings，优先级 **库 > env > 代码默认**，逐项回落。
--
-- 新增的键（都由 settings.ts 的 DEFAULTS 定义，这里只做迁移，不建表）：
--   ai.writer.base / ai.writer.key / ai.writer.model
--   ai.judge.provider / ai.judge.base / ai.judge.key / ai.judge.model
--
-- 只有一处搬家：旧的 `writer.model` 改名成 `ai.writer.model`。
-- 之所以改名而不是并存：同一个值有两个 key，迟早出现「改了 A 读的是 B」。
--
-- ⚠️ key 在库里是**明文**。这是站长自己的机器、自己的 key，不加密是因为没有可用的
-- KMS，硬造一层 AES 只会把密钥挪个地方。真要在意，就别在后台填 key，
-- 继续用 `wrangler secret put`，库里留空即可（空 = 回落 env）。

INSERT INTO admin_settings (key, value, ts, by_name)
SELECT 'ai.writer.model', value, ts, by_name
  FROM admin_settings
 WHERE key = 'writer.model' AND TRIM(value) != ''
ON CONFLICT(key) DO NOTHING;

DELETE FROM admin_settings WHERE key = 'writer.model';
