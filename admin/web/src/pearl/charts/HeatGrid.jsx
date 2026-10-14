// 星期 × 小时热力格：格子按分位分 5 级（青柠由浅到深），失败占比高的格子叠斜线（--hatch）。
// 悬停／聚焦时十字高亮整行整列并在页脚显示读数；格子可聚焦，方向键在网格里移动。
// 逐字搬自 scaffold-vue 的 components/charts/HeatGrid.vue。
//
// 与 Vue 的差异（只在这里说一次，代码里不再重复）：
// 1. Vue 用 GSAP 做「从左上角向右下对角线波纹点亮」（导 Conduct，stagger.grid from [0,0]）。
//    这里不引 GSAP，直接画终态 —— 这等价于 Vue 在 prefers-reduced-motion 或页面在后台时
//    走的那条 motionSkipped 分支，所以本组件不需要再读 matchMedia。
// 2. 纯计算（7×24 补格 + 分位分级）内联在下面当私有函数，不引 scaffold 的 utils/heatmap.ts。
// 3. DOM 结构、类名、坐标与键盘行为与 Vue 版逐字一致。
import { useMemo, useRef, useState } from 'react';
import { cls } from '../cls.js';

/* ── 以下两个函数逐字搬自 scaffold-vue 的 utils/heatmap.ts（纯函数，无副作用） ── */

/**
 * 把后端稀疏格子补成 7 × 24 网格，并按分位分 0–4 级。
 * 分位切点只统计 total > 0 的格子：否则大量空格的 0 会把切点压到 0，所有非空格都变最高级。
 */
function buildHeatGrid(cells) {
  const grid = Array.from({ length: 7 }, (_, dow) =>
    Array.from({ length: 24 }, (_, hour) => ({ dow, hour, total: 0, failed: 0, level: 0, failRate: 0, risky: false })),
  );
  for (const c of cells) {
    // 后端可能返回越界格子（时区/脏数据），丢掉而不是写坏 grid
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue;
    const cell = grid[c.dow][c.hour];
    cell.total += c.total;
    cell.failed += c.failed;
  }
  const totals = grid.flat().map((c) => c.total).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => (totals.length ? totals[Math.floor(p * (totals.length - 1))] : 0);
  const cuts = [q(0.25), q(0.5), q(0.75)];
  let peak = null;
  for (const cell of grid.flat()) {
    cell.failRate = cell.total ? cell.failed / cell.total : 0;
    cell.risky = cell.failed >= 2 && cell.failRate >= 0.3;
    cell.level = cell.total === 0 ? 0 : cell.total <= cuts[0] ? 1 : cell.total <= cuts[1] ? 2 : cell.total <= cuts[2] ? 3 : 4;
    if (!peak || cell.total > peak.total) peak = cell;
  }
  const total = totals.reduce((a, b) => a + b, 0);
  // peak 为空表格（total 全 0）时回落 null，页脚据此走「暂无登录」兜底
  return { grid, peak: peak && peak.total ? peak : null, total };
}

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function HeatGrid({ cells = [], loading = false }) {
  // cells 换引用才重算：hover 存的是 grid 里的格子对象，重算后旧引用失效（Vue 的 computed 同理）
  const data = useMemo(() => buildHeatGrid(cells), [cells]);
  const [hover, setHover] = useState(null);
  const root = useRef(null);

  const label = (c) =>
    `${DAYS[c.dow]} ${String(c.hour).padStart(2, '0')}:00，登录 ${c.total} 次${c.failed ? `，失败 ${c.failed} 次` : ''}`;

  // 方向键在 7×24 网格里移动焦点：不越界，落到边界就停在边界（不循环）
  function onKey(event, cell) {
    const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!move) return;
    event.preventDefault();
    const dow = Math.min(6, Math.max(0, cell.dow + move[0]));
    const hour = Math.min(23, Math.max(0, cell.hour + move[1]));
    root.current?.querySelector(`[data-cell="${dow}-${hour}"]`)?.focus();
  }

  return (
    <div ref={root} className={cls('heat', loading && 'is-loading')} onPointerLeave={() => setHover(null)}>
      <div className={cls('heat-hours')} aria-hidden="true">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className={cls(hover?.hour === hour && 'is-on')}>
            {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      {data.grid.map((row, dow) => (
        <div key={dow} className={cls('heat-row')} role="row">
          <span className={cls('heat-day', hover?.dow === dow && 'is-on')}>{DAYS[dow]}</span>
          {row.map((cell) => (
            <button
              key={cell.hour}
              type="button"
              data-cell={`${cell.dow}-${cell.hour}`}
              className={cls(
                'heat-cell',
                `lv-${cell.level}`,
                cell.risky && 'is-risky',
                hover && (hover.dow === cell.dow || hover.hour === cell.hour) && 'is-cross',
                hover === cell && 'is-hover',
              )}
              aria-label={label(cell)}
              onPointerEnter={() => setHover(cell)}
              onFocus={() => setHover(cell)}
              onKeyDown={(event) => onKey(event, cell)}
            />
          ))}
        </div>
      ))}
      <div className={cls('heat-foot')}>
        <span className={cls('heat-readout')} aria-live="polite">
          {hover
            ? label(hover)
            : data.peak
              ? `高峰：${DAYS[data.peak.dow]} ${String(data.peak.hour).padStart(2, '0')}:00 · ${data.peak.total} 次`
              : '所选范围内暂无登录'}
        </span>
        <span className={cls('heat-legend')} aria-hidden="true">少<i className={cls('lv-1')} /><i className={cls('lv-2')} /><i className={cls('lv-3')} /><i className={cls('lv-4')} />多<i className={cls('is-risky')} />失败集中</span>
      </div>
    </div>
  );
}
