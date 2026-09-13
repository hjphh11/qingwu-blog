# 音乐素材目录

> **重要：音频与封面已经搬到对象存储了**（雨云 · 浙江宁波）。这个文件夹现在只放歌词与占位图。

## 现在的分工

| 东西 | 放哪 | 为什么 |
|---|---|---|
| **mp3 音频**（13 首，约 60MB） | **雨云对象存储** `music/audio/song-N.mp3` | 60MB 留在仓库里会让每次克隆/构建都拖着它；国内节点播放也更稳 |
| **jpg 大封面原图**（最大那张 6.5MB） | **只在本地与 git 历史里**（已从仓库移除） | 浏览器加载 6.5MB 一张图太亏 |
| **压缩后的封面** `cover-N.webp`（640×640，约 50KB） | **雨云** `music/covers/cover-N.webp`，**仓库里也留了一份** | 云上是站点实际用的；仓库这份是保险 —— 万一云那边出问题，改个前缀就能切回来 |
| **歌词** `*.lrc` | **仓库** `public/music/lrc/` | 很小（几十 KB），跟着站点走最省事 |
| **占位封面** `cover-N.svg` | **仓库** `public/music/covers/` | 歌曲没封面时的兜底 |

## 地址怎么写

地址写在 **`src/data/music.json`** 里（不是 `.ts`）；前台用的 `src/data/music.ts` 由
`scripts/gen.mjs` 自动生成 —— **直接改 `.ts` 没用，会被重新生成覆盖**：

```json
{
  "id": 1,
  "title": "Waking of a World",
  "audio": "https://qingwu.cn-nb1.rains3.com/music/audio/song-1.mp3",
  "cover": "https://qingwu.cn-nb1.rains3.com/music/covers/cover-1.webp",
  "lrc": "song-1.lrc"
}
```

改完执行 `npm run gen`；后台「音乐」页点「保存并重新生成」也会做同样的事。

## 想换对象存储（或切回本地）怎么办

地址集中在 `music.json` 的 `audio` / `cover` 两个字段，**改一处全站生效**：

- **切回仓库里的本地封面**：把 `cover` 换成 `/music/covers/cover-N.webp`（仓库里有这份文件 ✓）
- **换服务商**：把 URL 前缀（`https://qingwu.cn-nb1.rains3.com`）整体替换即可

## 新增一首歌的步骤

1. 把音频传到对象存储 `music/audio/song-<下一个编号>.mp3`
2. 封面先压到 **640×640 WebP**（约 50KB）再传上去 —— 播放器最大显示 256px，再大纯属浪费流量
   （原来有 9000×9000、6.5MB 的封面，已经统一压过了）
3. 歌词放进 `public/music/lrc/song-<编号>.lrc`
4. 在后台「音乐」页补上信息并保存（或直接改 `src/data/music.json` 后执行 `npm run gen`）
