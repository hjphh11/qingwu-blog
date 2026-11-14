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

> **状态：已完成（2026-10-31）**。旧链路（Vercel 函数 → Upstash → GitHub Action 汇总 →
> 私有仓库 stats.json）已经整条删除，`.github/workflows/stats.yml` 与
> `scripts/stats-collect.mjs` 与 `src/lib/stats.ts` 都不在了。下面保留原始步骤供追溯。

1. **Vercel** 环境变量加 `HIT_WORKER_URL=https://api.qingwu.ink` → 重新部署。
   之后 `/api/hit` 就转发给 Worker 了。
   ⚠️ **现在没有 Upstash 兜底了**：Worker 不可达就是少记一次访问（只留服务端日志）。
   这是刻意取舍 —— 留着一条常年不产数据的「备用线」只会让人误以为有兜底。
2. **后台** `.env`（服务器上是 `/opt/qingwu/.env`）加：

   ```ini
   ADMIN_STATS_ENDPOINT=https://api.qingwu.ink/stats
   ADMIN_STATS_TOKEN=<与 Worker 上那个 secret 同一个值>
   ```

   `ADMIN_STATS_ENDPOINT` 现在是**线上必填**：不配的话统计页会直接告诉你「还没配数据源」，
   不会再静默退回读那份过期的 `stats.json`（那个回退分支已删）。
3. ~~观察几天，确认数字正常后删掉 `stats.yml` 和 Vercel 上的 `UPSTASH_REDIS_REST_*`~~
   → 已完成。**注意：Vercel 上的 `UPSTASH_REDIS_REST_*` 不能删** —— 友链申请的限流
   （`src/lib/rateLimit.ts`）还在用它，和统计共用同一个库、不同 key 前缀
   （限流 `qw:rl:*` / `qw:mail:*`，统计 `qw:*` 已废弃）。只删 GitHub Actions 的 secrets。

**回退**：旧路已经拆除，不存在「改回 Vercel 函数」这条路了。真要回退，得从
`git log` 里找回 `chore/retire-legacy-hit` 之前的版本。日常无需回退 —— D1 的数据是即时写入的。

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
    ├── util.ts              # 口径（切天/规范化/设备/哈希）—— 与站点旧 src/lib/stats.ts 对齐，该文件已删
    └── types.ts             # Env 等类型
```

## 与旧口径的一致性（重要）

> 下表「旧实现」列的 `src/lib/stats.ts` 已于 2026-10-31 随旧链路删除，
> 保留这张表是为了追溯口径来源与迁移时做过的等价性核对。

| 口径 | 旧实现（已删除） | 这里 |
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

---

## 2026-11-14 安全加固（改了什么、上线要注意什么）

审计报告：`audit/安全评估-2026-11-14.md`。这里只记**运维视角**必须知道的变更。

### 新增环境变量

| 变量 | 放哪 | 作用 | 不配会怎样 |
|---|---|---|---|
| `ENVIRONMENT` | 只在本地 `.dev.vars` 写 `"dev"`；**生产不写** | dev 旁路（`AUTH_DEV_CODE`、`ADMIN_DEV_LOGIN`）的唯一前提 | 生产不配 → dev 门户自然关闭（这是期望行为）；本地不写 → 验证码/直登在本地也不可用 |
| `OTP_PEPPER` | 生产与本地都可配（`wrangler secret put OTP_PEPPER`） | 验证码改存 `HMAC-SHA256(pepper, purpose\|email\|code)`，库被读走也推不回 6 位码 | 退回旧口径（盐与哈希同表，可穷举）；老码仍可验证，只是不强 |

> 生产机 `worker/.dev.vars` 里**不要**出现 `ENVIRONMENT`、`AUTH_DEV_CODE`、`ADMIN_DEV_LOGIN`、`DEV_SKIP_TURNSTILE`。
> 复核：`ssh … 'grep -E "ENVIRONMENT|AUTH_DEV_CODE|ADMIN_DEV_LOGIN|DEV_SKIP" /data/qingwu/worker/.dev.vars'` 应当无输出。

### 行为变更（会被人发现的那种）

1. **`server_tokens off`**：`/api/health` 不再回 `service` 字段，nginx `Server` 头也不再带版本。
2. **`/stats` 变成 fail-closed**：`ADMIN_STATS_TOKEN` 没配时返回 503，不再「无口令全开放」。
   后台统计页若突然 503，先看这个变量。
3. **`/link-click` 只认白名单**：`links-refresh.ts` 的 `SEED_HOSTS` 之外的主机一律不计数。
   **加新友链时必须同步这份数组**，否则新站的点击不会进榜（也不会再被抓取）。
4. **回复通知只发给「登录账号」**：匿名留言填的邮箱不再作为收件人（防被当作发信通道滥用）。
5. **会话绑设备**：后台会话换 UA 即失效；前台会话按 UA 前 60 字符比对，换浏览器/设备要重新登录。
6. **CSP 转强制**：若某个内联脚本被挡，`deploy/nginx/qingwu.conf` 里把那行换回
   `Content-Security-Policy-Report-Only` 并删掉 `Report-To`，reload 即回观察模式。
   违规会 POST 到 `/api/csp-report`，只写日志不落库。
7. **`CF-Connecting-IP` 被 nginx 清空**：Worker 侧只认 `x-real-ip`。
   自己写脚本调 `/api/hit` 时**别再指望用这个头伪造 IP**（以前能，现在不行）。

### 数据库清理（审计期间留下的测试行）

```sql
-- 打点测试行（路径都是审计用的占位）
DELETE FROM hits WHERE path IN ('/probe-test','/rl-test','/fuzz-a2','/inflation-demo','/origin-test','/xff-dedupe-test','/c2','/c3','/d1','/d2','/d4','/t3','/t4') OR path LIKE '/o%';
-- SSRF 演示行（link-click 注入的域名）
DELETE FROM link_clicks WHERE url LIKE '%qingwu-audit.test%';
-- 验证码测试（.invalid 域名，未发出）
DELETE FROM auth_codes WHERE email LIKE '%qingwu-audit.invalid';
```
