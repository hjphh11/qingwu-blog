# 方案 · 自建 Matrix（茶友独立账号）

> 目标：把长亭的互联从「共享转发账号」升级成「**每个茶友一个真实 Matrix 身份**」，让 rainzt 大厅里各人显示各自的昵称和头像。
> 起因：共享账号模式下「头像用 Matrix 成员资料」是听雨的设计（`isBridge:false`），`[URL:]` 天然不生效 —— 见 `docs/方案-聊天室.md` §46.6。想让每人头像不同，只有自建 homeserver 这一条路。
> 前提机器：2 核 E5-4657L v2 / **1.9GB 内存** / 40GB 盘（剩 34GB）；`qingwu-api`（wrangler dev + workerd）常驻 510MB。

---

## 一、先说清「正常 Matrix」是什么样

对照听雨的接入档位，我们在第 2 档：

| 档 | 形态 | 大厅里看到的 | 我们 |
| --- | --- | --- | --- |
| 1 | **自己的 homeserver，茶友各有独立账号** | 每条消息的 sender 是不同的人，昵称/头像**自动**取自成员资料 | ❌ 没做 |
| 2 | 共享转发账号 + 正文协议头 `[ID:昵称·站点名];[URL:头像]` | 全部是同一个账号；听雨明确「头像用成员资料」 | ✅ 现状 |
| 3 | 上架后核对大厅里实际收到的账号与来源 | 验收动作 | 部分做过 |

第 1 档的好处不只是头像：**来源可追溯**（谁的言论一目了然）、**限流能按人**、以后要做私聊/@ 也能直接走 Matrix 原生能力。代价是要自己养一个 homeserver，并且和一屋子公共房间共存。

---

## 二、核心决策：用 Application Service，不给每人发密码

自建之后，最直觉的做法是「每个茶友注册一个 Matrix 账号、我们存密码」。**不这么做**，理由是密码这件事一旦进我们库，改密、找回、泄露、跟站内登录同步全是成本。

改用 Matrix 规范的 **Application Service（AS）**：注册一个「桥」身份，声明一个用户命名空间，之后可以用 AS token **以任意本地用户身份**发消息，不需要那些用户的密码。mautrix-telegram / mautrix-discord 这些成熟桥接全是这个模式。

| 方案 | 需要存密码 | 能随时改资料 | 茶友能用 Element 登录 | 复杂度 |
| --- | --- | --- | --- | --- |
| 每人注册 + 存密码 | 要 | 要用户自己改 | 能 | 中，且安全面大 |
| **AS + 虚拟用户** | **不要** | **我们直接 PUT profile** | 要额外发一次性登录 token | 低 |
| 继续共享账号 | 不要 | 改一次全员变 | 不能 | 最低（但就是现状） |

选 AS。茶友想用 Element 看大厅，后面可以加「一次性登录 token」功能（`POST /_matrix/client/v3/login` 的 `m.login.token`），不做也不影响主流程。

---

## 三、选型（2026-10 的现状，不是老文章）

| 实现 | 语言 | 状态 | 桥接(AS) | 内存 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **Synapse** 1.163 | Python + Postgres | Active，参考实现，功能最全 | 完善 | 小规模私有 2GB 起；**加入大型公共房间要再加 1GB** | 最稳，但这台 1.9G 机器装不下 |
| **tuwunel** 1.9.4 | Rust | Active（conduwuit 官方继任者） | 支持 | 单二进制 + 嵌 RocksDB，量级小 | ✅ **本机首选** |
| continuwuity | Rust | Active（conduwuit 社区延续） | 支持 | 同上 | 备选，二选一看维护活跃度 |
| Dendrite | Go | **维护模式**（仅安全修复） | 标注「not well tested」 | 中 | ❌ 不用于新部署 |
| Conduit | Rust | Active 但 beta | 有，未充分测试 | 小 | 被 tuwunel / continuwuity 取代 |

**结论**：这台机器上跑 **tuwunel**。

- 我们的房间不是自己建的，是**加入 rainzt 的公共大厅**，Synapse 的内存主要被「房间状态大小」撑起来 —— 这正是它在这台机器上最危险的地方。
- 想用 Synapse 也可以，**先把内存升到 4GB**，否则每次 `astro build`（本机 45 秒，内存峰值不低）都可能和它抢内存，一 OOM 就是全站 403（历史事故，见 NOTEBOOK）。
- 换实现的代价：Rust 系与 Synapse **没有数据迁移路径**，以后要换只能重建账号、重新 join。现在还没数据，是换成本最低的时刻。

---

## 四、架构

