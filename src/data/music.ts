export type Song = {
  title: string; // 歌名
  artist: string; // 作者/歌手
  cover: string; // 封面路径,如 /music/covers/xxx.jpg
  audio: string; // 音频路径,如 /music/xxx.mp3
  note?: string; // 一句短评
  lrc?: string; // 可选 LRC 歌词(带时间轴)
};

// 歌曲列表:把真实歌曲加进来即可(音频放 public/music/,封面放 public/music/covers/)。
// 目前为空,等你提供音乐后填充。
export const playlist: Song[] = [];
