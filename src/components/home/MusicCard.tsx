import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Music, Play, Pause, SkipBack, SkipForward } from '../../lib/icons';
import {
  initMusic,
  subscribe,
  getMusicState,
  getPristineState,
  music,
} from '../../lib/musicStore';

/** 状态类型直接取 store 的返回值，不另立 interface —— 免得字段改名后两处不同步 */
type MusicView = ReturnType<typeof getPristineState>;

/**
 * 左栏的「音乐馆」卡：当前曲目 + 进度 + 上一首/播放/下一首。
 *
 * 关于「两处都有控制」：右下角的 MiniPlayer 和这张卡操作的是**同一个 store**
 * （`music.togglePlay` 等），store 一变就 `emit()`，两边通过 `subscribe` 同时刷新 ——
 * 左栏点播放，迷你播放器会立刻变成「暂停」，/music 页也跟着变。不是各控各的。
 *
 * 为什么首帧用 getPristineState：MiniPlayer 是 `client:only`，会先挂载并
 * initMusic() 从 localStorage 还原上次听的歌。这里若首帧读 getMusicState()，
 * 服务端 HTML（默认第 1 首）与客户端首帧（已还原）对不上 —— 就是 /music 那次
 * hydration mismatch 的同款问题。
 */
function view(s: MusicView) {
  return {
    title: s.currentSong?.title ?? '还没开始听',
    artist: s.currentSong?.artist ?? '挑一首听听',
    isPlaying: s.isPlaying,
    count: s.playlist.length,
    pct: s.duration > 0 ? Math.min(100, (s.currentTime / s.duration) * 100) : 0,
  };
}

export default function MusicCard() {
  const [v, setV] = useState(() => view(getPristineState()));

  useEffect(() => {
    initMusic();
    // subscribe 注册时会立即回调一次，正好把还原后的真实状态同步进来
    return subscribe(() => setV(view(getMusicState())));
  }, []);

  /* 卡片里既有链接又有按钮，所以不能整张卡包成 <a>（a 里套 button 是非法嵌套，
     键盘与读屏都会出问题）。标题那一行才是入口。 */
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

      {/* 固定两行 + truncate：曲名长短不一，而左栏是 sticky 容器，
          高度跳动会带着下面「按分类看」一起跳 */}
      <p
        data-music-title
        className="mt-1.5 truncate font-display text-[0.9375rem] leading-normal text-ink"
      >
        {v.title}
      </p>
      <p className="truncate text-[0.6875rem] text-subtle">{v.artist}</p>

      {/* 进度条只读：148px 宽上做拖拽精度太差、容易误触。
          要拖进度去 /music 或右下角迷你播放器。 */}
      <div
        className="mt-2 h-[3px] overflow-hidden rounded-full bg-rose/25"
        role="progressbar"
        aria-label="播放进度"
        aria-valuenow={Math.round(v.pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-crimson transition-[width] duration-300 ease-linear"
          style={{ width: `${v.pct}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-1">
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
          className="grid h-8 w-8 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-105 active:scale-95"
        >
          <MorphIcon icon={v.isPlaying ? Pause : Play} size={15} color="currentColor" />
        </button>

        <button
          type="button"
          onClick={() => music.nextSong()}
          aria-label="下一首"
          className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-rose/20 hover:text-crimson"
        >
          <MorphIcon icon={SkipForward} size={14} color="currentColor" />
        </button>

        <span className="ml-auto text-[0.6875rem] tabular-nums text-subtle">{v.count} 首</span>
      </div>
    </div>
  );
}
