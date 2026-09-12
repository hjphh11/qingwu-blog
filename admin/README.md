# 清吾后台（`admin/`）

> 后台管理系统 —— 手机/电脑都能用的内容后台。
> 完整方案见 `docs/后台管理方案.md`；**当前进度见 `docs/HANDOFF.md`**。

## 现在做到哪了

**阶段 D ~ L：概览 / 文章 / 分类 / 友链 / 友链申请 / 分享 / 关于页 / 音乐 / 回收站 / 发布 / 操作日志 / 备份与搜索 / 动效打磨**

- ✅ 服务端：Express（只监听 `127.0.0.1`）+ 单用户密码登录（argon2 哈希 + 签名会话 cookie + 登录限速）
- ✅ 前端：React + Vite 单页应用（暖色玻璃拟态，与博客前台同一套 tokens 与图标）
- ✅ 数据总览：文章统计 / 各数据文件健康度（**写坏了会直接告诉你哪个文件、哪个字段**）/ 分类分布 / 最近文章 / 原始 JSON 预览
- ✅ **文章管理（阶段 E）**：列表（搜索 / 分类筛选 / 状态筛选 / 排序 / 每页 20 条分页 / **待发布分组**）· 新建 · 编辑 · slug 拼音自动生成 · 摘要自动截取 · 草稿 · 置顶（含置顶区上下移动排序）· Markdown 工具栏 + 实时预览 · 标签自动补全 · **软删除到回收站**（可恢复/彻底清除）· 「待发布」可展开看具体文件
- ✅ **分类管理（阶段 F）**：新建（**只填中文名**，内部标识自动拼音）· 改名/换图标 · **上下移动排序 + 保存**（顺序即前台 `/blog` 筛选按钮顺序）· **删除归属保护**（有文章时必须选一个分类转移过去；迁移只改文章 frontmatter 的 `category` 一行）
- ✅ **友链 / 分享·语录 / 关于页（阶段 G）**：三模块都是**整块保存**（改好整块再保存，增删改排序一次提交）
  · 友链：增删改 · 上下移动排序 · **是否显示 + 添加时间**（只在后台用，前台不受影响）· 删除进回收站
  · 分享：收藏与语录统一列表 · **标签**（前台可按标签筛选）· id 自动分配
  · 关于页：四块独立保存（主页信息 / 信息条目 / 爱弥斯 / 联系方式）· 条目带**图形化图标选择器**
- ✅ **音乐（阶段 H）**：只改现有 13 首的标题 / 歌手 / 封面 / 说明 · **歌词时间轴编辑**（每行「时间 + 文字」，可改/插行/删行 + 按时间排序/清空）· 上下移动排序（= 前台歌单顺序）· **保存后自动重跑 `scripts/gen.mjs` 重新生成 `music.ts`**（**不做**新增歌曲/音频上传）
- ✅ **发布与回滚（阶段 I）**：「保存」≠「上线」，这里才是上线
  · 顶栏「发布 N」按钮（有待发布就显示数字）+ **发布页**：分支/领先落后/待发布清单（**可勾选部分发布**）/ 六步进度 / 原始日志 / 发布历史 + **一键回滚**
  · 六步 = **构建校验 → 暂存 → 提交（信息自动生成）→ `pull --rebase --autostash` → 推送 → 触发 Deploy Hook**
  · **构建不过绝不推送**（远端一个字节都不动）；**冲突不会静默失败**：自动 `rebase --abort` + 把这次自动提交**退回工作区**，改动不丢、能再发一次
  · **推送失败**（断网/被拒）本地提交保留，界面上出现 **「重试推送 N 个提交」**（推出去了才算完）
  · **回滚**用 `git revert`（不改写历史）+ 构建 + 推送，失败自动还原；仓库第一个提交回滚不了（按钮已禁）
  · PAT **只经子进程环境变量**传给 git，不进命令行、不落盘
  · **操作日志页**：只记发布 / 回滚 / **审批友链**（第 43 条），存在 `<仓库>/.admin-logs/operations.jsonl`（已 gitignore）
