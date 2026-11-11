/**
 * 画市 · 一面可以往任意方向拖的图片墙（/gallery）
 *
 * ── 它是怎么「无限」的 ──────────────────────────────────────
 * 不做真·无限画布（那需要动态增删节点）。做法是把图片排成一块**图案**：
 *   cols × rows 个格子，第 k 个格子的图是 items[k % n]。
 * 这块图案在横竖各铺 **2 份**（范围 -1 → 0，见 cx/cy），然后只写一个位移：
 *
 *   layer.style.transform = translate3d(mod(off.x, P.x), mod(off.y, P.y), 0)
 *
 * mod 落在 [0, P)，图案铺在 [-P, P] —— 视口 [0, vw] 永远被盖住，且 P ≥ 视口，
 * 所以任何位移都不会露边。位移跨过 P 时是「整块跳一格」，因为图案本身周期就是 P，
 * 这一跳看不出来。这就是「拖到哪里都有图」的全部秘密。
 *
 * ⚠️ 为什么不用 Motion 的 `drag`：它靠 setPointerCapture 接管指针，pointerup 的
 * target 会变成拖拽层本身，而 `click` 按规范派发到 pointerdown/pointerup 的共同祖先
 * —— 也就是拖拽层，瓦片上的 onClick 收不到。这里自己接管指针，松手时用
 * elementFromPoint 反查手上那张图，拖拽和点击互不干扰。
 *
 * ── 惯性 ──────────────────────────────────────────────────
 * 按帧衰减 v *= 0.94^(dt/16.7)，速度 < 8px/s 收手。一次 2000px/s 的甩手大约 1.4s 停住，
 * 是「慢慢停下」而不是「滑走」。减动效下直接不滑（松手即停）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { galleryItems as ITEMS, gallerySource as SOURCE } from '../../data/gallery';

/** 格子边长：随视口宽走，但有上下限 —— 手机上太小的格子拖起来没手感，太大又像单图 */
const CELL_MIN = 150;
const CELL_MAX = 300;
/** 格子间距（瓦片本体 = 格子 − 间距，等于留白） */
const GAP = 10;
/** 甩手速度上限（px/s），防止一次暴拖把画面甩到天边 */
const MAX_V = 4200;
/** 每帧衰减系数（60fps 基准） */
const FRICTION = 0.94;
/** 低于这个速度就停 */
const MIN_V = 8;
/** 判定「拖动」而不是「点击」的位移阈值（px）—— 手指比鼠标抖，给宽一点 */
const TAP_SLOP = 8;

const mod = (v: number, p: number) => ((v % p) + p) % p;

