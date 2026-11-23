import { playlist } from '../data/music';
import { attachAnalyser, resumeAnalyser } from './audioAnalyser';

type Listener = () => void;
type PlayMode = 'order' | 'one' | 'random';

const S = {
  index: 'qingwu:index',
  playing: 'qingwu:playing',
  time: 'qingwu:time',
  volume: 'qingwu:volume',
  muted: 'qingwu:muted',
  mode: 'qingwu:mode',
  queue: 'qingwu:queue',
  qpos: 'qingwu:qpos',
};

let currentIndex = 0;
let isPlaying = false;
/**
 * 音频是不是正在「等数据」(网络没跟上 / 卡了)。
 *
 * 之前界面只看 isPlaying:只要 play() 的 promise 一 resolve 唱片就转起来,
 * 但那时音频往往还在 buffering —— 视觉上已经在「播」,听感上却没有声音。
 * 补上这个字段之后,唱片降速、声波降幅、外圈琥珀缓冲环都读它,
 * 状态与事实才一致(见 docs/开屏与全部加载动画-完整设计文档.html 第 04 节 ④)。
 */
let isBuffering = false;
let currentTime = 0;
/**
 * 总时长（秒）。
 *
 * ⚠️ **初值必须来自数据，不能是 0。** 音频元素在「没设 src / 还没 loadedmetadata」
 * 之前 duration 是 0，而播放器在首页、/music、迷你窗三处都读它 —— 一旦从 0 起步，
 * 访客看到的就是 `0:00 / 0:00`、进度条 `aria-valuemax=0` 且点不动，像播放器坏了。
 * 现在先用 music.json 里预置的时长（scripts/gen.mjs 透传），元数据到了再覆盖成精确值。
 */
let duration = Math.round(playlist[0]?.duration ?? 0);
/** 数据里预置的时长（秒）。音频元数据还没到位时用它兜底。 */
const metaDuration = () => Math.max(0, Math.round(playlist[currentIndex]?.duration ?? 0));
let volume = 0.8;
let isMuted = false;
let playMode: PlayMode = 'order';

/* ── 播放队列 ──────────────────────────────────────────────────────────
   原来只有 currentIndex 一个指针，「随机」是每次 Math.random() 抽一首 ——
   既可能连抽同一首，也让「上一首」无法回到真的上一首。
   现在队列存的是 **playlist 下标**，顺序即播放顺序：
     · 顺序 / 单曲 → 顺着 queue 走（列表循环）
     · 随机      → 进入时打乱「当前之后」的部分，退出时用快照还原
   queue 与 playlist 长度不一致也安全：restore() 会把新歌补到队尾。 */
let queue: number[] = playlist.map((_, i) => i);
/** 当前曲目在 queue 里的位置（不是 playlist 下标）。 */
let queuePos = 0;
/** 进随机模式前的原顺序快照；退出随机时用它还原，避免把「顺序」永久洗掉。 */
let orderBackup: number[] | null = null;

let audio: HTMLAudioElement | null = null;
let loadedIndex: number | null = null;
let initialized = false; // 整页加载只恢复一次;客户端路由跨页不重复恢复
const listeners = new Set<Listener>();

const currentSong = () => playlist[currentIndex] || null;

type Line = { time: number; text: string };
/** 没有歌词时的稳定空数组 —— 每次返回新 [] 会让歌词组件的 effect 反复重启。 */
const NO_LINES: Line[] = [];
/** 按 lrc 原文缓存解析结果：timeupdate 每秒四次，不缓存就是每秒四次全量正则。 */
const lrcCache = new Map<string, Line[]>();

function parseLRC(lrc = ''): Line[] {
  const cached = lrcCache.get(lrc);
  if (cached) return cached;
  const lines = lrc
    .split('\n')
    .map((line) => {
      const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
      if (!m) return null;
      return { time: Number(m[1]) * 60 + Number(m[2]), text: (m[3] || '').trim() };
    })
    .filter(Boolean) as Line[];
  lrcCache.set(lrc, lines);
  return lines;
}

/* ── 系统媒体控制（锁屏 / 耳机线控 / 媒体键） ──────────────────────────
   零依赖，但一直没人做：网页播放器锁屏后完全失控，耳机按一下也没反应。
   处理器只注册一次；metadata 在换歌与播放状态变化时同步。 */
function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return navigator.mediaSession;
}

function syncMetadata() {
  const s = mediaSession();
  if (!s) return;
  const song = currentSong();
  if (!song) return;
  try {
    s.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: '清吾 · 音乐馆',
      artwork: [{ src: song.cover, sizes: '512x512', type: 'image/webp' }],
    });
  } catch {
    /* 老浏览器没有 MediaMetadata 构造器：忽略即可 */
  }
}

