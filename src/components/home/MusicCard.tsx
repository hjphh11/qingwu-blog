import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
} from '../../lib/icons';
import {
  initMusic,
  subscribe,
  getMusicState,
  getPristineState,
  music,
} from '../../lib/musicStore';

/** 状态类型直接取 store 的返回值，不另立 interface —— 免得字段改名后两处不同步 */
type MusicView = ReturnType<typeof getPristineState>;

const fmt = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const MODE_ICON = { order: Repeat, one: Repeat1, random: Shuffle } as const;
const MODE_LABEL = { order: '顺序播放', one: '单曲循环', random: '随机播放' } as const;

function view(s: MusicView) {
  return {
    title: s.currentSong?.title ?? '还没开始听',
    artist: s.currentSong?.artist ?? '挑一首听听',
    cover: s.currentSong?.cover ?? '',
    isPlaying: s.isPlaying,
    currentTime: s.currentTime,
    duration: s.duration,
    mode: s.playMode,
    pct: s.duration > 0 ? Math.min(100, (s.currentTime / s.duration) * 100) : 0,
  };
}

/**
 * 左栏「音乐馆」卡：圆形封面 + 歌名/音乐人 + 时间 + 可点进度 + 循环/上一首/播放/下一首。
 *
 * 为什么是纵向版：参考的横向布局（封面在左、信息在右、音量贴右）至少需要 400px，
 * 左栏只有 148px 内容宽，只能把封面居中、信息往下堆。
 *
 * 与全站播放器的关系：左栏卡、MiniPlayer、/music 页操作同一个 store，
 * 一处 `emit()` 三处同时刷新。注意 MiniPlayer 在 `/` 与 `/music` **不渲染**
 * （见 MiniPlayer.tsx 开头），所以首页的播放入口就是这张卡。
 *
 * 首帧用 getPristineState：MiniPlayer 是 client:only，会先 initMusic() 从
 * localStorage 还原上次听的歌；这里若读实时状态，服务端 HTML 与客户端首帧对不上。
 */
export default function MusicCard() {
  const [v, setV] = useState(() => view(getPristineState()));

  useEffect(() => {
    initMusic();
    return subscribe(() => setV(view(getMusicState())));
  }, []);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    music.handleSeek(((e.clientX - rect.left) / rect.width) * v.duration);
  };

  /* 卡里既有链接又有按钮，所以不能整卡包 <a>（a 里套 button 非法，键盘与读屏都会坏）。 */
  return (
    <div className="glass-card p-4">
      <a
        href="/music"
        className="flex items-center gap-1.5 text-[0.6875rem] tracking-[0.14em] text-subtle transition-colors hover:text-accent"
      >
        <MorphIcon icon={Music} size={13} color="currentColor" />
        音乐馆
        <span aria-hidden="true" className="ml-auto">
          →
        </span>
      </a>

      {/* 封面：底下先放图标兜底，img 盖在上面；外站图挂了就 onError 藏掉自己，
          露出底色与图标 —— 不会出现破图方块 */}
      <div className="relative mx-auto mt-3 grid h-[68px] w-[68px] place-items-center overflow-hidden rounded-full bg-gradient-to-br from-rose/45 to-amber/35 ring-1 ring-white/60">
        <MorphIcon icon={Music} size={22} color="rgba(255,255,255,0.85)" />
        {v.cover && (
          <img
            src={v.cover}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>

      {/* 固定行数 + truncate：曲名长短不一，而左栏是 sticky 容器，高度跳动会带着下面的卡一起跳 */}
      <p
        data-music-title
        className="mt-2.5 truncate text-center font-display text-[0.9375rem] leading-normal text-ink"
      >
        {v.title}
      </p>
      <p className="truncate text-center text-[0.6875rem] text-subtle">{v.artist}</p>

      {/* 时间贴着进度条两端，像参考那样「0:00 / 0:00」 */}
      <div
        data-music-time
        className="mt-2 flex justify-between text-[0.625rem] tabular-nums text-subtle"
      >
        <span>{fmt(v.currentTime)}</span>
        <span>{fmt(v.duration)}</span>
      </div>

      {/* 进度：可点跳转 + 方向键 ±5s（与 /music 页同一套无障碍语义） */}
      <div
        className="group mt-1 h-[7px] cursor-pointer rounded-full bg-rose/25"
        onClick={seek}
        onKeyDown={(e) => {
          if (!v.duration) return;
          if (e.key === 'ArrowRight') music.handleSeek(Math.min(v.duration, v.currentTime + 5));
          if (e.key === 'ArrowLeft') music.handleSeek(Math.max(0, v.currentTime - 5));
        }}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(v.duration)}
        aria-valuenow={Math.round(v.currentTime)}
        aria-valuetext={`${fmt(v.currentTime)} / ${fmt(v.duration)}`}
      >
        <div
          className="relative h-full rounded-full bg-crimson transition-[width] duration-300 ease-linear"
          style={{ width: `${v.pct}%` }}
        >
          <span className="absolute -right-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-crimson opacity-0 shadow-[0_1px_4px_rgba(194,58,85,0.45)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => music.togglePlayMode()}
          aria-label={`播放模式：${MODE_LABEL[v.mode]}（点击切换）`}
          title={MODE_LABEL[v.mode]}
          className={`grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-rose/20 ${
            v.mode === 'order' ? 'text-subtle' : 'text-crimson'
          }`}
        >
          <MorphIcon icon={MODE_ICON[v.mode]} size={13} color="currentColor" />
        </button>

        <button
          type="button"
          onClick={() => music.prevSong()}
          aria-label="上一首"
          className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-rose/20 hover:text-crimson"
        >
          <MorphIcon icon={SkipBack} size={14} color="currentColor" />
        </button>

        <button
          type="button"
          onClick={() => music.togglePlay()}
          aria-label={v.isPlaying ? '暂停' : '播放'}
          className="grid h-9 w-9 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-105 active:scale-95"
        >
          <MorphIcon icon={v.isPlaying ? Pause : Play} size={16} color="currentColor" />
        </button>

        <button
          type="button"
          onClick={() => music.nextSong()}
          aria-label="下一首"
          className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-rose/20 hover:text-crimson"
        >
          <MorphIcon icon={SkipForward} size={14} color="currentColor" />
        </button>
      </div>
    </div>
  );
}
