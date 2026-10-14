// 柱状图：柱子高度按峰值归一，highlight 柱用按斜线填充（CSS 的 --hatch）表示「当前」，
// 失败部分叠在柱顶成红色细段。逐字搬自 scaffold-vue 的 charts/BarChart.vue ——
// 最小高度兜底（有值 4%、零值 2%）、失败段相对柱高的百分比、峰顶默认读数、
// hover 与 peak 读数的互斥条件全部照抄。
//
// 与 Vue 的差异（只差动画）：
//  1. Vue 用 GSAP 从基线生长（scaleY 0→1，stagger 0.05s）；React 版直接画终态，
//     不给 transform，.bar-col 的 transform-origin 在 CSS 里留着也不影响。
//     因此也删掉了 bars ref / onBeforeUnmount 的 killTweensOf。
import { useState } from 'react';
import { cls } from '../cls.js';

export default function BarChart({ values = [], labels = [], failed = [], highlight = null, height = 168, unit = '' }) {
  const [hover, setHover] = useState(null);
  // 归一化基准至少为 1，全零时不至于除零
  const max = Math.max(1, ...values);
  // 空数组时 Math.max() 是 -Infinity，indexOf 得 -1，正好谁都不标（与 Vue 一致）
  const peakIndex = values.indexOf(Math.max(...values));

  return (
    <div className={cls('bars')} style={{ height: `${height}px` }} onPointerLeave={() => setHover(null)}>
      <div className="bars-plot" role="img" aria-label={`柱状图，最高 ${Math.max(0, ...values)}${unit}`}>
        {values.map((v, i) => (
          <div
            key={i}
            className={cls('bar-slot', hover === i && 'is-hover')}
            onPointerEnter={() => setHover(i)}
          >
            {/* 悬停时只显示该柱读数；没悬停时在峰顶显示一次，避免整排数字喧宾夺主 */}
            {hover === i || (hover === null && i === peakIndex && v > 0) ? (
              <span className={cls('bar-readout', 'tnum')}>
                {v}
                {unit}
              </span>
            ) : null}
            <div
              className={cls('bar-col', i === highlight && 'is-highlight')}
              style={{ height: `${Math.max(v ? 4 : 2, (v / max) * 100)}%` }}
            >
              {/* 失败段最多铺满整根柱子；v 为 0 时按 1 兜底，避免除零得到 Infinity */}
              {failed[i] ? (
                <span
                  className="bar-failed"
                  style={{ height: `${Math.min(100, (failed[i] / Math.max(v, 1)) * 100)}%` }}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="bars-labels">
        {labels.map((l, i) => (
          <span key={i} className={cls(i === highlight && 'is-highlight')}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
