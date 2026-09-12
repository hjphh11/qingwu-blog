// 由 `src/data/music.json`(歌曲元数据) + `public/music/lrc/*.lrc`(歌词) 生成 `src/data/music.ts`。
//
// 为什么要生成:歌词要在浏览器端解析,所以把 LRC 文本**内联**进 TS 模块随包发出
// (这与改造前行为一致)。后台(阶段 H)只改 music.json,再跑这个脚本重生成。
//
// 用法:
//   node scripts/gen.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const metaFile = path.join(root, 'src', 'data', 'music.json');
const lrcDir = path.join(root, 'public', 'music', 'lrc');
const outFile = path.join(root, 'src', 'data', 'music.ts');

/** 断言式读取:JSON 坏了就明确报错,不要静默生成半个文件 */
function readSongs() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  } catch (err) {
    throw new Error(`读取 ${metaFile} 失败:${err.message}`);
  }
  if (!raw || !Array.isArray(raw.songs) || raw.songs.length === 0) {
    throw new Error(`${metaFile} 里没有 songs 数组,或它是空的`);
  }
  return raw.songs;
}

function readLrc(name) {
  if (!name) return '';
  const f = path.join(lrcDir, name);
  if (!fs.existsSync(f)) {
    console.warn(`  ! 歌词文件不存在,留空:${name}`);
    return '';
  }
  return fs.readFileSync(f, 'utf8').trim();
}

const songs = readSongs();

/** 路径用单引号输出（与改造前的生成结果逐字节一致）；含单引号/反斜杠时退回 JSON 双引号 */
const q = (s) =>
  typeof s === 'string' && !s.includes("'") && !s.includes('\\') ? `'${s}'` : JSON.stringify(s);

const entries = songs
  .map((s, idx) => {
    const n = Number.isFinite(s.id) ? s.id : idx + 1;
    const cover = s.cover || `/music/covers/cover-${n}.jpg`;
    const audio = s.audio || `/music/audio/song-${n}.mp3`;
    // 反引号与 ${ 需要转义,否则会破坏模板字符串
    const lrc = readLrc(s.lrc).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `  {
    title: ${JSON.stringify(s.title)},
    artist: ${JSON.stringify(s.artist)},
    cover: ${q(cover)},
    audio: ${q(audio)},
    note: ${JSON.stringify(s.note ?? '')},
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

// 本文件由 scripts/gen.mjs 从 src/data/music.json 生成,**不要手改** ——
// 改歌曲信息请改 music.json 再跑 \`node scripts/gen.mjs\`。
// 《鸣潮》音乐(本地自托管):音频/封面/歌词在 public/music/。
export const playlist: Song[] = [
${entries}
];
`;

fs.writeFileSync(outFile, content, 'utf8');
console.log(`music.ts 已重新生成:${songs.length} 首`);
