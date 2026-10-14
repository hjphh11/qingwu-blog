// 时间轴泳道：泳道 × 时间轴。默认聚焦到 [首条 −1h, 现在 +1h]（至少 6 小时），可切回全天。
//   - 失败块红描边（is-failed），耗时超过 slowMs 的块加斜线（is-slow，--hatch）
//   - 「现在」竖线每分钟推进一格，页面在后台时不推进
//   - 悬停／聚焦块显示读数浮层（swim-tip），点击块回调 onSelect
// 逐字搬自 scaffold-vue 的 components/charts/Swimlane.vue。
//
// 与 Vue 的差异：
// 1. Vue 用 GSAP 让时间块从起点向右生长（导 Conduct，stagger from start）。这里直接画终态，
//    等价于 Vue 的 motionSkipped 分支，所以不需要读 matchMedia。
// 2. Vue 的「现在」线推进本来就是 window.setInterval 定时器（不是 GSAP），照搬为 useEffect +
//    清理函数；StrictMode 下 effect 跑两次，不清理会留下两个定时器。
// 3. Vue 引 ui/Ruler.vue（刻度尺）。React 侧暂时没有对应的 ui/Ruler.jsx，为了不让这个文件
//    依赖别的智能体正在写的 pearl/ui/*，把 Ruler 的模板逐字内联成本文件私有的 Ruler 组件。
//    等 ui/Ruler.jsx 落地后，把这里的 Ruler 删掉、改成 import 即可（DOM 与类名完全相同）。
// 4. Vue 的 `tip` ref 在模板里赋了值但脚本里没读过，这里省略。
import { useEffect, useMemo, useRef, useState } from 'react';
import { cls } from '../cls.js';

const DAY = 86400;
const MIN_WIDTH = 0.5; // 百分比：单次操作也要看得见