function syncPlaybackState() {
  const s = mediaSession();
  if (s) s.playbackState = isPlaying ? 'playing' : 'paused';
}

/** 锁屏进度条。position 必须 ≤ duration，否则 setPositionState 会抛。 */
function syncPosition() {
  const s = mediaSession();
  const a = audio;
  if (!s || !a || !s.setPositionState) return;
  const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
  if (!total) return;
  try {
    s.setPositionState({
      duration: total,
      position: Math.min(a.currentTime || 0, total),
      playbackRate: a.playbackRate || 1,
    });
  } catch {
    /* 元数据还没到位时忽略这一帧 */
  }
}

function setupMediaSession() {
  const s = mediaSession();
  if (!s) return;
  const act = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      s.setActionHandler(action, fn);
    } catch {
      /* 该浏览器不支持这个 action */
    }
  };
  act('play', () => {
    if (!isPlaying) togglePlay();
  });
  act('pause', () => {
    if (isPlaying) togglePlay();
  });
  act('previoustrack', () => prevSong());
  act('nexttrack', () => nextSong());
  act('seekbackward', (d) => handleSeek(Math.max(0, currentTime - (d.seekOffset || 10))));
  act('seekforward', (d) => handleSeek(Math.min(duration, currentTime + (d.seekOffset || 10))));
  act('seekto', (d) => {
    if (typeof d.seekTime === 'number') handleSeek(d.seekTime);
  });
  act('stop', () => {
    if (isPlaying) togglePlay();
  });
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    // ⚠️ crossOrigin **必须赶在 src 之前**设。跨域音频不走 CORS 的话，
    // Web Audio 的输出会被规范要求静音 → 声音正常但频谱永远全 0（见 lib/audioAnalyser.ts）。
    // 对象存储回的是 `Access-Control-Allow-Origin: *`，所以这里安全；换托管商要重新确认。
    audio.crossOrigin = 'anonymous';
    let lastPosSync = 0;
    audio.addEventListener('timeupdate', () => {
      if (audio) currentTime = audio.currentTime;
      // 锁屏进度条一秒一次就够；每秒四次只会白算。
      const now = Date.now();
      if (now - lastPosSync > 1000) {
        lastPosSync = now;
        syncPosition();
      }
      emit();
    });
    audio.addEventListener('loadedmetadata', () => {
      // ⚠️ 用 `||` 而不是直接赋值：元数据刚解析出来那一次 duration 仍可能是 0/NaN，
      // 直接写会把数据里预置的时长（以及已经在显示的 3:19）清成 0:00。
      if (audio) duration = Math.round(audio.duration) || metaDuration();
      syncPosition();
      emit();
    });
    audio.addEventListener('ended', onEnded);

    // —— 缓冲态:只在这里判一次,MusicClient / MiniPlayer 都只读 isBuffering,
    //    不各写一套(否则两处的「正在缓冲」会在不同时刻亮灭)。
    const setBuffering = (on: boolean) => {
      if (isBuffering === on) return;
      isBuffering = on;
      emit();
    };
    audio.addEventListener('waiting', () => setBuffering(true));
    audio.addEventListener('stalled', () => setBuffering(true));
    audio.addEventListener('playing', () => setBuffering(false));
    audio.addEventListener('canplay', () => setBuffering(false));
    // 暂停 / 换源之后不该还挂着缓冲环
    audio.addEventListener('pause', () => setBuffering(false));

    setupMediaSession();
  }
  return audio;
}

/**
 * 播放时把分析器接上。放在这里而不是组件里，是因为「一个元素只能建一个
 * MediaElementAudioSource」—— 两处各建一次必然抛异常。
 * AudioContext 在首次播放（必然由点击触发）时创建，才不会是 suspended。
 * 取不到 Web Audio 就静默返回：没有声波而已，播放不受影响。
 */
function hookAnalyser(a: HTMLAudioElement) {
  if (!attachAnalyser(a)) return;
  resumeAnalyser();
}

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(S.index, String(currentIndex));
    localStorage.setItem(S.playing, isPlaying ? '1' : '0');
    localStorage.setItem(S.time, String(currentTime));
    localStorage.setItem(S.volume, String(volume));
    localStorage.setItem(S.muted, isMuted ? '1' : '0');
    localStorage.setItem(S.mode, playMode);
    localStorage.setItem(S.queue, JSON.stringify(queue));
    localStorage.setItem(S.qpos, String(queuePos));
  } catch {
    /* ignore */
  }
}

/** 把队列里不合法的下标剔掉，再把 playlist 新增的歌补到队尾。 */
function sanitizeQueue(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of raw) {
    if (!Number.isInteger(n) || n < 0 || n >= playlist.length || seen.has(n)) continue;
    seen.add(n);
    out.push(n as number);
  }
  playlist.forEach((_, i) => {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  });
  return out.length ? out : null;
}

