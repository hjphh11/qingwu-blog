// 刻度环：60 根径向刻度按顺时针点亮到当前读数，末端一颗 cap 圆点。
// 逐字搬自 scaffold-vue 的 charts/TickRing.vue —— viewBox 0 0 1 1 的归一化坐标、
// 主刻度（每 5 根）更长更粗、cap 落在「已点亮刻度」的中点角度上，算法照抄。
//
// 与 Vue 的差异（只差动画）：
//  1. Vue 用 GSAP 时间线逐根点亮（stagger 0.014s）+ cap 的 back.out 过冲；
//     React 版直接画终态：is-on 类一次性给到该亮的刻度，没有补间。
//     因此也删掉了 root ref / onBeforeUnmount 里的 killTweensOf —— 没有补间要清。
//  2. 中心读数仍用 ui/Odometer.jsx（已有 React 版，逐位滚动是 CSS 过渡，不属于 GSAP）。
import { cls } from '../cls.js';
import Odometer from '../ui/Odometer.jsx';

/* 归一化半径：外沿 0.5（正好贴住 viewBox 边缘），普通刻度内侧 0.4，主刻度 0.37 */
const R_OUT = 0.5;
const R_IN = 0.4;
const R_MAJOR = 0.37;

export default function TickRing({ value, display, unit = '%', label, size = 168, ticks = 60, decimals = 1 }) {
  const pct = Math.min(100, Math.max(0, Number(value ?? 0)));
  // 点亮根数：四舍五入，0% 时一根不亮（cap 也随之消失）
  const lit = Math.round((pct / 100) * ticks);

  // 角度从 12 点方向起算（-90° 偏移），顺时针
  const marks = Array.from({ length: ticks }, (_, i) => {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
    const major = i % 5 === 0;
    const inner = major ? R_MAJOR : R_IN;
    return {
      x1: 0.5 + Math.cos(a) * inner,
      y1: 0.5 + Math.sin(a) * inner,
      x2: 0.5 + Math.cos(a) * (R_OUT - 0.02),
      y2: 0.5 + Math.sin(a) * (R_OUT - 0.02),
      on: i < lit,
      major,
    };
  });

  // cap 落在最后一根已点亮刻度的「半格」角度上，而不是压在刻度线上
  const cap = lit
    ? {
        x: 0.5 + Math.cos(((lit - 0.5) / ticks) * Math.PI * 2 - Math.PI / 2) * 0.53,
        y: 0.5 + Math.sin(((lit - 0.5) / ticks) * Math.PI * 2 - Math.PI / 2) * 0.53,
      }
    : null;

  return (
    <div className={cls('tick-ring')} style={{ width: `${size}px`, height: `${size}px` }}>
      <svg viewBox="0 0 1 1" width={size} height={size} role="img" aria-label={`${label ?? ''} ${pct}%`}>
        {marks.map((m, i) => (
          <line
            key={i}
            className={cls('ring-tick', m.on && 'is-on', m.major && 'is-major')}
            x1={m.x1}
            y1={m.y1}
            x2={m.x2}
            y2={m.y2}
          />
        ))}
        {cap ? <circle className="ring-cap" cx={cap.x} cy={cap.y} r=".022" /> : null}
      </svg>
      <div className="tick-ring-center">
        <span className="tick-ring-value">
          {/* display 给了就优先用它（例如服务端给的更精确的读数） */}
          <Odometer value={display ?? value} decimals={decimals} />
          {unit ? <sup>{unit}</sup> : null}
        </span>
        {label ? <span className="tick-ring-label">{label}</span> : null}
      </div>
    </div>
  );
}
