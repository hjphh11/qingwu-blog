import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
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
    isBuffering,
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
          {/* 与正常态用同一套标题,空态不该是另一套字号 */}
          <h1 className="font-hand text-[length:var(--text-section)] leading-none text-crimson">
            音乐馆
          </h1>
          <p className="mt-3 text-sm text-muted">在旋律里，找到片刻安静 ~</p>
        </header>
        <div className="glass-card q-empty p-12">
          <p className="q-empty__hand">音乐馆还没开张 ~</p>
          <p className="q-empty__sub">歌曲等主人慢慢添进来，先去别处逛逛？</p>
          <a href="/blog" className="q-empty-btn">去文章逛逛</a>
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
        <h1 className="font-hand text-[length:var(--text-section)] leading-none text-crimson">
          音乐馆
        </h1>
        <p className="mt-3 text-sm text-muted">在旋律里，找到片刻安静 ~</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* 左:播放控制台 */}
        <div className="glass-card flex flex-col items-center gap-5 p-6 md:h-[560px] md:gap-4">
          {/* 旋转光盘 */}
          <div className="relative grid place-items-center">
            <div className="absolute h-64 w-64 rounded-full bg-rose/25 blur-2xl md:h-72 md:w-72" />
            {/* q-media = 占位底 + 加载完淡入,同时充当缓冲环的定位父级。
                它自带 position:relative,所以这颗盘仍然盖在外圈光晕之上
                (和原来在 img 上写 relative 是同一个作用)。 */}
            <span className="q-media grid h-52 w-52 place-items-center rounded-full md:h-64 md:w-64">
              <img
                src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
                alt={currentSong?.title ?? '封面'}
                width={280}
                height={280}
                decoding="async"
                className={`disc relative h-full w-full object-cover shadow-[0_10px_30px_rgba(246,165,184,0.35)] ${
                  isPlaying ? 'playing' : ''
                } ${isBuffering ? 'is-buffering' : ''}`}
              />
              {/* 缓冲环:琥珀色,只在音频真的在等数据时才亮(读 musicStore 的 isBuffering)。
                  位置与外圈尺寸对齐,所以左缘不会因为「环出现」而移动。 */}
              <span className={`q-buf-ring ${isBuffering ? 'is-on' : ''}`} aria-hidden="true" />
            </span>
            <div className="absolute h-14 w-14 rounded-full border-4 border-white/80 bg-cream/90 md:h-16 md:w-16" />
          </div>

          <div className="text-center">
            {/* 歌名:切歌时柔和模糊浮现(借鉴 MotionVault blur-fade-in,MIT) */}
            <motion.p
              key={currentSong?.title ?? 'empty'}
              initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-2xl text-ink"
            >
              {currentSong?.title ?? '未选择歌曲'}
            </motion.p>
            <p className="mt-1 text-sm text-subtle">{currentSong?.artist ?? ''}</p>
          </div>

          {/* 进度条:可键盘操作(方向键 ±5s),补上 tabindex 与数值语义 */}
          <div className="w-full">
            <div
              className="group h-2 w-full cursor-pointer rounded-full bg-rose/20"
              onClick={seek}
              onKeyDown={(e) => {
                if (!duration) return;
                if (e.key === 'ArrowRight') music.handleSeek(Math.min(duration, currentTime + 5));
                if (e.key === 'ArrowLeft') music.handleSeek(Math.max(0, currentTime - 5));
              }}
              role="slider"
              tabIndex={0}
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={`${fmt(currentTime)} / ${fmt(duration)}`}
            >
              <div
                className="relative h-2 rounded-full bg-crimson transition-[width] duration-150 ease-linear"
                style={{ width: `${pct}%` }}
              >
                <span className="absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-crimson opacity-0 shadow-[0_2px_8px_rgba(194,58,85,0.4)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </div>
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-subtle tabular-nums">
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
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg text-muted transition-colors hover:text-crimson"
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
              className="grid h-9 w-9 place-items-center rounded-full border border-rose/30 text-muted transition-colors hover:border-rose/60 hover:text-crimson"
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
        <div className="glass-card flex flex-col p-6 md:h-[560px]">
          <div className="flex gap-2">
            {(['lrc', 'list'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`min-h-9 rounded-full px-4 text-sm transition-colors duration-200 ${
                  tab === t
                    ? 'bg-rose/30 font-medium text-crimson'
                    : 'text-muted hover:bg-rose/10 hover:text-crimson'
                }`}
              >
                {t === 'lrc' ? '歌词' : '歌单'}
              </button>
            ))}
          </div>

          {tab === 'lrc' ? (
            <div className="relative mt-4 flex min-h-[18rem] w-full flex-1 md:min-h-0">
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
                          : 'text-sm text-subtle hover:text-ink/85'
                      }`}
                    >
                      {ln.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-subtle">
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
                className="mb-4 w-full rounded-full border border-rose/25 bg-white/50 px-4 py-2 text-sm text-ink outline-none placeholder:text-subtle focus:border-rose/60"
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
                        <p className="truncate text-xs text-subtle">
                          {s.artist} · {s.note ?? ''}
                        </p>
                      </div>
                      {active && isPlaying && (
                        <span
                          className={`flex items-end gap-0.5 ${isBuffering ? 'is-buffering' : ''}`}
                          aria-hidden="true"
                        >
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
