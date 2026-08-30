export interface Song {
  id: string;
  title: string;
  artist: string;
  cover: string;
  src: string;
  note: string;
}

// 占位示例:后续把真实音频(mp3)放到 public/music/,封面放 public/music/covers/,并在此调整 src/cover。
export const SONGS: Song[] = [
  {
    id: 'song-1',
    title: '示例歌曲一',
    artist: '清吾',
    cover: '/music/covers/cover-1.svg',
    src: '/music/song-1.mp3',
    note: '把喜欢的旋律收进小屋 ~',
  },
  {
    id: 'song-2',
    title: '示例歌曲二',
    artist: '清吾',
    cover: '/music/covers/cover-2.svg',
    src: '/music/song-2.mp3',
    note: '一首听不腻的曲子 ₍ᐢ..ᐢ₎',
  },
  {
    id: 'song-3',
    title: '示例歌曲三',
    artist: '清吾',
    cover: '/music/covers/cover-3.svg',
    src: '/music/song-3.mp3',
    note: '循环一整个下午 ✨',
  },
];
