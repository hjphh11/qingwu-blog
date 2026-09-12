// 音乐管理（方案 §4.8 + 第 40 条）
//   · 只改现有歌曲的 title / artist / note / cover（**不做**新增歌曲、不做音频上传）
//   · 歌词用**时间轴列表**编辑：每行拆成「时间 + 文字」，可改时间/改文字/插行/删行
//   · 排序 = 前台歌单顺序（上下移动 + 保存）
//   · 改完**自动重跑 scripts/gen.mjs** 重新生成 src/data/music.ts
//
// 歌词文件的格式说明（很重要）：
//   public/music/lrc/*.lrc 是**混合格式** —— 顶部是 JSON 元信息行
//   （`{"t":0,"c":[{"tx":"作词: "},…]}`，带 li/or 链接），后面才是标准 LRC 行
//   （`[00:28.561]垂眸见 故城尽焚`）。
//   前台 `src/lib/musicStore.ts` 的 parseLRC **只认标准行**，JSON 行它直接忽略。
//   所以这里**把 JSON 行原样保留、只编辑标准行**；未改动的行按**原字节**回写，
//   做到「不改就不产生 diff」。换行符也沿用原文件的（这些 lrc 是 CRLF）。
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { badRequest, readJsonFile } from './jsonFile.js';

const MUSIC_FILE = () => path.join(config.repoPath, 'src', 'data', 'music.json');
const LRC_DIR = () => path.join(config.repoPath, 'public', 'music', 'lrc');

const urlLike = z.string().trim().min(1, '不能为空');

const SongSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1, '标题不能为空').max(120),
  artist: z.string().trim().max(120),
  cover: urlLike.max(300),
  audio: urlLike.max(300),
  note: z.string().max(200, '说明最多 200 字'),
  lrcFile: z.string().trim().max(120),
  lyrics: z
    .array(
      z.object({
        time: z
          .string()
          .trim()
          .regex(/^\d{1,3}:\d{2}(\.\d{1,3})?$/, '时间要写成 00:28.561 这样'),
        text: z.string().max(300, '一行歌词最多 300 字'),
        /** 原文行：没改动时按它原样回写，保证「不改就不产生 diff」 */
        raw: z.string().optional(),
      }),
    )
    .max(500, '歌词行数太多'),
});

const MusicSchema = z.object({ songs: z.array(SongSchema).min(1, '至少要有一首歌') });

// ——— LRC 解析 / 序列化 ———
const LRC_LINE_RE = /^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\](.*)$/;

/** 把 lrc 文本拆成「原样保留的行」与「可编辑的歌词行」*/
export function parseLrc(raw) {
  const lines = String(raw ?? '').split(/\r?\n/);
  const extras = [];
  const lyrics = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const m = line.match(LRC_LINE_RE);
    if (m) {
      lyrics.push({ time: `${m[1]}:${m[2]}`, text: (m[3] ?? '').trim(), raw: line });
    } else {
      extras.push(line); // JSON 元信息行等，原样保留
    }
  }
  return { extras, lyrics };
}

/** 序列化回 lrc：元信息行在前（原样），歌词行按原顺序；未改动的行原样写 */
export function serializeLrc({ extras = [], lyrics = [] }, eol = '\n') {
  const out = [];
  for (const e of extras) out.push(e);
  for (const l of lyrics) {
    const regenerated = `[${l.time}]${l.text}`;
    // 时间与文字都没变 → 用原文行（保留原有空格等细节）
    if (l.raw && l.raw.replace(/^\s+|\s+$/g, '') === regenerated) out.push(l.raw);
    else out.push(regenerated);
  }
  return out.join(eol) + eol;
}

async function readMusicJson() {
  const data = await readJsonFile(MUSIC_FILE());
  if (!data || !Array.isArray(data.songs) || data.songs.length === 0) {
    throw badRequest('music.json 里没有 songs 数组，或它是空的', 'bad_music_file');
  }
  return data;
}

/** 读一首歌的歌词文件 */
async function readLrcFile(name) {
  if (!name) return { raw: '', eol: '\n' };
  // 只允许文件名，挡住路径穿越
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw badRequest(`歌词文件名不合法：${name}`);
  }
  const file = path.join(LRC_DIR(), name);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return { raw, eol: raw.includes('\r\n') ? '\r\n' : '\n' };
  } catch {
    return { raw: '', eol: '\n' };
  }
}