- ✅ **友链申请审批（阶段 J）**：访客在 `/links/apply` 提交的申请存在**私有仓库**（含邮箱，绝不能进公开仓库）
  · 后台「友链申请」页：待审批 / 已通过 / 已拒绝 三个筛选 · 侧栏角标显示待审批数量 · 卡片上有头像预览、站点链接、**访客邮箱**（可直接联系）、提交时间
  · **通过** = 自动写进 `links.json`（补齐 `addedAt`/`visible`、自带同名链接去重）→ 于是它出现在**「待发布」**里，回发布页点一下就上线
  · **拒绝** = 把状态写回私有仓库（可留原因）；点错了能**改回待审批**。状态写在仓库里，所以阶段 B 的「被拒后可以重新申请」去重逻辑仍然成立
  · **审批也进操作日志**（第 43 条）：approve / reject / reopen
- ✅ **便捷功能（阶段 K）**
  · **定时发布**：发布页可以设「到点自动发布」—— 到点服务器自动跑一遍和手点**完全一样**的流程（构建校验 → 提交 → 推送）；指定某篇文章时，会先把它从**草稿**转成已发布再发（= 定时上线）；能取消、能清历史；**服务器重启后过期的待办会补跑**
  · **一键导出备份**：概览页一个按钮下载 zip（文章 + 各 JSON + 歌词 + `music.ts` + `MANIFEST.json`（逐文件 sha256）+ 恢复说明），解压覆盖回仓库即可完整还原（ZIP 按格式自己写，**没有新增依赖**）
  · **`Cmd/Ctrl + K` 全局搜索**：搜文章（含**正文**）/ 分类 / 友链 / 语录 / 歌曲 / 友链申请，也能搜**页面**与**动作**（如「下载备份」「新建文章」）；↑↓ 选择、Enter 打开、Esc 关闭
- ✅ **动效与交互（阶段 L，打磨阶段）**
  · **页面切换**：内容上浮淡入、顶栏标题轻推一下（按「页面 key」重挂载，所以每次换页都会重放）
  · **侧栏滑动高亮胶囊**：和博客前台导航同一套手感，胶囊滑到当前模块
  · **微交互**：按钮悬停抬升 + 按下回弹、图标按钮悬停放大（删除键带点旋转）、列表行悬停右移并亮出玫瑰条、输入框聚焦光圈
  · **发布反馈**：进行中的步骤呼吸、刚完成的步骤「打勾弹跳」、成功提示放大进入、顶栏「发布 N」数字变化时弹一下、发布中图标变成旋转的圈
  · **morphicons 图标形变**：菜单↔关闭、眼睛↔闭眼、置顶↔取消置顶、歌曲展开↔收起等 8 处原地换图标都走形变（`spring="snappy"`）
  · **手机端手势**：从左缘往右拖拉开抽屉（跟手，过半自动开）、往左拖收起、`Esc` 也能关
  · **键盘手感**：编辑器里 `Cmd/Ctrl+S` 保存、`+B` 加粗、`+I` 斜体、`+1/2` 标题；新建文章自动聚焦标题；焦点圈只在键盘操作时出现
  · **概览数字滚动**到位；**系统开了「减少动效」就一键全关**（CSS 全局压掉 + 数字直接给终值 + morphicons `reducedMotion="user"`）
- ⚠️ **写范围受限**：文章只写 `src/content/blog/*.md`；分类写 `src/data/categories.json`；友链/分享/关于分别写 `links.json` / `share.json` / `about.json`；音乐写 `src/data/music.json` + `public/music/lrc/*.lrc`（并重新生成 `src/data/music.ts`）；删除进 `.admin-trash/`（已 gitignore，**多类型共用**：文章/友链/分享）；**友链申请**只写私有仓库 `hjphh11/qingwu-link-applications`（**不写**博客仓库）；**定时待办**写在 `.admin-logs/schedule.json`（后台自己的待办，不进公开仓库）
- ⬜ 还没做：统计（M）、收尾（N）

## 本地运行