function restore() {
  try {
    const i = Number(localStorage.getItem(S.index) || 0);
    if (i >= 0 && i < playlist.length) currentIndex = i;
    currentTime = Number(localStorage.getItem(S.time) || 0);
    volume = Number(localStorage.getItem(S.volume) || 0.8);
    isMuted = localStorage.getItem(S.muted) === '1';
    const mode = localStorage.getItem(S.mode);
    playMode = mode === 'one' || mode === 'random' ? mode : 'order';
    isPlaying = false; // 自动播放限制,恢复时默认暂停

    // ⚠️ 队列单独 try：localStorage 里要是存了半截 JSON，
    // 不该连带把「上次听到哪首」一起丢掉。
    let savedRaw: unknown = null;
    try {
      savedRaw = JSON.parse(localStorage.getItem(S.queue) || 'null');
    } catch {
      savedRaw = null;
    }
    const saved = sanitizeQueue(savedRaw);
    if (saved) queue = saved;
    else queue = playlist.map((_, idx) => idx);
    const at = queue.indexOf(currentIndex);
    queuePos = at >= 0 ? at : 0;
    // 随机态退出后不该「接着上次的洗牌」——启动一律按队列原样走
    orderBackup = null;

    // 还原出来的歌也要立刻有总时长（restore 发生在 any ensure 之前）
    duration = metaDuration();
    if (currentTime > duration) currentTime = 0;
  } catch {
    /* ignore */
  }
}

function ensure(index: number) {
  const a = getAudio();
  if (loadedIndex !== index) {
    a.src = playlist[index].audio;
    a.volume = isMuted ? 0 : volume;
    loadedIndex = index;
    // 换歌先把时长换成新歌在数据里预置的那个，别让它停在上一首的长度上
    duration = Math.max(0, Math.round(playlist[index]?.duration ?? 0));
    // 换源相当于重新开始等数据,先把这个状态清掉(新源真的卡住时会再触发 waiting)
    isBuffering = false;
    syncMetadata();
  }
}

/** 真正把某一首放起来（不动队列）。 */
function startSong(index: number) {
  if (index < 0 || index >= playlist.length) return;
  if (index !== currentIndex) {
    currentIndex = index;
    currentTime = 0;
    // 不是 0 —— 换成新歌在数据里预置的时长，界面立刻显示正确总长
    duration = Math.max(0, Math.round(playlist[index]?.duration ?? 0));
  }
  ensure(currentIndex);
  const a = getAudio();
  hookAnalyser(a);
  if (loadedIndex === currentIndex && currentTime > 0 && a.currentTime !== currentTime) {
    a.currentTime = currentTime;
  }
  a.play()
    .then(() => {
      isPlaying = true;
      syncPlaybackState();
      emit();
    })
    .catch(() => {
      isPlaying = false;
      syncPlaybackState();
      emit();
    });
  persist();
  emit();
}

/**
 * 用户从曲库 / 队列里点某一首。
 * 已在队列里 → 把游标移过去；不在 → 插到当前之后（连播这首再回到原顺序）。
 */
function playSong(index: number) {
  if (index < 0 || index >= playlist.length) return;
  const at = queue.indexOf(index);
  if (at >= 0) {
    queuePos = at;
  } else {
    queue.splice(queuePos + 1, 0, index);
    queuePos += 1;
  }
  // 点同一首 = 从头再来（这是播放器的常识，别静默不响应）
  if (index === currentIndex) {
    currentTime = 0;
    if (loadedIndex === index && audio) audio.currentTime = 0;
  }
  startSong(index);
}

/** 队列内前后走一步（列表循环）。 */
function step(dir: 1 | -1) {
  if (!queue.length) return;
  queuePos = (queuePos + dir + queue.length) % queue.length;
  startSong(queue[queuePos]);
}

function togglePlay() {
  const s = currentSong();
  if (!s) return;
  ensure(currentIndex);
  const a = getAudio();
  if (isPlaying) {
    a.pause();
    isPlaying = false;
    syncPlaybackState();
  } else {
    hookAnalyser(a);
    if (loadedIndex === currentIndex && currentTime > 0 && a.currentTime !== currentTime) {
      a.currentTime = currentTime;
    }
    a.play()
      .then(() => {
        isPlaying = true;
        syncPlaybackState();
        syncPosition();
        emit();
      })
      .catch(() => {
        isPlaying = false;
        syncPlaybackState();
        emit();
      });
  }
  persist();
  emit();
}

