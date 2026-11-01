/**
 * 全站唯一的光场画布。
 *
 * 挂载方式按 P0 结论走**方案 A**：`Layout.astro` 里一个
 * `<div transition:persist="gl-layer">` 包着这个组件（`client:only="react"`），
 * 于是 Canvas 跨路由存活 —— 同一个 DOM 节点、同一个 WebGL context、RAF 从不中断。
 *
 * ── 这个文件要守住 P0 挖出来的四件事 ──────────────────────────
 * 1. **2.3.6 后台不停渲染**（P0 唯一不通过项）：`frameloop` 随 `visibilitychange`
 *    在 'always' / 'never' 之间切。`qhidden` 那套 CSS 只管 DOM 动画，管不到 R3F。
 * 2. **delta 夹取**：后台切回来那帧 delta 是几秒，见 store.ts 的 `clampDelta`。
 * 3. **context 丢失兜底**：真机上显存不足 / iOS 后台回收都会丢，丢了要能恢复，
 *    恢复不了就停下不再空转。
 * 4. **场景切换不能靠 React 挂载/卸载**：persist 之后 Canvas 不会被卸载，
 *    所以 scene 从 store 来（由 `astro:page-load` 写入），切换靠一层光晕遮罩。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import CameraRig from './CameraRig';
import SceneRouter from './SceneRouter';
import Post from './Post';
import { FrameWatchdog, budgetFor, detectInitialTier, isSoftwareRenderer } from '../../lib/gl/quality';
import {
  clampDelta,
  downgradeTier,
  getGlState,
  initGlInput,
  setActive,
  setContextLost,
  subscribe,
  wireGlToRouter,
  type SceneKey,
} from '../../lib/gl/store';

/** 场景切换过渡的一半时长（ms）。总时长 = 2 × 它 = 600ms，与 v6 的 0.6s 一致。 */
const HALF_MS = 300;

/**
 * 帧时看守。降档只发生一次（`FrameWatchdog` 内部 fired 后自杀）。
 * 顺便把帧数记到 `window.__qGl.frames` —— 验收脚本靠它判断「切后台后帧数有没有停」。
 */
function Watchdog() {
  const watchdog = useRef<FrameWatchdog | null>(null);
  if (!watchdog.current) {
    watchdog.current = new FrameWatchdog(() => {
      // 诊断标记：验收脚本靠它判断「看守确实触发过」。
      // 在软件渲染的 headless 里开局就已经是 low 档，`downgradeTier()` 会返回 false，
      // 光看 tier 无法区分「没触发」和「触发了但已经是最低档」。
      const g = window as unknown as { __qGl?: { watchdogFired?: boolean } };
      if (g.__qGl) g.__qGl.watchdogFired = true;
      downgradeTier();
    });
  }
  useFrame((_state, delta) => {
    const g = window as unknown as { __qGl?: { frames: number } };
    if (g.__qGl) g.__qGl.frames++;
    watchdog.current!.frame(clampDelta(delta) * 1000);
  });
  return null;
}

