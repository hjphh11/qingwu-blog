/**
 * 音频电平分析 —— 给「声波」提供真实数据。
 *
 * v6 §8.2 明确要求「用 Web Audio `AnalyserNode`，**不是假装随机跳**」，
 * 所以这里读的是 `<audio>` 里真实的采样。几个必须守住的点：
 *
 * ① **`crossOrigin` 必须在 `src` 之前设**。跨域音频若没走 CORS，
 *    `createMediaElementSource` 的输出会被规范要求静音 —— 于是声音正常、频谱永远全 0，
 *    查起来极难。对象存储回了 `Access-Control-Allow-Origin: *`（已核对），
 *    所以设 `anonymous` 是安全的；换托管商时要重新确认这一条。
 *
 * ② **`createMediaElementSource` 一个元素只能建一次**，而且建完音频就不再直连
 *    输出 —— 必须手动 `connect(destination)`，否则一接分析器就没声音了。
 *
 * ③ **`AudioContext` 要在用户手势里创建/恢复**，否则是 `suspended`。
 *    这里由 `attach()` 在首次播放时惰性创建（播放必然是点击触发的）。
 *
 * ④ 失败就**别画**。取不到数据时返回 false，界面把声波整块隐藏 ——
 *    宁可没有，也不要放一个假跳的动画。
 */

let ctx: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array | null = null;
/** 一次失败就记住，别每次播放都重试（某些环境会反复抛异常）。 */
let unavailable = false;
/** 已接上的元素，防止重复建 source。 */
let attachedEl: HTMLAudioElement | null = null;

/** 每次读到的频段数（40 根柱）。fftSize=256 → 128 bin，按对数分桶。 */
export const BAND_COUNT = 40;

/**
 * 把分析器接到播放元素上。返回是否可用。
 * 幂等：同一个元素重复调用直接返回 true。
 */
export function attachAnalyser(el: HTMLAudioElement): boolean {
  if (unavailable) return false;
  if (analyser && attachedEl === el) return true;

  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        unavailable = true;
        return false;
      }
      ctx = new Ctor();
    }
    if (!source) {
      source = ctx.createMediaElementSource(el);
      attachedEl = el;
      analyser = ctx.createAnalyser();
      // 256 → 128 个 bin，对「40 根柱」足够；再大只是多算。
      analyser.fftSize = 256;
      // 不做额外平滑：柱子的阻尼在 Spectrum 里按帧做，那里才知道是否在播。
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      // 必须接回输出，否则接了分析器就没声音了（见文件头 ②）。
      analyser.connect(ctx.destination);
      bins = new Uint8Array(analyser.frequencyBinCount);
    }
    return true;
  } catch {
    unavailable = true;
    return false;
  }
}

/** 从手势里恢复上下文（浏览器可能把新上下文置为 suspended）。 */
export function resumeAnalyser() {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/**
 * 读一帧电平，写进 `out`（长度应为 BAND_COUNT），值域 0..1。
 * 返回 false 表示拿不到数据（此时调用方应当淡出而不是乱跳）。
 */
export function readBands(out: Float32Array): boolean {
  if (!analyser || !bins) return false;
  analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);

  // 对数分桶：低频 bin 少、高频 bin 多，线性分桶会让左边 35 根柱挤在低音区不动。
  // 20Hz~20kHz 的人耳范围里，前 8 个 bin 就占了 0~1.4kHz，所以必须按 log 划。
  const n = out.length;
  const maxBin = bins.length;
  let any = false;
  for (let i = 0; i < n; i++) {
    // i/n 与 (i+1)/n 之间在 log 域上的落点
    const a = Math.floor(Math.pow(maxBin, i / n));
    const b = Math.max(a + 1, Math.floor(Math.pow(maxBin, (i + 1) / n)));
    let sum = 0;
    let cnt = 0;
    for (let k = a; k < b && k < maxBin; k++) {
      sum += bins[k];
      cnt++;
    }
    // 高频天然能量低，做一点倾斜补偿，否则右半边永远是平的。
    // 但补偿不能过头：实测 1.35 时低频段常年顶在 1.0，柱子糊成一根实心长条、
    // 完全没有动态。现在留出余量（0.72 的整体增益 + 1.05 的倾斜），
    // 让峰值落在 0.6~0.9 一带，看得出起伏。
    const tilt = 1 + (i / n) * 1.05;
    const v = Math.min(1, ((sum / Math.max(cnt, 1)) / 255) * 0.72 * tilt);
    out[i] = v;
    if (v > 0.01) any = true;
  }
  return any;
}

/** 当前是否可用（界面据此决定要不要显示声波）。 */
export function analyserReady() {
  return !!analyser && !unavailable;
}
