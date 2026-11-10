#!/bin/bash
# 清吾 · 自动部署（配合 qingwu-deploy.timer 每 2 分钟跑一次）
#
# 为什么需要它：后台「提交到仓库」之后，前台要等服务器 git pull + build 才变。
# 没有这一步，后台的友链审核只能算改了个仓库文件，站长还得登服务器敲一遍
# pull → build → 重启，那 P2 的「审批闭环」就是假的。
#
# 三条设计约束（2 核 2G 的机器，踩过一次就知道）：
#   1) flock 不排队 —— 上一轮还在 build 就直接退出。并发两个 build 会 OOM。
#   2) --ff-only —— 服务器上被手改过就停下来报错，宁可这次不部署，
#      也不要造出一个 merge 提交把仓库弄脏。
#   3) 构建回来先确认 dist/client/index.html 还在，再重启 Worker。
#      构建中途失败可能留下半套产物，那就保持现状等下一轮，别骗自己「上线成功」。
#   4) ⚠️ 下面 build 那行的两个环境变量**不能省**。服务器上没有 .env（只有
#      .env.example），缺了 PUBLIC_HIT_WORKER_URL=/api 时 import.meta.env 会回落到
#      代码默认的 https://api.qingwu.ink（早已废弃的 ECS）→ 全站打点、/link-status、
#      友链提交全部 CORS 失败，而**页面本身看着完全正常**，只有开 console 才发现。
#      手动上线时也要照抄这一行，别裸跑 npm run build。
#
# 日志：/var/log/qingwu-deploy.log

set -uo pipefail

REPO=/data/qingwu
LOG=/var/log/qingwu-deploy.log
LOCK=/tmp/qingwu-deploy.lock

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

# 9 号文件描述符持有锁，进程退出自动释放
exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO" || exit 1

git fetch --quiet origin main || { log "fetch 失败（网络？），跳过本轮"; exit 0; }

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

if ! git pull --ff-only --quiet >>"$LOG" 2>&1; then
  log "pull 失败：服务器上可能有本地改动，需要人工处理（目标 $REMOTE）"
  exit 1
fi

log "发现新提交 $REMOTE，开始构建"

if ! PUBLIC_HIT_WORKER_URL=/api PUBLIC_TURNSTILE_SITE_KEY= npm run build >>"$LOG" 2>&1; then
  log "构建失败，保持上一版"
  exit 1
fi

if [ ! -s "$REPO/dist/client/index.html" ]; then
  log "构建产物缺 index.html，放弃重启"
  exit 1
fi

systemctl restart qingwu-api
log "完成 $REMOTE"
