# 方案 · 自建 Matrix（Synapse + 茶友独立账号）

> ✅ **2026-11-27 核对：仍是「未实施」状态**。现有互联走的是共享转发账号 `@qingwuzf`（第 2 档），
> 自建 homeserver 要先把服务器内存升到 4G，见本文 §0。

> 一句话：**自建 Synapse，每个茶友一个真账号（用户名 + 密码）；注册可匿名（不填邮箱、不验证）；
> 大厅里每条消息的 sender 就是本人，昵称和头像由成员资料自动带出。**
> 这是听雨接入档位的**第 1 档**。现在的第 2 档（共享账号 `@qingwuzf` + 正文协议头）只能全站一个头像，
> 因为对方「头像用成员资料」是设计如此（见 `docs/方案-聊天室.md` §46.6）。
> 硬门槛：**内存 ≥ 4GB**（现在是 1.9GB，见 §三）。

---

## 一、目标形态

| | 现在（第 2 档） | 目标（第 1 档） |
| --- | --- | --- |
| 大厅里的 sender | 全是 `@qingwuzf` | 每条是不同的人 |
| 昵称 | `[ID:]` 协议头，对方可能不认 | 取自该账号的 `display_name` |
| 头像 | 成员资料（全站同一张） | 各自账号的 `avatar_url` |
| 来源标签 | 一个站名 | 每人都是「清吾长亭」来的 |

验收就一句：**在大厅里看到两条不同茶友的消息，sender 不同、昵称和头像各自正确。**

---

## 二、为什么是 Synapse

Synapse 是 Matrix 的参考实现，功能最全（联邦、媒体、已读、反应、编辑、撤回全齐），长期维护，
而且**后台管理接口完整**——代建账号、改密码、改显示名、改头像、查房间成员，全有现成 HTTP API，
正好对上「我们替茶友管账号」这件事。

代价只有一个：内存。它会被「加入的公共房间有多大」撑起来，不是被用户数撑起来。rainzt 大厅
（136 人）不算巨无霸，但也不是小房间，所以下面的机器门槛不能省。

---

## 三、机器（硬门槛，先解决这个）

| 项 | 现在 | 需要 | 说明 |
| --- | --- | --- | --- |
| 内存 | **1.9GB**（可用 1.1GB） | **4GB** | Synapse 常驻 400–700MB + Postgres 150–250MB；同机还有 `qingwu-api`(510MB) 和 `astro build` 的峰值 |
| 磁盘 | 40GB（剩 34GB） | 够 | media_store 会涨，先本地存，超了再迁 R2 |
| CPU | 2 核 E5-4657L v2 | 够 | Synapse 是 Python，单核弱一点但这点负载无感 |
| OS | Debian 12 / Python 3.11.2 | ✅ | Synapse 1.163 支持 |
| Postgres | 未安装 | 要装 | 15.x（Debian 自带） |

**为什么不能就在 1.9G 上跑**：`astro build` 是定时炸弹。一次 push 触发构建，峰值和 Synapse 抢内存，
一 OOM 就是整站 403（历史事故：构建中断留半套 `dist`）。升到 4G 之前不要上生产。

---

## 四、账号模型（含「匿名」）

| 项 | 取值 |
| --- | --- |
| 用户名（localpart） | `qw_<accountId>`，用站内自增 id，**不绑昵称**（改名不用重建账号） |
| 密码 | 16 位随机串，**AES-256-GCM 加密存库**，密钥在 `MATRIX_PW_KEY` |
| 显示名 | 现有署名规则：茶友 `昵称·清吾长亭`；站长本人 `清吾`（昵称就是站名简称，不重复） |
| 头像 | 我们站的头像代理图 → 上传到 Synapse media → `PUT avatar_url`（mxc） |
| 邮箱 | **不收**。这是「匿名」的全部含义：不填邮箱、不发验证信、不留任何真实信息 |
| 注册入口 | **关掉公开注册**，只允许我们代建（`registration_shared_secret`） |

**为什么要关公开注册**：Synapse 一旦 `enable_registration: true`，全世界都能在你机器上注册小号。
改为关掉它，只用 `registration_shared_secret` 走 `/_synapse/admin/v1/register` 代建——
茶友在长亭里点「开通大厅身份」，worker 算一个 HMAC 请求把号建出来，外部拿不到这个 secret。

**密码存哪、谁能看**：密文进 `accounts.matrix_secret`，长亭「我的身份」里可以查看一次（明文只在
响应里出现，不进日志）。忘了就重置——我们不需要知道旧密码。

