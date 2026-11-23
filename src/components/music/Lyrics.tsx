import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audioElement } from '../../lib/musicStore';

export type LyricLine = { time: number; text: string };

/** 二分查找当前行。每帧都要跑，线性扫几百行不划算。 */
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

/** 手动滑开后，停手多久回到当前句（毫秒）。 */
const HOLD_MS = 6000;

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
 * 几个和「普通滚动容器」不同的决定：
 * ① **不用 `scrollIntoView` / `scrollTop`**。前者会连带滚动所有可滚动祖先（整页会被
 *    带着跳），后者的滚动位置没法做缓动。这里用内层轨的 `translateY`，
 *    父级 `overflow:hidden` —— 位移只发生在轨自己身上，外面稳如泰山。
 * ② **支持手动滑动**：滚轮 / 拖动会接管位置（`pinned`），停手 4 秒后自己回到当前句；
 *    点任意一句则立即跳转并结束接管。接管期间高亮和擦色照常跟着音频走，只是视角没跟着。
 * ③ **擦色走 rAF 直写 CSS 变量**。store 的 timeupdate 一秒才四次，直接读它描边会
 *    「一格一格」跳。播放时每帧读一次 `audio.currentTime`，只改当前行的 `--p`，
 *    不触发 React 重渲染（只有换行时才 setState）。
 * ④ **行高固定**。当前行只做 `transform: scale`，不改字号占位 —— 否则每换一行
 *    轨道高度就变，`offsetTop` 全乱，居中会抖。
 */
