/**
 * 后期：Bloom + Vignette + Noise。
 *
 * 为什么不引入 `@react-three/postprocessing`：three 0.187 自带完整的
 * `EffectComposer` / `UnrealBloomPass` / `OutputPass`，够用了。多一个依赖就多一份
 * 与 R3F 9 / React 19 的版本耦合风险，而这个项目的后期需求很简单。
 *
 * ── 两个实现要点 ──────────────────────────────────────────────
 * 1. **接管渲染**：R3F 里只要有 `useFrame(cb, priority)` 的 priority > 0，
 *    自动渲染就会被关掉，由我们调 `composer.render()`。这是官方支持的用法，
 *    不需要 hack `gl.render`。
 * 2. **Vignette 与 Noise 合成一个 pass**：两者都是全屏像素运算，
 *    拆成两个 ShaderPass 就是两次额外的全屏采样。合并后少一次。
 *
 * 画布是**透明**的（`alpha: true`），所以后期必须守住 alpha：
 * 暗角只乘 rgb、噪点只在有内容的地方加，否则整个视口会蒙上一层灰。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { budgetFor } from '../../lib/gl/quality';
import { clampDelta, type QualityTier, type SceneKey } from '../../lib/gl/store';
/** 暗角 + 噪点合并 pass */
const VignetteNoiseShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uNoise: { value: 0.015 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uNoise;
    uniform vec2  uResolution;
    varying vec2 vUv;

    // 便宜的 hash 噪点（不用纹理，省一次采样和一个资源）
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // 暗角：以中心为原点，半径 0.5 之外开始压暗。只乘 rgb，不动 alpha
      float d = distance(vUv, vec2(0.5));
      float vig = 1.0 - smoothstep(0.35, 0.85, d) * uVignette;
      c.rgb *= vig;

      // 噪点：只在真的有内容的地方加，否则透明区域会被填成灰雾
      if (c.a > 0.004) {
        float n = hash(vUv * uResolution + fract(uTime) * 100.0) - 0.5;
        c.rgb += n * uNoise;
      }

      gl_FragColor = c;
    }
  `,
};

type Props = {
  scene: SceneKey;
  tier: QualityTier;
};

export default function Post({ scene, tier }: Props) {
  const { gl, scene: threeScene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const vnPassRef = useRef<ShaderPass | null>(null);

  const budget = budgetFor(scene, tier);
  // 低档只留 Bloom，且强度减半（v6 §4.7）
  const bloomStrength = budget.post === 'bloom' ? 0.275 : 0.55;

  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    // 透明画布：让 composer 的 render target 带 alpha，并且清成全透明
    c.addPass(new RenderPass(threeScene, camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), bloomStrength, 0.6, 0.82);
    c.addPass(bloom);
    bloomRef.current = bloom;

    if (budget.post === 'full') {
      const vn = new ShaderPass(VignetteNoiseShader);
      vn.uniforms.uResolution.value.set(size.width, size.height);
      c.addPass(vn);
      vnPassRef.current = vn;
    }

    // OutputPass 负责色调映射与 sRGB 转换 —— 少了它颜色会整体偏暗偏灰
    c.addPass(new OutputPass());

    c.setSize(size.width, size.height);
    c.setPixelRatio(gl.getPixelRatio());
    composerRef.current = c;
    return c;
  }, [gl, threeScene, camera, budget.post]);

  // 尺寸变化：composer 与 bloom 都要跟着改，否则模糊半径会按旧分辨率算
  useEffect(() => {
    composer.setSize(size.width, size.height);
    composer.setPixelRatio(gl.getPixelRatio());
    bloomRef.current?.setSize(size.width, size.height);
    const u = vnPassRef.current?.uniforms.uResolution.value as THREE.Vector2 | undefined;
    u?.set(size.width, size.height);
  }, [composer, gl, size.width, size.height]);

  // 卸载时释放 render target，避免切画质档后旧的还占着显存
  useEffect(() => {
    return () => {
      composer.dispose();
      composerRef.current = null;
    };
  }, [composer]);

  // priority > 0 → 关掉 R3F 的自动渲染，由我们驱动
  useFrame((_state, delta) => {
    if (bloomRef.current) bloomRef.current.strength = bloomStrength;
    const vn = vnPassRef.current;
    if (vn) vn.uniforms.uTime.value += clampDelta(delta);
    // 每帧开头手动清一次统计（CanvasHost 里把 autoReset 关了）。
    // 不这么做的话 composer 的多趟 render 会让 info 只剩最后一趟的数字。
    gl.info.reset();
    composer.render();
  }, 1);

  return null;
}