export default function CanvasHost() {
  const state = useSyncExternalStore(subscribe, getGlState, getGlState);

  /** 实际渲染的场景。与 store 的 scene 之间隔着 0.6s 的过渡。 */
  const [visibleScene, setVisibleScene] = useState<SceneKey>(state.scene);
  const visibleRef = useRef<SceneKey>(state.scene);
  const flashRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  /** WebGL 不可用就直接不挂画布 —— 页面本身完全不依赖它，这是最省事的兜底。 */
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    initGlInput();
    wireGlToRouter();

    // 开局分级：没有 WebGL 就直接退场；有的话按设备特征定 dpr 上限
    try {
      const probe = document.createElement('canvas');
      const ok = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
      setSupported(ok);
      if (!ok) return;
    } catch {
      setSupported(false);
      return;
    }

    if (detectInitialTier() === 'low') downgradeTier();

    // 调试 / 验收入口。不给业务用，只给 scripts 里的回归脚本读。
    // `frames` 用来判断「切后台后有没有真的停下来」，
    // `info()` 用来核对 draw calls / 三角形数是否在预算内。
    const g = window as unknown as {
      __qGl?: { frames: number; state: typeof getGlState; info?: () => unknown };
    };
    g.__qGl = { frames: 0, state: getGlState };
  }, []);

  /* ── 场景过渡：光晕亮起 → 换子树 → 退去 ──────────────────────
     为什么不用淡入淡出：Canvas 是透明的，没有黑场掩护，直接换子树会看到
     「几何体凭空消失又出现」。用一层暖色光晕盖住切换的那一帧，
     观感上是「光散开又重新聚拢」，比黑场更贴合这个站的气质。 */
  useEffect(() => {
    if (state.scene === visibleRef.current) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = flashRef.current;

    const commit = (s: SceneKey) => {
      visibleRef.current = s;
      setVisibleScene(s);
    };

    if (!el || reduce) {
      // 首次挂载时 state.scene === visibleRef.current，上面已经提前 return，
      // 所以走到这里一定是「真的换了场景但没法做动画」（减动效 / 光晕节点没就位）
      commit(state.scene);
      if (el) el.style.opacity = '0';
      return;
    }

    const target = state.scene;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    const step = (now: number) => {
      const t = now - start;
      if (t < HALF_MS) {
        el.style.opacity = String(t / HALF_MS);
        rafRef.current = requestAnimationFrame(step);
      } else if (t < HALF_MS * 2) {
        // 光晕最亮的时刻换场景 —— 这一帧被光盖住，看不到替换
        if (visibleRef.current !== target) commit(target);
        el.style.opacity = String(1 - (t - HALF_MS) / HALF_MS);
        rafRef.current = requestAnimationFrame(step);
      } else {
        el.style.opacity = '0';
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [state.scene]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const budget = budgetFor(visibleScene, state.tier);
  const running = state.active && !state.contextLost && supported;

  return (
    <div className="q-gl" aria-hidden="true">
      {/* 过渡光晕。在 canvas 之上、内容之下 —— 所以它亮起来时不会盖住文字 */}
      <div ref={flashRef} className="q-gl__flash" />

      {supported && (
        <Canvas
          className="q-gl__canvas"
          // 透明画布：底下还有 BackgroundDecor 的极光与樱花，不能被一块不透明的底盖掉
          gl={{ alpha: true, antialias: false, powerPreference: 'high-performance', stencil: false }}
          dpr={[1, budget.maxDpr]}
          frameloop={running ? 'always' : 'never'}
          camera={{ position: [0, 0, 6], fov: 55, near: 0.1, far: 60 }}
          onCreated={({ gl }) => {
            const ctx = gl.getContext();

            // 软件渲染（SwiftShader / llvmpipe / 禁用硬件加速）直接降到低档，
            // 否则 12 万粒子会把它压成幻灯片 —— 这类机器在现实中真的存在。
            if (isSoftwareRenderer(ctx)) downgradeTier();

            const g = window as unknown as { __qGl?: Record<string, unknown> };
            if (g.__qGl) {
              g.__qGl.info = () => ({
                calls: gl.info.render.calls,
                triangles: gl.info.render.triangles,
                points: gl.info.render.points,
                dpr: gl.getPixelRatio(),
                programs: gl.info.programs?.length ?? 0,
              });
            }

            // ⚠️ 关掉自动重置：EffectComposer 一帧里会 render 好几次（场景 pass + 各后期 pass），
            // 默认 autoReset 会在每次 render 前清零，于是 info 只剩最后一趟全屏 quad 的 1 个 call。
            // 关掉之后由 Post 在每帧开头手动 reset，统计到的才是这一帧的总量。
            gl.info.autoReset = false;

            gl.domElement.addEventListener('webglcontextlost', (e) => {
              // 不 preventDefault 的话浏览器不会尝试恢复
              e.preventDefault();
              setContextLost(true);
            });
            gl.domElement.addEventListener('webglcontextrestored', () => {
              setContextLost(false);
            });
          }}
        >
          <CameraRig />
          <SceneRouter scene={visibleScene} tier={state.tier} />
          <Post scene={visibleScene} tier={state.tier} />
          <Watchdog />
        </Canvas>
      )}
    </div>
  );
}
