# 更新日志

按时间倒序。这里只记「访客/站长能感知的变化」和「以后一定会再踩的坑」，
逐文件流水见 `git log`；部署与运维细节见 `.deploy/README-hk.md`（不进仓库）。

---

## 2026-11-10 · 自建上线后的第一轮修缮

站点已经跑在自建的香港机上（`https://qingwu.ink`：nginx 静态 + 本地 Worker + SQLite），
这一轮修的三件事都是「迁到自建之后才暴露出来」的 —— 在 Cloudflare 上根本不会发生。

### 1. 发信失败不再静默丢失（`worker/src/mail.ts`、`migrations/0012_mail_outbox.sql`）

原来失败只有一行 `console.warn`，而那台机器的日志平时没人看。触发点只有
「有人给友链评论区留言」和「有人回复你的留言」—— 一旦撞上 QQ 的频率限制或授权码失效，
信就直接没了，而这恰恰是唯一必须送达的两类通知。

现在是三段式：

- **同一次请求内最多试 3 次**（0.8s / 2.4s 退避），覆盖网络抖动与上游 5xx；
- 仍失败 → 落 D1 的 `mail_outbox`（新表），24 小时内等机会补发；
- 补发机会 = 每天 cron + 有人留言/回复时（机会式），试满 6 次或超过 24 小时就丢弃
  —— 一周前的「有人给你留言了」发出去只会莫名其妙。

⚠️ **哪些错该重试是分过的，别改成「一律重试」**：QQ 对超频的惩罚是递进的
（分钟级封 → 小时级封 → 当日禁发），已经报错还连着重试只会把封禁越拖越长。
所以 `smtp_authfailed`、收件人被拒这类永久错当场放弃；auth 类只入队不重试
（等授权码修好再补发）。中继把 SMTP 异常统一映射成 502 + `{"error":"smtp_xxx"}`，
所以「响应里有没有 `error` 字段」就是区分永久/瞬时的关键。

线上 CF 的 D1 没跑 `0012` 时，入队与补发都被 `try/catch` 包着 → 行为退化成「只记日志」，
不会反过来影响留言。

### 2. 打点兜底地址改成同源（`src/layouts/Layout.astro`）

内联脚本里 `HIT_ENDPOINT` 的兜底值还是 `https://api.qingwu.ink/hit`。这个 meta 一定存在，
理论上永远触发不到；但万一哪天模板改坏了，自建版会把数据打到线上 Worker，
而落到同源的 `/api/hit` 最多是打不出去 —— 错得更安全。

### 3. 「国家分布」不再是清一色 HK（`worker/src/hit.ts` + 服务器侧 nginx）

本地 workerd 的 `request.cf.country` 恒等于这台机器的**出口地**（香港），
而不是访客所在地，所以后台的国家分布只有 HK 一项。

修法是把这个值挪到真正知道答案的地方：nginx 装 `libnginx-mod-http-geoip2`，
用 **DB-IP Lite**（CC BY 4.0，免费可商用）的 `.mmdb` 查 IP，经
`proxy_set_header X-Q-Country` 交给 Worker；Worker 侧**优先读这个头**，
没有才回落到 `cf.country`（所以线上 Cloudflare 的行为一字不变）。

> ⚠️ 别用 Debian 的 `geoip-database` 包：它的数据停在 2019 年（MaxMind 换许可证后就冻结了），
> 近几年的新分配段全解析不出来。库文件由 `/usr/local/bin/update-geoip.sh` 每月刷新。

### 同日早些时候（服务器侧，不在本仓库）

- 全站迁到香港机：nginx + `wrangler dev --local` 跑 Worker + 本地 SQLite，Vercel 未动；
- 自建发信中继（出站 25 被丢包、无 PTR，直投不可行）；
- HTTPS 上线：Let's Encrypt 通配 apex+www、http2、HSTS 30 天、裸 IP 与 http 一律 301；
- 修掉一个致命隐蔽 bug：`wrangler dev` 会改写 Host、并把同源 Origin 降级成 `http://`，
  导致来源校验全判非法、**打点静默归零**（页面完全正常，跨源测试也发现不了）。
  修法：注释掉 `wrangler.toml` 的 `routes` + `originAllowed()` 按 host 兜底比较。
