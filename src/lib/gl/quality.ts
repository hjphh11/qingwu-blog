/**
 * 画质分级与自动降档。
 *
 * 两条判定：
 *  1. **开局分级**：设备是不是移动端（`pointer: coarse` / 窄屏 / 少核），
 *     以及 GPU 是不是软件渲染（SwiftShader / llvmpipe）。软件渲染在无头环境之外
 *     也真实存在 —— 老机器禁用了硬件加速就会这样，那时 12 万粒子会直接卡死。
 *  2. **运行中降档**：连续 2s 平均帧时超 22ms（≈45fps）就降一档。
 *
 * ⚠️ **降档只降一次，不回升**。P0 的残留风险里写明了：在高低画质之间来回切换，
 * 比一直低画质更让人难受（画面会周期性地「变清晰又变糊」）。
 */

import type { QualityTier, SceneKey } from './store';

/** 22ms ≈ 45fps，是「明显掉帧」的门槛，而不是 16.7ms —— 追满帧会误降。 */
const SLOW_FRAME_MS = 22;
/** 连续这么久都慢才降，避免一次 GC / 切标签页造成的尖峰误判 */
const SUSTAIN_MS = 2000;

type Budget = {
  /** 浮尘粒子数 */
  dust: number;
  /** 后期档位：full = Bloom + Vignette + Noise；bloom = 只有 Bloom 且强度减半 */
  post: 'full' | 'bloom';
  /** 设备像素比上限 */
  maxDpr: number;
};

/**
 * 场景预算（对应 v6 §4.2 / §4.7 的桌面列，low 档取手机列）。
 * 数值集中在这里，场景组件只管读，不自己写死 —— 否则调预算要翻五个文件。
 */
const BUDGETS: Record<SceneKey, { high: Budget; low: Budget }> = {
  home: {
    high: { dust: 120_000, post: 'full', maxDpr: 2 },
    low: { dust: 50_000, post: 'bloom', maxDpr: 1.5 },
  },
  reading: {
    high: { dust: 40_000, post: 'full', maxDpr: 2 },
    low: { dust: 20_000, post: 'bloom', maxDpr: 1.5 },
  },
  projects: {
    high: { dust: 20_000, post: 'full', maxDpr: 2 },
    low: { dust: 10_000, post: 'bloom', maxDpr: 1.5 },
  },
  sound: {
    high: { dust: 30_000, post: 'full', maxDpr: 2 },
    low: { dust: 15_000, post: 'bloom', maxDpr: 1.5 },
  },
};

export function budgetFor(scene: SceneKey, tier: QualityTier): Budget {
  return BUDGETS[scene][tier];
}

/**
 * 开局分级。不需要 WebGL context —— 只看设备特征，所以能在 `<Canvas>` 建起来之前决定 dpr。
 * GPU 字符串要拿到 renderer 之后才能读，见 `tierFromRenderer`。
 */
export function detectInitialTier(): QualityTier {
  if (typeof window === 'undefined') return 'high';

  // 移动端 / 触屏 → 直接低档。这条最重要：手机上 12 万粒子是灾难。
  if (window.matchMedia('(pointer: coarse)').matches) return 'low';
  if (window.innerWidth < 900) return 'low';
  // 核数很少的机器基本也不会带好显卡
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency ?? 4;
  if (cores <= 4) return 'low';

  return 'high';
}

/**
 * 软件渲染检查。拿到 renderer 之后调一次。
 * headless 环境（SwiftShader）会命中 —— 那不是真机，降档是对的，否则测不出真实行为。
 */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    return /swiftshader|llvmpipe|software|microsoft basic render/.test(name);
  } catch {
    return false;
  }
}

/**
 * 帧时监视器。喂 `frame(deltaMs)`，超时就回调一次然后自杀。
 *
 * 为什么用「连续 2s 的滑动判定」而不是采样计数：切标签页回来、
 * 一次大 GC、首帧编译 shader 都会造成单帧上百毫秒，按单帧判会误降档。
 */
export class FrameWatchdog {
  private slowFor = 0;
  private fired = false;

  constructor(private readonly onSlow: () => void) {}

  frame(deltaMs: number) {
    if (this.fired) return;
    // delta 会被上层夹到合理范围，这里再兜一次：异常大的值直接忽略
    const ms = Math.min(deltaMs, 1000);
    if (ms > SLOW_FRAME_MS) this.slowFor += ms;
    else this.slowFor = Math.max(0, this.slowFor - ms * 0.5); // 快的帧往回退，但退得慢

    if (this.slowFor >= SUSTAIN_MS) {
      this.fired = true;
      this.onSlow();
    }
  }

  get firedOnce() {
    return this.fired;
  }
}