const fmt = (sec) =>
  `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;

/* 刻度尺（内联自 scaffold-vue 的 ui/Ruler.vue）：细刻度 + 主刻度标签，
   marker 为 0–1 的当前位置（一根亮刻度）。标记为 aria-hidden —— 标尺是纯视觉参照，
   真正的读数在块的 aria-label 与浮层里。 */
function Ruler({ labels = [], marker = null, markerLabel, minor = 4 }) {
  const major = Math.max(labels.length - 1, 1);
  return (
    <div className={cls('ruler')} style={{ '--ruler-major': major, '--ruler-minor': minor }} aria-hidden="true">
      <div className={cls('ruler-ticks')} />
      <div className={cls('ruler-labels')}>
        {labels.map((l, i) => (
          <span key={i} style={{ left: `${(i / major) * 100}%` }}>{l}</span>
        ))}
      </div>
      {marker !== null ? (
        <span className={cls('ruler-marker')} style={{ left: `${Math.min(Math.max(marker, 0), 1) * 100}%` }}>
          {markerLabel ? <span className={cls('ruler-marker-label', 'tnum')}>{markerLabel}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

export default function Swimlane({
  lanes = [],
  nowSec = null,
  compact = false,
  maxLanes = 8,
  slowMs = 1000,
  onSelect,
}) {
  const plot = useRef(null);
  const [hover, setHover] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [now, setNow] = useState(nowSec);
  const [full, setFull] = useState(false);

  // props.nowSec 变化时同步本地 now（Vue 里是 watch(props.nowSec)）；初始值由 useState 给出
  useEffect(() => {
    setNow(nowSec);
  }, [nowSec]);

  // 现在线：每 60s 推进一分钟。document.hidden 时不动（后台标签页里时间照样走，
  // 但这里照抄 Vue 的语义：回到前台由下一次 tick 继续，避免整页在后台空转）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      // 用函数式更新而不是读闭包里的 now：定时器只注册一次，闭包里的 now 永远是首帧值
      setNow((value) => (value === null ? null : Math.min(DAY, value + 60)));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const shownLanes = lanes.slice(0, maxLanes);
  const hiddenCount = Math.max(0, lanes.length - maxLanes);

  /* 时间窗：整点对齐，区间长度为刻度步长的整数倍，刻度均匀铺满标尺。
     空数据（或切到全天）时退化成 00:00–24:00 均分。 */
  const domain = useMemo(() => {
    const H = 3600;
    const maxCols = compact ? 4 : 8;
    const blocks = lanes.flatMap((lane) => lane.blocks);
    if (full || !blocks.length) return { start: 0, end: DAY, step: DAY / maxCols };
    const first = Math.min(...blocks.map((b) => b.startSec));
    const last = Math.max(...blocks.map((b) => b.endSec), now ?? 0);
    let start = Math.max(0, Math.floor((first - H) / H) * H);
    let end = Math.min(DAY, Math.ceil((last + H) / H) * H);
    // 窗口太窄时补到 6 小时（先往前补一半，再夹回 0 点，最后反向夹一次保证恰好 6 小时）
    if (end - start < 6 * H) {
      const pad = 6 * H - (end - start);
      start = Math.max(0, start - Math.ceil(pad / 2 / H) * H);
      end = Math.min(DAY, start + 6 * H);
      start = Math.max(0, end - 6 * H);
    }
    const step = Math.ceil((end - start) / H / maxCols) * H;
    end = Math.min(DAY, start + step * Math.ceil((end - start) / step));
    if (end - start < step) start = Math.max(0, end - step);
    return { start, end, step };
  }, [lanes, compact, full, now]);

  const span = domain.end - domain.start;
  const cols = Math.max(1, Math.round(span / domain.step));
  const labels = Array.from({ length: cols + 1 }, (_, i) => {
    const sec = domain.start + i * domain.step;
    return compact ? String(Math.floor(sec / 3600)).padStart(2, '0') : fmt(Math.min(sec, DAY));
  });
  const frac = (sec) => (sec - domain.start) / span;

  const nowLabel = now === null ? '' : fmt(now);

  function blockStyle(block) {
    const left = frac(block.startSec) * 100;
    const width = Math.max(MIN_WIDTH, ((block.endSec - block.startSec) / span) * 100);
    // 左边界夹住，避免贴着窗口右端的块溢出轨道
    return { left: `${Math.min(left, 100 - width)}%`, width: `${width}%` };
  }

  // 浮层坐标相对 plot 量取：块自身也可能是定位父级，用事件目标而不是块元素查询
  function onEnter(event, lane, block) {
    setHover({ lane, block });
    const box = plot.current?.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    if (!box) return;
    setTipPos({ x: target.left - box.left + target.width / 2, y: target.top - box.top });
  }

  return (
    <div className={cls('swimlane', compact && 'is-compact')}>
      <div className={cls('swim-head')}>
        <button
          type="button"
          className={cls('swim-corner', 'swim-zoom')}
          aria-pressed={full}
          title={full ? '聚焦到有操作的时段' : '查看全天 00:00–24:00'}
          onClick={() => setFull((value) => !value)}
        >
          {full ? '全天' : '聚焦'}
        </button>
        <Ruler
          labels={labels}
          marker={now === null ? null : frac(now)}
          markerLabel={compact ? undefined : nowLabel}
          minor={compact ? 6 : 3}
        />
      </div>
      <div ref={plot} className={cls('swim-body')} onPointerLeave={() => setHover(null)}>
        <div className={cls('swim-grid')} style={{ '--swim-cols': cols }} aria-hidden="true" />
        {shownLanes.map((lane, li) => (
          <div key={lane.module} className={cls('swim-lane', `cat-${(li % 5) + 1}`)}>
            <div className={cls('swim-label')}>
              <span className={cls('swim-name')}>{lane.module}</span>
              <span className={cls('swim-count', 'tnum')}>{lane.count} 次</span>
            </div>
            <div className={cls('swim-track')}>
              {lane.blocks.map((b, bi) => (
                <button
                  key={bi}
                  type="button"
                  className={cls('lane-block', b.failed > 0 && 'is-failed', b.maxCost >= slowMs && 'is-slow')}
                  style={blockStyle(b)}
                  aria-label={`${lane.module} ${fmt(b.startSec)}–${fmt(b.endSec)}，${b.count} 次${b.failed ? `，失败 ${b.failed}` : ''}`}
                  onPointerEnter={(event) => onEnter(event, lane, b)}
                  onFocus={(event) => onEnter(event, lane, b)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect?.({ lane, block: b })}
                >
                  {!compact && b.count > 1 ? <span className={cls('lane-block-count', 'tnum')}>{b.count}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
        {now !== null ? (
          <div
            className={cls('swim-now')}
            style={{ left: `calc(var(--swim-label-w) + (100% - var(--swim-label-w)) * ${frac(now)})` }}
            aria-hidden="true"
          />
        ) : null}
        {hover ? (
          <div className={cls('swim-tip', 'm-float')} style={{ left: `${tipPos.x}px`, top: `${tipPos.y}px` }}>
            <span className={cls('eyebrow')}>{hover.lane.module}</span>
            <b className={cls('tnum')}>{fmt(hover.block.startSec)} – {fmt(hover.block.endSec)}</b>
            <span className={cls('swim-tip-row')}><span>操作</span><b className={cls('tnum')}>{hover.block.count} 次</b></span>
            <span className={cls('swim-tip-row')}><span>失败</span><b className={cls('tnum', hover.block.failed && 'is-red')}>{hover.block.failed}</b></span>
            <span className={cls('swim-tip-row')}><span>最大耗时</span><b className={cls('tnum')}>{hover.block.maxCost} ms</b></span>
          </div>
        ) : null}
        {hiddenCount ? <p className={cls('swim-more', 'faint')}>另有 {hiddenCount} 个模块未显示</p> : null}
      </div>
    </div>
  );
}
