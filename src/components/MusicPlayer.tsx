import { useEffect, useState } from 'react';
import { SONGS, type Song } from '../data/music';
import { initMusic, subscribe, getMusicState, music, audioElement } from '../lib/musicStore';

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MusicPlayer() {
  const [state, setState] = useState(getMusicState());
  const [progress, setProgress] = useState({ current: 0, duration: 0 });

  useEffect(() => {
    initMusic();
    return subscribe(() => setState(getMusicState()));
  }, []);

  useEffect(() => {
    const a = audioElement();
    const onTime = () => setProgress({ current: a.currentTime || 0, duration: a.duration || 0 });
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onTime);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onTime);
    };
  }, []);

  const { track, playing } = state;
  const pct = progress.duration ? (progress.current / progress.duration) * 100 : 0;

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioElement();
    if (!a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = ratio * a.duration;
  };

  const barBtn =
    'grid h-10 w-10 place-items-center rounded-full text-ink transition-transform hover:scale-110 active:scale-95';

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="flex items-center gap-3 font-display text-3xl text-ink">
          <span className="h-6 w-1.5 rounded-full bg-crimson"></span>
          音乐
        </h1>
        <p className="mt-2 text-sm text-ink/60">收藏的旋律，都在这儿 ~</p>
      </header>

      {/* 主播放器 */}
      <div className="glass-card flex items-center gap-4 p-4">
        <img
          src={track?.cover ?? '/music/covers/cover-1.svg'}
          alt={track?.title ?? '封面'}
          width={72}
          height={72}
          className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{track?.title ?? '未选择歌曲'}</p>
          <p className="truncate text-sm text-ink/50">{track?.artist ?? '点一首歌开始播放'}</p>

          {/* 进度条 */}
          <div
            className="mt-3 h-2 w-full cursor-pointer rounded-full bg-rose/20"
            onClick={seek}
            role="slider"
            aria-label="播放进度"
          >
            <div
              className="h-2 rounded-full bg-crimson"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-ink/40 tabular-nums">
            <span>{fmt(progress.current)}</span>
            <span>{fmt(progress.duration)}</span>
          </div>
        </div>

        {/* 控制 */}
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => music.prev()} className={barBtn} aria-label="上一首">
            ⏮
          </button>
          <button
            type="button"
            onClick={() => music.toggle()}
            className={`${barBtn} h-12 w-12 bg-crimson text-white`}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button type="button" onClick={() => music.next()} className={barBtn} aria-label="下一首">
            ⏭
          </button>
        </div>
      </div>

      {/* 歌曲列表 */}
      <div className="flex flex-col gap-4">
        {SONGS.map((s: Song) => {
          const active = track?.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => music.play(s)}
              className={`glass-card flex items-center gap-4 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                active ? 'ring-2 ring-crimson/40' : ''
              }`}
            >
              <img
                src={s.cover}
                alt={s.title}
                width={52}
                height={52}
                className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{s.title}</p>
                <p className="truncate text-sm text-ink/50">{s.artist}</p>
              </div>
              <span className="hidden shrink-0 text-xs text-ink/50 sm:block">{s.note}</span>
              <span className="shrink-0 text-crimson">
                {active ? (playing ? '▶️' : '⏸️') : '♫'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
