# 服务器 nginx 配置副本

线上真实生效的文件（香港机 `103.79.185.65`）在这里留一份副本，**只用于查阅与灾难重建**。
改了这里不会改变线上行为，必须另行登上服务器改并 `nginx -t && systemctl reload nginx`。

| 仓库内 | 服务器路径 |
|---|---|
| `qingwu.conf` | `/etc/nginx/sites-enabled/qingwu` |
| `00-limits.conf` | `/etc/nginx/conf.d/00-limits.conf` |
| `00-geoip2.conf` | `/etc/nginx/conf.d/geoip2.conf` |

## 同步方式

拉（服务器 → 仓库）：

```bash
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/conf.d/00-limits.conf deploy/nginx/
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/conf.d/geoip2.conf deploy/nginx/00-geoip2.conf
scp -i ~/.ssh/qingwu_admin root@103.79.185.65:/etc/nginx/sites-enabled/qingwu deploy/nginx/qingwu.conf
```

推（仓库 → 服务器，**先备份**）：

```bash
ssh -i ~/.ssh/qingwu_admin root@103.79.185.65 \
  'cp -a /etc/nginx/conf.d/00-limits.conf /data/backup/00-limits.conf.bak-$(date +%Y%m%d-%H%M)'
scp -i ~/.ssh/qingwu_admin deploy/nginx/00-limits.conf root@103.79.185.65:/etc/nginx/conf.d/00-limits.conf
ssh -i ~/.ssh/qingwu_admin root@103.79.185.65 'nginx -t && systemctl reload nginx'
```

## 三个容易踩的点

- ⚠️ `/etc/nginx/sites-enabled/qingwu` 是**普通文件不是软链** —— 改 `sites-available` 不生效，
  而且 `nginx -t` 照样通过。改完必须用响应头或 `nginx -T | grep` 验证。
- ⚠️ `location ^~ /admin` **必须带 `^~`**（否则被正则 location 抢走就漏了 Basic Auth），
  `try_files` 也要照抄，否则后台子页 404。
- 凭据不在这里：Basic Auth 用 `/etc/nginx/.htpasswd-admin`（640，不进 git）；
  改密码只用 `openssl passwd -apr1`（机器没装 htpasswd）。
