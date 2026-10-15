// 纯 SVG 趋势图：按容器真实宽度计算路径，线宽不被拉伸。
// 逐字搬自 scaffold-vue 的 charts/TrendChart.vue —— SVG 结构、类名、坐标算法、
// 刻度取整（1/2/5 × 10ⁿ）、稀疏数据降级成茎叶点、准星读数、无障碍属性全部照抄。
//
// 与 Vue 的差异（只差动画，几何与语义一一对应）：
//  1. 不引 GSAP。Vue 的 morphTo()/resample()（数据切换时折线从旧形态形变到新形态）
//     与 drawPath()（折线描绘）整段去掉：React 版 shown 恒等于 target，
//     所以只服务于形变的 resample() 采样函数也一并删除，其余点列计算逐字保留。
//  2. 读数气泡不再用 gsap.quickTo 平滑跟随：气泡尺寸在 useLayoutEffect 里量一次，
//     位置在渲染期算出来写进 transform（夹取公式与 Vue 一致）。省掉 +0.32s 跟随。
//  3. ResizeObserver 改用 useRef + useEffect，清理函数里 disconnect（StrictMode 双跑安全）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cls } from '../cls.js';

/* 绘图内边距：四周留白固定，坐标一律按内区算 */
const PAD = { top: 18, right: 20, bottom: 28, left: 38 };

/* 纵轴取整：至少留 15% 顶部余量，刻度步长取 1 / 2 / 5 × 10ⁿ */
function niceStep(raw) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const r = raw / magnitude;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * magnitude;
}

/* 平滑路径：相邻点取中点做三次贝塞尔控制点（与 Vue 的 smooth() 逐字符相同） */
function smooth(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i - 1];
    const c = pts[i];
    const mx = (p.x + c.x) / 2;
    d += ` C${mx},${p.y} ${mx},${c.y} ${c.x},${c.y}`;
  }
  return d;
}

