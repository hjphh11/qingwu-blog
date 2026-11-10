"""
字体子集化脚本。

为什么需要它：@fontsource 的中文字体按 unicode-range 切成 93 个分片，
全站实际只用到 1500 多个汉字，却要下载 174 个文件 / 13MB（woff2 + woff 双份）。

做法：
  1. 把 92 个中文字片合并成一个完整字库（拉丁分片不参与，否则字形重复）
  2. 按「这个字体实际要渲染哪些字」分别裁剪 —— 两种字体的字集**不一样**，见下
  3. 只输出 woff2（现代浏览器不需要 woff）
  4. 生成 @font-face 写到 src/styles/fonts.css

两种字体的字集为什么要分开（实测体积差距 4 倍）：
  · font-display（站酷小薇）挂在标题、数字和**访客城市名**上。
    城市名来自运行时 IP 定位，可能是任意地名 —— 构建期扫不到。
    所以它必须带 GB2312 一级常用字兜底，否则「攀枝花」这类地名会出方框。
  · font-hand（马善政楷体）只用在三处固定文案：开屏问候、空态提示、404 的「?」。
    文案全部写死在代码里，字集只有二十几个字，没必要背常用字。

用法：python scripts/subset-fonts.py
产物：public/fonts/*.woff2 + src/styles/fonts.css
"""

import glob
import hashlib
import os
import sys

from fontTools.merge import Merger
from fontTools.subset import Subsetter, Options

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "fonts")
CSS_OUT = os.path.join(ROOT, "src", "styles", "fonts.css")

# slug, CSS 族名, 键, 是否带常用字兜底
FAMILIES = [
    ("zcool-xiaowei", "ZCOOL XiaoWei", "display", True),
    ("ma-shan-zheng", "Ma Shan Zheng", "hand", False),
]

# font-hand 的三处文案（改文案时这里要跟着改，否则新字不打包）。
#   Splash.tsx:39      GREET
#   BlogList / links / share / MusicClient  空态提示
#   404.astro          q-lost__q
HAND_TEXTS = [
    "欢迎来到清吾的小屋",
    "这里还很空 ~",
    "音乐馆还没开张 ~",
    "友链还没开张 ~",
    "?",
]

SCAN_EXTS = (".md", ".mdx", ".json", ".astro", ".tsx", ".ts")


def gb2312_level1() -> str:
    """GB2312 一级汉字（3755 个），按区位码生成，不依赖外部字表文件。"""
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                continue
    return "".join(out)


def collect_chars() -> set[str]:
    """扫描 src/ 收集所有字符。宁可多留（含 fallback 文案）也不能少。"""
    chars = set()
    for dirpath, _dirnames, filenames in os.walk(os.path.join(ROOT, "src")):
        for name in filenames:
            if not name.endswith(SCAN_EXTS):
                continue
            with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                chars.update(fh.read())
    # 标点与西文兜底（动态插入的内容、用户昵称等）
    chars.update(
        "，。！？；：、“”‘’（）《》【】—…·・~～ 　0123456789"
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        ".,!?;:'\"()[]{}<>/\\|@#$%^&*_-+=`"
    )
    return chars


def cjk_slices(family_slug: str) -> list[str]:
    """取出该字体的 92 个中文字片，按编号排序（合并顺序要稳定）。"""
    files = glob.glob(
        os.path.join(ROOT, "node_modules", "@fontsource", family_slug, "files", "*.woff2")
    )
    cjk_files = [f for f in files if "-latin-" not in os.path.basename(f)]

    def idx(p: str) -> int:
        for part in os.path.basename(p).split("-"):
            if part.isdigit():
                return int(part)
        return 0

    cjk_files.sort(key=idx)
    return cjk_files


