-- 站点代表图（og:image）。
--
-- 为什么不用第三方截图服务（mShots / thum.io）：
--   实测 mShots 直接 403；thum.io 能出图，但抓 ragnote.top 拿到的是
--   Cloudflare 的「Performing security verification」验证页 —— 有防护的站全废。
--   截一张验证页比没有图更糟，所以放弃自动截图。
--
-- og:image 是站主自己挑的站点代表图，写在 HTML <head> 里，
-- 不被爬虫防护拦、也不需要额外依赖 —— 视觉上就是「这家长什么样」。
ALTER TABLE link_feeds ADD COLUMN og_image TEXT;