**匿名者的身份稳定性**：不登录就不能发言（长亭现在就是登录才能聊），所以每个发言的人都对应一个
站内 `accountId`，账号天然稳定、不会一个人建出十个号。

---

## 五、架构

```
浏览器 ──► www.qingwu.ink (nginx)
             ├─ /            静态 dist（astro）
             ├─ /api/*  ───► worker 127.0.0.1:8787 (workerd + D1)
             └─ /.well-known/matrix/*  静态 JSON

worker 出站：以该用户 token  PUT /rooms/{room}/send/…?   ──┐
worker 入站：GET /sync（现有的游标）                       ├──► matrix.qingwu.ink
worker 管号：POST /_synapse/admin/v1/register             ──┘        │
                                                                    ▼
                                        nginx (matrix.qingwu.ink) ──► 127.0.0.1:8008 (synapse)
                                                                          │
                                                                    127.0.0.1:5432 (postgres)
```

- **一个域名**：`matrix.qingwu.ink`。`www` 上放 `.well-known` 做委派（省一张证书、也省 8448）。
- **不暴露 8448**：那是联邦明文口，误配很常见；统一 443 反代。
- **worker 走 127.0.0.1:8008**，不绕公网（吃过 NAT 回环的亏）。
- **联邦出口**：Synapse 要主动连对方服务器（rainzt），出站 443 保持放行。

---

## 六、实施步骤

### Step 0 · 升内存（阻塞项）

VPS 面板从 2G 升到 4G（多数商家支持热升）。升完 `free -m` 确认，再往下走。

### Step 1 · 域名与证书

```bash
# DNS：A 记录 matrix.qingwu.ink → 103.79.185.65
# 解析生效后：
certbot --nginx -d matrix.qingwu.ink
```

### Step 2 · PostgreSQL

```bash
apt install -y postgresql
sudo -u postgres psql <<'SQL'
CREATE USER synapse WITH PASSWORD '换成随机串';
CREATE DATABASE synapse OWNER synapse ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' template=template0;
SQL
```

### Step 3 · Synapse

```bash
apt install -y matrix-synapse-py3        # 官方源；装的时候会问 server_name
# 或按官方文档加 apt 源，版本 1.163.x
```

`/etc/matrix-synapse/homeserver.yaml` 里必须对的几项（其余保持默认）：

```yaml
server_name: "matrix.qingwu.ink"

listeners:
  - port: 8008
    bind_addresses: ['127.0.0.1']
    type: http
    tls: false
    x_forwarded: true
    resources:
      - names: [client, federation]

database:
  name: psycopg2
  args:
    user: synapse
    password: "同 Step 2"
    database: synapse
    host: 127.0.0.1
    cp_min: 5
    cp_max: 10

# —— 账号：我们代建，不开自助注册 ——
enable_registration: false
registration_shared_secret: "改成随机串"

media_store_path: /var/lib/matrix-synapse/media
max_upload_size: 25M
url_preview_enabled: false          # 不做链接预览，少一个 SSRF 面
allow_public_rooms_over_federation: true
```

```bash
systemctl enable --now matrix-synapse
curl -s http://127.0.0.1:8008/_matrix/client/versions | head -c 200
```

### Step 4 · 管理员与代建通道

```bash
# 建一个站内服务账号（管理员），它只用来调 admin API
register_new_matrix_user -c /etc/matrix-synapse/homeserver.yaml \
  -u qingwu-bot -p '随机强密码' -a http://127.0.0.1:8008
```

然后登录一次拿长期 token，写进 worker 的 `.dev.vars`：

```bash
curl -s -X POST http://127.0.0.1:8008/_matrix/client/v3/login \
  -d '{"type":"m.login.password","user":"qingwu-bot","password":"…","initial_device_display_name":"qingwu-worker"}'
# 取 access_token → SYNAPSE_ADMIN_TOKEN
```

代建茶友账号（worker 里做，WebCrypto 算 HMAC-SHA1）：

```
GET  /_synapse/admin/v1/register            → { nonce }
POST /_synapse/admin/v1/register
  { nonce, username, password, admin:false, mac }
  mac = HMAC_SHA1(registration_shared_secret, `${nonce}\0${username}\0${password}\0notadmin`)
```

建完立刻用该账号登录，把 `access_token` 存下来（后续发消息用它，不用再登录）。

### Step 5 · nginx + well-known

```nginx
# matrix.qingwu.ink
server {
  listen 443 ssl http2;
  server_name matrix.qingwu.ink;
  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:8008;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;     # /sync 长轮询，别用默认 60s
  }
}
```

`www.qingwu.ink` 上放两个静态文件（CSP 已经是 `default-src 'self'`，JSON 不受影响）：