```bash
cd admin
npm install

# 1) 生成密码哈希
npm run hash-password -- 你的密码

# 2) 配置环境变量
copy .env.example .env      # Windows
#   cp .env.example .env    # macOS / Linux
#   把上一步输出的 ADMIN_PASSWORD_HASH 填进去，并填一个 ADMIN_SESSION_SECRET
#   （生成会话密钥：openssl rand -hex 32）

# 3) 起开发环境（API :3000 + 前端 :5173）
npm run dev
```

然后打开 **http://127.0.0.1:5173**。

> 单端口模式（生产用）：`npm run build && npm start` → 打开 http://127.0.0.1:3000

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | ✅ | 登录密码的 **argon2 哈希**（不存明文）。用 `npm run hash-password -- 密码` 生成 |
| `ADMIN_SESSION_SECRET` | ✅ | 会话 cookie 的签名密钥，≥16 位随机字符（`openssl rand -hex 32`） |
| `ADMIN_REPO_PATH` | 选填 | 博客仓库路径。默认 `admin/` 的上一级；服务器上按方案是 `/opt/qingwu/repo` |
| `ADMIN_HOST` / `ADMIN_PORT` | 选填 | 默认 `127.0.0.1:3000`。**只监听本地，不要改成 0.0.0.0** |
| `ADMIN_SESSION_DAYS` | 选填 | 登录态保留天数，默认 7 |
| `ADMIN_COOKIE_SECURE` | 选填 | 会话 cookie 是否带 `Secure`，默认跟 `NODE_ENV`（生产就带）。**只有走明文 HTTP 时才设 `0`**（见下方「部署实况」） |
| `ADMIN_TRASH_PATH` | 选填 | 回收站目录。默认 `<仓库>/.admin-trash/`（已 gitignore）。**删掉的文章可能从没提交过，放进公开仓库等于泄露，所以必须保持忽略** |
| `ADMIN_GIT_TOKEN` | 发布必填 | **GitHub 细粒度 PAT**（`qingwu-blog` 仓库 `Contents: Write`），发布/回滚要用它推送。**只经子进程环境变量传给 git**，不写命令行、不落盘。不配 → 只能保存、不能发布 |
| `ADMIN_DEPLOY_HOOK` | 选填 | **Vercel Deploy Hook URL**。配上就由后台主动触发重建（状态更明确）；不配也能用 —— Vercel 自己会检测到 push 后重建，只是慢一点 |
| `ADMIN_LOG_PATH` | 选填 | 操作日志目录。默认 `<仓库>/.admin-logs/`（已 gitignore），里面是 `operations.jsonl`（只记发布 / 回滚 / 审批友链） |
| `ADMIN_APPLY_TOKEN` | 审批必填 | **私有仓库** `hjphh11/qingwu-link-applications` 的 **Contents 读写** PAT —— 后台要读申请列表、并把「通过/拒绝」的状态写回去。不配 → 审批页只显示提示，其它功能不受影响 |
| `ADMIN_APPLY_REPO` / `ADMIN_APPLY_PATH` / `ADMIN_APPLY_REF` | 选填 | 申请数据在哪。默认 `hjphh11/qingwu-link-applications` / `applications.json` / `main` |
| `ADMIN_APPLY_API_BASE` | 选填 | GitHub API 地址，默认官方。**本地测试会指向 mock 服务**（`http://127.0.0.1:4600`），绝不会碰真私有仓库 |
| `ADMIN_APPLY_CACHE_MS` | 选填 | 审批列表的服务端缓存毫秒数，默认 45000（单用户后台，翻来翻去不必每次打 GitHub） |

`.env` 已被 `.gitignore` 忽略（`.env` 规则），**不要提交**。

## 结构

