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
  const [queueOpen, setQueueOpen] = useState(false);
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
      <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
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

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-hand text-[length:var(--text-section)] leading-none text-crimson">
          音乐馆
        </h1>
        <p className="mt-3 text-sm text-muted">在旋律里，找到片刻安静 ~</p>
      </header>

      {/* ── 正在播放（沉浸式）─────────────────────────────────────
          参考桌面播放页：左边大方形封面 + 信息 + 控制，右边整片歌词。
          队列收进控制条左边的列表按钮，不再占一排 tab。 */}
      <section className="q-mp-stage">
        <div
          className="q-mp-stage__bg"
          style={currentSong ? { backgroundImage: `url(${currentSong.cover})` } : undefined}
          aria-hidden="true"
        />
        <div className="q-mp-stage__veil" aria-hidden="true" />

        <div className="q-mp-stage__inner">
          {/* 左：封面 / 信息 / 进度 / 控制 / 音量 */}
          <div className="q-mp-left">
            <div className="q-mp-cover">
              <img
                src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
                alt={currentSong?.title ?? '封面'}
                width={480}
                height={480}
                decoding="async"
                className={isBuffering ? 'is-buffering' : undefined}
              />
            </div>

            {/* 歌名:切歌时柔和模糊浮现(借鉴 MotionVault blur-fade-in,MIT) */}
            <motion.h2
              key={currentSong?.title ?? 'empty'}
              initial={{ opacity: 0, y: 6, filter: 'blur(5px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="q-mp-title"
            >
              {currentSong?.title ?? '未选择歌曲'}
            </motion.h2>
            <p className="q-mp-meta">
              <span>{currentSong?.artist ?? ''}</span>
              {currentSong?.note && (
                <>
                  <span className="q-mp-meta__sep">—</span>
                  <span>{currentSong.note}</span>
                </>
              )}
            </p>

            <div className="mt-4 w-full">
              <div
                className="q-mp-track"
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
                <div className="q-mp-fill" style={{ width: `${pct}%` }}>
                  <span className="q-mp-knob" />
                </div>
              </div>
              <div className="q-mp-times">
                <span>{fmt(currentTime)}</span>
                <span>{isBuffering ? '缓冲中…' : `-${fmt(Math.max(0, duration - currentTime))}`}</span>
              </div>
            </div>

            <div className="q-mp-controls">
              <button
                type="button"
                className="q-mp-ctl"
                aria-label="待播清单"
                aria-pressed={queueOpen}
                title="待播清单"
                onClick={() => setQueueOpen((v) => !v)}
              >
                <MorphIcon icon={List} size={18} color="currentColor" />
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => music.prevSong()}
                  className="q-mp-ctl"
                  aria-label="上一首"
                >
                  <MorphIcon icon={SkipBack} size={20} color="currentColor" />
                </button>
                <button
                  type="button"
                  onClick={() => music.togglePlay()}
                  className="q-mp-ctl q-mp-ctl--main q-press"
                  aria-label={isPlaying ? '暂停' : '播放'}
                >
                  <MorphIcon icon={isPlaying ? Pause : Play} size={22} color="#fff" />
                </button>
                <button
                  type="button"
                  onClick={() => music.nextSong()}
                  className="q-mp-ctl"
                  aria-label="下一首"
                >
                  <MorphIcon icon={SkipForward} size={20} color="currentColor" />
                </button>
              </div>

              <button
                type="button"
                className="q-mp-ctl"
                onClick={() => music.togglePlayMode()}
                title={modeText[playMode]}
                aria-label={`播放模式：${modeText[playMode]}`}
              >
                <MorphIcon icon={modeIcon[playMode]} size={18} color="currentColor" />
              </button>
            </div>

            <div className="q-mp-volume">
              <button
                type="button"
                onClick={() => music.setMuted(!isMuted)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-crimson"
                aria-label={isMuted ? '取消静音' : '静音'}
              >
                <MorphIcon
                  icon={isMuted || volume === 0 ? VolumeX : Volume2}
                  size={17}
                  color="currentColor"
                />
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(e) => music.setVolume(Number(e.target.value) / 100)}
                className="h-1 w-full cursor-pointer accent-crimson"
                aria-label="音量"
              />
            </div>
          </div>

          {/* 右：歌词常驻；列表按钮切换成待播清单 */}
          <div className="q-mp-right">
            {queueOpen ? (
              <div className="absolute inset-0 flex flex-col">
                <div className="flex shrink-0 items-center justify-between pb-1">
                  <p className="text-sm text-ink">
                    待播清单 <span className="ml-1 text-xs text-subtle">{queue.length} 首</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setQueueOpen(false)}
                    className="grid h-8 w-8 place-items-center rounded-full text-subtle transition-colors hover:bg-rose/25 hover:text-crimson"
                    aria-label="回到歌词"
                  >
                    <MorphIcon icon={X} size={16} color="currentColor" />
                  </button>
                </div>
                {queueList}
              </div>
            ) : (
              <Lyrics
                lines={lrcLines}
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                onSeek={music.handleSeek}
              />
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
