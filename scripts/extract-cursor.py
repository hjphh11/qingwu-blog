#!/usr/bin/env python3
"""从 Windows 光标主题（.ani）抽帧导出网页用 PNG。

背景：站点的光标沿用本机安装的 Windows 主题「[Sunglasses] Aemeath by BLZ」。
浏览器 cursor 不能可靠使用 .ani（只有 Windows 上的部分浏览器认），
所以这里把每类光标取第 0 帧导出成 32×32 PNG —— 原图就是 32×32，
1:1 上屏不缩放，像素画不会糊。

⚠️ 这个脚本只在 Windows 本地跑一次，产物 public/images/cursor/*.png 要进仓库
   （Vercel 构建环境没有这个目录，也不会执行它）。
⚠️ 换主题 / 换图之后，必须同步更新 src/styles/cursor.css 里的热点坐标，
   脚本会把每类的 hotspot 打出来，照抄即可。

为什么要自己解位图：这套主题的帧是 8bpp 调色板 DIB + AND mask
（BITMAPINFOHEADER 的 biHeight 是实际高度的两倍，下半部是 1bpp 掩码）。
Pillow 读 ICO/CUR 时不会应用这个掩码，直接 convert('RGBA') 会把
"该透明的地方"变成不透明黑块 —— 必须手动按掩码抠。

用法：
  python scripts/extract-cursor.py
  python scripts/extract-cursor.py --dir "C:/windows/Cursors/某主题" --out public/images/cursor
"""

from __future__ import annotations

import argparse
import os
import struct
import sys

from PIL import Image

DEFAULT_DIR = r"C:\windows\Cursors\[Sunglasses]Aemeath_by BLZ"
DEFAULT_OUT = os.path.join("public", "images", "cursor")

# 网页实际用到的几类：源文件主名 -> 输出文件名
WANTED = [
    ("Normal", "normal"),         # 默认箭头
    ("Link", "link"),             # 可点击
    ("Text", "text"),             # 文本 / 输入
    ("Unavailable", "disabled"),  # 禁用
    ("Move", "move"),             # 拖动
]


def parse_ani(data: bytes):
    """返回 (frames, info)。frames 为内嵌 CUR/ICO 的原始字节列表。"""
    if data[:4] != b"RIFF" or data[8:12] != b"ACON":
        raise ValueError("不是 RIFF/ACON 动画光标")
    frames: list[bytes] = []
    info: dict = {}
    pos = 12
    while pos + 8 <= len(data):
        cid = data[pos : pos + 4]
        size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"anih":
            _cb, nf, ns = struct.unpack("<3I", body[:12])
            info = {"frames": nf, "steps": ns}
        elif cid == b"LIST" and body[:4] == b"fram":
            p = 4
            while p + 8 <= len(body):
                cid2 = body[p : p + 4]
                size2 = struct.unpack("<I", body[p + 4 : p + 8])[0]
                if cid2 == b"icon":
                    frames.append(body[p + 8 : p + 8 + size2])
                p += 8 + size2 + (size2 & 1)
        pos += 8 + size + (size & 1)
    return frames, info


def hotspot(cur: bytes) -> tuple[int, int]:
    """CUR 目录项第 10-13 字节是热点（ICO 里这两字节是颜色数/保留位）。"""
    if struct.unpack("<H", cur[2:4])[0] != 2:
        return (0, 0)
    return struct.unpack("<HH", cur[10:14])


def decode_cur(cur: bytes) -> Image.Image:
    """解单个 CUR/ICO 为 RGBA，正确应用 AND mask。"""
    _res, _kind, count = struct.unpack("<HHH", cur[:6])
    if count < 1:
        raise ValueError("空图标目录")

    # 取最大的一张（本主题只有一张 32×32，这里只是保险）
    best = None
    for i in range(count):
        entry = cur[6 + i * 16 : 6 + (i + 1) * 16]
        w, h, _n, _r, _p, bpp, size, off = struct.unpack("<BBBBHHII", entry)
        w = w or 256
        h = h or 256
        if best is None or w * h > best[0]:
            best = (w * h, w, h, bpp, size, off)
    if best is None:
        raise ValueError("没有可用条目")

    _area, width, height, bpp, size, off = best
    bmp = cur[off : off + size]
    # 目录项里的 bpp 常写作 0（系统忽略），只能靠 DIB 头判断：
    # 以 0x89 'PNG' 开头的是 PNG 压缩图标，否则是 BITMAPINFOHEADER（40）
    if bmp[:4] == b"\x89PNG":
        import io

        return Image.open(io.BytesIO(bmp)).convert("RGBA")

    _hdr_size = struct.unpack("<I", bmp[:4])[0]
    bi_w, bi_h, _planes, bpp = struct.unpack("<iiHH", bmp[4:16])
    hdr = _hdr_size
    rows = bi_h // 2 if bi_h == height * 2 else height

    palette = []
    xor_off = hdr
    if bpp <= 8:
        n = 1 << bpp
        palette = [
            tuple(reversed(bmp[hdr + i * 4 : hdr + i * 4 + 3]))  # BGR -> RGB
            for i in range(n)
            if hdr + i * 4 + 3 <= len(bmp)
        ]
        xor_off = hdr + n * 4

    xor_stride = ((bi_w * bpp + 31) // 32) * 4
    mask_stride = ((bi_w + 31) // 32) * 4
    mask_off = xor_off + xor_stride * rows

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    has_mask = len(bmp) >= mask_off + mask_stride * rows

    for y in range(min(rows, height)):
        src_y = rows - 1 - y  # DIB 自下而上
        base = xor_off + src_y * xor_stride
        mbase = mask_off + src_y * mask_stride
        for x in range(min(bi_w, width)):
            if bpp <= 8:
                idx = bmp[base + x]
                r, g, b = palette[idx] if idx < len(palette) else (0, 0, 0)
            elif bpp == 24:
                b, g, r = bmp[base + x * 3 : base + x * 3 + 3]
            else:  # 32bpp BGRA
                b, g, r, _a = bmp[base + x * 4 : base + x * 4 + 4]
            transparent = False
            if has_mask:
                bit = (bmp[mbase + (x // 8)] >> (7 - (x % 8))) & 1
                transparent = bit == 1
            px[x, y] = (r, g, b, 0 if transparent else 255)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR, help="光标主题目录")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出目录")
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        print(f"[x] 找不到目录：{args.dir}", file=sys.stderr)
        return 1
    os.makedirs(args.out, exist_ok=True)

    total = 0
    for src, dst in WANTED:
        path = os.path.join(args.dir, src + ".ani")
        if not os.path.isfile(path):
            print(f"[!] 跳过 {src}：{path} 不存在")
            continue
        with open(path, "rb") as fh:
            frames, info = parse_ani(fh.read())
        if not frames:
            print(f"[!] 跳过 {src}：没有帧")
            continue

        im = decode_cur(frames[0])
        target = os.path.join(args.out, dst + ".png")
        im.save(target, "PNG", optimize=True)
        size = os.path.getsize(target)
        total += size
        hx, hy = hotspot(frames[0])
        opaque = sum(1 for p in im.getdata() if p[3] > 0)
        print(
            f"{src:12s} -> {dst + '.png':12s} {im.size[0]}x{im.size[1]}  "
            f"{size / 1024:5.1f} KB  不透明 {opaque:4d}/{im.size[0] * im.size[1]}  "
            f"热点 ({hx}, {hy})  源 {info.get('frames', '?')} 帧"
        )

    print(f"\n合计 {total / 1024:.1f} KB -> {os.path.abspath(args.out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
