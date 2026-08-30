export type Song = {
  title: string; // 歌名
  artist: string; // 作者/歌手
  cover: string; // 封面路径,如 /music/covers/xxx.jpg
  audio: string; // 音频路径,如 /music/xxx.mp3
  note?: string; // 一句短评
  lrc?: string; // 可选 LRC 歌词(带时间轴)
};

// 占位示例:后续替换为真实歌曲。音频放 public/music/,封面放 public/music/covers/。
export const playlist: Song[] = [
  {
    title: '示例歌曲一',
    artist: '清吾',
    cover: '/music/covers/cover-1.svg',
    audio: '/music/song-1.mp3',
    note: '把喜欢的旋律收进小屋 ~',
    lrc: `[00:00.00]示例歌曲一 · 清吾
[00:03.00]把喜欢的旋律收进小屋
[00:06.00]一首听不腻的曲子
[00:09.00]循环一整个下午
[00:12.00]在旋律里 找到片刻安静
[00:15.00]伴我写 生活里的温柔`,
  },
  {
    title: '示例歌曲二',
    artist: '清吾',
    cover: '/music/covers/cover-2.svg',
    audio: '/music/song-2.mp3',
    note: '一首听不腻的曲子 ₍ᐢ..ᐢ₎',
  },
  {
    title: '示例歌曲三',
    artist: '清吾',
    cover: '/music/covers/cover-3.svg',
    audio: '/music/song-3.mp3',
    note: '循环一整个下午 ✨',
  },
];
