#!/usr/bin/env bash
# 清吾 · 2026-11-14 安全加固上线脚本
#
# 在**服务器上**执行（不是本地）：
#   ssh root@HOST
#   cd /data/qingwu && git pull            # 先把这个仓库的改动拉下来
#   bash deploy/apply-hardening-2026-11-14.sh
#
# 它做四件事，每步都可回滚：
#   1. 备份 nginx 三个文件 + Worker 源码目录
#   2. 换 nginx 配置 → `nginx -t` 通过才 reload（失败自动还原）
#   3. 重启 Worker（systemd），等 /api/health 起来
#   4. 打一组验证请求，逐条打印「期望 vs 实际」
#
# 全部完成后若哪条验证不过，脚本不会自动回滚 Worker —— 它会把回滚命令打出来。

set -uo pipefail

REPO="${REPO:-/data/qingwu}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BAK="/data/backup/hardening-$STAMP"
NGINX_SITE="/etc/nginx/sites-enabled/qingwu"
NGINX_LIMITS="/etc/nginx/conf.d/00-limits.conf"
NGINX_SNIPPET="/etc/nginx/snippets/security-headers.conf"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

[ "$(id -u)" = "0" ] || { echo "需要 root"; exit 1; }
[ -d "$REPO/worker/src" ] || { echo "找不到 $REPO/worker/src"; exit 1; }

say "1. 备份到 $BAK"
mkdir -p "$BAK"
cp -a "$NGINX_SITE"      "$BAK/qingwu.conf"            2>/dev/null || true
cp -a "$NGINX_LIMITS"    "$BAK/00-limits.conf"         2>/dev/null || true
cp -a "$NGINX_SNIPPET"   "$BAK/security-headers.conf"  2>/dev/null || true
tar -C "$REPO" -czf "$BAK/worker-src.tar.gz" worker/src 2>/dev/null || true
ok "已备份（含 worker/src、三个 nginx 文件）"

# 静态站要重建（这次的 changelog 与前端改动都得进 dist/client）。
# 不重建的话页面还是旧的，只有 Worker 与 nginx 变新 —— 很容易误判「改了没用」。
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  say "1.5 跳过构建（SKIP_BUILD=1）"
else
  say "1.5 重建静态站（约 50s，机器 2G 内存，别和别的构建抢）"
  if ( cd "$REPO" && PUBLIC_HIT_WORKER_URL=/api PUBLIC_TURNSTILE_SITE_KEY= npm run build >/tmp/qingwu-build.log 2>&1 ); then
    ok "构建完成（日志 /tmp/qingwu-build.log）"
  else
    bad "构建失败，未做任何变更。末尾日志："
    tail -20 /tmp/qingwu-build.log
    exit 1
  fi
fi

say "2. 安装 nginx 配置"
cp -f "$REPO/deploy/nginx/qingwu.conf"                    "$NGINX_SITE"
cp -f "$REPO/deploy/nginx/00-limits.conf"                 "$NGINX_LIMITS"
install -D -m 644 "$REPO/deploy/nginx/snippets/security-headers.conf" "$NGINX_SNIPPET"
if nginx -t 2>&1 | tee /tmp/nginx-t.log | grep -q "syntax is ok"; then
  systemctl reload nginx
  ok "nginx -t 通过并已 reload"
else
  bad "nginx -t 失败，正在还原"
  cp -f "$BAK/qingwu.conf"   "$NGINX_SITE"   2>/dev/null || true
  cp -f "$BAK/00-limits.conf" "$NGINX_LIMITS" 2>/dev/null || true
  cp -f "$BAK/security-headers.conf" "$NGINX_SNIPPET" 2>/dev/null || true
  nginx -t && systemctl reload nginx
  echo "已还原。原因："; cat /tmp/nginx-t.log
  exit 1
fi

say "3. 重启 Worker"
systemctl restart qingwu-api
for i in $(seq 1 30); do
  sleep 2
  if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then
    ok "Worker 起来了（${i}0 秒内）"; break
  fi
  [ "$i" = "30" ] && { bad "Worker 30 次探测都没起来，看 journalctl -u qingwu-api -n 50"; exit 1; }
done

say "4. 验证（期望 → 实际）"
v() { # $1 说明  $2 期望子串  $3 实际字符串
  if printf '%s' "$3" | grep -qi -- "$2"; then ok "$1（$2）"; else bad "$1：期望含「$2」，实际「$(printf '%s' "$3" | head -c 160)」"; fi
}

