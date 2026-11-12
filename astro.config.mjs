import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // 站点主域名统一用**带 www** 的写法（canonical / OG / RSS / sitemap 都以它为准）
  site: 'https://www.qingwu.ink',
  // Vercel adapter:站点仍是静态预渲染,只有 /api/questions 走服务端函数(见该文件的 prerender=false)
  adapter: vercel(),
  // 后台不进 sitemap：它本来就叫 noindex，别一边禁止收录一边把地址交出去
  integrations: [react(), mdx(), sitemap({ filter: (page) => !page.includes('/admin') })],
  // 本地改界面时那根黑色浮动工具条会压住页面内容，截图和肉眼都碍事
  devToolbar: { enabled: false },
  // 默认只绑 IPv6 的 [::1]，某些机器上 http://127.0.0.1:4321 连不上；
  // 显式绑 IPv4 回环，预览地址就固定成 http://127.0.0.1:4321
  server: { host: '127.0.0.1', port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    /*
     * 本地预览后台：`astro dev` 只负责页面，数据在 `worker/` 那份 Worker 里。
     * 线上是 nginx 把 `/api/` 转给 Worker（**去掉前缀**），这里做同一件事，
     * 所以前端那套 `fetch('/api/admin/...')` 一行都不用改，同源也不会有 CORS。
     *
     * 只转发 `/api/admin`：`src/pages/api/` 下还有三个真的 Astro 端点
     * （hit / links/apply / questions），一起吞掉它们就跑不通了。
     * Worker 不在时页面照常打开，只是列表会显示"读不到"。
     */
    server: {
      proxy: {
        // 本地预览时把 /api/* 整体转给 Worker，**与线上同源**：
        // 会话 cookie（q_sess）在 dev 下也能正常带上，跨源那套 CORS/凭证问题不会在本地冒出来。
        // 线上走 nginx 的 location /api/，行为一致（都去前缀）。
        '/api': {
          target: process.env.QINGWU_WORKER_DEV || 'http://127.0.0.1:8799',
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  },
});
