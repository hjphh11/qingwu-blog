import { useEffect, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { Music } from '../../lib/icons';
import { initMusic, subscribe, getMusicState, getPristineState } from '../../lib/musicStore';

/** 状态类型直接取 store 的返回值，不另立一个 interface —— 免得字段改名后两处不同步 */
type MusicView = ReturnType<typeof getPristineState>;

/**
 * 左栏的「音乐馆」小卡：显示当前曲目，点整卡进 /music。
 *
 * 为什么只做展示、不放播放控制：右下角已经有常驻的 MiniPlayer（全站可用），
 * 左栏再给一套播放/暂停就是两个地方控制同一件事，容易打架。
 *
 * 为什么首帧用 getPristineState：MiniPlayer 是 `client:only`，会先挂载并
 * `initMusic()` → 从 localStorage 还原上次听的歌，把模块状态改掉。
 * 这里若首帧读 `getMusicState()`，服务端 HTML（默认第 1 首）与客户端首帧
 * （已还原）对不上 —— 就是 /music 那个 hydration mismatch 的同款问题。
 */
function view(s: MusicView) {
  const song = s.currentSong;
  return {
    title: song?.title ?? '还没开始听',
    artist: song?.artist ?? '13 首在架上',
    playing: s.isPlaying,
    count: s.playlist.length,
  };
}

export default function MusicCard() {
  const [v, setV] = useState(() => view(getPristineState()));

  useEffect(() => {
    initMusic();
    // subscribe 注册时会立即回调一次，正好把还原后的真实状态同步进来
    return subscribe(() => setV(view(getMusicState())));
  }, []);

  return (
    <a
      href="/music"
      className="glass-card group block p-4 transition-colors hover:border-rose/45"
      aria-label={`音乐馆：${v.title}，共 ${v.count} 首`}
    >
      <span className="flex items-center gap-1.5 text-[0.6875rem] tracking-[0.14em] text-subtle">
        <MorphIcon icon={Music} size={13} color="currentColor" />
        音乐馆
      </span>

      {/* 固定两行 + truncate：曲名长短不一，限死行数卡片高度才稳定
          （左栏是 sticky 容器，高度跳动会带着下面的分类卡一起跳） */}
      <p className="mt-1.5 truncate font-display text-[0.9375rem] leading-normal text-ink">
        {v.title}
      </p>
      <p className="mt-0.5 truncate text-[0.6875rem] text-subtle">{v.artist}</p>

      <p className="mt-2 flex items-center gap-1 text-[0.6875rem] text-accent">
        {v.count} 首
        {v.playing && <span className="text-crimson"> · 正在听</span>}
        <span
          aria-hidden="true"
          className="ml-auto transition-transform duration-300 group-hover:translate-x-0.5"
        >
          →
        </span>
      </p>
    </a>
  );
}