```
admin/
├─ server/                 # Express API（Node 直接跑，无构建步骤）
│  ├─ index.js             # 入口：中间件 + 路由 + 单端口托管前端
│  ├─ config.js            # 环境变量读取 + 启动自检
│  ├─ auth.js              # argon2 校验 / 签名会话 cookie / 登录限速 / requireAuth
│  ├─ data.js              # 读博客仓库数据（白名单 + zod 校验 + frontmatter 解析）
│  ├─ jsonFile.js          # JSON 读写（zod 校验 + 原子写 + **沿用目标文件的换行符**）
│  ├─ articles.js          # 文章读写 + 摘要/slug + **未发布改动清单（changedFiles）**
│  ├─ applications.js      # **阶段 J：友链申请审批**（私有仓库 Contents API 读写 + 通过则写进 links.json）
│  ├─ oplog.js             # 操作日志（第 43 条；发布/回滚/审批共用一份）
│  ├─ search.js            # **阶段 K：全局搜索索引**（文章含正文 / 友链 / 语录 / 歌曲 / 申请 / 页面 / 动作）
│  ├─ backup.js + zip.js   # **阶段 K：一键导出备份**（自己按 ZIP 格式打包，不加依赖）
│  ├─ schedule.js          # **阶段 K：定时发布**（待办存 .admin-logs/schedule.json，到点自动发布，重启会补跑）
│  ├─ categories.js links.js shares.js about.js music.js
│  │                       # 各模块的读写实现（白名单路径 + 校验）
│  ├─ trash.js             # 回收站（多类型软删除 / 恢复 / 彻底清除）
│  ├─ overview.js          # 概览统计
│  ├─ publish.js           # **阶段 I：发布 / 回滚**（构建校验 → 提交 → 拉取 → 推送 → 触发重建）
│  └─ routes/              # auth / articles / categories / content / data / trash / publish / applications / tools
├─ web/                    # React + Vite 前端
│  ├─ vite.config.js       # dev 时 /api 代理到 3000
│  └─ src/{App,api,icons}.js(x) + components/ + pages/ + styles/
└─ scripts/                # dev.mjs（同时起 API+前端）、hash-password.mjs
```

## 安全设计（方案第九节）

| 面 | 做法 |
|---|---|
| 网络 | 只监听 `127.0.0.1`；对外走 **Tailscale 私网**，**不开任何公网端口**（免备案、外网扫不到） |
| 认证 | 单用户密码（**argon2** 哈希，不存明文）+ HttpOnly/SameSite 会话 cookie（线上 HTTPS 再加 `Secure`）+ 登录失败限速（15 分钟 5 次） |
| 读写范围 | **白名单**：读 `src/data/*.json`；写只能写 `src/content/blog/*.md`（阶段 E 起）。读不到也改不了代码 |
| 写入安全 | id 严格正则 + 解析后相对路径必须仍在文章目录内（挡 `../` 与编码绕过）；frontmatter 写前 zod 校验；分类必须在 `categories.json` 里；一律 **LF 无 BOM**；**原子写**（临时文件 + rename） |
| 删除 | **软删除**到回收站（默认 `仓库/.admin-trash/`，已 gitignore），可恢复或彻底清除 |
| CSRF | 会话 cookie 是 `SameSite=Lax`，另外**所有状态变更请求还要 Origin 同源校验** |
| 校验 | 读到的 JSON 都用 zod 校验，坏数据在后台就能看出「哪个文件、哪个字段」 |
| 私密数据 | **友链申请**（含访客邮箱）只存**私有仓库**，后台走 GitHub Contents API 读写；博客仓库是 public，绝不写进去（第 49 条） |

## 部署（已在服务器上跑起来了）

阶段 D 就部署完了：装 Node → clone 仓库到 `/opt/qingwu/repo` → Tailscale 登录 → 配 `/opt/qingwu/.env`（600 权限，**阶段 I 起要加 `ADMIN_GIT_TOKEN`**、**阶段 J 起要加 `ADMIN_APPLY_TOKEN`**）→ `npm ci && npm run build` → systemd 常驻 → `tailscale serve --bg --http=8080 3000`。

> **实况（为什么是 http 不是 https、怎么重新部署、踩过的坑）见 `docs/部署说明.md` §7**。
> 访问方式：`http://<服务器名>.<tailnet>.ts.net:8080`（手机/电脑都要装 Tailscale 并登录同一账号）。