# ① CSP 已经是强制头，不再是 Report-Only
H=$(curl -sSI --max-time 8 https://www.qingwu.ink/ 2>/dev/null)
v "CSP 强制" "content-security-policy:" "$H"
if printf '%s' "$H" | grep -qi "content-security-policy-report-only"; then bad "仍存在 Report-Only 头，检查是否被旧配置覆盖"; else ok "没有 Report-Only 残留"; fi
v "HSTS 带 includeSubDomains" "includeSubDomains" "$H"
v "Server 头不带版本" "^server: nginx$" "$H"

# ② /health 不再泄露 service 指纹
B=$(curl -sS --max-time 8 https://www.qingwu.ink/api/health)
v "health 精简" '^{"ok":true}$' "$B"

# ③ /stats 仍然要口令（fail-closed）
S=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://www.qingwu.ink/api/stats)
case "$S" in
  401) ok "/stats 需要口令（401）" ;;
  503) ok "/stats 未配口令 → 503（fail-closed，符合预期）" ;;
  *)   bad "/stats 期望 401/503，实际 $S" ;;
esac

# ④ CF-Connecting-IP 伪造不再能刷计数：两次同路径应一次 counted、一次 seen
#    注意要带浏览器的 UA（Worker 的 isBot 会把 curl/ 判成爬虫直接丢，那样看不出区别）
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
ORI='Origin: https://www.qingwu.ink'
r1=$(curl -sS --max-time 8 -X POST https://www.qingwu.ink/api/hit \
      -A "$UA" -H 'content-type: application/json' -H "$ORI" -H 'cf-connecting-ip: 9.9.9.9' \
      -d '{"path":"/deploy-check","referrer":""}')
r2=$(curl -sS --max-time 8 -X POST https://www.qingwu.ink/api/hit \
      -A "$UA" -H 'content-type: application/json' -H "$ORI" -H 'cf-connecting-ip: 8.8.8.8' \
      -d '{"path":"/deploy-check-2","referrer":""}')
case "$r1$r2" in
  *seen*) ok "伪造 CF-Connecting-IP 已失效（出现 seen）" ;;
  *) bad "两条都可能是 counted —— 确认 nginx 是否真的清了 CF-Connecting-IP：$r1 $r2" ;;
esac

# ⑤ /link-click 只认友链白名单（也要带 Origin，否则先被同源校验挡掉）
L=$(curl -sS --max-time 8 -X POST https://www.qingwu.ink/api/link-click \
      -A "$UA" -H 'content-type: application/json' -H "$ORI" -d '{"url":"https://evil.example/x"}')
v "link-click 拒绝白名单外主机" 'ok":false' "$L"

# ⑤b 白名单内的应当放行（证明收口没把正常功能一起关掉）
L2=$(curl -sS --max-time 8 -X POST https://www.qingwu.ink/api/link-click \
       -A "$UA" -H 'content-type: application/json' -H "$ORI" -d '{"url":"https://rainzt.cn"}')
v "link-click 放行友链" 'ok":true' "$L2"

# ⑥ CSP 上报口存在
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST https://www.qingwu.ink/api/csp-report \
      -H 'content-type: application/csp-report' -d '{"csp-report":{"document-uri":"https://www.qingwu.ink/"}}')
[ "$C" = "204" ] && ok "/api/csp-report 回 204" || bad "/api/csp-report 期望 204，实际 $C"

# ⑦ 后台入口限速（连打 20 次，应该出现 429）
codes=""
for i in $(seq 1 20); do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' --max-time 5 -u "probe$i:probe$i" https://www.qingwu.ink/admin)"
done
if printf '%s' "$codes" | grep -q 429; then ok "后台 Basic Auth 已限速（出现 429）"; else bad "没出现 429 —— 检查 zone=admin_login 是否生效：$codes"; fi

say "完成"
cat <<EOF

回滚办法（任一步有问题时）：

  # nginx（改回来再 reload）
  cp -a $BAK/qingwu.conf   $NGINX_SITE
  cp -a $BAK/00-limits.conf $NGINX_LIMITS
  cp -a $BAK/security-headers.conf $NGINX_SNIPPET
  nginx -t && systemctl reload nginx

  # Worker（代码）
  tar -C $REPO -xzf $BAK/worker-src.tar.gz
  systemctl restart qingwu-api

  # CSP 只想退回观察模式：把 qingwu.conf 里那行开头的
  #   add_header Content-Security-Policy "  改成
  #   add_header Content-Security-Policy-Report-Only "
  # 并删掉紧跟的 Report-To 行，reload 即可。

备份目录：$BAK
EOF
