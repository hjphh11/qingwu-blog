import { playlist } from '../data/music';

type Listener = () => void;
type PlayMode = 'order' | 'one' | 'random';

const S = {
  index: 'qingwu:index',
  playing: 'qingwu:playing',
  time: 'qingwu:time',
  volume: 'qingwu:volume',
  muted: 'qingwu:muted',
  mode: 'qingwu:mode',
};

let currentIndex = 0;
let isPlaying = false;
let currentTime = 0;
let duration = 0;
let volume = 0.8;
let isMuted = false;
let playMode: PlayMode = 'order';
let audio: HTMLAudioElement | null = null;
let loadedIndex: number | null = null;
let initialized = false; // 整页加载只恢复一次;客户端路由跨页不重复恢复
const listeners = new Set<Listener>();

const currentSong = () => playlist[currentIndex] || null;

function parseLRC(lrc = ''): { time: number; text: string }[] {
  return lrc
    .split('\n')
    .map((line) => {
      const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
      if (!m) return null;
      return { time: Number(m[1]) * 60 + Number(m[2]), text: (m[3] || '').trim() };
    })
    .filter(Boolean) as { time: number; text: string }[];
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('timeupdate', () => {
      if (audio) currentTime = audio.currentTime;
      emit();
    });
    audio.addEventListener('loadedmetadata', () => {
      if (audio) duration = audio.duration || 0;
      emit();
    });
    audio.addEventListener('ended', onEnded);
  }
  return audio;
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
  } catch {
    /* ignore */
  }
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
  }
}

function playSong(index: number) {
  if (index < 0 || index >= playlist.length) return;
  if (index !== currentIndex) {
    currentIndex = index;
    currentTime = 0;
    duration = 0;
  }
  ensure(currentIndex);
  const a = getAudio();
  if (loadedIndex === currentIndex && currentTime > 0 && a.currentTime !== currentTime) {
    a.currentTime = currentTime;
  }
  a.play()
    .then(() => {
      isPlaying = true;
      emit();
    })
    .catch(() => {
      isPlaying = false;
      emit();
    });
  persist();
  emit();
}

function togglePlay() {
  const s = currentSong();
  if (!s) return;
  ensure(currentIndex);
  const a = getAudio();
  if (isPlaying) {
    a.pause();
    isPlaying = false;
  } else {
    if (loadedIndex === currentIndex && currentTime > 0 && a.currentTime !== currentTime) {
      a.currentTime = currentTime;
    }
    a.play()
      .then(() => {
        isPlaying = true;
        emit();
      })
      .catch(() => {
        isPlaying = false;
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
  nextSong();
}

function nextSong() {
  let ni: number;
  if (playMode === 'random') ni = Math.floor(Math.random() * playlist.length);
  else ni = (currentIndex + 1) % playlist.length;
  playSong(ni);
}

function prevSong() {
  playSong((currentIndex - 1 + playlist.length) % playlist.length);
}

function handleSeek(t: number) {
  const a = getAudio();
  a.currentTime = t;
  currentTime = t;
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

function togglePlayMode() {
  playMode = playMode === 'order' ? 'one' : playMode === 'one' ? 'random' : 'order';
  persist();
  emit();
}

function getCurrentLyric(): { text: string; lines: { time: number; text: string }[] } | null {
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
    currentTime,
    duration,
    volume,
    isMuted,
    playMode,
    lrcLines: lyric?.lines ?? [],
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
};