```
浏览器 ──► www.qingwu.ink (nginx)
             ├─ /            静态 dist（astro）
             ├─ /api/*  ───► worker 127.0.0.1:8787 (workerd + D1)
             └─ /.well-known/matrix/*   （静态文件，给联邦用）

worker（出站）AS token ──► matrix.qingwu.ink ──► rainzt 大厅
worker（入站）/sync  ◄──  matrix.qingwu.ink ◄── rainzt 大厅

matrix.qingwu.ink (nginx server 块) ──► 127.0.0.1:8008 (tuwunel)
```

- **域名**：`matrix.qingwu.ink` 一个就够；`www.qingwu.ink/.well-known/matrix/{server,client}` 指过去。
- **不复用 8448**：把 8448 暴露成明文是常见误配。统一走 443 反代 + `.well-known` 委派。
- **证书**：与主站同一套 certbot，加一个子域即可（DNS 记录 + `certbot --expand`）。
- **worker 与 homeserver 同机**：走 `127.0.0.1:8008`，不绕公网（避开之前踩过的 NAT 回环）。

---

## 五、账号模型

| 项 | 取值 | 说明 |
| --- | --- | --- |
| localpart | `qw_<accountId>` | 用站内自增 id，**不绑昵称**（改昵称不用重建账号） |
| display_name | 走现有署名规则（`昵称·清吾长亭`） | 与大厅里其他站一致；站长自己那条是否去掉后缀，单独拍板 |
| avatar_url | 传成 `mxc://` | 源图就是我们站的 `/api/chat/avatar/u/<id>`，上传一次、换头像再传 |
| 注册 | **关闭** `allow_registration = false` | 只有 AS 能建号，杜绝陌生人注册 |
| join | 首次发言时按需 join | **不预建、不预 join** —— 每个 join 都是一个 member 事件，几十个人预 join 会把房间状态撑大 |

**按需创建流程**（首次在某条消息出现时）：

1. `PUT /_matrix/client/v3/profile/@qw_1:…/displayname`、`/avatar_url`（AS token）
2. `POST /_matrix/client/v3/join/{roomId}?user_id=@qw_1:…`（AS token）
3. `PUT /rooms/{roomId}/send/m.room.message/{txn}?user_id=@qw_1:…`

三条都成功才把消息标出站；失败就按现在的 outbox 退避重试。

---

## 六、代码改动清单

| 文件 | 改什么 |
| --- | --- |
| `worker/migrations/00xx_matrix_accounts.sql` | `accounts.matrix_user_id TEXT`、`chat_sync.appservice_ready INTEGER` |
| `worker/src/chat/appservice.ts`（新） | AS token、`ensureUser()`（建号+资料）、`ensureJoin()`、`sendAs()` |
| `worker/src/chat/bridge.ts` | `deliverContent()` 加 `?user_id=`；出站署名改由 profile 承担，正文头保留（见下） |
| `worker/src/chat/sync.ts` | 入站 `sender` 若是 `@qw_*:本域` → 直接映射本地 account（不再靠 `chat_remote_profiles` 兜底） |
| `worker/src/types.ts` | `MATRIX_AS_TOKEN`、`MATRIX_AS_USER`、`MATRIX_SELF_HS` |
| nginx | 新增 `matrix.qingwu.ink` server 块 + `.well-known` 静态 |

**正文协议头还发不发？** 继续发。对方的实现是按 `isBridge` 判断的，我们升级后会作为**独立账号**出现（不再走共享账号那条分支），头部对他们是无害的多余信息；但其它接入方（比如还在用第 2 档逻辑的站）仍然需要它。**两套并存，谁认哪套都能显示。**

---

## 七、部署步骤（到命令级）

```bash
# 1) 域名：A 记录 matrix.qingwu.ink → 本机；证书
certbot --nginx -d matrix.qingwu.ink

# 2) tuwunel：官方 release 下静态二进制（单文件），放 /usr/local/bin/tuwunel
#    配置按发行包自带的 conduwuit-example.toml 改，必须动的语义项：
#      server_name                = "matrix.qingwu.ink"
#      address / port             = "127.0.0.1" / 8008
#      database_path              = "/var/lib/tuwunel"
#      allow_registration         = false
#      allow_federation           = true
#      appservice_registration_files = ["/etc/tuwunel/as-qingwu.yaml"]
#    systemd 单元照 qingwu-api 的写法（Restart=always + 显式 User）

# 3) nginx：matrix.qingwu.ink → proxy_pass http://127.0.0.1:8008;
#    client_max_body_size 25m;  （媒体上传）

# 4) .well-known（放主站静态目录，nginx 直接给文件）
#    /.well-known/matrix/server → {"m.server":"matrix.qingwu.ink:443"}
#    /.well-known/matrix/client → {"m.homeserver":{"base_url":"https://matrix.qingwu.ink"}}

# 5) AS 注册文件（/etc/tuwunel/as-qingwu.yaml，标准规范格式）
#    id: qingwu / url: http://127.0.0.1:8787/_matrix/app
#    as_token / hs_token 各生成一串随机
#    sender_localpart: qingwu
#    namespaces.users: exclusive, regex "@qw_.*:matrix.qingwu\.ink"

# 6) 验证联邦
curl -s https://matrix.qingwu.ink/_matrix/federation/v1/version
curl -s https://www.qingwu.ink/.well-known/matrix/server
```

