#!/usr/bin/env python3
"""把 gallery-to-r2.py 的 done.jsonl 切成画市用的分片索引（在**本地**跑）。

为什么索引不进 R2，而是跟站点一起发：
  R2 公共域（img.qingwu.ink）不回 Access-Control-Allow-Origin，前端 fetch 那个
  JSON 会被浏览器直接拦掉。图片是 <img> 引的，不受 CORS 限制，所以图可以放 R2、
  索引必须同源。分片后每片 ~4KB（gzip），墙每次只随机取一片。

产物：
  public/gallery/data/<n>.json   每片 PER_SHARD 条 [{"id","w","h"}]
  src/data/gallery.json          { base, count, shards, perShard, sample }
                                 —— sample 给 SSR 清单和前端兜底用

用法：
  python scripts/build-gallery-index.py --done /tmp/done.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

PER_SHARD = 500
SAMPLE = 60
BASE = "https://img.qingwu.ink/gallery"
ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--done", required=True, help="gallery-to-r2.py 产出的 done.jsonl")
    ap.add_argument("--seed", type=int, default=20261111)
    args = ap.parse_args()

    items: list[dict] = []
    for line in Path(args.done).read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            items.append({"id": r["id"], "w": r["w"], "h": r["h"]})

    # 打散一次：分片里就别再是「同一批 hash 挨在一起」
    random.Random(args.seed).shuffle(items)

    out = ROOT / "public" / "gallery" / "data"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()

    shards = 0
    for i in range(0, len(items), PER_SHARD):
        chunk = items[i : i + PER_SHARD]
        (out / f"{shards}.json").write_text(
            json.dumps(chunk, separators=(",", ":")), encoding="utf-8"
        )
        shards += 1

    manifest = {
        "base": BASE,
        "count": len(items),
        "shards": shards,
        "perShard": PER_SHARD,
        "sample": items[:SAMPLE],
    }
    (ROOT / "src" / "data" / "gallery.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    size = sum(p.stat().st_size for p in out.glob("*.json"))
    print(f"✅ {len(items)} 张 → {shards} 片 · 索引共 {size / 1024:.0f}KB · "
          f"sample {len(manifest['sample'])} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
