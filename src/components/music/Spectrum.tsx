import { useEffect, useRef } from 'react';
import { BAND_COUNT, readBands } from '../../lib/audioAnalyser';

/**
 * 40 根频谱柱（v6 §8.2）。数据来自 `AnalyserNode` 的真实采样，不是随机跳。
 *
 * 三条纪律：
 * ① **不播就不跑**。rAF 只在 `playing` 时开；暂停后先让柱子衰减到 0，再停 ——
 *    否则一根不动的柱子挂在播放器上，看起来像卡住了。§8.3 的「暂停后频谱回落到静止」
 *    验的就是这个。
 * ② **取不到数据就整块隐藏**。没有 Web Audio / 跨域静音时 `readBands` 返回 false，
 *    这里直接 `display:none`，绝不放一个假动画（宁缺毋滥，方案原话）。
 * ③ **减动效不跑**。持续动画的既有约定（见 motion.css）：`prefers-reduced-motion` 下静止。
 *
 * 位置用 absolute 挂在那张唱片上，**不占布局** —— 加一条 22px 的柱子本来就该零位移，
 * 一旦进常规流，播放器卡片在 md 断点下会溢出。
 */
export default function Spectrum({ playing }: { playing: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const rafRef = useRef(0);
  /** 当前显示值（做过阻尼，用于平滑）。 */
  const shownRef = useRef<number[]>(new Array(BAND_COUNT).fill(0));
  /** readBands 的落点缓冲，复用避免每帧 new。 */
  const levelRef = useRef(new Float32Array(BAND_COUNT));

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      wrap.dataset.state = 'off';
      return;
    }

    let cancelled = false;
    let silentFrames = 0;

    const paint = () => {
      const bars = barsRef.current;
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i];
        if (!el) continue;
        const shown = shownRef.current[i];
        el.style.transform = `scaleY(${Math.max(0.015, shown).toFixed(3)})`;
      }
    };

    const frame = () => {
      if (cancelled) return;
      const level = levelRef.current;
      const hasData = readBands(level);

      // 播着播着一直读到全 0 → 大概率是跨域静音（见 audioAnalyser.ts ①）。
      // 连续 90 帧（≈1.5s）都这样就不再折腾，把整块收起来。
      if (playing && hasData) silentFrames = 0;
      else if (playing) silentFrames++;

      if (playing && silentFrames > 90 && !hasData) {
        wrap.dataset.state = 'off';
        return;
      }

      let alive = false;
      for (let i = 0; i < BAND_COUNT; i++) {
        const target = playing && hasData ? level[i] : 0;
        const cur = shownRef.current[i];
        // 上升快、回落慢：真实电平就是这个手感（对称阻尼会显得迟钝）
        const next = cur + (target - cur) * (target > cur ? 0.5 : 0.16);
        shownRef.current[i] = next;
        if (next > 0.004) alive = true;
      }
      paint();

      // 播着 → 一直跑；停了但还没落干净 → 继续跑到静止
      if (playing || alive) rafRef.current = requestAnimationFrame(frame);
      else rafRef.current = 0;
    };

    /* 播 / 停走同一条循环：`playing` 只决定「目标值是电平还是 0」。
       暂停时仍然要跑，是为了让柱子回落 —— 直接停会留一排定格的柱子在上头。
       上一轮 effect 的 cleanup 已经把 rAF 取消并把 cancelled 置真，所以这里必须重新起。 */
    wrap.dataset.state = playing ? 'on' : 'off';
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [playing]);

  return (
    <div ref={wrapRef} className="q-spectrum" data-q-spectrum data-state="off" aria-hidden="true">
      {Array.from({ length: BAND_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}
