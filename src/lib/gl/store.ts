/**
 * 光场状态（glStore）。
 *
 * 为什么必须有这个文件：`<Canvas>` 用 `transition:persist` 常驻之后，它的生命周期与
 * Astro 路由**完全解耦**（P0 实测：同一个 DOM 节点、同一个 WebGL context，RAF 从不中断）。
 * 于是「现在在哪个页面」不能再靠组件挂载/卸载传递 —— 必须有一个外部状态源，
 * 由 `astro:page-load` 写进来。不补这一层，会得到「首页场景永远不切」的 bug。
 *
 * ── 两类数据分开存，这是性能上的关键 ──────────────────────────────
 *  · state  —— 低频（切场景 / 降档 / 前后台 / context 丢失），变化时**通知**订阅者，
 *    React 会重渲染。
 *  · motion —— 高频（指针、滚动），**只写不通知**。useFrame 每帧直接读最新值。
 *    如果指针也走通知，每秒 60 次 setState 会把 React 拖死，而这个值根本不需要
 *    触发渲染 —— 它只是喂给 uniform 的原始输入。
 *
 * ── 纪律（v6 §6.3）──────────────────────────────────────────────
 * 所有 uniform 的更新都走 store → useFrame 读取，
 * **禁止在 DOM 事件回调里直接改 Three 对象**（会造成抖动）。
 * 也就是说：监听器只负责把数字写进 `motion`，改相机/改材质一律发生在 useFrame 内。
 */

export type SceneKey = 'home' | 'reading' | 'projects' | 'sound';
export type QualityTier = 'high' | 'low';

export type GlState = {
  /** 当前场景。由 pathname 推导，见 sceneKey.ts */
  scene: SceneKey;
  /** 画质档位。`low` 是降档后的结果，**只降不升**，避免来回抖 */
  tier: QualityTier;
  /** 页面是否在前台。false 时 frameloop 应为 never */
  active: boolean;
  /** WebGL context 是否已丢失。是则展示静态兜底，不再渲染 */
  contextLost: boolean;
};

let state: GlState = {
  scene: 'home',
  tier: 'high',
  active: true,
  contextLost: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** 订阅（React 用 useSyncExternalStore，非 React 代码也可直接用） */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 取当前快照。useSyncExternalStore 要求同一个 state 对象引用稳定，
 *  所以只在真的变了的时候才换对象 —— 否则会无限重渲染。 */
export function getGlState(): GlState {
  return state;
}

function patch(next: Partial<GlState>) {
  let changed = false;
  for (const k of Object.keys(next) as (keyof GlState)[]) {
    if (state[k] !== next[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...next };
  emit();
}

export function setScene(scene: SceneKey) {
  patch({ scene });
}

/**
 * 降档。**只能往下降，不能升回去** —— P0 的残留风险里写明了「降档只降一次，不来回抖」。
 * 在高帧率与低帧率之间反复切换比一直低画质更让人难受。
 */
export function downgradeTier() {
  if (state.tier === 'low') return false;
  patch({ tier: 'low' });
  return true;
}

export function setActive(active: boolean) {
  patch({ active });
}

export function setContextLost(contextLost: boolean) {
  patch({ contextLost });
}

/* ── 高频输入：只写不通知 ──────────────────────────────────────── */

/**
 * 指针（归一化到 -1..1，原点在视口中心）。
 * 触屏设备没有 hover，保持 0 即可 —— 由 CameraRig 决定要不要跟随。
 */
export const pointer = { x: 0, y: 0 };

/** 全局滚动进度 0..1。0 是页顶，1 是页底（内容不足一屏时恒为 0）。 */
export const scroll = { progress: 0 };

/**
 * 夹住 delta（秒）。
 *
 * P0 明确要求：从后台标签页切回来时，R3F 给的 `delta` 会是**几秒**（那一帧的
 * 时间差就是离开的时长）。直接拿它去累加 `uTime` 或做插值，画面会瞬移一下 ——
 * 粒子整体漂走、相机一下子飞出去。
 * 夹到 1/20 秒（相当于最低按 20fps 记），既保住了正常帧的精度，
 * 又让「一大段空白时间」被当成一次普通的慢帧处理。
 */
export function clampDelta(delta: number): number {
  return Math.min(delta, 1 / 20);
}

/**
 * 减动效偏好。缓存一次，别每帧去问 matchMedia（那会每帧创建一个 MediaQueryList）。
 * 只在客户端调用 —— 光场组件都是 `client:only`，不存在 SSR 期取值的问题。
 */
let reduceCache: boolean | null = null;

export function reduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (reduceCache === null) {
    reduceCache = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return reduceCache;
}

/* ── 全局输入接线 ─────────────────────────────────────────────── */

let inputWired = false;

/**
 * 指针 + 滚动的监听只装一次。
 * 用 `passive: true`：这两个回调绝不会 preventDefault，声明 passive 能让浏览器
 * 不等待回调就滚动，滚动跟手感更好。
 */
export function initGlInput() {
  if (inputWired || typeof window === 'undefined') return;
  inputWired = true;

  const fine = window.matchMedia('(pointer: fine)');

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!fine.matches) return;
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );

  // 指针离开窗口时回正，否则视差会卡在最后一帧的位置
  window.addEventListener('pointerleave', () => {
    pointer.x = 0;
    pointer.y = 0;
  });

  const readScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    scroll.progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', readScroll);
  readScroll();
}

/* ── 路由 → 场景 ──────────────────────────────────────────────── */

/**
 * 场景推导。单独放在这里而不是 sceneKey.ts，是为了让「改路由」只有一处要动。
 *
 * ⚠️ 这里的路径是**当前站**的（`/blog`、`/music`）。第 7-9 条会把路由迁到
 * v6 的 `/writing`、`/sound`、`/projects`，届时只需要改这个函数。
 */
export function sceneForPath(pathname: string): SceneKey {
  const p = pathname.replace(/\/+$/, '') || '/';

  if (p === '/') return 'home';
  if (p.startsWith('/writing') || p.startsWith('/blog')) return 'reading';
  if (p.startsWith('/music') || p.startsWith('/sound')) return 'sound';
  if (p.startsWith('/projects') || p.startsWith('/about')) return 'projects';
  // 友链 / 分享 / 申请表单 / 404 都按「安静场景」处理 —— 它们都需要读字。
  return 'reading';
}

/**
 * 把 store 接到 Astro 路由上。**只装一次**。
 *
 * 为什么监听 `astro:page-load` 而不是靠 React：persist 之后 Canvas 不会被卸载，
 * 所以拿不到「新页面挂载」这个信号。`astro:page-load` 是 ClientRouter 每次切页
 * 完成后都会派发的事件，是唯一可靠的入口。
 */
let routerWired = false;

export function wireGlToRouter() {
  if (routerWired || typeof window === 'undefined') return;
  routerWired = true;

  const sync = () => setScene(sceneForPath(location.pathname));
  sync();
  document.addEventListener('astro:page-load', sync);

  // 前后台：P0 的 2.3.6 不通过项。Layout 里已有一个 qhidden 的脚本会派发
  // `qingwu:visibility`，复用它，不再重复监听 visibilitychange。
  window.addEventListener('qingwu:visibility', (e) => {
    setActive(!!(e as CustomEvent<boolean>).detail);
  });
}