function onEnded() {
  if (playMode === 'one') {
    const a = getAudio();
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  step(1);
}

function nextSong() {
  step(1);
}

function prevSong() {
  step(-1);
}

/** 「下一首播放」：插到当前之后；原本已在队列里就先摘出来，避免重复。 */
function playNext(index: number) {
  if (index < 0 || index >= playlist.length || index === currentIndex) return;
  const at = queue.indexOf(index);
  if (at >= 0) {
    queue.splice(at, 1);
    if (at < queuePos) queuePos -= 1;
  }
  queue.splice(queuePos + 1, 0, index);
  persist();
  emit();
}

/** 从队列里移除一条（当前正在播的那条不能删，得先切走）。 */
function removeFromQueue(pos: number) {
  if (pos < 0 || pos >= queue.length) return;
  if (pos === queuePos || queue.length <= 1) return;
  queue.splice(pos, 1);
  if (pos < queuePos) queuePos -= 1;
  persist();
  emit();
}

function handleSeek(t: number) {
  const a = getAudio();
  const target = Math.max(0, Math.min(duration || a.duration || 0, t));
  a.currentTime = target;
  currentTime = target;
  syncPosition();
  emit();
}

function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (audio) audio.volume = isMuted ? 0 : volume;
  persist();
  emit();
}

function setMuted(m: boolean) {
  isMuted = m;
  if (audio) audio.volume = m ? 0 : volume;
  persist();
  emit();
}

/** 洗牌：只打乱「当前之后」的部分，已经听过的顺序保持不动。 */
function shuffleTail() {
  const tail = queue.slice(queuePos + 1);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  queue = queue.slice(0, queuePos + 1).concat(tail);
}

function togglePlayMode() {
  const next: PlayMode = playMode === 'order' ? 'one' : playMode === 'one' ? 'random' : 'order';
  if (next === 'random') {
    orderBackup = queue.slice();
    shuffleTail();
  } else if (playMode === 'random') {
    // 退出随机会把顺序还原 —— 否则「顺序播放」其实是刚才那副洗过的牌
    if (orderBackup) {
      queue = orderBackup;
      const at = queue.indexOf(currentIndex);
      queuePos = at >= 0 ? at : 0;
      orderBackup = null;
    }
  }
  playMode = next;
  persist();
  emit();
}

function getCurrentLyric(): { text: string; lines: Line[] } | null {
  const s = currentSong();
  if (!s?.lrc) return null;
  const lines = parseLRC(s.lrc);
  let text: string | null = null;
  for (const ln of lines) {
    if (ln.time <= currentTime) text = ln.text;
    else break;
  }
  return { text: text ?? '', lines };
}

function getState() {
  const lyric = getCurrentLyric();
  return {
    playlist,
    currentIndex,
    currentSong: currentSong(),
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    isMuted,
    playMode,
    queue: queue.slice(),
    queuePos,
    lrcLines: lyric?.lines ?? NO_LINES,
    currentLyric: lyric?.text ?? '',
  };
}

export function initMusic() {
  if (!initialized) {
    restore();
    initialized = true;
  }
  emit();
}

export function subscribe(cb: Listener) {
  listeners.add(cb);
  // 注册时立即回调一次,确保恢复出来的状态(如上次播放的歌)被界面拿到。
  // 否则 initMusic() 里的 restore()+emit() 先于订阅发生,首屏会停留在
  // 模块默认值(currentIndex=0,第 1 首歌),导致「切页后悬浮窗显示错歌」。
  cb();
  return () => {
    listeners.delete(cb);
  };
}

export function getMusicState() {
  return getState();
}

/**
 * 模块求值那一刻的状态快照 —— 也就是**还没被 restore() 还原过**的那份默认值。
 *
 * 为什么需要它：MusicClient 是 `client:load`，服务端会先渲染一份 HTML，
 * 那里面的状态就是这份默认值。但 MiniPlayer 是 `client:only`，它会先挂载并调用
 * `initMusic()` → `restore()`，把 localStorage 里的歌写进模块变量。
 * 之后 MusicClient 水合时再 `useState(getMusicState())`，拿到的就是「已还原」的状态，
 * 与服务端 HTML 对不上 —— React 报 hydration mismatch，而且明确说**不会修补**，
 * 界面会停在服务端那份（用户上次听的那首歌不显示）。
 *
 * 所以首帧必须用这份快照，等水合完成后再同步成真实状态。
 */
const PRISTINE_STATE = getState();

export function getPristineState() {
  return PRISTINE_STATE;
}

export function audioElement() {
  return getAudio();
}

export const music = {
  playSong,
  togglePlay,
  nextSong,
  prevSong,
  handleSeek,
  setVolume,
  setMuted,
  togglePlayMode,
  playNext,
  removeFromQueue,
};
