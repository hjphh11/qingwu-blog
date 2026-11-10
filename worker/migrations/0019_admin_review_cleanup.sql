-- 清吾 · 0019 清掉审核规则的三个已废弃键
--
-- 背景（2026-11-10 晚，站长定）：
--   ① 「提交前审核」总开关去掉了 —— 每条留言都必须判一次，不给关的选项；
--   ② 「命中后怎么处置」（hold / reject）去掉了 —— 固定落 spam；
--   ③ 「命中时给访客看的话」去掉了 —— 垃圾直接不展示，没有「压下来了」这回事。
--
-- 顺带把 `judge.categories` 也删掉：类别的键名从 spam/abuse/privacy 三类
-- 重定义成 illegal/porn/abuse/privacy/spam 五类，旧值（比如 `spam,abuse,privacy`）
-- 不但少两类，语义也不一一对应。留着一个「看起来生效、其实漏判」的组合，
-- 比让它回落到默认（全选五类）危险得多。
--
-- 这三件事都没有表结构变更，纯粹是数据清理。删不删都不影响读取
-- （parseSettings 只认代码里定义过的键），但留着会让下一个人在库里看到
-- 一堆永远不会生效的参数，查半天。

DELETE FROM admin_settings
 WHERE key IN ('judge.on', 'judge.action', 'judge.notice', 'judge.categories');
