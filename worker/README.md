# worker/ —— 清吾的动态运行时（Cloudflare Workers + D1）

> 方案：`docs/后台迁移-Cloudflare方案.md`。
> **当前只做到第 1 步：访问统计（`POST /hit` + `GET /stats`）。**
> 友链申请（第 2 步）、后台 API（第 3 步）、定时发布（第 4 步）、评论/点赞（第 5 步）都在后面，
> `migrations/0001_init.sql` 里的对应表已经建好，但**现在没有任何路由会写它们**。

## 它替换掉了什么

```
迁移前：访客 → Vercel /api/hit → Upstash Redis → GitHub Action（每 6h）→ 私有仓库 stats.json → 后台读文件
迁移后：访客 → Vercel /api/hit（薄转发）→ 本 Worker → D1
        后台 ─────────────────────────→ GET /stats ────────────┘
```

- 访客上报仍然是**同源** `/api/hit`（前端一行都没改），由那个 Vercel 函数转发过来，所以没有 CORS 问题。
- 后台只读一个 HTTP 接口，**不再需要 GitHub token 读统计文件**，也不再等 6 小时。

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/hit` | 访客上报，写 D1。**永远回 200**（`{ok, reason?, mode?, counted?}`）。 |
| GET | `/hit` | 能力探测，回 `{enabled}`（与旧 `/api/hit` 同形）。 |
| GET | `/stats` | 后台读取统计。需要 `Authorization: Bearer <ADMIN_STATS_TOKEN>`（若配了口令）。 |
| GET | `/health` | 健康检查，回 `{ok, service, time}`。 |

## 手工步骤（按顺序，一次做完）

### 1. 装依赖

```bash
cd worker
npm install
```

### 2. 建 D1 数据库

```bash
npx wrangler login          # 浏览器里授权一次
npx wrangler d1 create qingwu
```

命令会打印一段 `database_id = "xxxx-xxxx-..."`，**把它填到 `wrangler.toml` 里**
（替换 `REPLACE_WITH_D1_DATABASE_ID`）。把 `database_name` 改成别的也行，但要和
`package.json` 里 `wrangler d1 migrations apply qingwu` 的那个名字一致。

### 3. 跑 migration 建表

```bash
# 线上
npm run migrate             # = wrangler d1 migrations apply qingwu --remote
# 本地（wrangler dev 用的那份 SQLite）
npm run migrate:local
```

建 `hits` / `daily_stats`（第 1 步用）+ `applications` / `comments` / `likes` / `audit`（后续步骤用）。

### 4. 设 secret

```bash
# ① 访客匿名化用的盐（必填；没配就只探测不采集）
#    新值随便一串长随机字符：openssl rand -hex 32
npx wrangler secret put HIT_IP_SALT

# ② 后台读 /stats 的口令（强烈建议配；这个值要同时填到后台的 ADMIN_STATS_TOKEN）
#    同样用 openssl rand -hex 32 生成
npx wrangler secret put ADMIN_STATS_TOKEN
```

> ⚠️ 如果不配 `ADMIN_STATS_TOKEN`，`/stats` 就是**谁都能读**（里面有你的页面路径/来源/地区）。
> 建议一定配上；本地开发用 `worker/.dev.vars`（已 gitignore）：
>
> ```ini
> HIT_IP_SALT="dev-salt"
> ADMIN_STATS_TOKEN="dev-token"
> ```

### 5. 本地自测（`wrangler dev --local`，不碰线上）

```bash
npm run dev            # = wrangler dev --local，默认 http://127.0.0.1:8787
```

另开一个终端：

```bash
# 健康检查
curl http://127.0.0.1:8787/health

# 打一个点（模拟访客上报；path/referrer 与前端发的一模一样）
curl -X POST http://127.0.0.1:8787/hit ^
  -H "content-type: application/json" ^
  -H "user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" ^
  -d "{\"path\":\"/blog/hello\",\"referrer\":\"https://www.google.com/search?q=x\"}"

# 读统计（带口令）
curl http://127.0.0.1:8787/stats -H "authorization: Bearer dev-token"
```

应该看到：第一次 `{"ok":true,...}`，紧接着再打同样的点会回 `{"ok":false,"reason":"seen"}`
（30 分钟去重，和旧逻辑一致）。`/stats` 里应该出现 `days:[{d:"<今天>",pv:1,uv:1}, ...]`。

顺手确认一下本地库里的行：

```bash
npx wrangler d1 execute qingwu --local --command "SELECT * FROM hits ORDER BY id DESC LIMIT 5"
```

### 6. 导历史数据（把旧的 stats.json 灌进来）

`stats.json` 在私有仓库 `hjphh11/qingwu-link-applications`（后台里那个文件）。
把它下载到本地，然后：

```bash
cd worker
node scripts/import-stats.mjs --in ../stats.json --out migration.sql
# 自检输出里 ensure 各维度「还原后合计 == 旧文件合计」
npx wrangler d1 execute qingwu --remote --file=./migration.sql
```

数字为什么一致、以及为什么用 `daily_stats` 而不是硬造 `hits` 行，见脚本头部注释。
可重跑（整表覆盖），回滚就是 `DELETE FROM daily_stats;`。

### 7. 部署

```bash
npm run dry-run        # 先本地打包一次（不需要账号，验证代码能过）
npm run deploy         # = wrangler deploy
```

### 8. 绑自定义域 `api.qingwu.ink`

Cloudflare 控制台 → Workers & Pages → `qingwu-api` → **Settings → Domains & Routes → Add → Custom Domain**
→ 填 `api.qingwu.ink`（域名已经托管在 Cloudflare 的话会自动加好 DNS 与证书）。

或者在 `wrangler.toml` 里加：

```toml
routes = [
  { pattern = "api.qingwu.ink", custom_domain = true }
]
```

> 大陆访问提示：Cloudflare 没有大陆节点，`api.qingwu.ink` 从国内访问会绕一圈。
> 访客上报是「发了就不用管」（`sendBeacon` / `keepalive`），慢一点无感；
> 后台读统计稍微慢一点，可以用 `ADMIN_STATS_CACHE_MS` 挡住。**上线前建议实测一轮。**

### 9. 切换站点与后台（这一步才算真正迁移）

1. **Vercel** 环境变量加 `HIT_WORKER_URL=https://api.qingwu.ink` → 重新部署。
   之后 `/api/hit` 就转发给 Worker 了（转发失败会自动退回 Upstash，不丢数据）。
