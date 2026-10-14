// 环比胶囊：上升青柠、下降红、持平中性；上一周期为 0（fresh）时显示「新增」中性态，
// 不给出误导的百分比。逐字搬自 scaffold-vue 的 ui/DeltaPill.vue。
//
// 与 Vue 的差异：computed → 渲染期直接算（纯函数，无缓存必要）。
// 方向判定与文案逐条照抄，包括：v 为 0 或 NaN 时都是 flat；up 显式为 null 才按
// value 正负推方向；整数不带小数，非整数保留一位。
import { cls } from '../cls.js';

export default function DeltaPill({ value, up = null, fresh = false, suffix = '%', label }) {
  let dir;
  if (fresh) dir = 'new';
  else {
    const v = Number(value ?? 0);
    if (!v) dir = 'flat';
    else if (up === null) dir = v > 0 ? 'up' : 'down';
    else dir = up ? 'up' : 'down';
  }

  let text;
  if (fresh) text = '新增';
  else {
    const v = Math.abs(Number(value ?? 0));
    const sign = dir === 'up' ? '+' : dir === 'down' ? '−' : '±';
    text = `${sign}${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`;
  }

  return (
    <span className={cls('delta-pill', `is-${dir}`)} title={label}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        {dir === 'up' ? (
          <path d="M4 1.2 7 6H1z" fill="currentColor" />
        ) : dir === 'down' ? (
          <path d="M4 6.8 1 2h6z" fill="currentColor" />
        ) : dir === 'new' ? (
          <circle cx="4" cy="4" r="2.2" fill="currentColor" />
        ) : (
          <rect x="1" y="3.3" width="6" height="1.4" rx=".7" fill="currentColor" />
        )}
      </svg>
      <span className="tnum">{text}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
