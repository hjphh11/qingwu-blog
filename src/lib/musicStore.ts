import { SONGS, type Song } from '../data/music';

type Listener = () => void;

const TRACK_KEY = 'qingwu:track';
const PLAYING_KEY = 'qingwu:playing';

let currentTrack: Song | null = null;
let playing = false;
let loadedId: string | null = null;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<Listener>();

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('ended', () => {
      playing = false;
      emit();
    });
  }
  return audio;
}

function persist() {
  try {
    if (currentTrack) localStorage.setItem(TRACK_KEY, currentTrack.id);
    else localStorage.removeItem(TRACK_KEY);
    localStorage.setItem(PLAYING_KEY, playing ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function restore() {
  try {
    const id = localStorage.getItem(TRACK_KEY);
    currentTrack = SONGS.find((s) => s.id === id) || null;
    playing = false; // 出于自动播放限制,跨页复用时默认暂停
  } catch {
    /* ignore */
  }
}

function ensureSrc(t: Song) {
  const a = getAudio();
  if (loadedId !== t.id) {
    a.src = t.src;
    loadedId = t.id;
  }
}

function play(track?: Song) {
  const t = track || currentTrack;
  if (!t) return;
  ensureSrc(t);
  if (currentTrack?.id !== t.id) currentTrack = t;
  playing = true;
  getAudio()
    .play()
    .catch(() => {
      playing = false;
      emit();
    });
  persist();
  emit();
}

function toggle() {
  if (!currentTrack) return;
  if (playing) {
    getAudio().pause();
    playing = false;
  } else {
    play(currentTrack);
    return;
  }
  persist();
  emit();
}

function step(dir: 1 | -1) {
  if (!currentTrack) return play(SONGS[0]);
  const i = SONGS.findIndex((s) => s.id === currentTrack!.id);
  const ni = (i + dir + SONGS.length) % SONGS.length;
  play(SONGS[ni]);
}

export function initMusic() {
  restore();
  emit();
}

export function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getMusicState() {
  return { track: currentTrack, playing };
}

export function audioElement() {
  return getAudio();
}

export const music = {
  play,
  toggle,
  next: () => step(1),
  prev: () => step(-1),
};
