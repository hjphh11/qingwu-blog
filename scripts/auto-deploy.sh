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

# ——— 构建前先备份产物（2026-11-24 全站事故的补丁）———
# 上面那句注释原本写着「构建失败，保持上一版」，但那是**错的**：
# Astro build 一开始就把 dist 清空重建，页数是逐页写盘的，
# 任何一页抛错（比如 links.json 校验失败）都会留下「只有一半页面」的 dist。
# 而 nginx 对「目录存在、里面没有 index.html」的响应是 **403**，
# 于是首页、/links/、/music/ 全部 403，/projects/ 之类连目录都没建出来变 404 ——
# 整站看起来像挂了，实际上只是构建中断。旧产物必须自己搬走、失败再搬回来。
PREV="$REPO/.dist-prev"
rm -rf "$PREV"
[ -d "$REPO/dist" ] && mv "$REPO/dist" "$PREV"

rollback() {
  log "$1，回滚上一版产物"
  rm -rf "$REPO/dist"
  [ -d "$PREV" ] && mv "$PREV" "$REPO/dist"
  exit 1
}

if ! PUBLIC_HIT_WORKER_URL=/api PUBLIC_TURNSTILE_SITE_KEY= npm run build >>"$LOG" 2>&1; then
  rollback "构建失败"
fi

# 产物完整性闸门：光看 exit code 不够，必须确认关键页面真的落盘了
for f in index.html links/index.html music/index.html projects/index.html; do
  [ -s "$REPO/dist/client/$f" ] || rollback "构建产物缺 $f"
done

rm -rf "$PREV"

systemctl restart qingwu-api
log "完成 $REMOTE"
