#!/usr/bin/env python3
"""把画市的一大批图抓到 R2 上（下载 → 转两档尺寸 → 上传 → 出分片索引）。

为什么跑在香港那台机上，而不是本地：
  · 源站（img.mibase.top）和 R2 都在境外，服务器离两边都近，2GB 走的是机房带宽；
    本地抓再传等于把 4GB 塞进家宽上行。
  · 服务器上已经有 R2 的 S3 凭据（/etc/qingwu-r2.conf，备份脚本在用）。

产物（都进 R2，公开域 https://img.qingwu.ink/）：
  <prefix>/<id>.webp     大图  最长边 ≤1100×1650（看大图用）
  <prefix>/<id>-t.webp   瓦片  560×560 正方形（墙上用）
  <prefix>/index/<n>.json  每 500 条一片：[{"id","w","h"}]，前端随机取一片
  <prefix>/index/meta.json {"count","shards","perShard","base"}

为什么要分片索引：全量一万多条 id 塞进一个 JSON 有一百多 KB；
墙每次只要三四十张，随机拿一片 3KB 就够，而且每次进来都不一样。

断点续跑：done.jsonl 记已完成的 id，中断后重跑会跳过（只有正在上传的那一批会重来）。

用法（在服务器上，先 export RCLONE_CONFIG_R2_* 那几个变量，见 qingwu-backup.sh）：
  python3 gallery-to-r2.py --listing /data/gallery-build/listing.json \
      --target-bytes 2147483648 --workers 6
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

SRC = "https://img.mibase.top/waifus/full/{id}.webp"
TILE = 560
TILE_TOP_BIAS = 0.06
PER_SHARD = 500
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"}

_lock = threading.Lock()


def log(msg: str) -> None:
    with _lock:
        print(f"[{time.strftime('%F %T')}] {msg}", flush=True)


def fetch(url: str, tries: int = 3) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 —— 网络抖动一律重试
            last = exc
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def convert(raw: bytes, stage: Path, img_id: str) -> tuple[int, int]:
    """大图原样落地 + 出一张方瓦片，返回（原图）尺寸。

    ⚠️ 大图**不重编码**：源站给的就是压缩好的 webp，再 encode 一遍只会掉画质，
      还让 CPU 时间翻倍（实测 12 张：只做瓦片 0.45s/张，加一次 1100px 重编码 0.89s/张）。
      文件名就是内容哈希，原样上传最老实。
    """
    with Image.open(io.BytesIO(raw)) as im:
        w, h = im.size
        is_webp = (im.format or "").upper() == "WEBP"

        if not is_webp:
            im.convert("RGB").save(stage / f"{img_id}.webp", "WEBP", quality=82, method=4)

        side = min(w, h)
        top = max(0, min(int(h * TILE_TOP_BIAS), h - side))
        left = (w - side) // 2
        im.convert("RGB").crop((left, top, left + side, top + side)).resize(
            (TILE, TILE), Image.LANCZOS
        ).save(stage / f"{img_id}-t.webp", "WEBP", quality=78, method=4)

    if is_webp:
        (stage / f"{img_id}.webp").write_bytes(raw)
    return w, h


def rclone_upload(stage: Path, remote: str, workers: int) -> None:
    """整目录推上去。Cache-Control 设 immutable —— 文件名就是内容哈希，永远不会变。"""
    cmd = [
        "rclone", "copy", str(stage), remote,
        "--transfers", str(workers), "--checkers", str(workers * 2),
        "--header-upload", "Cache-Control: public, max-age=31536000, immutable",
        "--s3-no-check-bucket", "--retries", "3", "--low-level-retries", "5",
        "--quiet",
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listing", required=True, help="[hash,w,h] 数组的 JSON")
    ap.add_argument("--work", default="/data/gallery-build")
    ap.add_argument("--bucket", default="qingwu-uploads")
    ap.add_argument("--prefix", default="gallery")
    ap.add_argument("--target-bytes", type=int, default=2 * 1024**3, help="原图累计到这个数就收手")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--batch", type=int, default=400, help="每批上传条数")
    ap.add_argument("--seed", type=int, default=20261111, help="抽样顺序（固定的话可复现）")
    args = ap.parse_args()

    work = Path(args.work)
    stage = work / "stage"
    stage.mkdir(parents=True, exist_ok=True)
    done_path = work / "done.jsonl"

    listing = json.loads(Path(args.listing).read_text())
    ids = [row[0] for row in listing]

    # 先打散再取：清单是按 hash 排的，顺着头几千张可能集中在同一批作者/时期
    random.Random(args.seed).shuffle(ids)

    done: dict[str, tuple[int, int]] = {}
    if done_path.exists():
        for line in done_path.read_text().splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            done[r["id"]] = (r["w"], r["h"])
    log(f"清单 {len(ids)} 张，已完成 {len(done)} 张")

    todo = [i for i in ids if i not in done]
    total_bytes = 0
    started = time.time()
    done_this_run = 0

    batch: list[tuple[str, int, int]] = []
    remote = f"r2:{args.bucket}/{args.prefix}"

    def flush() -> None:
        nonlocal batch
        if not batch:
            return
        rclone_upload(stage, remote, args.workers)
        with done_path.open("a") as f:
            for img_id, w, h in batch:
                f.write(json.dumps({"id": img_id, "w": w, "h": h}) + "\n")
        for p in stage.iterdir():
            p.unlink()
        done_n = len(done) + done_this_run
        rate = done_this_run / max(1e-6, (time.time() - started) / 60)
        log(f"上传一批 → R2 累计 {done_n} 张 · 本次 {done_this_run} 张 · "
            f"{rate:.0f} 张/分 · 原图 {total_bytes / 1024 / 1024:.0f}MB")
        batch = []

    def work_one(img_id: str) -> tuple[str, int, int, int] | None:
        try:
            raw = fetch(SRC.format(id=img_id))
            vw, vh = convert(raw, stage, img_id)
            return img_id, vw, vh, len(raw)
        except Exception as exc:  # noqa: BLE001
            log(f"失败 {img_id}: {exc}")
            return None

    # ⚠️ 别用 `for res in pool.map(work_one, todo)`：map 会**一次性把所有任务提交**，
    # 里面 break 只是不再消费结果，池子照样把一万多张全下完。所以按批切片提交。
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pos = 0
        while pos < len(todo) and total_bytes < args.target_bytes:
            chunk = todo[pos : pos + args.batch]
            pos += len(chunk)
            for res in pool.map(work_one, chunk):
                if res is None:
                    continue
                img_id, vw, vh, nbytes = res
                batch.append((img_id, vw, vh))
                total_bytes += nbytes
                done_this_run += 1
            flush()

    flush()

    # ── 收尾：把「已完成的 id + 尺寸」整理成索引放在本地工作目录，
    #    由 scripts/build-gallery-index.py 拿回去切成站点用的分片。
    #    ⚠️ 索引**不上 R2**：公共桶的自定义域不带 Access-Control-Allow-Origin，
    #    前端 fetch 跨源会被浏览器拦掉；同源出（站点自己的 /gallery/data/N.json）最稳。
    all_items = []
    for line in done_path.read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            all_items.append({"id": r["id"], "w": r["w"], "h": r["h"]})
    (work / "all.json").write_text(json.dumps(all_items, separators=(",", ":")), encoding="utf-8")

    log(f"完成：{len(all_items)} 张 · 原图 {total_bytes / 1024**2:.0f}MB · "
        f"耗时 {(time.time() - started) / 60:.1f} 分钟")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