2. **后台** `.env`（服务器上是 `/opt/qingwu/.env`）加：

   ```ini
   ADMIN_STATS_ENDPOINT=https://api.qingwu.ink/stats
   ADMIN_STATS_TOKEN=<与 Worker 上那个 secret 同一个值>
   ```

   配完之后后台就不再读 GitHub 上的 stats.json 了（`ADMIN_APPLY_TOKEN` 只剩友链申请在用）。
3. 观察几天，确认统计页数字正常后，再删掉 `.github/workflows/stats.yml`
   和 Vercel 上的 `UPSTASH_REDIS_REST_*`（**限流还要用它们，别删** —— 只删 Action 的 secrets）。

**回退**：把 Vercel 的 `HIT_WORKER_URL` 和后台的 `ADMIN_STATS_ENDPOINT` 删掉即可，
两边立刻回到迁移前的行为；D1 里的数据留着不影响任何东西。

## 目录说明

```
worker/
├── wrangler.toml            # Worker 配置：D1 绑定 + vars（R2/Cron 以注释占位）
├── package.json             # dev / deploy / migrate / import-stats
├── tsconfig.json            # 只做类型检查，构建由 wrangler 自己打包
├── migrations/
│   └── 0001_init.sql        # 建表（第 1 步只用 hits / daily_stats）
├── scripts/
│   └── import-stats.mjs     # 旧 stats.json → daily_stats 的 SQL
└── src/
    ├── index.ts             # 极小路由
    ├── hit.ts               # POST /hit（去重 + 限流 + 写 D1）
    ├── stats.ts             # GET /stats（D1 聚合，形状与后台旧代码一致）
    ├── util.ts              # 与站点旧 src/lib/stats.ts 逐字对齐的口径（切天/规范化/设备/哈希）
    └── types.ts             # Env 等类型
```

## 与旧口径的一致性（重要）

| 口径 | 旧实现 | 这里 |
|---|---|---|
| 切天 | `src/lib/stats.ts` `dayKey()`：UTC+8 | `util.ts` `dayKey()`：同样 UTC+8（**Asia/Shanghai**） |
| 路径 | `normPath()`，异常归 `/(other)` | 同 |
| 来源 | `refHost()`，只留主机名，空 = `(direct)` | 同 |
| 设备 | `deviceOf()`：desktop/mobile/tablet | 同 |
| 爬虫 | `isBot()` 正则 | 同一份正则（多了一刀 Cloudflare bot score，拿不到就跳过） |
| 去重 | 同一访客同一页 30 分钟一次 | 同（`DEDUPE_SECONDS = 1800`） |
| 访客标识 | HMAC-SHA256(IP\|UA, 盐) 前 12 位 | SHA-256(盐\|IP\|UA) 前 12 位，同样不存明文 IP |
| UV | 每日 HLL 估基数 | 每日 `COUNT(DISTINCT visitor)`（**精确值**，不是估算） |

## 已知取舍 / 不确定的地方

1. **限流粒度**：现在做的是「同一访客 60 秒内最多记一次 + 同页 30 分钟去重」，都靠 D1 查询。
   够挡「一个人狂刷」，但挡不住分布式刷量（换 IP 就绕过了）。真要硬防得上 Turnstile 或
   Cloudflare Rate Limiting 规则 —— 个人站先不上，需要时再加。
2. **`hits` 明细保留 400 天**，期间靠 `DELETE` 清理（约 1/500 的请求顺手跑一次）。
   量更大时应改成「按天聚合后删明细」。
3. **历史各维度分布是按当天 PV 占比摊出来的**（旧文件只有全站累计值）。
   总量、榜单累计值 100% 一致；只有「某一天的页面榜」是推出来的，不影响任何页面上的数字。
4. **`/stats` 的 `repo`/`path`** 字段是给后台页面显示数据来源用的（回显 `cloudflare-d1` / `hits`），
   不再是 GitHub 仓库路径 —— 形状没变，只是文案变了。
5. 后台统计页顶部仍写着「每 6 小时汇总一次」（那是 `admin/web/src/pages/Stats.jsx` 里的固定文案）。
   **第 1 步按要求没有动前端**，这行字以后可以顺手改成「实时」。