/** 歌单：元数据 + 解析好的歌词行（给时间轴编辑器用）*/
export async function listMusic() {
  const { songs } = await readMusicJson();
  const out = [];
  for (const s of songs) {
    const { raw } = await readLrcFile(s.lrc);
    const { extras, lyrics } = parseLrc(raw);
    out.push({
      id: s.id,
      title: s.title,
      artist: s.artist ?? '',
      cover: s.cover ?? '',
      audio: s.audio ?? '',
      note: s.note ?? '',
      lrcFile: s.lrc ?? '',
      lyrics,
      /** 有几行元信息（JSON 行）—— 前台不用它们，这里只是告诉后台"它们会被原样保留" */
      extraLines: extras.length,
    });
  }
  return { songs: out, count: out.length };
}

/** music.json 手写序列化：与现有文件一样「一行一首」 */
function serializeMusicJson(songs) {
  const lines = songs.map((s) => {
    const parts = [
      `"id": ${s.id}`,
      `"title": ${JSON.stringify(s.title)}`,
      `"artist": ${JSON.stringify(s.artist)}`,
      `"cover": ${JSON.stringify(s.cover)}`,
      `"audio": ${JSON.stringify(s.audio)}`,
      `"note": ${JSON.stringify(s.note)}`,
      `"lrc": ${JSON.stringify(s.lrcFile)}`,
    ];
    return `    { ${parts.join(', ')} }`;
  });
  return `{\n  "songs": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/** 重跑 scripts/gen.mjs 生成 src/data/music.ts */
export function regenerateMusicTs() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['scripts/gen.mjs'],
      { cwd: config.repoPath, timeout: 60_000 },
      (err, stdout, stderr) => {
        const text = `${stdout ?? ''}${stderr ?? ''}`.trim();
        if (err) resolve({ ok: false, message: text || err.message });
        else resolve({ ok: true, message: text });
      },
    );
  });
}

/**
 * 整表保存：元数据 + 歌词 + 顺序一次提交，然后**重新生成 music.ts**。
 * id 不允许改（它对应 audio/cover 的默认路径与前台的 key）。
 */
export async function saveMusic(input) {
  const parsed = MusicSchema.safeParse(input);
  if (!parsed.success) {
    const f = parsed.error.issues[0];
    throw badRequest(
      `${f.path.join('.') || '(根)'}：${f.message}`,
      'validation',
    );
  }
  const before = (await readMusicJson()).songs;
  const beforeIds = new Set(before.map((s) => s.id));
  const songs = parsed.data.songs;

  // id 必须都是已有的（不做新增歌曲，方案 §4.8）
  for (const s of songs) {
    if (!beforeIds.has(s.id)) {
      throw badRequest(`不支持新增歌曲（id=${s.id} 不存在于 music.json）`, 'not_supported');
    }
  }
  for (const b of before) {
    if (!songs.some((s) => s.id === b.id)) {
      throw badRequest(`不支持删除歌曲（id=${b.id} 不见了）`, 'not_supported');
    }
  }

  // 1) 写歌词文件（元信息行原样保留，未改动的歌词行原样写回，换行沿用原文件）
  for (const s of songs) {
    if (!s.lrcFile) continue;
    const { raw, eol } = await readLrcFile(s.lrcFile);
    const { extras } = parseLrc(raw);
    const text = serializeLrc({ extras, lyrics: s.lyrics }, eol);
    const file = path.join(LRC_DIR(), s.lrcFile);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, text, { encoding: 'utf8' });
    await fs.rename(tmp, file);
  }

  // 2) 写 music.json（顺序 = 传进来的顺序 = 前台歌单顺序）
  //    换行沿用原文件（与 jsonFile.writeJsonFile 同样的理由）
  let eol = '\n';
  try {
    const old = await fs.readFile(MUSIC_FILE(), 'utf8');
    if (old.includes('\r\n')) eol = '\r\n';
  } catch {
    /* 用 LF */
  }
  const json = serializeMusicJson(
    songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      cover: s.cover,
      audio: s.audio,
      note: s.note,
      lrcFile: s.lrcFile,
    })),
  ).replace(/\r?\n/g, eol);
  const mf = MUSIC_FILE();
  const mt = `${mf}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(mt, json, { encoding: 'utf8' });
  await fs.rename(mt, mf);

  // 3) 重新生成 music.ts
  const regen = await regenerateMusicTs();

  return { ok: regen.ok, count: songs.length, regenerated: regen.message, musicJson: json };
}
