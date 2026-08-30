import { useRef } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';

const WIDTH = 220;
const HEIGHT = 68;
const EDGE = 16;

// 全局悬浮迷你播放器占位:可拖拽、拖到左右两侧自动收边。
// 音乐数据在阶段 4 接入,此刻仅显示占位说明。
export default function MiniPlayer() {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const spring = { type: 'spring' as const, stiffness: 320, damping: 30 };

  const handleDragEnd = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const center = rect.left + rect.width / 2;

    if (center < vw / 2) {
      // 吸附到左边缘
      animate(x, x.get() + (EDGE - rect.left), spring);
    } else {
      // 吸附到右边缘
      animate(x, x.get() + (vw - EDGE - rect.width - rect.left), spring);
    }
  };

  const bounds = {
    top: EDGE,
    left: EDGE,
    right: Math.max(window.innerWidth - WIDTH - EDGE, EDGE),
    bottom: Math.max(window.innerHeight - HEIGHT - EDGE, EDGE),
  };

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
          background: 'rgba(253, 246, 240, 0.78)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.7)',
          boxShadow: '0 12px 36px rgba(246, 165, 184, 0.28)',
        }}
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose/25 text-lg">
          🎵
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">暂无播放</p>
          <p className="truncate text-xs text-ink/50">音乐将在阶段 4 接入</p>
        </div>
        <button
          type="button"
          aria-label="播放/暂停(占位)"
          onClick={() => {}}
          className="grid h-8 w-8 place-items-center rounded-full bg-crimson text-white transition-transform hover:scale-110 active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