```
/.well-known/matrix/server → {"m.server":"matrix.qingwu.ink:443"}
/.well-known/matrix/client → {"m.homeserver":{"base_url":"https://matrix.qingwu.ink"}}
```

⚠️ 注意 **不要**给 `/.well-known/matrix/` 加 `add_header Content-Type application/json` 之外的花活，
也不要被现有 `/api/` 或静态缓存规则吃掉。

### Step 6 · 联邦自检

```bash
# 委派
curl -s https://www.qingwu.ink/.well-known/matrix/server
# 本机版本
curl -s https://matrix.qingwu.ink/_matrix/federation/v1/version
# 别人能不能连我们（第三方工具，选一个）
#   https://federationtester.matrix.org/
```

再让 `@qingwu-bot` join rainzt 大厅（`POST /_matrix/client/v3/join/{roomId}`），
在 `/sync` 里能看到大厅消息，就算通。

### Step 7 · worker 接入

| 文件 | 改什么 |
| --- | --- |
| `migrations/00xx_matrix_accounts.sql` | `accounts.matrix_user_id`、`matrix_token`、`matrix_secret`、`matrix_synced_at` |
| `worker/src/chat/synapse.ts`（新） | `createUser()`（shared secret 代建 + 登录存 token）、`setProfile()`、`uploadAvatar()`、`joinRoom()`、`sendAs()` |
| `worker/src/chat/bridge.ts` | `deliverContent()` 改用「该用户的 token」，不再用共享账号 token；正文协议头保留（兼容其它站） |
| `worker/src/chat/sync.ts` | 入站 sender 若是 `@qw_*.本域` → 反查本地 account（不用再抓 profile 兜底） |
| `worker/src/types.ts` | `SYNAPSE_HS`、`SYNAPSE_ADMIN_TOKEN`、`MATRIX_REG_SHARED_SECRET`、`MATRIX_PW_KEY` |
| 前端 | 长亭「我的身份」：显示 Matrix ID、可查看一次密码、可重置、可换头像 |

几个要点：

- **昵称/头像变更要推**：站内改名或换头像后，调 `PUT /_matrix/client/v3/profile/{userId}/displayname|avatar_url`；
  头像要先 `POST /_matrix/media/v3/upload` 拿 `mxc://`。失败只记日志，不阻塞站内操作。
- **首次发言才建号**：老用户不必一次性全建，避免几百个空账号 + 几百个 join 事件。
- **旧共享账号保留**：`@qingwuzf` 继续作为「系统通知」身份，历史消息不迁。

### Step 8 · 切换与验收

1. 先只给自己（id=1）建号，在大厅发一条，确认 sender、昵称、头像都对；
2. 开给 2–3 个活跃茶友；
3. 全量；
4. 观察 24h：`journalctl -u matrix-synapse` 无频繁错误、内存曲线平稳。

---

## 七、运维

| 项 | 做法 |
| --- | --- |
| 备份 | 每天 `pg_dump synapse` + 打包 `media_store`；跟现有 `qingwu-backup` 合并到一个脚本 |
| 限额 | `rc_message` / `rc_registration` 保持默认；账号只由我们建，外部打不进来 |
| 监控 | `systemctl status matrix-synapse` + 现有的 `qingwu-health-check`；加一条「8008 不通就告警」 |
| 升级 | 跟着 Debian 源走；跨大版本前先备份 DB（Synapse 升级会跑 schema 迁移，不可逆） |
| 媒体 | `media_store` 涨得快时，加 `media_retention` 或迁到 R2（需要 S3 兼容存储模块） |
| 房间 | 只加入必要的大厅；别随手 join 大公共房间，那是内存杀手 |

---

## 八、回滚

- 服务和数据都在，只是 worker 不再使用 ⇒ 把 `SYNAPSE_ADMIN_TOKEN` 清空，
  `bridgeOf()` 退回共享账号链路，站内一切照旧。
- 已经建出来的 Matrix 账号留着不影响任何东西（它们只在大厅里发言过）。
- **不要**为此删库、删 media：留着以后还能用。

---

## 九、不做

- **不迁历史消息**：老消息挂在 `@qingwuzf` 名下，翻历史能看到断层，接受。
- **不做 E2EE**：大厅是公开房间；站内消息本来就在我们库里。
- **不上 MAS / OIDC**：个人站规模用不上，多一层认证多一层故障。
- **不自建 Element Web**：茶友想用客户端就用 element.io 或桌面端，账号密码给他了就能登。
- **不开放注册**：机器只服务我们自己的茶友。
- **不做游客身份**：长亭发言本来就要求登录，没有「未登录也能在大厅说话」的场景。
