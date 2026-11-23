import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audioElement } from '../../lib/musicStore';

export type LyricLine = { time: number; text: string };

/** 二分查找当前行。几百行线性扫也够，但每帧都要跑，二分更稳。 */
function indexAt(lines: LyricLine[], t: number) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * 行内进度 0..1。
 *
 * 没有逐字时间戳（LRC 只有行级），所以用「行时长 ÷ 文本」线性估算 ——
 * 对四四拍的流行曲目误差通常 < 0.2s，肉眼看就是逐字亮起来。
 * 末行的终点用总时长兜底，行与行之间不留空档（否则上一行会停在半格）。
 */
function progressAt(lines: LyricLine[], i: number, t: number, total: number) {
  if (i < 0 || i >= lines.length) return 0;
  const start = lines[i].time;
  const end = lines[i + 1]?.time ?? Math.max(total, start + 3);
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0.15) return 1;
  return Math.min(1, Math.max(0, (t - start) / span));
}

type Props = {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (t: number) => void;
};

/**
 * 歌词轨。
 *
 * 三个和旧实现不同的决定：
 * ① **不用 `scrollIntoView`**。它会连带滚动所有可滚动祖先（整页会被带着跳），
 *    也没法做缓动。这里改成给内层轨 `translateY`，父级 `overflow:hidden` ——
 *    位移只发生在轨自己身上，外面稳如泰山，还能上 spring 曲线。
 * ② **擦色走 rAF 直写 DOM**。store 的 timeupdate 一秒才四次，直接读它描边会
 *    「一格一格」跳。播放时每帧读一次 `audio.currentTime`，只改当前行的
 *    `clip-path`，不触发 React 重渲染（只有换行时才 setState）。
 * ③ **行高固定**。活跃行只做 `transform: scale`，不放大占位 —— 否则每换一行
 *    轨道高度就变，`offsetTop` 全乱，居中会抖。
 */
export default function Lyrics({ lines, currentTime, duration, isPlaying, onSeek }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const activeRef = useRef(-1);
  const [active, setActive] = useState(-1);
  const [shift, setShift] = useState(0);

  /** 只描当前行的擦色；其余行停在 0 或 1，不动。 */
  const paint = useCallback(
    (i: number, t: number) => {
      if (i < 0 || i >= lines.length) return;
      const el = fillRefs.current[i];
      if (!el) return;
      const pct = progressAt(lines, i, t, duration) * 100;
      el.style.clipPath = `inset(0 ${(100 - pct).toFixed(2)}% 0 0)`;
    },
    [lines, duration],
  );

  /* 播放中：每帧读一次真实播放位置，换行才 setState。 */
  useEffect(() => {
    if (!isPlaying || !lines.length) return;
    let raf = 0;
    const tick = () => {
      const t = audioElement().currentTime || 0;
      const i = indexAt(lines, t);
      if (i !== activeRef.current) {
        activeRef.current = i;
        setActive(i);
      }
      paint(i, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, lines, paint]);

  /* 暂停 / 拖动进度条：用 store 的时间对齐，不必等下一帧。 */
  useEffect(() => {
    if (isPlaying || !lines.length) return;
    const i = indexAt(lines, currentTime);
    activeRef.current = i;
    setActive(i);
    paint(i, currentTime);
  }, [isPlaying, currentTime, lines, paint]);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const track = trackRef.current;
    if (!box || !track) return;
    // 还没唱到第一句（前奏常常十几秒）：从头显示即可。
    // 别去居中第一行 —— 那会把它推进上方遮罩的淡出区，看起来像缺了首句。
    if (active < 0) {
      setShift(0);
      return;
    }
    const el = track.querySelector(`[data-i="${active}"]`) as HTMLElement | null;
    if (!el) {
      setShift(0);
      return;
    }
    setShift(el.offsetTop + el.offsetHeight / 2 - box.clientHeight / 2);
  }, [active]);

  useLayoutEffect(() => {
    measure();
  }, [measure, lines]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (!lines.length) {
    return (
      <div className="grid h-full place-items-center text-sm text-subtle">
        这首歌还没配歌词
      </div>
    );
  }

  return (
    <div ref={boxRef} className="q-ly-box">
      <div ref={trackRef} className="q-ly-track" style={{ transform: `translateY(${-shift}px)` }}>
        {lines.map((ln, i) => {
          const on = i === active;
          const near = Math.abs(i - active) === 1;
          return (
            <div
              key={`${ln.time}-${i}`}
              className="q-ly"
              data-i={i}
              data-on={on ? '1' : '0'}
              data-near={near ? '1' : '0'}
              role="button"
              tabIndex={0}
              aria-current={on ? 'true' : undefined}
              onClick={() => onSeek(ln.time)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSeek(ln.time);
                }
              }}
            >
              <span className="q-ly__base">{ln.text || '\u00A0'}</span>
              <span
                ref={(el) => {
                  fillRefs.current[i] = el;
                }}
                className="q-ly__fill"
                aria-hidden="true"
              >
                {ln.text || '\u00A0'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
