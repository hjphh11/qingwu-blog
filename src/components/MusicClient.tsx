import { useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon } from 'morphicons/react';
import { SkipBack, Play, Pause, SkipForward, Volume2, VolumeX, Repeat, Repeat1, Shuffle } from '../lib/icons';
import { initMusic, subscribe, getMusicState, music } from '../lib/musicStore';

function fmt(sec: number) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const modeText = { order: '顺序', one: '单曲', random: '随机' } as const;

export default function MusicClient() {
  const [state, setState] = useState(getMusicState());
  const [tab, setTab] = useState<'lrc' | 'list'>('lrc');
  const [query, setQuery] = useState('');
  const lyricsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initMusic();
    return subscribe(() => setState(getMusicState()));
  }, []);

  const {
    playlist,
    currentIndex,
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playMode,
    lrcLines,
  } = state;

  const pct = duration ? (currentTime / duration) * 100 : 0;

  // 当前歌词行索引
  const activeLyricIndex = useMemo(() => {
    let idx = -1;
    lrcLines.forEach((ln, i) => {
      if (ln.time <= currentTime) idx = i;
    });
    return idx;
  }, [lrcLines, currentTime]);

  // 歌词自动滚动到中间
  useEffect(() => {
    const box = lyricsRef.current;
    if (!box || activeLyricIndex < 0) return;
    const el = box.querySelector(`[data-line="${activeLyricIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeLyricIndex]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    music.handleSeek(((e.clientX - rect.left) / rect.width) * duration);
  };

  const filtered = query
    ? playlist.filter(
        (s) => s.title.includes(query) || s.artist.includes(query),
      )
    : playlist;

  const btn =
    'grid h-11 w-11 place-items-center rounded-full text-ink transition-transform hover:scale-110 active:scale-95';

  if (playlist.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <header>
          <h1 className="font-hand text-4xl text-crimson md:text-5xl">音乐馆</h1>
          <p className="mt-2 text-sm text-ink/60">在旋律里，找到片刻安静 ~</p>
        </header>
        <div className="glass-card grid place-items-center p-12 text-center">
          <p className="font-hand text-2xl text-crimson">音乐馆还没开张 ~</p>
          <p className="mt-2 text-sm text-ink/60">歌曲等主人慢慢添进来，稍后再来听。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-8">
      {/* 背景:当前封面模糊放大 + 暖色蒙层 */}
      {currentSong && (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <img
            src={currentSong.cover}
            alt=""
            className="h-full w-full scale-125 object-cover opacity-30 blur-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-cream/70 via-cream/80 to-cream/95" />
        </div>
      )}

      <header>
        <h1 className="font-hand text-4xl text-crimson md:text-5xl">音乐馆</h1>
        <p className="mt-2 text-sm text-ink/60">在旋律里，找到片刻安静 ~</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* 左:播放控制台 */}
        <div className="glass-card flex h-[560px] flex-col items-center gap-4 p-6">
          {/* 旋转光盘 */}
          <div className="relative grid place-items-center">
            <div className="absolute h-72 w-72 rounded-full bg-rose/25 blur-2xl" />
            <img
              src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
              alt={currentSong?.title ?? '封面'}
              width={280}
              height={280}
              className={`disc relative h-64 w-64 object-cover shadow-[0_10px_30px_rgba(246,165,184,0.35)] ${
                isPlaying ? 'playing' : ''
              }`}
            />
            <div className="absolute h-16 w-16 rounded-full border-4 border-white/80 bg-cream/90" />
          </div>

          <div className="text-center">
            <p className="font-display text-2xl text-ink">{currentSong?.title ?? '未选择歌曲'}</p>
            <p className="mt-1 text-sm text-ink/50">{currentSong?.artist ?? ''}</p>
          </div>

          {/* 进度条 */}
          <div className="w-full">
            <div
              className="h-2 w-full cursor-pointer rounded-full bg-rose/20"
              onClick={seek}
              role="slider"
              aria-label="播放进度"
            >
              <div className="h-2 rounded-full bg-crimson" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-ink/40 tabular-nums">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => music.prevSong()} className={btn} aria-label="上一首">
              <MorphIcon icon={SkipBack} size={20} color="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => music.togglePlay()}
              className="grid h-14 w-14 place-items-center rounded-full bg-crimson text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              <MorphIcon icon={isPlaying ? Pause : Play} size={22} color="#fff" />
            </button>
            <button type="button" onClick={() => music.nextSong()} className={btn} aria-label="下一首">
              <MorphIcon icon={SkipForward} size={20} color="currentColor" />
            </button>
          </div>

          {/* 音量 + 模式 */}
          <div className="flex w-full items-center gap-3">
            <button
              type="button"
              onClick={() => music.setMuted(!isMuted)}
              className="text-lg text-ink/70 transition-colors hover:text-crimson"
              aria-label="静音"
            >
              <MorphIcon icon={isMuted || volume === 0 ? VolumeX : Volume2} size={20} color="currentColor" />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => music.setVolume(Number(e.target.value) / 100)}
              className="h-1.5 w-full cursor-pointer accent-crimson"
              aria-label="音量"
            />
            <button
              type="button"
              onClick={() => music.togglePlayMode()}
              className="grid h-9 w-9 place-items-center rounded-full border border-rose/30 text-ink/70 transition-colors hover:border-rose/60 hover:text-crimson"
              title={`播放模式: ${modeText[playMode]}`}
              aria-label={`播放模式: ${modeText[playMode]}`}
            >
              <MorphIcon
                icon={playMode === 'order' ? Repeat : playMode === 'one' ? Repeat1 : Shuffle}
                size={18}
                color="currentColor"
              />
            </button>
          </div>
        </div>

        {/* 右:歌词 / 歌单 */}
        <div className="glass-card flex h-[560px] flex-col p-6">
          <div className="flex gap-2">
            {(['lrc', 'list'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  tab === t ? 'bg-rose/25 text-crimson' : 'text-ink/60 hover:text-crimson'
                }`}
              >
                {t === 'lrc' ? '歌词' : '歌单'}
              </button>
            ))}
          </div>

          {tab === 'lrc' ? (
            <div className="relative mt-4 w-full flex min-h-0 flex-1">
              {lrcLines.length ? (
                <div
                  ref={lyricsRef}
                  className="no-scrollbar h-full w-full overflow-y-auto text-center"
                >
                  {lrcLines.map((ln, i) => (
                    <button
                      key={i}
                      type="button"
                      data-line={i}
                      onClick={() => music.handleSeek(ln.time)}
                      className={`block w-full py-2.5 text-center transition-all ${
                        i === activeLyricIndex
                          ? 'scale-105 rounded-xl bg-rose/10 font-display text-xl text-crimson'
                          : 'text-sm text-ink/50 hover:text-ink/80'
                      }`}
                    >
                      {ln.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-ink/40">
                  暂无歌词
                </div>
              )}
              {/* 渐变遮罩 上淡下淡 */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/80 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white/80 to-transparent" />
            </div>
          ) : (
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索歌名 / 作者…"
                className="mb-4 w-full rounded-full border border-rose/25 bg-white/50 px-4 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-rose/60"
              />
              <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
                {filtered.map((s) => {
                  const idx = playlist.indexOf(s);
                  const active = idx === currentIndex;
                  return (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => music.playSong(idx)}
                      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors ${
                        active ? 'bg-rose/20' : 'hover:bg-rose/10'
                      }`}
                    >
                      <img
                        src={s.cover}
                        alt={s.title}
                        width={44}
                        height={44}
                        className="h-11 w-11 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${active ? 'font-medium text-crimson' : 'text-ink'}`}>
                          {s.title}
                        </p>
                        <p className="truncate text-xs text-ink/50">
                          {s.artist} · {s.note ?? ''}
                        </p>
                      </div>
                      {active && isPlaying && (
                        <span className="flex items-end gap-0.5" aria-hidden="true">
                          <span className="wave-bar h-3" />
                          <span className="wave-bar h-4" />
                          <span className="wave-bar h-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