export default function TrendChart({
  values = [],
  labels = [],
  secondary,
  secondaryLabel = '失败',
  // 副曲线色调：默认 red（语义是"失败"）；流量类页面（PV/UV 都不是失败）传 ink
  secondaryTone = 'red',
  primaryLabel = '数值',
  height = 220,
  unit = '',
  band = null,
  dots = true,
  tone = 'blue',
}) {
  const boxRef = useRef(null);
  const tipRef = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 });
  // 渐变/斜线 pattern 的 id 必须整轮生命周期稳定：渲染期每次重新随机会让
  // fill="url(#tg-…)" 指向一个不存在的 id，面积和斜线填充会整片消失。
  const [uid] = useState(() => Math.random().toString(36).slice(2, 8));

  const sec = secondary ?? [];

  /* ── 纵轴量程：峰值参与，至少 4 条刻度 ── */
  const peak = Math.max(1, ...values, ...sec);
  const step = Math.max(1, niceStep((peak * 1.15) / 4));
  const max = step * Math.max(1, Math.ceil((peak * 1.15) / step));

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const base = PAD.top + innerH;

  const xAt = (i, n) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => PAD.top + innerH - (v / max) * innerH;

  const target = values.map((v, i) => ({ x: xAt(i, values.length), y: yAt(v) }));
  const target2 = sec.map((v, i) => ({ x: xAt(i, sec.length), y: yAt(v) }));

  const linePath = smooth(target);
  const line2Path = smooth(target2);
  const areaPath = target.length
    ? `${smooth(target)} L${target[target.length - 1].x},${base} L${target[0].x},${base} Z`
    : '';

  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push({ y: yAt(v), label: v });

  // 横轴标签抽稀：每约 70px 允许一个，两端保留（末尾永远显示）
  const n = labels.length;
  const labelStep = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));
  const xLabels = labels
    .map((label, i) => ({ label, i }))
    .filter(({ i }) => i % labelStep === 0 || i === n - 1);

  const showAllDots = dots && values.length <= 12;
  // 稀疏数据（非零点 ≤ 3 且点数 > 6）改画茎叶点并直接标数值，
  // 避免贴底折线末端一根尖刺
  const sparse = values.length > 6 && values.filter((v) => v > 0).length <= 3 && values.some((v) => v > 0);
  const stems = target.map((p, i) => ({
    ...p,
    i,
    v: values[i],
    v2: sec[i] ?? 0,
    y2: secondary ? yAt(sec[i] ?? 0) : 0,
  }));

  const bandRect = (() => {
    if (!band || values.length < 2) return null;
    const [a, b] = band;
    const x1 = xAt(Math.max(0, a), values.length);
    const x2 = xAt(Math.min(values.length - 1, b), values.length);
    return { x: Math.min(x1, x2), w: Math.max(2, Math.abs(x2 - x1)) };
  })();

  // 读数气泡：位置在渲染期算好（Vue 用 quickTo 跟随，这里直接落位）
  const tip = hover !== null && target[hover] ? target[hover] : null;
  const tipX = tip ? Math.min(Math.max(tip.x - tipSize.w / 2, 0), width - tipSize.w) : 0;
  const tipY = tip ? Math.max(tip.y - tipSize.h - 14, 0) : 0;

  /* 气泡宽度随内容变（图例行多一行就变高），挂载当帧量一次；
     在 useLayoutEffect 里 setState 会在浏览器绘制前同步补一帧，不会有原点闪烁 */
  useLayoutEffect(() => {
    if (hover === null || !tipRef.current) return;
    const el = tipRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setTipSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [hover, labels, values, secondary]);

  /* 宽度跟随容器：与 Vue 的 ResizeObserver 同一件事，只是接线方式换成 effect */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 准星：横向找最近的数据点（比较 SVG 坐标，容器宽度与 svg 等宽所以 1:1）
  function onMove(event) {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !target.length) return;
    const x = event.clientX - rect.left;
    let nearest = 0;
    target.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(target[nearest].x - x)) nearest = i;
    });
    setHover(nearest);
  }

  function onLeave() {
    setHover(null);
  }

  return (
    <div
      ref={boxRef}
      className={cls('trend', `tone-${tone}`, `sec-tone-${secondaryTone}`)}
      style={{ height: `${height}px` }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <svg width={width} height={height} role="img" aria-label={`趋势图，峰值 ${Math.max(0, ...values)}${unit}`}>
        <defs>
          <linearGradient id={`tg-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="trend-stop" stopOpacity=".2" />
            <stop offset="100%" className="trend-stop" stopOpacity="0" />
          </linearGradient>
          <pattern id={`th-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
        </defs>
        <g className="trend-grid">
          {ticks.map((t) => (
            <line key={t.y} x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} />
          ))}
        </g>
        {bandRect ? (
          <rect
            x={bandRect.x}
            y={PAD.top}
            width={bandRect.w}
            height={innerH}
            fill={`url(#th-${uid})`}
            className="trend-band"
          />
        ) : null}
        <g className="trend-axis">
          {ticks.map((t) => (
            <text key={`l${t.y}`} x={PAD.left - 10} y={t.y + 3.5} textAnchor="end">
              {t.label}
            </text>
          ))}
          {xLabels.map((l) => (
            <text key={`x${l.i}`} x={target[l.i]?.x} y={height - 8} textAnchor={l.i === 0 ? 'start' : l.i === n - 1 ? 'end' : 'middle'}>
              {l.label}
            </text>
          ))}
        </g>
        {sparse ? (
          <g className="trend-stems">
            <line className="trend-base" x1={PAD.left} x2={width - PAD.right} y1={base} y2={base} />
            {stems.map((st) =>
              !st.v ? (
                <circle key={`s${st.i}`} className="trend-tick" cx={st.x} cy={base} r="1.6" />
              ) : (
                <g key={`s${st.i}`}>
                  <line className="trend-stem" x1={st.x} x2={st.x} y1={base} y2={st.y} />
                  {st.v2 ? (
                    <line
                      className={cls('trend-stem', 'is-secondary')}
                      x1={st.x + 3}
                      x2={st.x + 3}
                      y1={base}
                      y2={st.y2}
                    />
                  ) : null}
                  <circle className="trend-dot" cx={st.x} cy={st.y} r="4.5" />
                  <text className="trend-stem-label" x={st.x} y={st.y - 12} textAnchor="middle">
                    {st.v}
                    {unit}
                  </text>
                </g>
              )
            )}
          </g>
        ) : null}
        {/* v-show 语义：稀疏时保留节点、只隐藏（不是不渲染） */}
        <path
          style={{ display: sparse ? 'none' : undefined }}
          d={areaPath}
          fill={`url(#tg-${uid})`}
        />
        {sec.length && !sparse ? <path className="trend-line-2" d={line2Path} /> : null}
        <path
          style={{ display: sparse ? 'none' : undefined }}
          className="trend-line"
          d={linePath}
        />
        {sparse ? (
          <g />
        ) : showAllDots ? (
          <g className="trend-nodes">
            {target.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3.2" />
            ))}
          </g>
        ) : dots && target.length ? (
          <g className={cls('trend-nodes', 'is-last')}>
            <circle cx={target[target.length - 1].x} cy={target[target.length - 1].y} r="9" className="trend-halo" />
            <circle cx={target[target.length - 1].x} cy={target[target.length - 1].y} r="3.6" />
          </g>
        ) : null}
        {hover !== null && target[hover] ? (
          <g>
            <line className="trend-cursor" x1={target[hover].x} x2={target[hover].x} y1={PAD.top} y2={base} />
            <line className={cls('trend-cursor', 'is-h')} x1={PAD.left} x2={width - PAD.right} y1={target[hover].y} y2={target[hover].y} />
            <circle className="trend-dot" cx={target[hover].x} cy={target[hover].y} r="4.5" />
          </g>
        ) : null}
      </svg>
      {hover !== null && target[hover] ? (
        <div
          ref={tipRef}
          className={cls('trend-tip', 'm-float')}
          style={{ transform: `translate(${tipX}px, ${tipY}px)` }}
        >
          <span className="eyebrow">{labels[hover]}</span>
          <span className="trend-tip-row">
            <i className={cls('tip-key', 'is-primary')} />
            {primaryLabel}
            <b className="tnum">
              {values[hover]}
              {unit}
            </b>
          </span>
          {sec.length ? (
            <span className="trend-tip-row">
              <i className={cls('tip-key', 'is-secondary')} />
              {secondaryLabel}
              <b className="tnum">
                {sec[hover]}
                {unit}
              </b>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
