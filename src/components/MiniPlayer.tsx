import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'motion/react';
import { MorphIcon } from 'morphicons/react';
import { Play, Pause, SkipForward } from '../lib/icons';
import { initMusic, subscribe, getMusicState, music } from '../lib/musicStore';

export default function MiniPlayer() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [state, setState] = useState(getMusicState());
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPageLoad = () => setPathname(window.location.pathname);
    document.addEventListener('astro:page-load', onPageLoad);
    setPathname(window.location.pathname);
    initMusic();
    const unsub = subscribe(() => setState(getMusicState()));
    return () => {
      document.removeEventListener('astro:page-load', onPageLoad);
      unsub();
    };
  }, []);

  const { currentSong, isPlaying, currentLyric } = state;

  // 首页与音乐页隐藏(音乐页已有完整播放器)
  if (pathname === '/' || pathname === '/music') return null;

  return (
    <div ref={viewportRef} className="pointer-events-none fixed inset-0 z-50">
      <motion.div
        ref={ref}
        drag
        dragMomentum={false}
        dragConstraints={viewportRef}
        style={{ x, y }}
        className="pointer-events-auto absolute bottom-6 right-6 cursor-grab select-none active:cursor-grabbing"
      >
        <div
          className="flex items-center gap-2.5 rounded-[var(--radius-card)] p-2.5"
          style={{
            background: 'rgba(253, 246, 240, 0.85)',
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.7)',
            boxShadow: '0 12px 36px rgba(246, 165, 184, 0.28)',
          }}
        >
          <img
            src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
            alt={currentSong?.title ?? '暂无播放'}
            width={44}
            height={44}
            className={`h-11 w-11 shrink-0 rounded-full object-cover ${isPlaying ? 'disc playing' : 'disc'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{currentSong?.title ?? '暂无播放'}</p>
            <p className="truncate text-xs text-ink/50">
              {currentLyric || currentSong?.artist || '去音乐馆挑一首'}
            </p>
          </div>
          <button
            type="button"
            aria-label={isPlaying ? '暂停' : '播放'}
            onClick={() => music.togglePlay()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-110 active:scale-95"
          >
            <MorphIcon icon={isPlaying ? Pause : Play} size={17} color="#fff" />
          </button>
          <button
            type="button"
            aria-label="下一首"
            onClick={() => music.nextSong()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink/70 transition-transform hover:scale-110 active:scale-95"
          >
            <MorphIcon icon={SkipForward} size={17} color="currentColor" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
