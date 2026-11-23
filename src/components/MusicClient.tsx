import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  List,
  LayoutGrid,
  Search,
  ListPlus,
  X,
  Music2,
} from '../lib/icons';
import { initMusic, subscribe, getMusicState, getPristineState, music } from '../lib/musicStore';
import Spectrum from './music/Spectrum';
import Lyrics from './music/Lyrics';

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const modeText = { order: '列表循环', one: '单曲循环', random: '随机播放' } as const;
const modeIcon = { order: Repeat, one: Repeat1, random: Shuffle } as const;

/** 播放中的三根小柱；暂停时换成一个静止的点，避免「没声音却还在动」。 */
function Bars({ playing }: { playing: boolean }) {
  if (!playing) return <span className="mx-auto block h-1.5 w-1.5 rounded-full bg-crimson" />;
  return (
    <span className="flex items-end justify-center gap-0.5" aria-hidden="true">
      <span className="wave-bar h-3" />
      <span className="wave-bar h-4" />
      <span className="wave-bar h-2.5" />
    </span>
  );
}

export default function MusicClient() {
  /* ⚠️ 首帧必须用「未被 restore 还原过」的快照，不能用 getMusicState()。
     这个组件是 client:load —— 服务端渲染的 HTML 里是默认状态；而 MiniPlayer
     是 client:only，它会先挂载并 restore()，把 localStorage 里的歌写进模块变量。
     直接读 getMusicState() 就会拿到已还原的值，与水合时的服务端 HTML 对不上，
     React 报 hydration mismatch 且**不会修补**（用户上次听的歌就不显示）。
     真实状态在下面的 effect 里同步。 */
  const [state, setState] = useState(getPristineState);
  const [tab, setTab] = useState<'lrc' | 'queue'>('lrc');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');

  useEffect(() => {
    initMusic();
    // initMusic 里的 emit() 发生在 subscribe 之前，会漏掉 —— 这里补同步一次
    setState(getMusicState());
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
    queue,
    queuePos,
    lrcLines,
  } = state;

  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  const totalMin = useMemo(
    () => Math.round(playlist.reduce((acc, s) => acc + (s.duration ?? 0), 0) / 60),
    [playlist],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return playlist;
    return playlist.filter((s) => s.title.includes(q) || s.artist.includes(q));
  }, [playlist, query]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    music.handleSeek(((e.clientX - rect.left) / rect.width) * duration);
  };

  /* 曲库与队列用 useMemo 包起来：store 每秒 emit 四次（timeupdate），
     而这两块只依赖「哪首歌 / 播没播」—— 不包的话每帧都要 diff 十几个卡片。 */
  const library = useMemo(() => {
    if (!filtered.length) {
      return (
        <p className="py-10 text-center text-sm text-subtle">
          没有匹配「{query.trim()}」的歌
        </p>
      );
    }

    if (view === 'grid') {
      return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((s) => {
            const idx = playlist.indexOf(s);
            const active = idx === currentIndex;
            return (
              <div key={s.title} className="q-mp-card group relative">
                <div
                  className={`relative aspect-square overflow-hidden rounded-[0.9rem] ${
                    active ? 'ring-2 ring-crimson/45' : 'ring-1 ring-white/70'
                  }`}
                >
                  <img
                    src={s.cover}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  />
                  <span className="q-mp-veil pointer-events-none absolute inset-0 grid place-items-center bg-[rgba(74,55,40,0.32)]">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-white/95 text-crimson">
                      <MorphIcon icon={active && isPlaying ? Pause : Play} size={18} color="currentColor" />
                    </span>
                  </span>
                  {active && (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-crimson/90 px-2 py-0.5 text-[0.625rem] leading-normal text-white">
                      播放中
                    </span>
                  )}
                </div>
                <p
                  className={`mt-2 truncate text-sm ${active ? 'font-medium text-crimson' : 'text-ink'}`}
                >
                  {s.title}
                </p>
                <p className="truncate text-xs text-subtle">{s.artist}</p>

                {/* 播放键铺满整张卡：点封面或点文字都能播，读屏只报一个名字 */}
                <button
                  type="button"
                  onClick={() => music.playSong(idx)}
                  aria-label={`播放 ${s.title} — ${s.artist}`}
                  className="absolute inset-0 rounded-[0.9rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson"
                />
                <button
                  type="button"
                  onClick={() => music.playNext(idx)}
                  aria-label={`下一首播放 ${s.title}`}
                  title="下一首播放"
                  className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-crimson opacity-0 transition-opacity duration-200 hover:bg-white focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MorphIcon icon={ListPlus} size={14} color="currentColor" />
                </button>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="no-scrollbar max-h-[30rem] overflow-y-auto pr-1">
        {filtered.map((s, i) => {
          const idx = playlist.indexOf(s);
          const active = idx === currentIndex;
          return (
            <div
              key={s.title}
              className={`q-mp-card group relative flex items-center gap-3 rounded-xl p-2 ${
                active ? 'bg-rose/18' : 'hover:bg-rose/10'
              }`}
            >
              <span className="w-6 shrink-0 text-center text-[0.6875rem] tabular-nums text-subtle">
                {active ? <Bars playing={isPlaying} /> : String(i + 1).padStart(2, '0')}
              </span>
              <img
                src={s.cover}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${active ? 'font-medium text-crimson' : 'text-ink'}`}
                >
                  {s.title}
                </span>
                <span className="block truncate text-xs text-subtle">{s.artist}</span>
              </span>
              <span className="shrink-0 text-[0.6875rem] tabular-nums text-subtle group-hover:opacity-0">
                {fmt(s.duration ?? 0)}
              </span>
              <span className="absolute right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => music.playNext(idx)}
                  aria-label={`下一首播放 ${s.title}`}
                  title="下一首播放"
                  className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-rose/20 hover:text-crimson"
                >
                  <MorphIcon icon={ListPlus} size={14} color="currentColor" />
                </button>
              </span>
              <button
                type="button"
                onClick={() => music.playSong(idx)}
                aria-label={`播放 ${s.title} — ${s.artist}`}
                className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson"
              />
            </div>
          );
        })}
      </div>
    );
  }, [filtered, view, playlist, currentIndex, isPlaying, query]);

  const queueList = useMemo(() => {
    if (!queue.length) return <p className="py-8 text-center text-sm text-subtle">队列是空的</p>;
    return (
      <div className="no-scrollbar h-full space-y-1 overflow-y-auto pr-1">
        {queue.map((idx, pos) => {
          const s = playlist[idx];
          if (!s) return null;
          const cur = pos === queuePos;
          return (
            <div
              key={`${idx}-${pos}`}
              className={`group relative flex items-center gap-3 rounded-xl py-1.5 pl-2 pr-1 ${
                cur ? 'bg-rose/18' : 'hover:bg-rose/10'
              }`}
            >
              <span className="w-5 shrink-0 text-center text-[0.6875rem] tabular-nums text-subtle">
                {cur ? <Bars playing={isPlaying} /> : pos + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${cur ? 'font-medium text-crimson' : 'text-ink'}`}
                >
                  {s.title}
                </span>
                <span className="block truncate text-[0.6875rem] text-subtle">{s.artist}</span>
              </span>
              {!cur && (
                <button
                  type="button"
                  onClick={() => music.removeFromQueue(pos)}
                  aria-label={`从队列移除 ${s.title}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-subtle opacity-0 transition-opacity hover:bg-rose/25 hover:text-crimson focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MorphIcon icon={X} size={13} color="currentColor" />
                </button>
              )}
              <button
                type="button"
                onClick={() => music.playSong(idx)}
                aria-label={`播放 ${s.title}`}
                className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson"
              />
            </div>
          );
        })}
      </div>
    );
  }, [queue, queuePos, playlist, isPlaying]);

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

  const btn =
    'grid h-11 w-11 place-items-center rounded-full text-ink transition-transform hover:scale-110 q-press';

  return (
    <div className="flex flex-col gap-10">
      {currentSong && (
        <div className="q-mp-ambient" aria-hidden="true">
          {/* key 让它随歌重建：换封面时才重绘一次模糊，平时这层不动 */}
          <img key={currentSong.cover} src={currentSong.cover} alt="" loading="lazy" decoding="async" />
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-hand text-[length:var(--text-section)] leading-none text-crimson">
            音乐馆
          </h1>
          <p className="mt-3 text-sm text-muted">在旋律里，找到片刻安静 ~</p>
        </div>
        <p className="text-xs tabular-nums text-subtle">
          {playlist.length} 首 · 约 {totalMin} 分钟
        </p>
      </header>

      {/* ── 正在播放 ───────────────────────────────────────────── */}
      <section className="glass-card grid gap-7 p-6 md:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] md:gap-8 md:p-7">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative grid place-items-center">
            <div
              className="absolute h-56 w-56 rounded-full bg-rose/25 blur-2xl md:h-64 md:w-64"
              aria-hidden="true"
            />
            {/* q-media = 占位底 + 加载完淡入,同时充当缓冲环的定位父级。
                suppressHydrationWarning：`is-loaded` 由 Layout 里的内联脚本在
                水合之前就加上了，React 会以为 className 不匹配而报一条警告
                （属性本身没坏，只是时序问题）。 */}
            <span
              className="q-media grid h-44 w-44 place-items-center rounded-full md:h-52 md:w-52"
              suppressHydrationWarning
            >
              <img
                src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
                alt={currentSong?.title ?? '封面'}
                width={280}
                height={280}
                decoding="async"
                className={`disc q-mp-disc relative h-full w-full object-cover ${
                  isPlaying ? 'playing' : ''
                } ${isBuffering ? 'is-buffering' : ''}`}
              />
              <span className={`q-buf-ring ${isBuffering ? 'is-on' : ''}`} aria-hidden="true" />
            </span>
            <div className="absolute h-12 w-12 rounded-full border-4 border-white/80 bg-cream/90 md:h-14 md:w-14" />
            <Spectrum playing={isPlaying} />
          </div>

          <div className="min-w-0 text-center">
            {/* 歌名:切歌时柔和模糊浮现(借鉴 MotionVault blur-fade-in,MIT) */}
            <motion.p
              key={currentSong?.title ?? 'empty'}
              initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="truncate font-display text-[1.375rem] text-ink"
            >
              {currentSong?.title ?? '未选择歌曲'}
            </motion.p>
            <p className="mt-1 truncate text-sm text-subtle">{currentSong?.artist ?? ''}</p>
            {currentSong?.note && (
              <p className="mt-1.5 truncate text-xs text-subtle">{currentSong.note}</p>
            )}
          </div>

          <div className="w-full max-w-[22rem]">
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
                data-q-progress
                className="relative h-2 rounded-full bg-crimson"
                style={{ width: `${pct}%` }}
              >
                <span className="absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-crimson opacity-0 shadow-[0_2px_8px_rgba(194,58,85,0.4)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </div>
            </div>
            <div className="mt-1.5 flex justify-between text-xs tabular-nums text-subtle">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => music.prevSong()} className={btn} aria-label="上一首">
              <MorphIcon icon={SkipBack} size={20} color="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => music.togglePlay()}
              className="grid h-14 w-14 place-items-center rounded-full bg-crimson text-white shadow-lg transition-transform hover:scale-110 q-press"
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              <MorphIcon icon={isPlaying ? Pause : Play} size={22} color="#fff" />
            </button>
            <button type="button" onClick={() => music.nextSong()} className={btn} aria-label="下一首">
              <MorphIcon icon={SkipForward} size={20} color="currentColor" />
            </button>
          </div>

          <div className="flex w-full max-w-[22rem] items-center gap-3">
            <button
              type="button"
              onClick={() => music.setMuted(!isMuted)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-crimson"
              aria-label={isMuted ? '取消静音' : '静音'}
            >
              <MorphIcon
                icon={isMuted || volume === 0 ? VolumeX : Volume2}
                size={19}
                color="currentColor"
              />
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
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rose/30 text-muted transition-colors hover:border-rose/60 hover:text-crimson"
              title={`播放模式：${modeText[playMode]}`}
              aria-label={`播放模式：${modeText[playMode]}`}
            >
              <MorphIcon icon={modeIcon[playMode]} size={17} color="currentColor" />
            </button>
          </div>
        </div>

        {/* 右：歌词常驻 / 队列。高度交给左栏决定 —— 里面的歌词轨是绝对定位，
            不参与内在高度，所以行高天然等于左边唱片区。 */}
        <div className="flex h-[21rem] min-h-0 flex-col md:h-auto">
          <div className="flex shrink-0 items-center gap-2">
            {(
              [
                ['lrc', '歌词', lrcLines.length ? null : '暂无'],
                ['queue', '队列', String(queue.length)],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={`min-h-9 rounded-full px-4 text-sm transition-colors duration-200 ${
                  tab === key
                    ? 'bg-rose/30 font-medium text-crimson'
                    : 'text-muted hover:bg-rose/10 hover:text-crimson'
                }`}
              >
                {label}
                {hint && <span className="ml-1.5 text-xs text-subtle">{hint}</span>}
              </button>
            ))}
          </div>

          <div className="relative mt-3 min-h-0 flex-1">
            {tab === 'lrc' ? (
              <Lyrics
                lines={lrcLines}
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                onSeek={music.handleSeek}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col">{queueList}</div>
            )}
          </div>
        </div>
      </section>

      {/* ── 曲库 ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[length:var(--text-cardtitle)] font-medium text-ink">曲库</h2>
            <span className="text-xs tabular-nums text-subtle">
              {filtered.length === playlist.length
                ? `${playlist.length} 首`
                : `${filtered.length} / ${playlist.length} 首`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="relative block">
              <span className="sr-only">搜索曲库</span>
              <MorphIcon
                icon={Search}
                size={15}
                color="currentColor"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜歌名 / 作者"
                className="w-40 rounded-full border border-rose/25 bg-white/60 py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-subtle focus:border-rose/60 sm:w-52"
              />
            </label>
            <div className="flex items-center rounded-full border border-rose/25 bg-white/60 p-0.5">
              {(
                [
                  ['grid', LayoutGrid, '网格视图'],
                  ['list', List, '列表视图'],
                ] as const
              ).map(([key, icon, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  aria-label={label}
                  title={label}
                  className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
                    view === key ? 'bg-rose/35 text-crimson' : 'text-subtle hover:text-crimson'
                  }`}
                >
                  <MorphIcon icon={icon} size={14} color="currentColor" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {library}
      </section>

      <p className="flex items-center justify-center gap-1.5 text-[0.6875rem] text-subtle">
        <MorphIcon icon={Music2} size={12} color="currentColor" />
        音乐来自《鸣潮》，版权归原制作方所有
      </p>
    </div>
  );
}
