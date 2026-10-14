"""从爱弥斯立绘派生「纯剪影」素材(骨架屏占位用)。

为什么不用 AI 另画一张:爱弥斯是《鸣潮》授权角色,AI 生成既不合规、
画风也对不上站上其余官方立绘。剪影只需要轮廓,从既有立绘的 alpha 通道
派生即可 —— 同源同比例,和真实立绘天然对齐。

做法:取 alpha → 阈值化(去掉立绘边缘那圈极淡的光晕/投影残留)→ 裁到
人物包围盒 → 按高度缩放 → 铺上站点主色玫瑰粉(#f6a5b8)。

产物是「单色 + alpha」,既能当 <img> 直接用,也能当 CSS mask 用
(mask 只看 alpha,颜色无所谓)。

用法(需要 Pillow):
  python scripts/gen-emis-silhouette.py
"""

from __future__ import annotations

import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'images', 'emis', 'full.png')
OUT = os.path.join(ROOT, 'public', 'images', 'emis', 'silhouette.webp')

# 阈值:alpha 低于它的一律当「没有」。立绘外圈常有一圈极淡的投影/光晕残留,
# 不切掉的话剪影会肿出一圈毛边,当 mask 用时尤其明显。
ALPHA_MIN = 16
# 人物包围盒外再留一点空气,免得贴边
PAD = 10
# 输出高度:卡片里最大渲染约 200px,给 2.8x 的余量足够
TARGET_H = 560
ROSE = (246, 165, 184)  # --color-rose


def main() -> None:
    src = Image.open(SRC).convert('RGBA')
    alpha = src.getchannel('A')
    mask = alpha.point(lambda v: 255 if v >= ALPHA_MIN else 0)

    bbox = mask.getbbox()
    if bbox is None:
        raise SystemExit('alpha 通道全空,源图不对?')

    box = (
        max(0, bbox[0] - PAD),
        max(0, bbox[1] - PAD),
        min(src.width, bbox[2] + PAD),
        min(src.height, bbox[3] + PAD),
    )
    trimmed = mask.crop(box)

    height = TARGET_H
    width = max(1, round(trimmed.width * height / trimmed.height))
    resized = trimmed.resize((width, height), Image.LANCZOS)

    out = Image.new('RGBA', (width, height), (*ROSE, 0))
    out.putalpha(resized)
    out.save(OUT, 'WEBP', quality=90, method=6)

    print(f'源图      {src.size}')
    print(f'包围盒    {bbox} → 裁剪后 {trimmed.size}')
    print(f'输出      {out.size}  宽高比 {width / height:.4f}')
    print(f'文件      {OUT}  {os.path.getsize(OUT) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
