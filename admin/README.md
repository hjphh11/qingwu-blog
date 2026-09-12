# 清吾后台（`admin/`）

> 后台管理系统 —— 手机/电脑都能用的内容后台。
> 完整方案见 `docs/后台管理方案.md`；**当前进度见 `docs/HANDOFF.md`**。

## 现在做到哪了

**阶段 D + E：骨架 + 登录 + 数据总览 + 文章管理**

- ✅ 服务端：Express（只监听 `127.0.0.1`）+ 单用户密码登录（argon2 哈希 + 签名会话 cookie + 登录限速）
- ✅ 前端：React + Vite 单页应用（暖色玻璃拟态，与博客前台同一套 tokens 与图标）
- ✅ 数据总览：文章统计 / 各数据文件健康度（**写坏了会直接告诉你哪个文件、哪个字段**）/ 分类分布 / 最近文章 / 原始 JSON 预览
- ✅ **文章管理（阶段 E）**：列表（搜索 / 分类筛选 / 状态筛选 / 排序 / 每页 20 条分页）· 新建 · 编辑 · slug 拼音自动生成 · 摘要自动截取 · 草稿 · 置顶（含置顶区上下移动排序）· Markdown 工具栏 + 实时预览 · 标签自动补全 · **软删除到回收站**（可恢复/彻底清除）
- ⚠️ **写范围受限**：只写 `src/content/blog/*.md`；删除进 `.admin-trash/`（已 gitignore）
- ⚠️ **「保存」≠「上线」**：保存只是写进仓库文件；真正发布（git push + Vercel Deploy Hook）是**阶段 I**，现在列表上会显示「N 个文件待发布」
- ⬜ 还没做：分类管理（阶段 F）、友链/分享/关于（G）、音乐（H）、发布与回滚（I）、申请审批（J）、统计（M）

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

`.env` 已被 `.gitignore` 忽略（`.env` 规则），**不要提交**。

## 结构

```
admin/
├─ server/                 # Express API（Node 直接跑，无构建步骤）
│  ├─ index.js             # 入口：中间件 + 路由 + 单端口托管前端
│  ├─ config.js            # 环境变量读取 + 启动自检
│  ├─ auth.js              # argon2 校验 / 签名会话 cookie / 登录限速 / requireAuth
│  ├─ data.js              # 读博客仓库数据（白名单 + zod 校验 + frontmatter 解析）
│  └─ routes/              # auth.js（登录登出）、data.js（只读数据接口）
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

## 部署（阶段 D 的后半段，尚未执行）

按 `docs/后台管理方案.md` 第十节：装 Node 20 + git → clone 仓库到 `/opt/qingwu/repo` → 装并登录 Tailscale → 配 `/opt/qingwu/.env`（600 权限）→ `npm install && npm run build` → systemd 常驻 → `tailscale serve --bg https / http://127.0.0.1:3000`。

> 访问方式：`https://<服务器名>.<tailnet>.ts.net`（手机/电脑都要装 Tailscale 并登录同一账号）。
