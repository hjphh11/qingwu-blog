---
title: "把后端从边缘搬回一台小机器"
description: "这个站的后端原本跑在 Cloudflare 的 Worker 上，用 D1 存数据。现在它跑在香港一台 2 核 2G 的机器里，用 workerd 和 SQLite。这篇记搬家的原因、四个真正的坑，以及「自己的机器」到底换来了什么、要付什么代价。"
cover: https://img.qingwu.ink/site/covers/home-backend-f9d933869ace.webp
guide: "清吾把后端搬进了香港的一台小机器。现在能亲手翻日志、看数据库了，备份和半夜排障也得自己来啦。"
pubDate: 2026-11-24
category: tech
tags: ["后端", "Cloudflare", "SQLite", "运维", "架构"]
---

一个博客为什么需要后端？

如果只是发文章，确实不需要 —— 静态文件扔给 nginx 就完了。但后来陆续要加这些：访问统计（不依赖第三方）、友链申请、留言板和文章评论、邮箱验证码登录、后台审核、友链失联检测、AI 自动回复。

这些都要写数据、要鉴权、要定时任务。静态站做不到。

于是有了一个很小的后端。它的特别之处不是功能，是**它跑在哪** —— 一开始在 Cloudflare 的边缘，现在在香港一台 2 核 2G 的机器里。

## 第一版：Worker + D1

选 Cloudflare 的理由很实际：

- **不用服务器**。没有进程要守、没有证书要续、没有磁盘要清。
- **免费额度够用**。一个个人站的写入量，离免费额度差着好几个数量级。
- **D1 是 SQL**。不是 KV、不是对象存储，是能 `JOIN` 的真数据库。这一点在后来做统计和评论时省了很多事。

代码形态也简单：一个 `fetch` 入口加一个极简路由。

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/hit') return request.method === 'POST' ? postHit(request, env, ctx) : getHit(env);
    if (path === '/apply') return postApply(request, env);
    if (path.startsWith('/admin/')) return handleAdmin(request, env, path);
    // …
  },
};
```

写了 25 个迁移，一路加到现在：统计、申请、友链点击、评论、账户、AI。这套东西在 Worker 上跑得挺好。

## 为什么又搬回来

有两个原因，第二个比第一个重要。

**一是访问问题。** `workers.dev` 在大陆实测 TCP 443 超时。这不是「慢」，是连不上。给 Worker 绑自己域名能绕开，但那是把「一个不受控的中转」换成「另一个依赖」。

**二是可控性。** 这在平时看不出来，出事的时候致命。

后端在别人边缘上的时候，我能看到的东西只有：接口返回了什么。看不到进程、看不到日志文件、看不到数据库文件、看不到连接数。有一次统计数字对不上，我花了很久才排除「代码问题」这个方向 —— 因为我没法直接看一眼库里到底有没有那行数据。

自己机器上的后端，出问题第一步就是 `ssh` 上去 `tail -f`。这个差别，比任何性能指标都值钱。

## 现在的样子

<figure>
  <img src="/images/blog/backend-topology.svg" width="820" height="330" alt="请求路径示意图：浏览器经 nginx 分流，静态页面直接读 dist/client，/api 反代到本机 8787 端口上的 workerd，数据落在 SQLite 文件" loading="lazy" />
  <figcaption>现在的请求路径：静态页面由 nginx 直接吐出，只有 <code>/api/</code> 才进 Worker。虚线是仓库推送后自动拉取构建的那条路。</figcaption>
</figure>

搬回来之后，形态变成这样：

- **静态站在 nginx 里**，`try_files` 直接吐 `dist/client` 的文件，不过任何后端。
- **接口在 nginx 后面**，`location /api/` 反代到 `127.0.0.1:8787`，去掉 `/api` 前缀转发给 Worker。

```nginx
location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://127.0.0.1:8787/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header CF-Connecting-IP "";
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- **Worker 进程由 systemd 守着**：

```ini
ExecStart=/usr/local/bin/node wrangler.js dev --port 8787 --ip 127.0.0.1 --local
Restart=always
RestartSec=5
```

用 `wrangler dev --local` 跑是本方案的关键。它启动的是 workerd —— Cloudflare 自己的运行时，跑在本机，完全离线，不需要 Cloudflare 账号。

**而 D1 在本地就是一个 SQLite 文件。**

这一点值得单独说。D1 的 API 是 `env.DB.prepare(...).bind(...).first()`，本地实现（miniflare）把它映射到一个真的 SQLite 数据库上。所以代码一行没改，但数据从「云上的托管服务」变成了「磁盘上一个能直接打开的文件」。

