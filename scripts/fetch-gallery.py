#!/usr/bin/env python3
"""抓一组图，裁成「画市」图片墙要用的两档尺寸。

背景：画市（/gallery）是一面可以往任意方向拖的图片墙。墙上的瓦片是**正方形**
（拖拽时图案要能严丝合缝地循环，非等比方格会让接缝错位），点开看的是原比例大图。
所以每张图出两份产物：

  public/images/gallery/<id>-t.webp   瓦片  560×560 正方形（中心偏上裁）
  public/images/gallery/<id>.webp     大图  最长边 ≤1100 / 1650，保持原比例

外加一份清单 src/data/gallery.json —— 页面只认它，不扫目录（构建期扫目录会让
「删了图但忘了删清单」这种情况在线上变成 404，清单是唯一事实来源）。

图片来源：https://blog.mibase.top/photo（昭鸢笺的画廊），清单 JSON 里给的是
`[hash, thumb宽, thumb高]`，实际文件在 https://img.mibase.top/waifus/full/<hash>.webp。
⚠️ 这些图不是本站原创，页面上留了一行「图片来自 昭鸢笺」的出处。

用法：
  python scripts/fetch-gallery.py            # 取 24 张（已存在的跳过）
  python scripts/fetch-gallery.py --count 32 # 换数量
  python scripts/fetch-gallery.py --force    # 重新下载，覆盖已有

⚠️ 只在本地跑一次，产物要进仓库（服务器构建时不联网抓图）。
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "images" / "gallery"
MANIFEST = ROOT / "src" / "data" / "gallery.json"

LIST_URL = (
    "https://blog.mibase.top/photo/"
    "gallery-data.8500bee2dedd7ec86ffd1c8232547f9cabac597a01104a002eb97abe769fbded.json"
)
IMG_BASE = "https://img.mibase.top/waifus/full/{id}.webp"
SOURCE_PAGE = "https://blog.mibase.top/photo"

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"}

TILE = 560          # 瓦片边长（2× 下足够铺满 ~280px 的格子）
TILE_TOP_BIAS = 0.06  # 正方形裁切从顶部 6% 起 —— 立绘的头基本都在上半部
VIEW_MAX = (1100, 1650)  # 大图最长边：1100 宽 / 1650 高，够看又不至于几 MB

# 人工剔除：这几张是泳装 / 内衣特写。站子是暖色治愈向，这面墙又贴在导航后面
# 铺满整屏，把这类图放上去跟整站的观感打架 —— 所以抽样时跳过。
# 要全都要就把这里清空重跑（记得先删掉 public/images/gallery 里对应的两张）。
EXCLUDE = {
    "157540fac0",  # 泳装 · 海滩
    "1fe23bd1f8",  # 泳装 · 海边
    "ca3f295447",  # 内衣 · 特写
    "54f1f6ab48",  # 内衣 · 红丝带
    "858e297037",  # 泳装 · 背影
}


def fetch(url: str, tries: int = 3) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 —— 网络问题一律重试
            last = exc
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"下载失败 {url}: {last}")


def square_crop(im: Image.Image) -> Image.Image:
    """按「偏上」的正方形裁切。人像的重心在上面，正中心裁会把脸切掉一半。"""
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = int(h * TILE_TOP_BIAS)
    top = max(0, min(top, h - side))
    return im.crop((left, top, left + side, top + side))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=24)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"· 读清单 {LIST_URL}")
    listing = json.loads(fetch(LIST_URL))
    if not isinstance(listing, list) or not listing:
        print("清单格式不认识，退出", file=sys.stderr)
        return 1
    print(f"  共 {len(listing)} 张可选")

    # 等距抽样：清单是按 hash 排序的，等距取能覆盖到不同作者/时期的图，
    # 比取前 N 张（可能是一批同一套图）更像一面「墙」。
    # 步长取「总数 / (目标数 × 2)」再筛掉 EXCLUDE，保证剔除几张之后还凑得够。
    stride = max(1, len(listing) // (args.count * 2))
    picked = []
    for i in range(0, len(listing), stride):
        if listing[i][0] in EXCLUDE:
            continue
        picked.append(listing[i])
        if len(picked) >= args.count:
            break

    items = []
    total = 0
    for n, entry in enumerate(picked, 1):
        img_id = entry[0]
        view_path = OUT_DIR / f"{img_id}.webp"
        tile_path = OUT_DIR / f"{img_id}-t.webp"

        if not args.force and view_path.exists() and tile_path.exists():
            with Image.open(view_path) as im:
                vw, vh = im.size
            items.append({"id": img_id, "w": vw, "h": vh})
            total += view_path.stat().st_size + tile_path.stat().st_size
            print(f"  [{n:02d}/{len(picked)}] {img_id} 已存在，跳过")
            continue

        raw = fetch(IMG_BASE.format(id=img_id))
        with Image.open(io.BytesIO(raw)) as im:
            im = im.convert("RGB")

            view = im.copy()
            view.thumbnail(VIEW_MAX, Image.LANCZOS)
            view.save(view_path, "WEBP", quality=80, method=6)

            tile = square_crop(im).resize((TILE, TILE), Image.LANCZOS)
            tile.save(tile_path, "WEBP", quality=78, method=6)

            vw, vh = view.size

        size = view_path.stat().st_size + tile_path.stat().st_size
        total += size
        items.append({"id": img_id, "w": vw, "h": vh})
        print(f"  [{n:02d}/{len(picked)}] {img_id}  {im.size[0]}×{im.size[1]} → "
              f"大图 {vw}×{vh}  {size // 1024}KB")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps(
            {
                "source": SOURCE_PAGE,
                "note": "由 scripts/fetch-gallery.py 生成：瓦片 <id>-t.webp，大图 <id>.webp",
                "items": items,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n✅ {len(items)} 张，合计 {total / 1024 / 1024:.2f}MB")
    print(f"   清单 → {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
