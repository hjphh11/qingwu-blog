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
见 [`部署说明.md`](./部署说明.md)：推到 GitHub → 导入 Vercel（Build `npm run build`、Output `dist`）→ 绑定 `qingwu.ink`。

## 📝 内容
- 文章：`src/content/blog/*.md`
- 音乐：`src/data/music.ts` + `public/music/`
- 友链：`src/data/links.ts` ｜ 分享：`src/data/share.ts` ｜ 关于：`src/data/about.ts`

## 🎨 主题形象
**爱弥斯**（《鸣潮》五星热熔共鸣者，《飞行雪绒》/《电子幽灵》，作者的小 IP）。她的配色即全站的方向。