export default function Lyrics({ lines, currentTime, duration, isPlaying, onSeek }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const activeRef = useRef(-1);

  const [active, setActive] = useState(-1);
  /** 自动跟随算出来的位移。 */
  const [autoShift, setAutoShift] = useState(0);
  /** 手动接管时的位移；null = 跟随当前句。 */
  const [userShift, setUserShift] = useState<number | null>(null);
  /**
   * 接管期间「视觉焦点」落在哪一行。
   *
   * 景深不能按音频那一句算 —— 翻到远处时眼前全是虚的；也不能整个关掉，
   * 那就没有纵深了。所以接管时改用**视口中心**那一行当焦点：
   * 中间的清楚，上下照样渐隐渐糊。
   */
  const [focus, setFocus] = useState(-1);

  /** 当前实际渲染的位移（接管中就用接管值）。滚轮/拖动要读它，所以另存一份 ref。 */
  const shift = userShift ?? autoShift;
  /** 手动接管中：整片景深关掉，否则翻到远处时每行都是虚的。 */
  const pinned = userShift !== null;
  const shiftRef = useRef(0);
  /** wheel 监听器只挂一次，闭包里的 userShift 会过期，所以也存一份。 */
  const userShiftRef = useRef<number | null>(null);
  const dragRef = useRef<{ y: number; base: number } | null>(null);
  /** 这次按下之后有没有真的拖动过 —— 拖完松手不该顺便触发「点歌词跳转」。 */
  const draggedRef = useRef(false);
  const holdTimer = useRef(0);

  useLayoutEffect(() => {
    shiftRef.current = shift;
    userShiftRef.current = userShift;
  }, [shift, userShift]);

  /** 把位移夹在「第一行顶到上沿」和「最后一行贴到底」之间。 */
  const clampShift = useCallback((v: number) => {
    const box = boxRef.current;
    const track = trackRef.current;
    if (!box || !track) return Math.max(0, v);
    const max = Math.max(0, track.scrollHeight - box.clientHeight);
    return Math.min(max, Math.max(0, v));
  }, []);

  const hold = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setUserShift(null), HOLD_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  /** 只描当前行的擦色；其余行由 CSS 的 [data-on='0'] 强制收起。
      写的是自定义属性 `--p` 而不是 clip-path 本身 —— 行离开「当前」之后
      内联的 clip-path 不会自己复位，会留在上一行的进度上（旧行永远红着）。 */
  const paint = useCallback(
    (i: number, t: number) => {
      if (i < 0 || i >= lines.length) return;
      const el = fillRefs.current[i];
      if (!el) return;
      el.style.setProperty('--p', progressAt(lines, i, t, duration).toFixed(4));
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
      setAutoShift(0);
      return;
    }
    const el = track.querySelector(`[data-i="${active}"]`) as HTMLElement | null;
    if (!el) {
      setAutoShift(0);
      return;
    }
    setAutoShift(el.offsetTop + el.offsetHeight / 2 - box.clientHeight / 2);
  }, [active]);

  useLayoutEffect(() => {
    measure();
  }, [measure, lines]);

  /* 接管期间：算出视口正中是哪一行，景深跟着它走。
     滚轮一次事件就会跑一遍，几十个节点取 offsetTop 而已，不值得再 memo。 */
  useLayoutEffect(() => {
    if (userShift === null) return;
    const box = boxRef.current;
    const track = trackRef.current;
    if (!box || !track) return;
    const center = shift + box.clientHeight / 2;
    let best = -1;
    let bestD = Infinity;
    const kids = track.children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - center);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setFocus(best);
  }, [userShift, shift, lines]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  /** 最新一版 measure，给 ResizeObserver 用（不想每次换行都重建 observer）。 */
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  }, [measure]);

  /* 容器高度会变 —— 静置收起控制条时整个舞台要矮 130px。
     用尾部防抖：过渡那 340ms 里每帧都重量的话，位移过渡会被不停打断（看着像卡住），
     所以等尺寸稳定下来再量一次。 */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => measureRef.current(), 120);
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  /* 换歌：接管状态归零，重新跟着新歌走 */
  useEffect(() => {
    setUserShift(null);
    draggedRef.current = false;
    dragRef.current = null;
    window.clearTimeout(holdTimer.current);
  }, [lines]);

  /* 按下播放 / 从暂停恢复：立刻回到当前句。
     浏览歌词时按播放，意图就是「从这儿接着听」，别再停在刚才翻到的地方。 */
  useEffect(() => {
    if (!isPlaying) return;
    window.clearTimeout(holdTimer.current);
    setUserShift(null);
  }, [isPlaying]);

  /* 滚轮：必须用原生监听（React 的 onWheel 是 passive 的，preventDefault 无效），
     否则滚歌词会连带把整页滚下去。 */
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !lines.length) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const next = clampShift((userShiftRef.current ?? shiftRef.current) + e.deltaY);
      setUserShift(next);
      hold();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [lines.length, clampShift, hold]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragRef.current = { y: e.clientY, base: shiftRef.current };
    draggedRef.current = false;
    setUserShift(shiftRef.current);
    /* ⚠️ 这里**不能** setPointerCapture：一旦捕获，后续 pointerup 会被重定向到
       容器，浏览器随之把 click 也派发给容器 —— 行上的 onClick 永远收不到，
       表现就是「点歌词没反应」。只有真的开始拖了才捕获。 */
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (!draggedRef.current && Math.abs(dy) > 6) {
      draggedRef.current = true;
      // 拖起来了才捕获，保证手指/鼠标移出面板也继续跟手
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (!draggedRef.current) return;
    setUserShift(clampShift(d.base + dy));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    hold();
  };

  if (!lines.length) {
    return (
      <div className="grid h-full place-items-center text-sm text-subtle">
        这首歌还没配歌词
      </div>
    );
  }

  return (
    <>
      <div
        ref={boxRef}
        className="q-ly-box"
        /* 手动滑开时挂 data-pinned：CSS 会把景深整片关掉。
           否则每行都按「离当前唱到的那句多远」去虚化 —— 你翻到远处的段落时，
           眼前每一行都是 far 级模糊 + 0.2 透明度，等于什么都看不见。 */
        data-pinned={pinned ? '1' : '0'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
      {/* 3D 倾斜挂在这层：轨自己要 translateY，两个 transform 写一处会互相覆盖 */}
      <div className="q-ly-tilt">
        <div ref={trackRef} className="q-ly-track" style={{ transform: `translateY(${-shift}px)` }}>
          {lines.map((ln, i) => {
            const on = i === active;
            /* 焦点的来源：自动跟随时是「当前唱到的那句」；手动接管时是
               「视口正中那一行」—— 这样就既保住了纵深，又保证眼前能看清。
               还没唱到第一句（active = -1）时退化成「离第一行的距离 + 1」，
               第一行算「下一句」，不该以清晰全黑的字冒充当前行。 */
            const anchor = pinned && focus >= 0 ? focus : active;
            const dist = anchor < 0 ? i + 1 : Math.abs(i - anchor);
            return (
              <div
                key={`${ln.time}-${i}`}
                className="q-ly"
                data-i={i}
                data-on={on ? '1' : '0'}
                data-dist={dist > 3 ? 'far' : String(dist)}
                role="button"
                tabIndex={0}
                aria-current={on ? 'true' : undefined}
                onClick={() => {
                  // 刚才是拖动，不是点击 —— 别顺手跳转
                  if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                  }
                  setUserShift(null);
                  onSeek(ln.time);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setUserShift(null);
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
      </div>

      {/* 挂在遮罩外面（否则贴底这颗按钮会被 mask 一起淡掉）。
          手动滑开时给个明确的出口，不用干等自动回位。 */}
      {pinned && (
        <button
          type="button"
          className="q-ly-back"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setUserShift(null)}
        >
          回到当前句
        </button>
      )}
    </>
  );
}
