import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import { initMusic, subscribe, getMusicState, music } from '../lib/musicStore';

const WIDTH = 220;
const HEIGHT = 68;
const EDGE = 16;

// 全局悬浮迷你播放器:显示当前歌曲、可拖拽、拖到左右两侧自动收边。跨页持久。
export default function MiniPlayer() {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [state, setState] = useState(getMusicState());

  useEffect(() => {
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
    if (center < vw / 2) {
      animate(x, x.get() + (EDGE - rect.left), spring);
    } else {
      animate(x, x.get() + (vw - EDGE - rect.width - rect.left), spring);
    }
  };

  const bounds = {
    top: EDGE,
    left: EDGE,
    right: Math.max(window.innerWidth - WIDTH - EDGE, EDGE),
    bottom: Math.max(window.innerHeight - HEIGHT - EDGE, EDGE),
  };

  const { track, playing } = state;

  return (
    <motion.div
      ref={ref}
      drag
      dragMomentum={false}
      dragConstraints={bounds}
      style={{ x, y }}
      onDragEnd={handleDragEnd}
      initial={{ y: 0 }}
      className="fixed bottom-6 right-6 z-50 w-[220px] cursor-grab select-none active:cursor-grabbing"
    >
      <div
        className="flex items-center gap-3 rounded-[var(--radius-card)] p-2.5"
        style={{
          background: 'rgba(253, 246, 240, 0.82)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.7)',
          boxShadow: '0 12px 36px rgba(246, 165, 184, 0.28)',
        }}
      >
        <img
          src={track?.cover ?? '/music/covers/cover-1.svg'}
          alt={track?.title ?? '暂无播放'}
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-xl object-cover"
        />
        <button
          type="button"
          onClick={() => (window.location.href = '/music')}
          className="min-w-0 flex-1 text-left"
          title="打开音乐页"
        >
          <p className="truncate text-sm text-ink">{track?.title ?? '暂无播放'}</p>
          <p className="truncate text-xs text-ink/50">{track?.artist ?? '去音乐页挑一首'}</p>
        </button>
        <button
          type="button"
          aria-label={playing ? '暂停' : '播放'}
          onClick={() => music.toggle()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-110 active:scale-95"
        >
          <span className="text-sm">{playing ? '⏸' : '▶'}</span>
        </button>
      </div>
    </motion.div>
  );
}