def subset_one(family_slug: str, chars: set[str]) -> int:
    """合并分片 → 按字集裁剪 → 输出 woff2，返回字节数。"""
    cjk_files = cjk_slices(family_slug)
    if not cjk_files:
        raise SystemExit(f"没找到 {family_slug} 的分片，先 npm i")

    print(f"  {family_slug}: 合并 {len(cjk_files)} 个分片…")
    # ⚠️ Merger.merge() 收的是**路径列表**（它自己打开文件），
    # 传已实例化的 TTFont 列表会报 "fileOrPath must be a file path"。
    merged = Merger().merge(cjk_files)
    total_glyphs = len(merged.getGlyphOrder())

    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.drop_tables += ["DSIG"]
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.recalc_timestamp = False

    sub = Subsetter(options=opts)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(merged)

    # —— 已知坏字形：**字体自身的问题**，不是子集化的锅 ——
    # 2026-11-10 实测：ZCOOL XiaoWei 的 U+56DE「回」渲染出来是一个**实心方块**
    # （不是缺字，是字形如此）。分片 118 与 chinese-simplified 完整包都一个样，
    # 所以与「合并 92 个分片」无关。
    # 处理办法：从 cmap 里摘掉这个码位 —— 浏览器找不到就会自动 fallback 到
    # fonts.css 字体栈里的下一个（Noto Serif SC / Songti SC / serif），
    # 视觉上仍是宋体系，几乎看不出来；但「回复」「回来」不会再变成黑方块。
    # ⚠️ 遇到别的方块字就往这里加，并在注释里写清楚是哪个字。
    if family_slug == "zcool-xiaowei":
        for cp in (0x56DE,):
            for table in merged["cmap"].tables:
                table.cmap.pop(cp, None)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{family_slug}-subset.woff2")
    merged.flavor = "woff2"
    merged.save(out_path)
    size = os.path.getsize(out_path)
    print(
        f"  {family_slug}: {total_glyphs} → {len(merged.getGlyphOrder())} 字形 / "
        f"{len(chars)} 字, {size / 1024:.0f}KB"
    )
    return size


def main() -> None:
    print("收集实际用字…")
    used = collect_chars()
    print(f"  扫描到 {len(used)} 个字符")

    hand_chars = set("".join(HAND_TEXTS)) | set(" ")
    print(f"  手写体固定文案 {len(hand_chars)} 个字符")

    print("生成字库…")
    results = []
    for slug, css_name, key, with_common in FAMILIES:
        if with_common:
            # 城市名等运行时未知内容 → 用一级常用字兜底
            chars = used | set(gb2312_level1())
        else:
            chars = hand_chars
        size = subset_one(slug, chars)
        results.append((css_name, slug, size))

    total = sum(s for _, _, s in results)
    lines = [
        "/* 由 scripts/subset-fonts.py 生成，不要手改。",
        "   重跑：python scripts/subset-fonts.py（改完文案后执行）",
        "",
        "   为什么要子集化：@fontsource 按 unicode-range 把中文字体切成 92 个分片，",
        "   原始 174 个文件 / 13MB。这里只打实际要渲染的字，两种字体字集不同：",
        "   · ZCOOL XiaoWei 承载标题与**运行时城市名**，故含 GB2312 一级常用字兜底；",
        "   · Ma Shan Zheng 只用于开屏问候/空态/404 的固定短句，字集按文案精确生成。",
        "   font-display: swap —— 字体没到时先用系统字体，绝不阻塞渲染。 */",
        "",
    ]
    for css_name, slug, _size in results:
        # ⚠️ URL 必须带内容指纹：nginx 对 /fonts/ 下的是 `immutable` + 1 年缓存，
        # 文件名固定时老访客永远拿不到新字形（2026-11-10 修「回」字时踩过）。
        fpath = os.path.join(OUT_DIR, f"{slug}-subset.woff2")
        with open(fpath, "rb") as fh:
            ver = hashlib.sha256(fh.read()).hexdigest()[:8]
        lines += [
            "@font-face {",
            f'  font-family: "{css_name}";',
            "  font-style: normal;",
            "  font-weight: 400;",
            "  font-display: swap;",
            f'  src: url("/fonts/{slug}-subset.woff2?v={ver}") format("woff2");',
            "}",
            "",
        ]
    with open(CSS_OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(f"\n合计 {total / 1024:.0f}KB → {OUT_DIR}")
    print(f"CSS → {CSS_OUT}")


if __name__ == "__main__":
    main()