export default function GalleryWall() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [moved, setMoved] = useState(false); // 第一次拖动后收起提示

  const layerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /** 累计位移（不做取模，取模只在绘制时做） */
  const off = useRef({ x: 0, y: 0 });
  /** 当前图案周期，绘制前读它，避免闭包拿到旧的 */
  const period = useRef({ x: 1, y: 1 });
  /** 松手那一刻的落点：位移够小就当成「点了一下」，用它反查手上是哪张图 */
  const sameSpot = useRef<null | { x: number; y: number }>(null);

  const drag = useRef<{
    id: number;
    sx: number;
    sy: number;
    baseX: number;
    baseY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const raf = useRef(0);
  /** 减动效：拖拽本身是用户主动发起的，保留；但松手后不再「自己滑」。 */
  const reduce = useRef(false);

  /* ── 尺寸 ──────────────────────────────────────────────── */
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reduce.current = mq.matches;
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /* ── 图案：cols×rows 的格子 + 横竖各两份 ─────────────────── */
  const layout = useMemo(() => {
    const { w, h } = size;
    if (!w || !h || !ITEMS.length) return null;

    const cell = Math.round(Math.min(CELL_MAX, Math.max(CELL_MIN, w * 0.2)));
    const pitch = cell + GAP;
    // 只取 ceil：cols × pitch ≥ 视口宽就够了，多一格白多 12 个节点
    const cols = Math.max(1, Math.ceil(w / pitch));
    const rows = Math.max(1, Math.ceil(h / pitch));
    const periodX = cols * pitch;
    const periodY = rows * pitch;

    const tiles: { key: string; idx: number; left: number; top: number }[] = [];
    // cx/cy 取 -1 与 0：图案原点在 0，位移取模后落在 [0, P)，
    // 于是视口左/上那条缝由 -1 那份补上，右边/下面 0 那份本来就够。
    for (let cy = -1; cy <= 0; cy++) {
      for (let cx = -1; cx <= 0; cx++) {
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            tiles.push({
              key: `${cx}:${cy}:${i}:${j}`,
              idx: (i + j * cols) % ITEMS.length,
              left: cx * periodX + i * pitch,
              top: cy * periodY + j * pitch,
            });
          }
        }
      }
    }

    return { cell, cols, rows, periodX, periodY, tiles };
  }, [size]);

  /** 把任意位移画上去（唯一的写 DOM 的地方） */
  const paint = useCallback(() => {
    const el = layerRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${mod(off.current.x, period.current.x)}px, ${mod(
      off.current.y,
      period.current.y,
    )}px, 0)`;
  }, []);

  useEffect(() => {
    if (!layout) return;
    period.current = { x: layout.periodX, y: layout.periodY };
    paint();
  }, [layout, paint]);

  /* ── 惯性 ────────────────────────────────────────────────── */
  const stopGlide = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const glide = useCallback(
    (vx: number, vy: number) => {
      stopGlide();
      let t = performance.now();
      const step = (now: number) => {
        const dt = Math.min(64, now - t); // 切标签页回来时 dt 会很大，夹住
        t = now;
        const decay = Math.pow(FRICTION, dt / 16.7);
        vx *= decay;
        vy *= decay;
        off.current.x += (vx * dt) / 1000;
        off.current.y += (vy * dt) / 1000;
        paint();
        if (Math.hypot(vx, vy) > MIN_V) raf.current = requestAnimationFrame(step);
        else raf.current = 0;
      };
      raf.current = requestAnimationFrame(step);
    },
    [paint, stopGlide],
  );

  useEffect(() => stopGlide, [stopGlide]);

  /* ── 指针 ────────────────────────────────────────────────── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopGlide();
    drag.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      baseX: off.current.x,
      baseY: off.current.y,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    };
    sameSpot.current = null; // 上一轮留下的点击目标作废
    surfaceRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;

    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      d.moved = true;
      setMoved(true);
    }

    off.current.x = d.baseX + dx;
    off.current.y = d.baseY + dy;
    paint();

    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) {
      // 指数平滑：最后一个 move 事件经常只有一个采样点，直接拿它当速度会抖
      const ivx = ((e.clientX - d.lastX) / dt) * 1000;
      const ivy = ((e.clientY - d.lastY) / dt) * 1000;
      d.vx = d.vx * 0.6 + ivx * 0.4;
      d.vy = d.vy * 0.6 + ivy * 0.4;
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
  };

  /** 松手时用来记「这次是点还是拖」：位移够小就在原地找那张图 */
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    surfaceRef.current?.releasePointerCapture(e.pointerId);

    if (d.moved) {
      // 抬手前 60ms 内没再动 ⇒ 视为已经停住，别再滑（否则「拖到位后轻轻一放」会漂）
      if (!reduce.current && performance.now() - d.lastT < 60) {
        const vx = Math.max(-MAX_V, Math.min(MAX_V, d.vx));
        const vy = Math.max(-MAX_V, Math.min(MAX_V, d.vy));
        if (Math.hypot(vx, vy) > 240) glide(vx, vy);
      }
      return;
    }

    sameSpot.current = { x: e.clientX, y: e.clientY };
  };

  const onClickCapture = (e: React.MouseEvent) => {
    // 拖动结束时浏览器仍会补一个 click —— 那时 sameSpot 是空的，正好挡掉
    const spot = sameSpot.current;
    if (!spot) return;
    sameSpot.current = null;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-gallery-idx]');
    if (!el) return;
    setView(Number(el.dataset.galleryIdx));
  };

  /* ── 页面级：锁滚动 + 接管 .astro 里那份无障碍清单 ────────── */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('q-wall-page');

    // astro 页里那份「列表版」是给读屏和 no-JS 用的，有 JS 时点它应该进灯箱而不是跳走
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-gallery-open]'));
    const onLink = (e: Event) => {
      const a = e.currentTarget as HTMLAnchorElement;
      e.preventDefault();
      setView(Number(a.dataset.galleryOpen));
    };
    links.forEach((a) => a.addEventListener('click', onLink));

    return () => {
      root.classList.remove('q-wall-page');
      links.forEach((a) => a.removeEventListener('click', onLink));
    };
  }, []);

  /* ── 键盘：方向键推动画面；灯箱开着时交给灯箱 ─────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== null) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setView(null);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const step = e.key === 'ArrowRight' ? 1 : -1;
          setView((v) => (v === null ? v : (v + step + ITEMS.length) % ITEMS.length));
        }
        return;
      }
      if (e.target !== surfaceRef.current) return;
      const step = e.shiftKey ? 320 : 120;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const delta = map[e.key];
      if (!delta) return;
      e.preventDefault();
      stopGlide();
      off.current.x += delta[0];
      off.current.y += delta[1];
      paint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, paint, stopGlide]);

  /* ── 灯箱开合时把焦点接上 ───────────────────────────────── */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (view !== null) {
      wasOpen.current = true;
      closeRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      surfaceRef.current?.focus();
    }
  }, [view]);

  const current = view !== null ? ITEMS[view] : null;

  return (
    /*
     * ⚠️ 灯箱（.q-wall-view）**不能**放进 .q-wall 里面：.q-wall 带 z-index:0，
     * 那是一个层叠上下文 —— 里面的 z-index:300 只在这个上下文里算数，实际层级
     * 还是「墙」这一层，会被 z-50 的导航压在下面（截图里导航亮在暗背景之上就是这个）。
     * 所以在 body 这一层并列：墙 / 提示 / 灯箱，各用各的 z-index。
     */
    <>
      <div className={`q-wall${dragging ? ' is-dragging' : ''}`}>
      <div
        ref={surfaceRef}
        className="q-wall__surface"
        role="region"
        aria-label="画市：可拖动的图片墙，方向键也能推"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        <div ref={layerRef} className="q-wall__layer" aria-hidden="true">
          {layout?.tiles.map((t) => {
            const item = ITEMS[t.idx];
            return (
              <button
                key={t.key}
                type="button"
                tabIndex={-1}
                data-gallery-idx={t.idx}
                className="q-wall__tile"
                style={{ left: t.left, top: t.top, width: layout.cell, height: layout.cell }}
              >
                <img
                  src={`/images/gallery/${item.id}-t.webp`}
                  alt=""
                  width={560}
                  height={560}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
      </div>
      </div>

      <p className={`q-wall__hint${moved ? ' is-gone' : ''}`} aria-hidden="true">
        按住往任意方向拖 · 点图看大图
      </p>

      {SOURCE && (
        <p className="q-wall__credit">
          图片来自{' '}
          <a href={SOURCE} target="_blank" rel="noopener noreferrer">
            昭鸢笺 · 画廊
          </a>
        </p>
      )}

      {/* 看大图 */}
      <div
        className={`q-wall-view${current ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="看大图"
        aria-hidden={current ? undefined : true}
      >
        <div className="q-wall-view__stage" onClick={() => setView(null)}>
          {current && (
            <img
              key={current.id}
              className="q-wall-view__img"
              src={`/images/gallery/${current.id}.webp`}
              width={current.w}
              height={current.h}
              alt=""
              decoding="async"
            />
          )}
        </div>

        <button
          type="button"
          className="q-wall-view__btn q-wall-view__btn--prev"
          aria-label="上一张"
          onClick={() => setView((v) => (v === null ? v : (v - 1 + ITEMS.length) % ITEMS.length))}
        >
          ‹
        </button>
        <button
          type="button"
          className="q-wall-view__btn q-wall-view__btn--next"
          aria-label="下一张"
          onClick={() => setView((v) => (v === null ? v : (v + 1) % ITEMS.length))}
        >
          ›
        </button>
        <button
          ref={closeRef}
          type="button"
          className="q-wall-view__btn q-wall-view__btn--close"
          aria-label="关闭"
          onClick={() => setView(null)}
        >
          ×
        </button>
        <p className="q-wall-view__count" aria-hidden="true">
          {view !== null ? `${view + 1} / ${ITEMS.length}` : ''}
        </p>
      </div>
    </>
  );
}