> 具体配置键名以所装版本自带的示例为准，上面只列「必须改的语义」。tuwunel 与 conduwuit 的 `CONDUIT_*` 环境变量兼容，务必跟版本号一起记进 NOTEBOOK。

---

## 八、资源与风险

| 项 | 估算 | 备注 |
| --- | --- | --- |
| 常驻内存 | tuwunel 150–350MB（随大厅状态涨） | 现可用 1.2GB，留出 ~700MB 给 build 峰值 |
| 磁盘 | 首月 < 1GB；媒体是大头 | 可给媒体设配额，或后续接 S3 |
| 带宽 | 联邦同步 + 头像/封面 | 每次有人发图都会同步到我们；大厅活跃时持续有小流量 |
| CPU | 低（Rust） | E5 v2 单核弱，但这点负载无感 |

**必须处理的四件事**：

1. **与构建抢内存**：`astro build` 是定时炸弹。要么升级到 4G，要么把 `auto-deploy` 改到凌晨并保证 tuwunel 有 `MemoryMax` 上限（systemd 限制，超了只杀它不杀全机）。
2. **注册关闭 + 邀请制**：`allow_registration=false`，任何人不能自建号；AS 只在我们这侧触发。
3. **备份**：RocksDB 目录 + AS 配置，跟现有 `qingwu-backup` 一起做（热备要停服务或用自带 dump 工具）。
4. **回滚**：保留现有共享账号 `@qingwuzf` 与整套 bridge 不动。新链路出问题 ⇒ 把 `MATRIX_AS_TOKEN` 清空，`bridgeOf()` 自然退回旧路径。

---

## 九、需要跟听雨对齐的四件事

1. 我们新增 `matrix.qingwu.ink` 作为来源站，**大厅是否允许我们的用户自行 join**（还是需要邀请/白名单）。
2. 来源标签怎么显示（现在共享账号的 `source.siteName` 是「清吾长亭」）；换成独立账号后来源怎么算。
3. 我们站有几十个潜在账号，**是否存在成员数上限或频率限制**。
4. 老账号 `@qingwuzf` 是否继续保留作为「系统通知」身份。

---

## 十、验收（对应第 1 档）

- [ ] `/_matrix/federation/v1/version` 公网可达，`.well-known` 两个文件都对
- [ ] AS 能建号、能 join、能以指定 `user_id` 发言
- [ ] 在大厅里看到**两条不同茶友**的消息，各自昵称与头像正确
- [ ] 头像来自成员资料（`mxc://`），不依赖 `[URL:]`
- [ ] 入站长亭：sender 正确映射回站内账号，不出现「远方的茶客」
- [ ] 断网/对方 5xx 时 outbox 退避重试，不阻塞站内发送
- [ ] 全站 build 期间 homeserver 不被 OOM 杀掉

---

## 十一、三个需要你拍板的点

1. **现在就做，还是等机器升内存**？（tuwunel 可以先跑起来验证，再决定是否长期留）
2. **站长自己的显示名**：大厅里要「清吾」还是「清吾长亭」？（现在 `signOf` 对「清吾」做了特判，只留站点名）
3. **茶友要不要能用 Element 登录**？要的话加一次性 token 流程，不要就纯站内使用。

---

## 不做

- **不迁历史消息**：老消息仍挂在 `@qingwuzf` 名下，翻历史时是「同一个人」，属于可接受的断层。
- **不做 E2EE**：大厅是公开房间，AS 也进不了加密房间；站内消息本来就在我们库里。
- **不上 MAS / OIDC**：个人站规模用不上，多一层认证就多一层故障。
- **不自建 Element Web**：想用客户端就用公共 Element 或桌面端。
- **不把 homeserver 暴露成通用注册站**：它只服务我们自己的茶友。
