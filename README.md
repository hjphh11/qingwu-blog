# 清吾 · qingwu.ink

> 一个温馨二次元的个人博客 —— 写技术，也记生活。一块属于自己的小小角落。

## ✨ 简介
「清吾」是作者自己的小站，以主题形象 **爱弥斯** 的暖色调（玫瑰粉 / 绯红 / 奶油白 / 琥珀金 / 暖棕）为视觉基础，营造温馨、日常、二次元的氛围。全站采用玻璃拟态卡片 + 克制的动效。

## 🧩 功能
- **首页**：Hanzi Writer 笔顺问候 + 爱弥斯随滚动缩小；两栏布局（中央文章流 + 右栏卡片：当前时间 / 访客城市 / 小数据 / 技术栈 / 运行时长）。
- **文章**：分类切换（全部 / 技术 / 记录）+ 详情页（暖色排版 / 目录 / 阅读进度条）。
- **音乐馆**：旋转光盘播放器 + 歌词 / 歌单（歌词逐行高亮、搜索、音量、播放模式）；全局悬浮迷你播放器（可拖动）。
- **友链 / 分享 / 关于**：朋友卡片、收藏 + 语录、个人介绍与爱弥斯人设。

## 🛠 技术栈
- **Astro**（内容优先、静态输出）
- **Tailwind CSS**（暖色设计 tokens）
- **Motion**（motion/react，克制动效）
- **Hanzi Writer**（笔顺书写动画）
- **Vercel**（部署托管，绑定 `qingwu.ink`）

## 🚀 本地运行
```bash
npm install
npm run dev      # 开发(默认 http://localhost:4321)
npm run build    # 构建静态站(输出 dist/)
npm run check    # 类型检查
```

## 📦 部署
推送到 GitHub 的 `main` 分支 → Vercel 通过 GitHub 集成自动构建并上线：
- Build：`npm run build`（静态输出到 `dist/`）
- Output：`dist`
- 绑定域名：`qingwu.ink` / `www.qingwu.ink`

> 部署的更多细节与备注，保存在**本地** `docs/部署说明.md`，不随仓库公开。

## 📈 访问统计
访客打点走**同源** `/api/hit`，正常情况下站点不会直接对外暴露接口：

- 默认（未配 `HIT_WORKER_URL`）：打点写 Upstash Redis，由 GitHub Action 定时汇总。
- 配了 `HIT_WORKER_URL`（例如 `https://api.qingwu.ink`）：`/api/hit` 变成一层**薄转发**，
  由 Cloudflare Worker 写 D1；后台改读 Worker 的 `GET /stats`。
  转发失败会自动退回 Upstash，不会丢数据；删掉这个变量即可回退。

> Worker 的部署步骤、migration、secret 与历史数据迁移见 **`worker/README.md`**。
> 完整方案见 `docs/后台迁移-Cloudflare方案.md`。

## 📝 内容
- 文章：`src/content/blog/*.md`（分类见 `src/data/categories.json`）
- 音乐：`src/data/music.json` + `public/music/`（改完跑 `node scripts/gen.mjs` 重新生成 `src/data/music.ts`）
- 友链：`src/data/links.json` ｜ 分享：`src/data/share.json` ｜ 关于：`src/data/about.json`
- 以上 JSON 在构建时会经 zod 校验，写错会在构建时报出「哪个文件、哪个字段」

> 这些内容文件都是纯 JSON，是给将来的后台管理系统读写用的；
> 对应的 `src/data/*.ts` 只是带校验的薄封装，改内容请改 JSON。

## 🎨 改外观前先看
**`docs/设计规范.md`** —— 颜色 / 字号 / 间距 / 动效的 token 定义与硬约束（对比度 ≥ 4.5:1、容器用 `.page-shell`、悬停位移用 `.card-lift`、图片给 webp 等）。
照着它改，就不会一页一页地跑偏。

## 🎨 主题形象
**爱弥斯**（《鸣潮》五星热熔共鸣者，《飞行雪绒》/《电子幽灵》，作者的小 IP）。她的配色即全站的方向。
