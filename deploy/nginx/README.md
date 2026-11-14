# 服务器 nginx 配置副本

线上真实生效的文件（香港机 `103.79.185.65`）在这里留一份副本，**只用于查阅与灾难重建**。
改了这里不会改变线上行为，必须另行登上服务器改并 `nginx -t && systemctl reload nginx`。

| 仓库内 | 服务器路径 |
|---|---|
| `qingwu.conf` | `/etc/nginx/sites-enabled/qingwu`（**普通文件，不是软链**） |
| `00-limits.conf` | `/etc/nginx/conf.d/00-limits.conf` |
| `00-geoip2.conf` | `/etc/nginx/conf.d/geoip2.conf` |
| `snippets/security-headers.conf` | `/etc/nginx/snippets/security-headers.conf` |

## 同步方式

拉（服务器 → 仓库）：

```bash
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/conf.d/00-limits.conf deploy/nginx/
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/conf.d/geoip2.conf deploy/nginx/00-geoip2.conf
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/sites-enabled/qingwu deploy/nginx/qingwu.conf
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/snippets/security-headers.conf deploy/nginx/snippets/
```

推（仓库 → 服务器，**先备份**）：

```bash
ssh -i ~/.ssh/qingwu_admin root@103.79.185.65 \
  'cp -a /etc/nginx/sites-enabled/qingwu /data/backup/qingwu.conf.bak-$(date +%Y%m%d-%H%M)'
scp -i ~/.ssh/qingwu_admin deploy/nginx/qingwu.conf root@103.79.185.65:/etc/nginx/sites-enabled/qingwu
ssh -i ~/.ssh/qingwu_admin root@103.79.185.65 'nginx -t && systemctl reload nginx'
```

或者用一键脚本（备份 + `nginx -t` 自动回滚 + 验证）：`bash deploy/apply-hardening-2026-11-14.sh`

## 四个容易踩的点

- ⚠️ `/etc/nginx/sites-enabled/qingwu` 是**普通文件不是软链** —— 改 `sites-available` 不生效，
  而且 `nginx -t` 照样通过。改完必须用响应头或 `nginx -T | grep` 验证。
- ⚠️ `location ^~ /admin` **必须带 `^~`**（否则被正则 location 抢走就漏了 Basic Auth），
  `try_files` 也要照抄，否则后台子页 404。
- ⚠️ **`add_header` 不叠加**：某个 location 里只要写了一条 `add_header`，父级的全部失效。
  所以 `/_astro/` `/fonts/` `/images/` 三个静态目录各自 include 一次
  `snippets/security-headers.conf` —— 加新 location 时也别忘了。
- ⚠️ **别再另起 443 的 `default_server` 块**。2026-11-14 第一版那么写过，nginx 1.22 直接报
  `duplicate listen options for [::]:443` 拒绝启动（同一地址端口的 listen 参数必须完全一致，
  连 `ipv6only=on` 都不能在第二个块里重复声明）。现在改成在**同一个 server 块顶部**用
  `if ($host !~* ^(qingwu\.ink|www\.qingwu\.ink)$) { return 444; }` 拦未知 Host —— 效果一样，
  且不动 listen 一个字节。`ssl_reject_handshake` 在这个部署形态里用不上。
- 凭据不在这里：Basic Auth 用 `/etc/nginx/.htpasswd-admin`（640，不进 git）；
  改密码只用 `openssl passwd -apr1`（机器没装 htpasswd）。

## 2026-11-14 这次改了什么（排查时按这个对）

| 位置 | 变更 | 现象 |
|---|---|---|
| `location /api/`、`/api/admin/` | 新增 `proxy_set_header CF-Connecting-IP "";` | 客户端自带的该头被丢弃，Worker 只认 `x-real-ip` |
| 同上 | 新增 `proxy_set_header X-Forwarded-Proto $scheme;` | 生产 cookie 终于带上 `Secure` |
| `location ^~ /admin` | 新增 `limit_req zone=admin_login burst=5` | 连打 20 次错误凭据会出现 429 |
| `00-limits.conf` | 新增 `admin_login` zone（12r/m） | 同上 |
| 原 `Content-Security-Policy-Report-Only` | 改强制 `Content-Security-Policy`，加 `report-uri`/`Report-To` | 违规 POST 到 `/api/csp-report`（只记日志） |
| `snippets/security-headers.conf` | HSTS 加 `includeSubDomains`；补 `X-XSS-Protection: 0` | 子域也进 HSTS |
| 443 server 块顶部 | 新增 `$host` 白名单（非 `qingwu.ink`/`www.qingwu.ink` → 444） | `curl -k https://IP/ -H 'Host: evil.example'` 连接被断，不再返回主站 |
| 80 server 块顶部 | 同上，未知 Host 不再 301 到主站 | 裸 IP 的 http 访问直接断开 |
| server 级 | 新增 `server_tokens off`、`client_max_body_size 1m` | `Server: nginx` 不带版本 |
