-- 友链申请：新增「站点照片」列（选填）。
--
-- 存的是**图片直链**（http(s) 或站内路径），不是文件本身 ——
-- 和 avatar 一样，后台审核时能看到预览，通过后由人手动写进 src/data/links.json 的 shot 字段。
-- 这样不需要开 R2，也不会有「上传的图存在哪」的问题。
ALTER TABLE applications ADD COLUMN shot TEXT;