想看数据，`sqlite3` 打开就行；想备份，`tar` 一下就行。

## 坑一：加了 routes，所有统计静默归零

这是最阴的一个。

Worker 在 Cloudflare 上时绑了自定义域名，所以 `wrangler.toml` 里有这段：

```toml
routes = [
  { pattern = "api.qingwu.ink", custom_domain = true }
]
```

搬回自己机器、用 `wrangler dev` 跑起来之后，问题出现了：**所有打点都归零，但也没有任何报错。**

原因是 `wrangler dev` 会按这条 route 改写请求的 Host。nginx 传进去的 `Host: qingwu.ink`，到达 Worker 时变成了 `api.qingwu.ink`。而同源请求的 `Origin` 也跟着被改写成了 `http://api.qingwu.ink`。

于是来源校验把每个请求都判成非法 —— 代码里那段 `originAllowed()` 忠实地执行了它的职责，返回 403。前端把失败的埋点请求吞掉了，页面上什么都看不出来。

修法是把整段 `routes` 注释掉，只在需要重新 `wrangler deploy` 到 Cloudflare 时恢复。注释里留了一行警告，因为**下次有人「顺手补上」这段配置，站点会再次静默失去全部统计**。

这个坑的教训不是「小心 routes」，是：**当一处配置同时服务两种部署形态时，它一定会背叛其中一种。**

## 坑二：`CF-Connecting-IP` 是客户端自己填的

Worker 上取客户端 IP 有个惯例：读 `CF-Connecting-IP`。

搬到自己的机器上之后，这个头变成了**纯粹的请求头** —— 谁都能填。它不再是 Cloudflare 盖的戳，而是客户端自己写的一张纸条。

而代码里还留着优先读它的逻辑。等于说：任何一个人发一个带 `CF-Connecting-IP: 1.2.3.4` 的请求，就能让去重、限流、后台失败锁定全部失效 —— 因为这些功能都以「这个 IP 是谁」为前提。

修法是在 nginx 层把它清空：

```nginx
proxy_set_header CF-Connecting-IP "";
proxy_set_header X-Real-IP $remote_addr;
```

并且 Worker 只信 `x-real-ip`。

这条很容易被漏掉，因为它不造成任何可见的错误 —— 只是**安全边界悄悄消失了**。

## 坑三：邮件根本发不出去

访客留言要通知我、登录要发验证码，都依赖发信。

在 Worker 上，发信就是一次 HTTPS 请求打给 Resend，两行代码。搬到自己的机器上之后，这条路还在，但另外冒出来一个需求：**能不能不依赖第三方**。

试了直连 SMTP。结果发现本机出站 25 端口被服务商丢包 —— 不是拒绝，是丢。连接超时，没有任何错误码告诉你「这里被墙了」。

于是有了一个本机中继进程：`qingwu-mail.service`，把信交给上游 SMTP 的 587 端口代投。Worker 侧的代码不用改，只要把 `MAIL_ENDPOINT` 指向它就行 —— 协议和 Resend 的 `/emails` 同构。

同时补了一套待发队列，因为「发信失败就丢」在评论通知这种场景下不可接受：

- 同一次请求内最多重试 3 次（0.8s / 2.4s 退避）
- 仍失败 → 落 `mail_outbox` 表，等下次机会补发
- 补发机会 = 每天 cron + 有人留言时
- **超过 24 小时未发出直接丢弃** —— 一周前的「有人给你留言了」发出去只会莫名其妙

还有一条不能动的纪律：**永久错误不走重试**。QQ 邮箱对超频的惩罚是递进的（分钟级封 → 小时级封 → 当日禁发），已经报错还连着重试，只会把封禁时间越拖越长。所以 `smtp_authfailed`、收件人被拒这类错误当场放弃。

## 坑四：限流把运维自己封了

nginx 层有一组 `limit_req` zone，配 fail2ban 看日志封 IP。这套东西保护站点，也保护过一次我自己。

但 11-18 出过一次事故：后台一页要并发五六个接口，全被 12 次/分钟的 `admin_login` 档挡住，连撞 429 → fail2ban 记满 5 条 → **整站 80/443 被 DROP 两小时**，而 ping 和 SSH 都正常。

表现是「全站打不开、前端提示网络异常」，特别像机器宕了。那次之后改了两件事：

- 登录档只留给**登录接口**（精确匹配 `= /api/admin/login`），后台页面换 120 次/分钟的宽松档
- fail2ban 的 `bantime` 从 2 小时降到 20 分钟、`maxretry` 从 5 提到 10

