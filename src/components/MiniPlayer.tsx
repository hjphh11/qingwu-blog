import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import { initMusic, subscribe, getMusicState, music } from '../lib/musicStore';

const WIDTH = 240;
const HEIGHT = 76;
const EDGE = 16;

type Dock = 'left' | 'right' | null;

export default function MiniPlayer() {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [state, setState] = useState(getMusicState());
  const [docked, setDocked] = useState<Dock>(null);
  const [pathname, setPathname] = useState('/');

  useEffect(() => {
    setPathname(window.location.pathname);
    initMusic();
    return subscribe(() => setState(getMusicState()));
  }, []);

  const spring = { type: 'spring' as const, stiffness: 320, damping: 30 };

  const handleDragEnd = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const center = rect.left + rect.width / 2;
    if (center < vw * 0.4) {
      animate(x, x.get() + (EDGE - rect.left), spring);
      setDocked('left');
    } else if (center > vw * 0.6) {
      animate(x, x.get() + (vw - EDGE - rect.width - rect.left), spring);
      setDocked('right');
    } else {
      setDocked(null);
    }
  };

  const bounds = {
    top: EDGE,
    left: EDGE,
    right: Math.max(window.innerWidth - WIDTH - EDGE, EDGE),
    bottom: Math.max(window.innerHeight - HEIGHT - EDGE, EDGE),
  };

  const { currentSong, isPlaying, currentLyric } = state;

  // 首页隐藏
  if (pathname === '/') return null;

  const open = () => setDocked(null);

  return (
    <motion.div
      ref={ref}
      drag
      dragMomentum={false}
      dragConstraints={bounds}
      style={{ x, y }}
      onDragEnd={handleDragEnd}
      initial={{ y: 0 }}
      className="fixed bottom-6 right-6 z-50 w-[240px] cursor-grab select-none active:cursor-grabbing"
    >
      {docked ? (
        /* 收进边缘的小贴边标签 */
        <motion.button
          type="button"
          layout
          onClick={open}
          className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3"
          style={{
            background: 'rgba(253, 246, 240, 0.85)',
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.7)',
            boxShadow: '0 8px 24px rgba(246, 165, 184, 0.25)',
          }}
          transition={{ layout: spring }}
        >
          <img
            src={currentSong?.cover ?? '/music/covers/cover-1.svg'}
            alt=""
            width={34}
            height={34}
            className={`h-9 w-9 rounded-full object-cover ${isPlaying ? 'disc playing' : 'disc'}`}
          />
          <span className="text-xs text-ink/60">{currentSong?.title ?? '音乐馆'}</span>
        </motion.button>
      ) : (
        <div
          className="flex items-center gap-2.5 rounded-[var(--radius-card)] p-2.5"
          style={{
            background: 'rgba(253, 246, 240, 0.82)',
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
          <button
            type="button"
            onClick={() => (window.location.href = '/music')}
            className="min-w-0 flex-1 text-left"
            title="打开音乐馆"
          >
            <p className="truncate text-sm text-ink">{currentSong?.title ?? '暂无播放'}</p>
            <p className="truncate text-xs text-ink/50">
              {currentLyric || currentSong?.artist || '去音乐馆挑一首'}
            </p>
          </button>
          <button
            type="button"
            aria-label={isPlaying ? '暂停' : '播放'}
            onClick={() => music.togglePlay()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-110 active:scale-95"
          >
            <span className="text-sm">{isPlaying ? '⏸' : '▶'}</span>
          </button>
          <button
            type="button"
            aria-label="下一首"
            onClick={() => music.nextSong()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink/70 transition-transform hover:scale-110 active:scale-95"
          >
            <span className="text-sm">⏭</span>
          </button>
        </div>
      )}
    </motion.div>
  );
}
