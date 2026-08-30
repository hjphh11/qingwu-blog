import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const musicDir = path.join(__dirname, '..', 'public', 'music');
const outFile = path.join(__dirname, '..', 'src', 'data', 'music.ts');

const songs = [
  { title: 'Waking of a World', artist: 'TerryZhong钟天利 / 炎明熹', note: '《鸣潮》公测主题曲' },
  { title: '愿戴荣光坠入天渊', artist: 'jixwang / VISION SOUND', note: '卡提希娅主题曲' },
  { title: '涤罪的咏叹调', artist: '十音', note: '罗蕾莱 Boss 主题曲' },
  { title: '今州鸾鸣', artist: '梨华rika / 不要杀我!', note: '长离与今汐师徒印象曲' },
  { title: '持续瞬间的永恒', artist: 'jixwang / markmilian', note: '尤诺 BGM' },
  { title: '悠忽舞于梦中', artist: 'jixwang / VISION SOUND', note: '罗蕾莱云海隐藏约会曲' },
  { title: '尘外客', artist: '蔡明希(不才) / 宫阁', note: '' },
  { title: '定玄', artist: '黄霄雲 / 杨秉音', note: '' },
  { title: '玄翎谣', artist: 'jkinss / 薄荷Miint', note: '' },
  { title: '小小奇迹', artist: 'jixwang / 飞行雪绒', note: '' },
  { title: '那颗星梦见的春日', artist: 'jixwang / 小林未郁', note: '' },
  { title: '纸飞机', artist: '飞行雪绒', note: '' },
  { title: '远航星的告别', artist: 'jixwang / Tarokiki / Emi Evans', note: '' },
];

function readLrc(i) {
  const f = path.join(musicDir, 'lrc', `song-${i}.lrc`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
}

const entries = songs
  .map((s, idx) => {
    const n = idx + 1;
    const lrc = readLrc(n).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `  {
    title: ${JSON.stringify(s.title)},
    artist: ${JSON.stringify(s.artist)},
    cover: '/music/covers/cover-${n}.jpg',
    audio: '/music/audio/song-${n}.mp3',
    note: ${JSON.stringify(s.note)},
    lrc: \`${lrc}\`,
  },`;
  })
  .join('\n');

const content = `export type Song = {
  title: string;
  artist: string;
  cover: string;
  audio: string;
  note?: string;
  lrc?: string;
};

// 《鸣潮》音乐(本地自托管):音频/封面/歌词在 public/music/,替换即改此文件。
export const playlist: Song[] = [
${entries}
];
`;

fs.writeFileSync(outFile, content, 'utf8');
console.log('music.ts generated with', songs.length, 'songs');
