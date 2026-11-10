# 方案：站点内 `/admin` 后台（2026-11-10）

> 目标：在 `www.qingwu.ink/admin` 直接访问的后台，做成「朝朝听雨的小爱后台」那样的形态，
> 视觉换成本站的爱弥斯暖色系。登录走**账号密码 → 邮箱验证码**两级。
>
> 参考文章：`https://rainzt.cn/posts/aemeath-xiaoai-admin/`（2026-10-30）。

## 一、开源结论：后台没开源

| 项 | 结论 |
|---|---|
| 主题本体 | **已开源**：[`Jarvis0227/Aemeath`](https://github.com/Jarvis0227/Aemeath)，MIT，135★，最后 push 2026-11-04 |
| 后台 | **没有开源**。仓库 `src/pages/` 只有 26 个前台页（blog / friends / links / moments / gallery…），无 `admin`；顶层与 `src/` 下均无后台目录 |
| 作者原话 | "后续我打算把这套后台和博客一起整理开源" —— 属于待办，不是已发布 |

⇒ 只能**照图仿真**。好处是他那套的信息架构经过真实使用打磨，结构可以直接抄；
坏处是交互细节（拖拽、暂存、草稿恢复）要靠我们自己实现一遍。

## 二、从他 18 张截图反推的信息架构

后台是**单页 + 顶部 tab**，不是独立 URL 的多页。六个主模块：

| 模块 | 对应截图 | 核心内容 |
|---|---|---|
| 登录 | `login` `login-verification` | 左栏品牌 + 三步说明，右栏账号/密码/验证码 |
| 评论收件箱 | `comment-inbox` `comment-ai-reply` | 表格（访客/内容/情绪/意图/审核/回复状态），行内展开回复区 |
| 运行与设置 | `moderation-settings`（动图，未取到） | 模型参数、回复范围、路径黑白名单、关键词、安静时段、每日上限、运行日志 |
| 评论审核 | `moderation-rules` `moderation-test` | 规则权重与阈值、测试页（显示判定 + 各项概率 + 访客看到的提示） |
| 友链审核 | `friend-application-actions` `friend-review-detail` `friend-comment-review` `friend-management` `friend-drag-sort` `friend-status-menu` `friend-unavailable` `friend-violation` | 三个子页：待处理申请 / 已收录 / 仓库设置 |
| 回链检查 | `backlink-checks` | 三列卡片，每站一个「重新检查 / 指定检查页 / 管理状态」 |

**几个值得抄的交互**（截图里能看出来的）：

1. **行内展开**而不是跳详情页 —— 评论点「回复」直接在当前行下面铺开编辑区，上下文不丢。
2. **暂存 + 批量提交** —— 顶部常驻「待提交改动 N」，弹窗逐条列出「字段：旧 → 新」并可单条撤销，最后合成一次提交。
3. **拖拽排序** —— 卡片右上角点阵把手，按住后整张卡跟随、虚线框表示落位，键盘也能操作（空格抓取 / 方向键 / 空格放下 / Esc 取消）；提示条写明「排序未暂存，和其他改动一起提交」。
4. **状态带倒计时** —— 短暂失联 30 天、违规整改 7 天，到期文案变「将于 3 日内清除」。
5. **草稿不丢** —— 回复草稿存浏览器本地，发送成功才清；AI 返回时保留用户期间手打的内容。

## 三、视觉：他的黑白 → 我们的暖色

他走「黑白 + 点阵 + 淡蓝灰输入框」。我们不能照抄配色（会和全站打架），
但**结构、圆角、留白、信息密度**全部保留。映射如下（值全部取自 `src/styles/tokens.css`）：

| 元素 | 他 | 我们 |
|---|---|---|
| 页面底色 | `#fafafa` + 淡点阵 | `--color-cream` `#fdf6f0` + 现有 `.q-grain` 柔光层（不新造纹理） |
| 卡片 | `#fff` + `1px #eee` + 圆角 10px | `#fff` + `1px --color-hairline` + 圆角 **12px**（后台比前台紧一档，不用 `--radius-card` 的 20px） |
| 主按钮 | `#111` 黑底白字 | `--color-crimson` `#c23a55` 白字（5.1:1，达标） |
| 次按钮 | 白底 + `#e5e5e5` 边 | 白底 + hairline 边 + `--color-ink` 字 |
| 输入框 | `#f1f4fb` 淡蓝、无边框 | `rgba(74,55,40,.05)` 暖灰、无边框、focus 时 1px crimson 环 |
| 标题字体 | 思源黑 | `--font-display` ZCOOL XiaoWei（**只用于页面级/区块级标题**） |
| 正文字体 | 思源黑 | `--font-body`（PingFang / Noto Sans SC） |
| 次级文字 | `#666` | `--color-muted` / `--color-subtle`（**禁止 `text-ink/NN`**，项目硬约定） |
| 绿色「已通过」 | `#e8f5e9` / `#2e7d32` | 哑光暖绿 `#e9f0e6` / `#4c6b45` |
| 金色「推荐」 | `#fff8e1` / `#b8860b` | `--color-amber` `#e8b04b`（前台友链金卡同一支） |
| 危险「违规/拒绝」 | 红 | `--color-crimson` |
| 头像「小爱」 | 粉发少女 | 爱弥斯头像（沿用首页立绘裁切） |

**状态语义表**（前台已有，后台必须一致）：

| 状态 | 文案 | 色 | 前台表现 |
|---|---|---|---|
| `normal` | 正常展示 | 暖绿 | 正常卡片 |
| `unreachable` | 短暂失联 · 30 天倒计时 | amber | 失联遮罩，不可点击 |
| `violation` | 违规整改 · 7 天倒计时 | crimson | 违规遮罩，不可点击 |
| 推荐 | 推荐友链 | amber 金 | 金卡 + 评论区身份 |

新增样式文件：`src/styles/admin.css`，在 `index.css` 里插到 **`ui` 之后、`effects` 之前**
（层级顺序即层叠，别挂到最后）。

## 四、落地形态（关键：零 nginx 改动）

现在这套是「Astro 静态 + 本地 workerd」：

```
浏览器 → nginx → /              → dist/client（静态）
               → /api/*         → 127.0.0.1:8787（workerd）→ 本地 SQLite
```

`try_files $uri $uri/index.html $uri/ =404` 已经能把 `/admin` 解析到 `/admin/index.html`，
`/api/` 也已经整体反代到 Worker。所以：

- **前端**：`src/pages/admin/index.astro`（登录页）+ `src/pages/admin/console.astro`（控制台）。
  **保持静态预渲染，不引 SSR** —— 香港机跑的是 workerd，一旦用了 `prerender=false`
  就会和 Vercel adapter 绑死，搬不过去。数据全靠客户端 fetch。
- **后端**：Worker 新增 `/admin/*` 路由，实际 URL 是 `/api/admin/*`，**nginx 一行不动**。
- **组件**：Astro 壳（管布局、字体、无闪白）+ React 岛（管表格/弹窗/拖拽）。项目已有 React 19。
- **SEO**：`/admin` 加 `<meta name="robots" content="noindex,nofollow">`，`robots.txt` 加 `Disallow: /admin`。

## 五、认证：两级 + 会话

```
① 账号 + 密码  →  ② 6 位邮箱验证码  →  ③ HttpOnly cookie 会话（30 天）
```

**为什么要两级**：站点公网可访问、`/admin` 也不藏。单密码被撞就全丢了；
二级验证码等于给后台加一个"必须拿到邮箱"的门槛，且天然带限流。

- 密码：PBKDF2-SHA256 / 150k 迭代 / 随机盐（Web Crypto，workerd 原生支持）。
- 验证码：6 位数字，5 分钟有效，**60 秒发送冷却**，最多试 5 次；
  存 `code_hash` 不存明文。发信走现成的 `qingwu-mail` 中继（QQ SMTP，500 封/天）。
- 会话：32 字节随机 → SHA-256 存库；cookie `HttpOnly; Secure; SameSite=Lax; Max-Age=30d`。
  **只在服务端校验**，前端拿不到 token 原文。
- 限流：同一 IP 15 分钟内失败 15 次 → 锁 15 分钟；每次登录尝试都记 `ip_hash`（复用 `HIT_IP_SALT`）。
- 首次初始化：不给页面注册入口。用一条 CLI/SQL 插入管理员（`scripts/create-admin.mjs`），
  密码本地哈希后写入，避免任何"初始化页面"变成后门。

**新增表**（迁移 `worker/migrations/0013_admin.sql`）：

| 表 | 字段要点 |
|---|---|
| `admin_users` | `id` / `username` (UNIQUE) / `pass_hash` / `salt` / `email` / `created_at` / `last_login_at` |
| `admin_sessions` | `token_hash` (PK) / `user_id` / `created_at` / `expires_at` / `ip_hash` / `ua` |
| `admin_codes` | `id` / `user_id` / `code_hash` / `sent_at` / `expires_at` / `tries` |
| `admin_attempts` | `ip_hash` / `ts` / `ok`（算限流用） |

## 六、数据：哪些直接读本地库，哪些要动仓库

这是整套里唯一有"架构重量"的地方，必须先讲清：

| 功能 | 数据来源 | 写入方式 |
|---|---|---|
| 评论列表 / 审核 / 回复 | D1 `comments` | 直接 UPDATE/INSERT（**已在主库**） |
| 友链申请 | D1 `applications` | 直接 UPDATE（主通道是评论区留言，见 README-hk） |
| 友链资料（名称/头像/描述/排序/推荐） | **`src/data/links.json`（仓库）** | 只能改仓库 → push → 服务器 `git pull` + build |
| 友链展示状态（失联/违规倒计时） | 建议新表 `friend_status` | 直接写 D1，前台读接口 |
| 回链检查结果 | 新表 `backlink_checks` | cron 每日写 |
| 访问统计 | D1 `hits` / `daily_stats` | 只读 |

**友链资料那条是硬骨头**：`links.json` 在 Git 里，后台要改就得走 GitHub Contents API
（拿文件 SHA 做乐观锁 → PUT → Actions/服务器拉取构建）。朝朝听雨折腾最久的就是这块。

我们有两阶段性做法：

- **P2 先做「半自动」**：后台只管审批和状态，通过后**生成一段可直接粘贴的 JSON 片段**
  并给出 `git` 命令 —— 人确认后执行。零风险，先跑起来。
- **P3 再做「全自动」**：接 GitHub PAT（细粒度，只授权该仓库 contents:write），
  实现 SHA 乐观锁 + 提交 + 触发构建。**这一步要单独评估**，因为它让后台获得了改仓库的能力。

## 七、分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | 迁移 0013、`/admin` 登录页 + 控制台壳、两级认证、会话、限流、登出 | 能从登录走到空控制台，错的验证码进不去 |
| **P1** | 评论收件箱：列表 / 筛选 / 搜索 / 分页 / 行内展开 / 回复 / 改审核状态 / 草稿本地保存 | 能把一条 pending 变成 visible 并回复 |
| **P2** | 友链审核：申请列表（三卡一行）/ 详情（原始留言 + 回链证据 + 资料校对）/ 通过或拒绝 / 已收录列表 / 状态与推荐开关 / 拖拽排序 / 暂存批量提交（写 D1 那部分） | 审批闭环，前台立刻可见 |
| **P3** | 回链检查：cron 每日轮检 + 卡片网格 + 手动指定页面 / 重新检查 | 能看出谁把友链下了 |
| **P4** | AI 辅助：审核打分、回复起草 —— 需要外部模型 API key，单独定 | 可关可开 |

P0+P1 是最小可用后台（能审评论了，这是当前最大痛点：只能裸 SQL）。

## 八、要先定的三件事

1. **AI 要不要**：他背后接的是 Jev 模型。我们没有模型通道，要做得先定用哪家、
   key 放哪（Worker secret）。建议 P0~P3 都不依赖 AI，先跑通人工流程。
2. **友链是否允许后台直接改仓库**：决定 P2 走「半自动出片段」还是直接上 P3「全自动提交」。
3. **管理员用什么邮箱收码**：中继是 QQ SMTP，收件人可以是任意邮箱（发件人才受限）。

---

## 附：与现有项目的冲突检查

- ✅ 不改 nginx（`/admin` 走 `try_files`，`/api/admin/*` 走现成反代）
- ✅ 不引 SSR（与香港机 workerd 部署方式兼容，也不影响 Vercel）
- ✅ 不碰主题色（新增 `admin.css`，只消费 tokens，不新增变量）
- ⚠️ 需过 `scripts/check-tokens.mjs`：后台里禁止出现裸 hex，除上面明确列出的三个新色
  （暖绿 `#e9f0e6` / `#4c6b45`、暖灰底 `rgba(74,55,40,.05)`）——若检查器拦，就把它们提进 tokens.css。
- ⚠️ `/admin` 是静态页，**任何人可访问登录框**。真正的门在接口鉴权；页面本身不泄露任何数据。

---

## 九、落地情况（2026-11-10 收盘）

| 阶段 | 状态 | 落在哪 |
|---|---|---|
| P0 登录 + 控制台壳 | ✅ 已上线 | `/admin`、`admin/auth.ts`、`0013_admin.sql` |
| P1 评论收件箱 | ✅ 已上线 | `/admin/console`、`admin/comments.ts` |
| P2 友链审核 | ✅ 已上线 | `/admin/friends`、`admin/friends.ts`、`0014_friends.sql` |
| P3 回链检查 | ✅ 已上线 | 同上 + cron 每日轮检 |
| P4 AI 辅助 | ⬜ 未做 | 缺模型通道，还没定用哪家 |

### 实际做出来的和这份方案的三处偏差

1. **「半自动 → 全自动」没有分两期，代码里两条路并存。**
   有 `GITHUB_TOKEN` 就直写仓库；没有就降级返回成品 JSON 让管理员粘贴。
   **目前 PAT 还没配，所以线上跑的是半自动那条。**
   这比原计划好：不用等 PAT 到位才能用，配了自动切换。

2. **「暂存批量提交」按原样做了，但只覆盖 links.json 那部分。**
   申请审批仍是即时的（写 D1 立刻生效）。两者在界面上刻意分开：
   申请卡的按钮是实心 primary，已收录的行内按钮全是 ghost，
   只有顶部 savebar 的「提交到仓库」是实心。
   —— 混用实心按钮会让站长以为自己已经改完了。

3. **多做了「自动部署」，方案里没写。**
   不做的话 P2 的验收标准「前台立刻可见」根本达不到 ——
   后台提交完还得人工登服务器 pull + build。
   `scripts/auto-deploy.sh` + `qingwu-deploy.timer`（2 分钟一轮，flock 防并发）。

### 回链检查的实测口径（下次别重新发明）

- 规则极宽：页面里出现 `qingwu.ink` 就算，不带协议头也算。
- 首页没命中就看候选页：先取首页 href 里的友链链接，再补
  `/links/ /friends/ /link/` 三个常见路径，最多 3 页。https 失败回落 http。
- **必须流式读**：rainzt.cn 首页 983KB，先截断到 400KB 再搜索必然漏判。
- 已知局限：SPA 站点的回链在前端渲染后才出现，raw HTML 抓不到 ——
  这类站点会被判成「无回链」，需要人工看一眼。
- 2026-11-10 全量跑 14 个友链：**7 有 / 7 无**，无的逐个核过，是真没给。

### 还没做的

- **P4 AI 辅助**：需要选模型、定 key 放哪（Worker secret）。
  按方案第八节的原则，前三个阶段都不依赖 AI，现在就处在「全人工也跑得通」的状态。
- **friend_status 前台接入**：表建好了、后台能改，但前台还没读
  `/link-status` 接口 —— 也就是说「失联 30 天倒计时」目前只在后台可见。
- **Vercel 项目的 git 自动部署还没断**（需在 Vercel 后台操作）。