结论很朴素：**限流是按「正常访客的行为」估算的，而运维自己的行为从来不像正常访客。**

## 剩下的边界

搬回来之后，有几条边界是刻意划死的：

**口令按泄露后果分开。** 统计口令泄漏，最多暴露访问量；申请口令泄漏，会暴露访客邮箱。所以 `ADMIN_STATS_TOKEN` 和 `ADMIN_APPLY_TOKEN` 是两个独立的值，分开配、分开轮换，不为了省事合并成一个。

**调试开关要有第二道门。** 以前有个 `DEV_SKIP_TURNSTILE`，设成 1 就跳过人机验证的网络校验 —— 因为 workerd 在本地访问不到 `challenges.cloudflare.com`。本来靠「线上不要配」这个口头约定。后来审计发现，生产机的 `.dev.vars` 里真的留着这个变量（只是因为没配 secret、入口一直是 503，才没造成后果）。

现在除了这个变量，还要求 `ENVIRONMENT === 'dev'` 才生效。**「记得别在生产开」不是安全措施，环境门才是。**

**邮箱原文永不出网。** `/auth/me` 只回打码后的 `145****@qq.com`，日志只记结果类别、永不写地址。

**归档实例只读。** 环境变量 `READONLY=1` 时，所有写接口一律返回 410。这是给「已经迁走、但还留着做备查」的实例用的 —— 与其删掉，不如让它明确地拒绝写入。

<figure>
  <img src="/images/blog/edge-vs-home.svg" width="820" height="300" alt="迁移前后对比：左边是 Cloudflare 边缘上的 Worker 与 D1，能看到的东西只有接口返回；右边是香港机器上的 nginx、workerd、SQLite，能 ssh 进去看进程、日志和数据库文件" loading="lazy" />
  <figcaption>左边能看到的只有「接口返回了什么」，右边能 <code>ssh</code> 进去 <code>tail -f</code>。这个差别比任何性能指标都值钱。</figcaption>
</figure>

## 数据：25 个迁移，一个文件

`worker/migrations/` 下现在是 25 个 SQL 文件，按顺序加，从不改旧的：

```
0001_init.sql
0013_admin.sql
0015_ai.sql
0017_auto_reply.sql
0023_accounts.sql
0025_reply_to.sql
```

每一条对应一次功能生长。这种「只追加」的迁移方式很土，但有一个好处：任何时候把库清空、从头跑一遍，得到的就是当前结构。**数据模型的历史是可重放的。**

而在本地形态下，整个库就是一个 SQLite 文件。备份因此变得非常轻：

```bash
tar czf qingwu-$(date +%Y%m%d).tar.gz /data/qingwu/data /etc/nginx/sites-enabled
age -r <公钥> -o qingwu-$(date +%Y%m%d).tar.gz.age qingwu-$(date +%Y%m%d).tar.gz
```

每天凌晨跑一次，用 age 加密。70KB 左右，连库带 nginx 配置。

这是自建最实际的好处之一：**备份不是「调用某个服务的导出接口」，是 `tar`。**

## 代价

说完好处，得把账算清楚。自建不是免费的可控。

- **进程要你守。** 有 systemd 也会挂，挂了要能及时发现。
- **证书要你续。** certbot 挂了，全站立刻不可用。
- **磁盘要你盯。** 装完 node_modules 和 25 个版本的构建产物，40G 的盘也会慢慢变窄。
- **误封要你解。** fail2ban 封了自己，SSH 还是通的，但得知道去查哪本日志。
- **构建要你兜。** 就在今天，一次构建中途失败留下了半套产物，全站一半页面 403 —— 而在 Cloudflare 上，这类事发生在别人那里，你只会看到 500。

最后这条尤其重要：**自建意味着所有失败模式都变成你的**。托管平台替你吃掉了很多错误，代价是你不知道它们存在。搬回来之后，它们全都冒出来了。

## 小结

如果只看功能，这个后端在 Cloudflare 上跑完全没问题 —— 25 个迁移、十几个接口，从没因为平台本身出过故障。

搬回来换到的是一件事：**当它出问题时，我能看到里面。**

而这台 2 核 2G 的机器，现在同时跑着 nginx、静态站、workerd、邮件中继和每天两次的定时任务。它的资源一直很空闲，说明这个规模的后端本来就不需要边缘计算 —— **它需要的是一台能登上去的机器。**

至于什么时候该搬回去（或者搬去别的托管），判断标准不是「哪种更先进」，而是：**这次故障，你想不想自己能查？**

想，就自己拿。不想，就交给别人，然后接受「你只能等他们修好」。
